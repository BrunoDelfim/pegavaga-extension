# PegaVaga — Migração da extensão para TypeScript

> Documento de trabalho: o plano e o **registro** da troca. Boa parte dele foi
> executada e verificada numa pasta de rascunho (`/tmp`) antes de entrar no
> repositório — os pontos verificados estão marcados com ✅.
>
> **Estado hoje:** o caminho sem npm (§3, com uma correção importante), o
> `tsconfig.json` (§6), a ponte entre arquivos sem ESM (§5) e os **passos 1 a 3** da
> ordem (§7 — `edicoes.js`, `shared.js` e `background.js`) estão no repositório e
> verdes: `./pgv.sh build`, `./pgv.sh check`, `./pgv.sh conferir` e `./pgv.sh test`
> (272 testes) passam, e cada `.js` gerado saiu equivalente ao escrito à mão na
> comparação do §7. Os passos **4 e 5 seguem como plano**. Há também o
> **build em container** (`Dockerfile`, `docker-compose.yml`) para máquina sem Node.

## 1. Ponto de partida (medido)

| Arquivo | Linhas | Papel |
| ------- | -----: | ----- |
| `edicoes.js` | 180 | perfis de edição (free/premium), sem DOM |
| `background.js` | 580 | service worker (`chrome.*`), agendador |
| `shared.js` | 1792 | constantes e utilitários puros (cotas, ritmo, motivos, motor de espera) |
| `popup.js` | 1799 | a UI do pop-up |
| `content.js` | 3167 | scraping/candidatura no LinkedIn |
| `tests/*.js` | 4 arquivos | testes de fumaça, Node puro |
| **total** | **~7 500** | |

Fatos que definem o plano:

- **Não há `package.json`, `tsconfig.json` nem `node_modules`** — e o `npm` **não
  existe nesta máquina** (`node -v` → v26.10.0; `npm`/`npx`/`corepack`/`pnpm`/`yarn`
  ausentes).
- Cada arquivo é um **script clássico** (sem `import`/`export`) que termina
  anexando o seu API em `globalThis`: `globalThis.PegaVagaShared` (`shared.js:11`),
  `globalThis.PegaVagaEdicoes` (`edicoes.js:19`). O `content.js`/`popup.js` leem
  desses globais; o worker faz `importScripts('edicoes.js'); importScripts('shared.js')`
  (`background.js:22-25`).
- Quem aponta para os arquivos é o **`manifest.json`** (`content_scripts`:
  `edicoes.js`, `shared.js`, `content.js`; `background.service_worker`:
  `background.js`) e o **`popup.html`** (três `<script src>`, linhas 1207-1209).
- Os testes carregam o **JS final** por caminho literal:
  `vm.runInThisContext(fs.readFileSync(path.join(raiz, 'edicoes.js'), 'utf8'))`
  (`tests/smoke-espera.js:25` e irmãos). Ou seja: **se o build mudar o nome ou a
  pasta dos arquivos, os quatro testes quebram**.

## 2. Regras da casa que a migração precisa respeitar

1. **A extensão continua instalável sem build**: é carregada em
   `chrome://extensions` → "Carregar sem compactação"; o JS que o manifest aponta
   tem de existir no repositório.
2. **Os testes continuam rodando com `node tests/*.js`**, sem `npm install`.
3. **Sem bundler** (por ora): nada de webpack/esbuild/vite.
4. **Português** nos nomes e comentários, como hoje.
5. O `content.js` continua sendo **content script clássico** (o Chrome não carrega
   content script como módulo ES) — mais um motivo para não adotar ESM agora.

## 3. O caminho sem npm (testado hoje) ✅

`npm` não existe aqui, mas **o `typescript` pode ser baixado direto do registry e
rodado com `node`** — sem instalar nada no sistema e sem `node_modules`:

```sh
mkdir -p tools/typescript
curl -sSL https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz -o /tmp/tsc.tgz
tar xzf /tmp/tsc.tgz -C tools/typescript --strip-components=1
node tools/typescript/bin/tsc --version      # ✅ Version 5.9.3
```

`@types/chrome` sai do mesmo jeito (`.../registry.npmjs.org/@types/chrome/-/chrome-x.y.z.tgz`).

