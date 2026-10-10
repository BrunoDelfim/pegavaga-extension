# PegaVaga — Migração da extensão para TypeScript

> Documento de trabalho: o plano **antes** da troca. Boa parte do que está aqui já
> foi **executada e verificada** numa pasta de rascunho (`/tmp`) nesta máquina — os
> pontos verificados estão marcados com ✅. Nada foi migrado no repositório ainda.

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
Proposta: um `tools/baixar-tipos.sh` (ou `make tipos`) que baixa e extrai os dois em
`tools/` — que fica no `.gitignore` (o `node_modules/` já está lá, e a seção do
`.gitignore` já diz "Dependencias (se um dia entrar tooling no Node)").

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
- **D2 — Commitar o JS gerado?** Proposta: **sim**, com um cabeçalho
  "GERADO de `src/x.ts` — não edite aqui" (a extensão continua instalável
  diretamente do GitHub, que é o ponto do repositório público). O cabeçalho sai de
  um `tools/cabecalho.js` (Node puro, pós-build) — o `tsc` não tem banner nativo.
- **D3 — Sourcemaps?** Sem eles o JS gerado fica igual ao de hoje (diff limpo);
  com eles o `chrome://extensions` fica depurável no fonte TS. Proposta: gerar
  (`sourceMap: true`) e **commitar**, já que o repositório é aberto.
- **D4 — ESM ou globais?** Proposta: **manter os globais + IIFE** (§5). É o que
  preserva `importScripts`, os content scripts e os quatro testes. ESM só se um dia
  entrar bundler — decisão adiada, e não é necessária para tipar.
- **D5 — Tipo compartilhado entre arquivos.** Um único `.d.ts` ambiente
  (`src/tipos/globais.d.ts`) declarando os globais **com o tipo vindo do próprio
  IIFE** (§5) — sem duplicar tipo na mão.

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

| # | Arquivo | Por que nesta ordem | O que protege |
| - | ------- | ------------------- | ------------- |
| 1 | `edicoes.js` → `src/edicoes.ts` | o menor (180 linhas) e sem DOM: valida o pipeline inteiro (baixar tipos, build, emit, extensão carregando) com risco mínimo | `tests/smoke-edicoes.js` |
| 2 | `shared.js` → `src/shared.ts` | o **maior ganho**: é puro, é o que os testes mais exercitam, e é onde os tipos mais valem (`Settings`, `apply.answers`, `APPLY_OUTCOMES`, `APPLY_KINDS`, o motor de espera) | `smoke-espera` + `smoke-edicoes` + `smoke-conta` |
| 3 | `background.js` → `src/background.ts` | `chrome.*` tipado de verdade (alarms, tabs, windows, notifications) | `smoke-ajuda` |
| 4 | `popup.js` → `src/popup.ts` | a UI; o DOM falso do `smoke-conta` já cobre o essencial | `smoke-conta` |
| 5 | `content.js` → `src/content.ts` | por último: 3167 linhas, o mais acoplado ao DOM do LinkedIn (helpers de `query`, espera, fluxo de candidatura) | os quatro + teste manual no LinkedIn |

Em cada passo: `tsc` sem erro + os quatro smoke passando + **um teste manual no
navegador** (recarregar a extensão e fazer uma varredura curta).

## 8. Riscos e como evitar

- **Editar o `.js` gerado por engano** — é o risco número um desta migração (o
  arquivo que o Chrome carrega volta a ser um artefato). Mitigação: o cabeçalho
  "GERADO de `src/x.ts` — não edite aqui" em todo arquivo emitido (D2) e o build
  sobrescrevendo a raiz.
- **`.gitignore`**: hoje ele já ignora `node_modules/`; acrescentar `tools/` (o
  `typescript` e o `@types/chrome` não entram no git) e **não** ignorar `*.js` na
  raiz, que passa a ser o artefato versionado.
- **Diffs maiores**: cada mudança passa a tocar o `.ts` e o `.js` (mais o `.map`,
  se D3 for "commitar"). O cabeçalho resolve a leitura, mas vale dizer no README
  qual dos dois é a fonte.
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
node tools/typescript/bin/tsc -p .             # compila e emite o JS na raiz
node tools/typescript/bin/tsc -p . --noEmit    # só confere os tipos

node tests/smoke-edicoes.js
node tests/smoke-espera.js
node tests/smoke-conta.js
node tests/smoke-ajuda.js
```

Proposta: dar esses alvos ao `pgv.sh` que já vive na raiz do workspace (fora dos
dois repos): `./pgv.sh build`, `./pgv.sh check`, `./pgv.sh test`. Assim o dia a dia
não depende de npm nem de decorar caminho de `tools/`.

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