**O que entrou no repositório (correção do rascunho):** o `curl` e o `tar` acima não
servem para o objetivo — **não são portáveis** (no Windows não existem com essa
cara). O que existe é o `tools/baixar-tipos.js`: baixa e extrai com **só o Node**
(`https` + `zlib` + um leitor de tar de ~40 linhas), resolve as dependências de
`@types/*` recursivamente (o `@types/chrome` puxa `filesystem` → `filewriter` e
`har-format`) e fixa as versões **dentro do próprio script** — o "lockfile" é ele.
Destino: `tools/typescript` e `tools/node_modules/@types` (`--forcar` refaz):

```sh
node tools/baixar-tipos.js --forcar
```

Duas coisas que só apareceram na prática (o script já trata as duas):

- O tar de um pacote **não** vem sempre com a pasta `package/` na frente: os
  `@types` publicados pelo DefinitelyTyped vêm com o nome do pacote (`chrome/…`,
  `filesystem/…`). O que o script extrai é o **primeiro nível**, seja ele qual for.
- O que fica no `.gitignore` é só o **resultado** (`tools/typescript/` e
  `tools/node_modules/`). Os scripts (`tools/*.js`, `tools/*.sh`) **entram** no
  repositório: são eles que definem o toolchain — sem eles, "build sem npm" não se
  repete em outra máquina.

Ligado a isso, **o Node 26 roda `.ts` direto** (type stripping, verificado:
`node arquivo.ts` executa) — dá para apontar um teste para o `.ts` algum dia. Duas
consequências práticas:

- **Escrever TS "apagável"** (`type`, `interface`, `as`, anotações) e evitar
  `enum`, `namespace`, `import =` e *parameter properties*: o Node recusa
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, verificado com `enum`). Como o
  `shared.js` de hoje já usa objetos `const` em vez de `enum`, não custa nada.
- Não confundir com verificação: o Node **não checa tipos** nem emite JS — quem
  checa e emite continua sendo o `tsc`.

## 4. Decisões a confirmar

- **D1 — Onde ficam as fontes e onde cai o JS.** Proposta (validada ✅):
  `src/*.ts` → **JS emitido na raiz do repositório**, com os mesmos nomes
  (`src/shared.ts` → `shared.js`), para o `manifest.json` e o `popup.html` não
  mudarem **nem uma linha**.
- **D2 — Commitar o JS gerado?** ✅ **Sim**, com um cabeçalho "GERADO de `src/x.ts`
  — não edite aqui" (a extensão continua instalável direto do GitHub, que é o ponto
  do repositório público). Está feito: o cabeçalho sai do `tools/cabecalho.js`
  (Node puro, pós-build) — o `tsc` não tem banner nativo.
- **D3 — Sourcemaps?** ⏸️ **Adiado, e por um motivo técnico** descoberto ao montar o
  `tsconfig`: com `rootDir: src` e o JS na raiz, o `.map` sai com
  `"sources": ["../src/x.ts"]` — e esse `../` **sai da pasta da extensão**, que o
  Chrome não deixa carregar. O mapa apontaria para o nada no DevTools (e o
  `//# sourceMappingURL=` ficaria quebrado). Ficou `sourceMap: false`; o JS gerado
  mantém nomes e comentários, então lê-se quase como o fonte. Se depurar no TS
  virar necessidade, o caminho é `inlineSources: true` **junto** com
  `sourceMap: true` (o fonte viaja embutido no `.map`, sem caminho relativo) — em
  aberto.
- **D4 — ESM ou globais?** Proposta: **manter os globais + IIFE** (§5). É o que
  preserva `importScripts`, os content scripts e os quatro testes. ESM só se um dia
  entrar bundler — decisão adiada, e não é necessária para tipar.
- **D5 — Tipo compartilhado entre arquivos.** ✅ Um único `.d.ts` ambiente
  (`src/tipos/globais.d.ts`) declarando os globais **com o tipo vindo do próprio
  IIFE** (§5) — sem duplicar tipo na mão. No `edicoes.ts` isso ficou assim: os
  tipos do domínio (`FeaturesEdicao`, `LimitesEdicao`, `PerfilEdicao`) são
  declarados no topo (script sem `import` ⇒ tipo de topo é global, e o
  `shared.ts` poderá usá-los sem importar nada) e o que sai do arquivo é derivado:
  `type PegaVagaEdicoesApi = typeof apiEdicoes;`.
- **D6 — O service worker inteiro num IIFE.** ✅ O `background.js` **não publica
  nada**: ninguém o carrega esperando uma API (o pop-up e o content script só falam
  com ele por mensagem), ao contrário do `shared.js`/`edicoes.js`. Mas ele tem ~30
  nomes de topo, que num script clássico viram globais — e, como o `tsc` compila
  todos os fontes no **mesmo** escopo global, eles colidiriam com os do `popup.ts` e
  do `content.ts` quando esses migrarem (o `popup.js` de hoje já tem `SHARED` e
  `MSG`; o `sendToTab` existe nos dois). Por isso o `src/background.ts` é um IIFE
  inteiro — e os tipos dele também vivem lá dentro, pelo mesmo motivo. Conferido na
  comparação do §7: o antigo deixava 22 nomes no global, o gerado nenhum.

## 5. Como os arquivos conversam (sem ESM) ✅

O truque é não importar nada: cada arquivo continua **script** (o TypeScript decide
isso pela ausência de `import`/`export`) e o tipo do global é **derivado do próprio
código**, num `.d.ts` ambiente:

```ts
// src/shared.ts
'use strict';

const api = (() => {
  const APPLY_KINDS = { easy: 'easy', external: 'externa' } as const;

  function classifyApply(href: string): string {
    return href ? APPLY_KINDS.external : APPLY_KINDS.easy;
  }

  return { APPLY_KINDS, classifyApply };
})();

type PegaVagaSharedApi = typeof api; // o tipo sai do código, não de uma cópia

globalThis.PegaVagaShared = api;
```

```ts
// src/tipos/globais.d.ts
declare var PegaVagaShared: PegaVagaSharedApi;
```

E o consumidor, tipado de ponta a ponta, sem nenhum `import`:

```ts
// src/consumer.ts
const SHARED = globalThis.PegaVagaShared;
console.log(SHARED.classifyApply('https://acme.com/vaga')); // ✅ 'externa'
```

Dois detalhes que economizam uma hora amanhã:

- **`declare var`, não `declare const`**: um `var` global é propriedade de
  `globalThis`, e é isso que faz a linha `globalThis.PegaVagaShared = api`
  type-checkar (com `const` o TS recusa a atribuição).
- O **JS emitido é idêntico ao de hoje** (o alias de tipo desaparece; o IIFE e a
  atribuição do global ficam). Verificado ✅: rodando o `shared.js` gerado com o
  mesmo `vm.runInThisContext` dos testes, o consumidor imprime `consumer: externa`
  — ou seja, **os quatro testes continuam funcionando sem tocar em uma linha**.

## 6. `tsconfig.json` proposto (validado) ✅

> O que está no repositório segue isto, com cinco ajustes que a prática pediu:
> `sourceMap: false` (ver D3), `removeComments: false` (os comentários são a
> documentação do projeto, e o JS é o que se lê no DevTools e no repositório),
> `noEmitOnError: true` (um erro de tipo **não** deixa o `.js` velho no lugar — o
> que esconderia a falha, já que o `manifest.json` continuaria carregando o
> arquivo antigo; foi o que salvou o primeiro build), `moduleDetection: "auto"`
> (sem `import`, o arquivo continua script clássico — e não vira módulo por
> acidente) e `typeRoots: ["./tools/node_modules/@types"]` (é o que faz o tsc
> achar o `@types/chrome` baixado, sem `node_modules` na raiz do repositório).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ES2022",
    "strict": true,
    "rootDir": "src",
    "outDir": ".",
    "sourceMap": true,
    "types": ["chrome"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts"],
  "exclude": ["tools", "tests", "docs"]
}
```

Armadilhas que já apareceram no rascunho:

- **`outDir: "."` exige `exclude` explícito.** Sem ele o TS auto-exclui a pasta de
  saída — que, sendo a raiz, contém o `src/` — e o build morre com
  `TS18003: No inputs were found in config file`. Com `exclude` explícito passa
  (exit 0, `shared.js` emitido na raiz, `src/` intacto).
- **Nunca `moduleDetection: "force"`**: forçaria todo arquivo a ser módulo, o JS
  sairia com `export`/`Object.defineProperty` e quebraria o `importScripts` do
  worker e os `vm.runInThisContext` dos testes.
- **`types: ["chrome"]` depende do `@types/chrome` de §3** (baixado em `tools/`);
  o `skipLibCheck` só evita conferir dentro dos `.d.ts`, não substitui o pacote.
- Enquanto houver arquivo ainda em JS, **nada de misturar**: o `tsc` só compila o
  que está em `include`/`src`, então os `.js` antigos da raiz ficam de fora e a
  migração pode ser arquivo a arquivo (um commit por arquivo).

## 7. Ordem da migração (um commit por passo)

| # | Arquivo | Por que nesta ordem | O que protege | Estado |
| - | ------- | ------------------- | ------------- | ------ |
| 1 | `edicoes.js` → `src/edicoes.ts` | o menor (180 linhas) e sem DOM: valida o pipeline inteiro (baixar tipos, build, emit, extensão carregando) com risco mínimo | `tests/smoke-edicoes.js` | ✅ **feito** |
| 2 | `shared.js` → `src/shared.ts` | o **maior ganho**: é puro, é o que os testes mais exercitam, e é onde os tipos mais valem (`Settings`, `apply.answers`, `APPLY_OUTCOMES`, `APPLY_KINDS`, o motor de espera) | `smoke-espera` + `smoke-edicoes` + `smoke-conta` | ✅ **feito** |
| 3 | `background.js` → `src/background.ts` | `chrome.*` tipado de verdade (alarms, tabs, windows, notifications) | `smoke-ajuda` | ✅ **feito** |
| 4 | `popup.js` → `src/popup.ts` | a UI; o DOM falso do `smoke-conta` já cobre o essencial | `smoke-conta` | ⏳ |
| 5 | `content.js` → `src/content.ts` | por último: 3167 linhas, o mais acoplado ao DOM do LinkedIn (helpers de `query`, espera, fluxo de candidatura) | os cinco + teste manual no LinkedIn | ⏳ |

Em cada passo: `tsc` sem erro + os **cinco** smoke passando + **um teste manual no
navegador** (recarregar a extensão e fazer uma varredura curta). O passo 1 cumpriu
os três — e, antes do teste manual, o `edicoes.js` gerado foi comparado com o
escrito à mão no mesmo `vm` dos testes: `PERFIS`, `FURTIVIDADE_SAO` e a superfície
da API saíram **idênticos**.

O passo 2 cumpriu `tsc` sem erro (com `strict`) e os cinco smoke (272 testes). A
mesma comparação no `vm` foi repetida, agora entre o `shared.js` antigo e o
gerado, e cobriu **151 checagens**: as 77 chaves da API (mesma ordem, mesmo tipo,
mesma aridade de função), todas as constantes campo a campo (`STORAGE`, `MSG`,
`DEFAULT_SETTINGS`, `POPUP_GUARD`, `AJUDA_*`, `APPLY_*`, `DIALOG_KINDS`,
`LIMIT_LABELS`…) e o resultado de
~140 chamadas reais — cotas, agenda, `parseSettings`, `buildRunQueue`,
`classifyApply`/`classifyDialog`, `popupGuardMode`, `statusLight`, o relatório de
candidaturas e o motor de espera (inclusive o caso assíncrono, com o `wake()` do
sinal) — **sem uma única diferença**. O que a comparação pegou e foi corrigido: o
perfil reserva do `shared.ts` havia ganhado um `painelAdmin: false` que o
`shared.js` antigo não tinha (o `painelAdmin` é do PAPEL da conta, não da edição;
agora o literal omite a chave e o `as PerfilEdicao` fica só no tipo).

O passo 3 cumpriu o mesmo protocolo: `tsc` sem erro (com `strict`), os cinco smoke
com os mesmos **272 testes** e o `conferir-gerado`. A comparação no `vm` foi a mais
exigente até aqui — o worker é feito de chamadas ao `chrome.*` —, então um `chrome`
falso gravou **toda** chamada (storage, alarms, tabs, windows, action e
notifications) e as duas versões rodaram a mesma história: subida do worker,
`onInstalled`, agendador ligado, tick começando sozinho, tick encerrando fora da
janela, retomada por cota, cutucada sem resposta (com recarga da aba), proteção da
conta, `onChanged`, pedido de ajuda com clique nos dois botões, clique num aviso
alheio, `PEGAVAGA_AJUDA_FECHAR` e `PEGAVAGA_PROGRESS` — em três ambientes (sem
canvas, sem a API de notificações, e com `OffscreenCanvas`/`fetch` e uma aba do
LinkedIn já aberta). Resultado: **696 registros de chamada, idênticos**, mais a
checagem de que o gerado não acrescenta global nenhum (§D6).

Duas coisas que o passo 3 ensinou:

- **O cenário só chega ao `startRun` com o perfil do servidor aplicado.** A primeira
  versão da comparação "passava" sem nunca começar uma execução: sem o cache do
  `/plano`, o `parseSettings` aplica o **free** e desliga o agendador (é o
  `temFeature('scheduler')`), exatamente como no navegador de quem não tem
  assinatura. O ambiente de teste passou a gravar o cache do perfil antes de ligar o
  agendador — e aí o `startRun`, o `stopRun` e o `nudge` entraram na trilha.
- **Um tipo do `shared.ts` estava impreciso:** `VarreduraLuz.pauseReason` era
  `string`, mas a fila grava `null` quando não há motivo (`FilaExecucao` já dizia
  `string | null`, como o `resumeAt`). O ajuste é **só de tipo** — o `shared.js`
  gerado continua byte a byte igual, como o `conferir-gerado` comprova.

## 8. Riscos e como evitar

- **Editar o `.js` gerado por engano** — é o risco número um desta migração (o
  arquivo que o Chrome carrega volta a ser um artefato). Mitigação: o cabeçalho
  "GERADO de `src/x.ts` — não edite aqui" em todo arquivo emitido (D2) e o build
  sobrescrevendo a raiz. ✅ **Guarda automática:** `tools/conferir-gerado.sh`
  compila `src/` para um diretório temporário e compara **byte a byte** com o `.js`
  versionado — pega a edição à mão, o `.js` velho, o fonte sem `.js` commitado e o
  `.js` órfão, com código de saída ≠ 0.
- **`.gitignore`**: ✅ feito, com um ajuste ao que estava previsto: o ignorado é o
  **resultado** (`tools/typescript/` e `tools/node_modules/`), não `tools/` inteiro
  — os scripts do build são o toolchain e **entram** no git. E **nada** de ignorar
  `*.js` na raiz: ele passa a ser o artefato versionado.
- **Diffs maiores**: cada mudança passa a tocar o `.ts` e o `.js` (mais o `.map`,
  se D3 for "commitar"). O cabeçalho resolve a leitura, mas vale dizer no README
  qual dos dois é a fonte. ✅ Feito também no `.gitattributes`: os `.js` já gerados
  levam `linguist-generated=true -diff`, então o diff que se lê no GitHub é o do
  `src/*.ts` (o gerado aparece recolhido, e o `git diff` local mostra só
  "Binary files ... differ" — `git diff --text` força o conteúdo). A lista é por
  arquivo, para não marcar como gerados o `popup.js` e o `content.js` antes de eles
  migrarem (o `background.js` entrou na lista no passo 3).
- **Tipos globais**: se alguém esquecer de declarar um global novo no
  `src/tipos/globais.d.ts`, o erro aparece no `tsc` (não em runtime) — que é
  exatamente a ajuda que se quer.
- **`@types/chrome` fora de sincronia** com o Chrome instalado: é só dev; quando der
  ruído, atualizar a versão do pacote em `tools/baixar-tipos.sh`.
- **Nada disso pode virar requisito para usar a extensão**: quem baixa o repositório
  e carrega sem compactação tem de continuar funcionando **sem rodar o build**. Se o
  JS gerado for commitado (D2), isso está garantido.

## 9. Comandos do dia a dia (sem npm)

```sh
./pgv.sh build                  # compila: toolchain (se faltar) + tsc + cabeçalho
./pgv.sh check                  # só confere os tipos, sem escrever arquivo
./pgv.sh conferir               # prova que o .js versionado é o que src/ produz
./pgv.sh test                   # os cinco smokes (sem lista fixa: o glob acha)
```

Por baixo, esses alvos chamam `extensao/tools/build.sh` e `extensao/tools/testar.sh`
— o "como compilar" mora **dentro** do repositório (não no script de fora), então
quem clona só a extensão tem os mesmos comandos:

```sh
cd extensao
./tools/build.sh              # compila
./tools/build.sh --conferir   # confere os tipos
./tools/conferir-gerado.sh    # confere o artefato versionado (não escreve nada)
./tools/testar.sh             # testa
```

Sem Node na máquina, o mesmo build num container:

```sh
cd extensao
docker compose run --rm extensao ./tools/build.sh
docker compose run --rm extensao ./tools/testar.sh
PGV_DOCKER=1 ./pgv.sh test    # da pasta de cima: força o container
```

O `pgv.sh` decide sozinho: sem `node` no `PATH`, `build`/`check`/`test` caem no
container (e `PGV_DOCKER=1` força o container mesmo com Node instalado). O toolchain
é o mesmo dos dois lados — versão fixa no `baixar-tipos.js` — e foi conferido com
`cmp` que o `.js` gerado no container é **byte a byte** igual ao gerado na máquina.

## 10. Ordem geral (TypeScript × candidatura externa)

Recomendação: **tipar `edicoes.js` e `shared.js` primeiro** (passos 1 e 2 da §7 —
~2 000 linhas, sem DOM, já cobertos por três dos quatro testes) e **depois** fazer a
candidatura externa. Motivo: a candidatura externa vai nascer justamente dentro do
`shared.js` (mapa de ATS + plano de preenchimento + desfechos novos), e são dados
que o compilador ajuda a manter honestos desde a primeira linha. `background.js`,
`popup.js` e `content.js` ficam para depois — é onde o risco da migração é maior e
onde a pressa não ajuda.

> Se a decisão for o contrário (externa primeiro, TS depois), o plano da externa
> continua válido: só vai chegar como JS e ser tipado no passo 2.

## 11. CI e a apresentação do gerado ✅

Duas peças fecham o que a §8 listou como risco: o artefato versionado passa a ser
**cobrado por máquina** e a leitura do diff deixa de ser poluída.

**CI** — `.github/workflows/testes.yml` (`name: testes`; badge no README), em cada
push e pull request. Dois jobs:

| Job | Passos | O que prova |
| --- | --- | --- |
| `extensao` | `node tools/baixar-tipos.js` → `./tools/build.sh --conferir` → `./tools/conferir-gerado.sh` → `./tools/testar.sh` | tipos fecham, o `.js` versionado é o que `src/` produz, os smokes passam |
| `container` | `docker compose build` → `./tools/build.sh` (dentro) → `git status --porcelain` vazio → `./tools/testar.sh` (dentro) | o container gera **o mesmo byte** e os smokes valem lá dentro também |

Três decisões que valem registro:

1. **O CI chama os scripts de `tools/`, não o `pgv.sh`** — exatamente pelo motivo da
   §9: o "como compilar" mora dentro do repositório. Se o CI tivesse caminho próprio,
   ele poderia testar uma coisa e você outra.
2. **`PGV_UID`/`PGV_GID` exportados no job do container**: no runner do GitHub o uid é
   `1001`, e o `docker-compose.yml` roda como `${PGV_UID:-1000}` — sem exportar, o
   `tsc` de dentro do container não poderia escrever no repositório montado. É o
   mesmo ajuste que o comentário do `user:` já documentava para quem tem UID ≠ 1000.
3. **A prova do container é o `git status` limpo**, não um `cmp` à parte: se os bytes
   mudassem (ou se um arquivo não pedido aparecesse), o repositório ficaria sujo e o
   job falharia — com `git diff --text` no log para dizer o quê.

**Apresentação** — `.gitattributes` marca os `.js` **já gerados**:

```
edicoes.js     linguist-generated=true -diff
shared.js      linguist-generated=true -diff
background.js  linguist-generated=true -diff
```

- `linguist-generated=true` é do **GitHub**: recolhe o arquivo no diff do PR e o tira
  da estatística de linguagens (senão o JS gerado viraria a linguagem "dominante").
- `-diff` é do **git**: trata como binário, então o `git diff` não despeja milhares de
  linhas de reformatação. O diff que importa é o do `src/*.ts`. Para ver o conteúdo:
  `git diff --text -- shared.js`.

A lista é **por arquivo** de propósito: `popup.js` e `content.js` ainda são fonte
escrita à mão (passos 4 e 5 da §7) e marcá-los como gerados seria mentira no diff.
Ao migrar cada um, move-se o nome para a lista, no mesmo commit.

> A marcação é só apresentação: quem **prova** a correspondência fonte↔artefato é o
> `tools/conferir-gerado.sh` (§8). Nenhum dos dois interfere no que o Chrome carrega.


