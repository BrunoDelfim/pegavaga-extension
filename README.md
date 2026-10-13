# PegaVaga — Extensão do Chrome (Manifest V3)

[![testes](https://github.com/BrunoDelfim/pegavaga-extension/actions/workflows/testes.yml/badge.svg)](https://github.com/BrunoDelfim/pegavaga-extension/actions/workflows/testes.yml)

Extensão para automatizar o rastreamento **e as candidaturas** no LinkedIn:
cadastra uma **URL de busca (ou perfil)** e uma lista de **termos**, varre cada
termo automaticamente, captura **título, empresa, link e descrição completa** de
cada vaga e, se a candidatura automática estiver ligada, **candidata-se sozinho**
pela Candidatura Simplificada — respondendo as perguntas obrigatórias do
formulário, fechando os popups de avaliação/pesquisa que o LinkedIn abre depois e
**imitando o ritmo humano** (chegando a ceder a vez para você quando está usando
o navegador).

Esta é a **edição free** — a mesma build do **portfólio**, publicada como código
aberto: roda **sem conta**, com tudo local e efêmero no `chrome.storage.local`. A
**premium** (mesma base de código, destravada por assinatura) é o horizonte e
ainda não está implementada. O desenho completo — regras do free, cortes de cada
plano e o serviço de licenças — fica no repositório **privado** da API: é
estratégia de produto, não código de cliente.

## Estrutura

```
extensao/
├── manifest.json   # Manifest V3: permissões, service worker e content script
├── src/            # A FONTE do código (TypeScript) — é aqui que se edita
│   ├── edicoes.ts    # Perfis de edição (free/premium): a política de cada plano
│   ├── shared.ts     # Constantes e utilitários puros (o maior dos arquivos)
│   ├── background.ts # Service worker: o agendador (chrome.alarms, tabs, avisos)
│   └── tipos/        # Tipos compartilhados entre os arquivos (globais.d.ts)
├── edicoes.js      # GERADO de src/edicoes.ts — não edite este arquivo à mão
├── shared.js       # GERADO de src/shared.ts — não edite este arquivo à mão
├── background.js   # GERADO de src/background.ts — não edite este arquivo à mão
├── popup.html      # Interface (configuração, cotas, agendador + contador)
├── popup.js        # Fila de termos, orquestração da aba e geração do CSV
├── content.js      # Scraping do DOM do LinkedIn, candidatura, fila e storage
├── tests/          # Testes que rodam no Node (o shared.js é livre de DOM)
│   ├── smoke-edicoes.js        # perfis free/premium e o funil do parseSettings
│   ├── smoke-espera.js         # o motor de espera: sinal, waitUntil e waitForQuiet
│   ├── smoke-conta.js          # o pop-up num DOM falso: conta, plano e painel do admin
│   ├── smoke-popups.js         # o guard de popup: quando ele age e o que protege
│   └── smoke-ajuda.js          # (temporário) o pedido de ajuda ao usuário
├── tools/          # O build — Node puro, SEM npm
│   ├── baixar-tipos.js         # baixa o tsc e os tipos do Chrome (só Node)
│   ├── build.sh                # build: baixar + compilar + marcar (./pgv.sh build)
│   ├── cabecalho.js            # marca o JS gerado com "não edite à mão"
│   ├── conferir-gerado.sh      # prova que o .js versionado é o que src/ produz
│   └── testar.sh               # roda os cinco smokes (./pgv.sh test)
├── tsconfig.json   # Configuração do TypeScript (src/ → a raiz)
├── Dockerfile      # O build num container, para máquina sem Node
├── docker-compose.yml
├── docker/         # Peças dos containers (ponto de entrada da imagem)
├── docs/           # Notas de trabalho (o desenho acordado antes do código)
│   ├── candidatura-externa.md  # vaga no site da empresa: abrir, preencher e revisar
│   └── migracao-typescript.md  # trocar o JS por TS (e o build sem npm)
├── CHANGELOG.md    # Histórico de versões (a regra está no README)
├── README.md
├── .github/        # CI: tipos, artefato versionado e smokes em cada push
│   └── workflows/testes.yml
└── .gitattributes  # marca os .js gerados (o GitHub recolhe o diff deles)
```

Este repositório é **só a extensão**. A API de licenças (Python) vive num
repositório **privado** separado: a extensão pergunta a ela (`/plano`) quando há
conta, e o `manifest.json` já declara o host do backend de desenvolvimento
(`http://127.0.0.1:8787`).

As **notas de trabalho** (`docs/`) não descrevem o que existe: são o desenho do que
vem — a **candidatura em site de terceiro** (a vaga cujo botão sai do LinkedIn) e a
**migração de JavaScript para TypeScript** — no mesmo espírito do `docs/` da API.
Servem para a implementação nascer cortada na fronteira certa, e não como
documentação do que já roda.

### Build (TypeScript, sem npm)

O código está migrando de JavaScript para **TypeScript**, um arquivo por vez (o
plano está em `docs/migracao-typescript.md`). Uma regra não muda: **quem baixa o
repositório e carrega a extensão no Chrome não precisa compilar nada** — o `.js`
da raiz é versionado, e é ele que o `manifest.json` carrega.

Quem mexe no código escreve em `src/*.ts` e roda o build, que reescreve o `.js` da
raiz e o marca com o aviso de "não edite à mão":

```sh
./pgv.sh build                  # ou, dentro de extensao/: ./tools/build.sh
./pgv.sh check                  # confere os tipos, sem escrever arquivo
./pgv.sh conferir               # prova que o .js versionado é o que src/ produz
./pgv.sh test                   # os cinco smokes (ou: ./tools/testar.sh)
```

Como o `.js` da raiz é **versionado** (é ele que o Chrome carrega), a pergunta que
todo artefato versionado levanta — *o arquivo commitado é mesmo o que o fonte
produz?* — tem resposta automática:

```sh
cd extensao
./tools/conferir-gerado.sh      # não escreve nada na raiz
```

Ele compila `src/` para um diretório temporário, aplica o mesmo cabeçalho e compara
**byte a byte** com o que está no repositório, dizendo `ok`, `DIFERE` (o `.js` está
velho ou foi editado à mão — rode o build), `FALTA` (o fonte existe e o `.js` não foi
commitado) ou `órfão` (`.js` marcado como gerado sem fonte em `src/`). Sai com código
diferente de zero quando algo diverge, então serve de pré-commit ou de CI.

**Não existe `npm install` em lugar nenhum** — nem `package.json`. O compilador
(TypeScript 5.9.3) e os tipos do Chrome (`@types/chrome`) são baixados pelo próprio
Node, em versão fixa, para `tools/` (que é ignorado pelo git):

```sh
node tools/baixar-tipos.js      # baixa o tsc e os tipos (uma vez; --forcar refaz)
```

Isso mantém o build **igual em qualquer sistema** (Linux, macOS, Windows — só
precisa do Node), **offline** depois da primeira vez e **sem depender de registro de
pacotes**: o tarball é lido à mão, com `https`/`zlib` do Node.

**Sem Node na máquina?** O mesmo build roda num container:

```sh
cd extensao
docker compose run --rm extensao ./tools/build.sh     # compila
docker compose run --rm extensao ./tools/testar.sh    # testa
```

O `pgv.sh` escolhe sozinho: se não houver `node` no `PATH`, `build`, `check` e
`test` caem no container (e `PGV_DOCKER=1 ./pgv.sh build` força o container mesmo
com Node instalado). O toolchain é o mesmo dos dois lados, então o resultado
também é — conferido com `cmp`: o `.js` gerado no container é byte a byte igual ao
gerado na máquina, e o arquivo sai com o **seu** usuário (nada de `root` na pasta).

### Testes

Sem dependências e **sem `npm install`**: o `edicoes.js` e o `shared.js` não tocam
no DOM, então rodam no Node puro e conferem que os cortes do free e o que o
premium mantém continuam coerentes.

```sh
node tests/smoke-edicoes.js   # perfis, cotas e o funil do parseSettings
node tests/smoke-espera.js    # o motor de espera: sinal, waitUntil e waitForQuiet
node tests/smoke-conta.js     # o pop-up de verdade num DOM falso
node tests/smoke-popups.js    # o guard de popup: quando ele age e o que protege
node tests/smoke-ajuda.js     # (temporário) o pedido de ajuda ao usuário
```

O segundo não toca em DOM nem em aba nenhuma: exercita o **motor de espera** que o
content script usa para saber se a página mexeu — o sinal que acorda a espera a
cada mutação, o `waitUntil` (valor achado na hora, pelo sinal e pelo prazo, com
`check` que estoura) e o `waitForQuiet` (a página quieta, a que mexe durante a
espera e a que já estava mexendo quando ela começou) — e confere que ninguém fica
inscrito depois que a espera termina.

O terceiro é um **teste de interface sem navegador**: ele monta um DOM falso (um
elemento para cada `id` do `popup.html`, com os `hidden` do HTML), um
`chrome.storage.local` em memória e um **servidor de mentira no `fetch`** — e roda
`edicoes.js`, `shared.js` e `popup.js` como o Chrome faria. Depois abre o pop-up,
entra como cliente e como administrador e confere o essencial: que o free **não faz
chamada de rede nenhuma**, que o painel do administrador **só** aparece quando o
servidor concede, que um `401` devolve a tela ao free e que ficar sem rede **não**
derruba quem tem assinatura.

O quarto cobre o **(temporário) pedido de ajuda**: roda o `background.js` de
verdade com um `chrome` falso (storage, alarms, tabs, windows e notifications) e
confere que o pedido vira uma notificação com os dois botões, que o clique leva a
decisão para a aba de origem — trazendo a aba para a frente, com o foco na janela
dela, quando é o "Vou preencher à mão" — e que o aviso sai da tela.

O quinto cobre o **guard de popup** (o observer que fecha, na hora, os dialogs que
o LinkedIn joga por cima): a regra é pura (`popupGuardMode`, no `shared.js`) e o
teste a confere estado por estado — quieto fora da varredura, `proteger` com o
formulário na tela, quieto enquanto o formulário está sendo aberto (o dialog que
entra aí pode ser a nossa própria candidatura carregando) e `limpar` quando ele já
saiu dela ou entre uma vaga e outra com a página livre (com o formulário na tela é
o caso do envio: o LinkedIn troca o nó do dialog e o popup do pós-candidatura
chega atrasado). O teste também confere as redações do **aviso de limite** do
LinkedIn (`looksRateLimited`): é o único dialog que o guard não fecha, então é o
que faz a varredura **parar sozinha** — sem reconhecê-las, ela ficava presa com o
aviso na frente da lista.

### CI (GitHub Actions)

[`.github/workflows/testes.yml`](.github/workflows/testes.yml) roda em cada push e
pull request, com os **mesmos scripts** que você usa na máquina (o CI não tem
caminho próprio — é o que garante que ele teste o que você testa):

| Job | O que responde |
| --- | --- |
| **tipos · artefato · smokes** | 1. os tipos fecham? (`build.sh --conferir`) 2. o `.js` versionado é o que `src/` produz? (`conferir-gerado.sh`) 3. os smokes passam? (`testar.sh`) |
| **mesmo resultado no container** | o build dentro do Docker gera o **mesmo byte** do commitado (o `git status` tem de ficar limpo depois) e os smokes passam lá dentro também |

Como o `.js` é versionado, é o CI que cobra por máquina as duas regras que antes
dependiam de disciplina: **não editar o artefato** e **não commitar o `.js` velho**.
O job do container existe porque o README promete "igual byte a byte" — promessa que
agora é verificada, e não afirmada.

O CI **não** publica nada e **não** compila para quem usa a extensão: quem baixa o
repositório continua carregando o `.js` versionado sem rodar build nenhum.

## Edições (free, portfólio e premium)

Um só código-fonte, três usos:

| Edição        | Como se obtém                | O que muda                                                                                                            |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Free**      | instala e usa, **sem conta** | até **2 termos**; cotas **fixas** de **4 por termo**, **3 por hora** e **9 por dia** (sem campos na UI) e "máx. vagas por termo" fixo no código; **sem** agendador e **sem** exportação (botão desabilitado) |
| **Portfólio** | é a **mesma build** da free  | — (é a free, publicada como código aberto)                                                                            |
| **Premium**   | conta + **assinatura ativa** | até 40 termos, cotas de termo/hora/24 h/dia ajustáveis, agendador, ritmo humano ajustável e exportação (o CSV é gerado **no servidor**)  |

O que a **free** mantém, mesmo sem conta: a candidatura automática completa
(Candidatura Simplificada + formulário obrigatório), a captura das vagas com
contador e o **ritmo humano seguro** — este **fixo** (delays longos, pausas de
leitura e descansos), por ser a principal proteção da conta.

A regra de edição passa por um **funil único**: o `edicoes.js` declara o perfil e o
`shared.js` (`parseSettings`) o impõe — então **pop-up, content script e service
worker** obedecem ao mesmo limite, sem depender de o usuário "não mexer". A UI
apenas esconde o que a edição não oferece.

## Conta, assinatura e o painel do administrador

A extensão **não escolhe** a edição: quem concede é o servidor. Sem conta, ela é
free e não faz **nenhuma** chamada de rede. Com conta, pergunta o plano ao `/plano`
e obedece ao que voltar — inclusive para **perder** o premium (assinatura vencida,
atrasada, cancelada ou licença revogada).

**A conta vive no avatar do topo (ao lado do nome do PegaVaga):**

| Onde | O que acontece |
| ---- | -------------- |
| **Avatar, sem sessão** | mostra o ícone de pessoa; clicar leva direto à tela **Entrar**, que traz a aba **Criar conta** para quem ainda não tem |
| **Criar conta** | pede a senha duas vezes (a conferência é local, antes de qualquer chamada) e usa `POST /conta/cadastro` — a conta nasce **usuário**; administrador só existe por semente do servidor |
| **Avatar, com sessão** | mostra as **iniciais do e-mail** numa cor fixa por conta e o anel do plano (verde no Premium, dourado no administrador); clicar abre o **menu** com **Minha conta**, **Painel de administração** (só com o papel) e **Sair** |
| **Entrar** | `POST /conta/login` → guarda a sessão (`pegavaga_sessao`), guarda o perfil (`pegavaga_perfil`) e aplica o plano |
| **Sair** | apaga a credencial e o cache; o selo volta ao Free e a tela volta ao formulário de entrar |

Não há upload de foto: o "rosto" da conta são as **iniciais do e-mail** (o servidor
não guarda imagem). Os ícones das seções (Configurações, Administração) são SVGs do
mesmo tamanho, e a tela de conta só aparece quando é chamada pelo avatar.

**O painel 🛠 Administração** (no menu do avatar) aparece **apenas** para uma conta de
administrador — pelo `features.painelAdmin: true` da resposta do servidor ou pelo
`papel: "admin"` da sessão (é o que impede o painel de sumir quando o `/plano` não
responde e o perfil cai no free). Não há atalho, botão ou opção que o abra por conta
própria: se o painel sumiu, a conta perdeu o papel. Com ele dá para:

- **Ver a tela como Free/Premium** — o perfil vem do servidor (`/plano?simular=`) e
  **não** altera o seu direito. Como o administrador **já é premium** (o plano dele
  vem do papel, sem licença), o selo da build marca `edição X (simulação)` e o botão
  **Meu plano** traz a tela real de volta;
- **Emitir/renovar licença** (`POST /admin/licenca` com `acao: "emitir"`) e
  **revogar** direto na lista;
- **Trocar o endereço da API** — o campo já vem preenchido com o endereço em vigor
  (o salvo ou o padrão `http://127.0.0.1:8787`, o mesmo do `docker compose`).

Três garantias que os testes cobrem:

- **O plano nunca sai do token**: cada `/plano` é reconsultado no cadastro, então
  cancelar, vencer ou revogar vale **na hora** — só o administrador fica fora disso,
  porque o plano dele não vem de licença nenhuma;
- **Sessão recusada volta ao free**: um `401` descarta a credencial e a tela volta
  ao free na mesma abertura;
- **Rede fora não derruba quem tem assinatura**: o último perfil concedido fica em
  cache por 6 h e continua valendo até o servidor confirmar de novo.

> A edição decide só a **tela e as cotas locais**. O que vale dinheiro — o CSV — é
> gerado no **servidor**: sem a feature, o `/exportar` responde `403
> sem_permissao_export`, mesmo que alguém reabilite o botão pelo DevTools.

Para rodar o backend na sua máquina, use o `docker compose` do repositório privado
(`./pgv.sh subir`, na pasta acima desta): ele sobe Postgres + API e semeia as
licenças e contas de teste — por exemplo `premium@pegavaga.test`, senha
`pegavaga-demo`.

## Versionamento

O `version` do `manifest.json` usa **quatro casas** —
`MAIOR.MENOR.CORREÇÃO.REVISÃO` — e a faixa diz em que ponto do caminho a extensão
está:

| Faixa                 | Significa                                                          |
| --------------------- | ------------------------------------------------------------------ |
| `0.x.x.x`             | **em desenvolvimento** — ainda mudando, sem garantia de estabilidade |
| `1.0.0.0`             | **pronto para usar** — primeira versão estável; só chega aqui quando for de verdade |
| `1.1.0.0`, `1.2.0.0`… | melhorias e correções **compatíveis**                              |
| `2.0.0.0`             | mudança **grande**, que quebra config/dados salvos                 |

As três primeiras casas são o **SemVer** de sempre — a terceira (correção) sobe em
ajuste compatível. A **quarta é a revisão da build**: sobe quando a mesma versão é
reempacotada com um retoque que **não muda comportamento** (um texto, um
comentário, a limpeza de um trecho `TEMPORÁRIO`). Ou seja, `0.3.0.0` e `0.3.0.1`
fazem o mesmo — só não são o mesmo pacote.

Enquanto o `1.0.0.0` não sai, tudo é `0.x.x.x`. A versão aparece no cabeçalho do
pop-up (junto da edição ativa) e o histórico fica no
[`CHANGELOG.md`](CHANGELOG.md).

> A **versão da extensão é independente da edição** (free/premium): é a mesma
> build — a `0.3.0.0` pode estar rodando como free ou como premium.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions/`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta
   `pegavaga_chrome`.
4. Fixe o ícone do **PegaVaga** na barra de ferramentas.
5. Se a extensão já estava instalada nesta pasta, clique em **🔄 Atualizar** em
   `chrome://extensions/` e dê **F5** nas abas do LinkedIn já abertas (o
   `shared.js` e o `background.js` são novos).

> **Não é preciso compilar para instalar.** O `.js` que o Chrome carrega está
> versionado no repositório; o build (TypeScript) só interessa a quem edita o
> código em `src/` — veja [Build](#build-typescript-sem-npm).

## Como usar

1. Clique no ícone da extensão e abra **⚙ Configuração de busca**.
2. Em **busca**, preencha:
   - **URL de busca ou perfil**: por padrão
     `https://www.linkedin.com/jobs/search/`. Também funciona colando a URL de
     um perfil/empresa (ex.: `https://www.linkedin.com/company/acme/jobs/`).
   - **Localização (opcional)**: vai como parâmetro `location` na busca
     (ex.: `Brasil`, `São Paulo`, `Remoto`).
   - **Termos de vaga (vários)**: cadastre quantos quiser — **um por linha** ou
     **separados por vírgula** (`desenvolvedor frontend, react, node.js`;
     também valem `;`, `|` e tabulação). Cada termo é uma busca própria, varrida
     **um por vez, em loop, na ordem digitada**; abaixo do campo aparece a
     **fila numerada** (passe o mouse para ver a busca de cada termo). Vazios e
     repetidos são descartados (limite de 40 termos).
3. Em **Candidaturas** (opcional), ligue
   **“Candidatar-se sozinho pela Candidatura Simplificada”** e ajuste as cotas:
   - **Por termo** — quantas candidaturas fazer em cada termo. Ao atingir,
     o PegaVaga **passa para o próximo termo** e zera essa cota.
   - **Por hora** — janela móvel de 60 min.
   - **Por 24 h** — janela móvel de 24 h.
   - **Por dia (0 = sem limite)** — dia corrido, zera à meia-noite.
   - **Máx. vagas por termo** — teto de vagas *visitadas* por termo (trava de
     segurança para o script não varrer a lista para sempre).
   - **Formulário (perguntas e popups do LinkedIn)** — o que fazer quando a
     etapa pede uma resposta que o LinkedIn não tem:
     - **Responder sozinho perguntas obrigatórias** — liga/desliga o
       preenchimento automático de Sim/Não, listas e números;
     - **Em Sim/Não, responder** — `Sim` (padrão) ou `Não`;
     - **Número (anos, quantidade)** — resposta para campos numéricos (0–200);
     - **Texto livre (ex.: cidade)** — resposta para campos de texto; **vazio**
       (padrão) deixa a extensão não responder em vez de inventar.
     Os popups de **avaliação/pesquisa** que o LinkedIn abre depois de
     candidatar são fechados sozinhos, sempre, independentemente destas opções.
   As cotas são **dinâmicas**: quando uma delas estoura, a execução **pausa** e
   **volta sozinha** no instante em que a próxima vaga “libera” (a candidatura
   mais antiga sair da janela, ou a virada do dia).
4. Em **Furtividade e segurança** (recomendado deixar ligado):
   - **Ceder a vez para mim** — enquanto você mexe na página (mouse, teclado,
     rolagem), a automação **espera**; se você continuar usando, ela descansa
     alguns minutos e volta sozinha depois. Ela nunca rouba o seu clique nem
     empurra a rolagem por cima da sua.
   - **Pausas longas de tempos em tempos** — a cada *N* candidaturas a extensão
     descansa (padrão: 10 vagas → ~90 s), como uma pessoa faria.
   - **Intervalo mínimo/máximo (s)** — espera entre uma candidatura e outra
     (padrão 4–12 s). Todo intervalo recebe uma variação de ±30%, e antes de
     cada candidatura há uma pausa de “leitura” da vaga (1,5–4,5 s, às vezes
     mais).
   - **Vagas entre pausas / Duração da pausa (s)** — o tamanho do descanso.
   - Se o LinkedIn mostrar **checkpoint, verificação de segurança ou aviso de
     limite de uso**, a extensão **para tudo por 1 hora** (nenhuma candidatura,
     nenhuma varredura, nem pelo agendador) e retoma sozinha depois. O aviso
     aparece no topo do pop-up em laranja.
5. Em **Agendador** (opcional), ligue
   **“Iniciar e parar sozinho nos horários abaixo”** e escolha:
   - **Começa às / Para às** — aceita janelas que cruzam a meia-noite
     (ex.: `22:00 → 06:00`);
   - **Dias da semana**;
   - **Começar sozinho quando o horário abrir** — abre a busca e inicia sem
     você clicar em nada;
   - **Trazer a aba para frente** — o Chrome estrangula os timers de abas em
     segundo plano, então trazer a aba para frente deixa a varredura rápida.
   Aqui a extensão **para de verdade** quando a janela fecha (a fila é
   descartada) e **recomeça do primeiro termo** quando a janela abre de novo.
   Vagas já candidatadas são puladas, então recomeçar não repete candidaturas.
6. Clique em **▶ Iniciar Busca e Varredura**:
   - Se a aba ativa **não** for uma página de vagas do LinkedIn, a extensão
     **abre uma nova aba** (ou navega a aba atual do LinkedIn) já na busca do
     primeiro termo;
   - O script seleciona os cards, lê o painel de detalhes de cada vaga (para
     pegar a descrição) e, se a candidatura automática estiver ligada, clica em
     **Candidatura Simplificada**, preenche/avança o formulário e **envia** —
     e as vagas que saem do LinkedIn (site da empresa) são **registradas no
     relatório e puladas, sem clique**;
   - A fila roda **em loop pelos termos cadastrados**: termina a lista do
     termo atual (fim da lista, teto de vagas ou cota do termo), ele **navega
     sozinho para o próximo** termo, até acabarem os termos — a barra de status
     mostra a fila, ex.: `Varredura em andamento: 3 termos em loop (react → node.js → vue).`
7. Acompanhe no pop-up:
   - `N vagas capturadas` e o resumo das candidaturas, ex.:
     `12 candidatada(s) · 8 não candidatada(s) · 3 na fila: 4 travada em campo obrigatório · 2 externa (site da empresa)`;
   - a linha `Termo X de N: "…" · K candidatura(s) neste termo`;
   - a linha de cotas, ex.:
     `Candidaturas — 2/6 na hora · 5/25 em 24 h · 8 hoje · 3/8 neste termo`;
   - a linha do agendador, ex.:
     `Janela: Seg, Ter, Qua, Qui, Sex, 08:00 → 18:00 · próxima: seg. 08:00.`
     (quando a fila está pausada, ela também diz **por quê**: cota, janela,
     proteção do LinkedIn ou “você estava usando o navegador”).
   - a **luzinha ao lado do nome PegaVaga** (a mesma cor do ponto no ícone da
     extensão): verde capturando, amarela pronta, vermelha quando precisa de
     atenção — passe o mouse para ver o motivo.
8. Ao terminar (ou quando quiser), exporte:
   - **⬇ Exportar para Excel (CSV)** — todas as vagas capturadas, com o status e
     o **motivo** das que não foram candidatadas;
   - **⚠ Exportar não candidatadas (CSV)** — um relatório enxuto, só com as vagas
     que **não** foi possível candidatar (e o porquê de cada uma).
9. **■ Parar Varredura** interrompe tudo na hora: encerra a fila atual, cancela
   qualquer retomada agendada e fecha o formulário de candidatura aberto.

> Sem termos cadastrados, o comportamento é o antigo: a extensão varre a lista
> de vagas aberta no momento (útil quando você já filtrou a busca na mão).

### Como funciona a candidatura automática

- Só a **Candidatura Simplificada** (Easy Apply) é automatizada. Vagas cujo botão
  sai do LinkedIn (site da empresa) são **puladas sem clique nenhum** e ficam
  registradas com o status `Externa (site da empresa)` e o motivo (ex.: “Botão
  ‘Candidatar-se no site da empresa’, que aponta para careers.acme.com.”) — assim
  a extensão nunca leva a sua aba para fora do LinkedIn.
  - O tipo do botão é lido por **ícone** (`link-external` × `linkedin-bug`),
    **rótulo/aria-label** (“no site da empresa”, “Candidatura simplificada”,
    “Easy Apply”…) e **link embutido** (inclusive o redirecionador
    `/redir/redirect?url=…` do LinkedIn), além do aviso “Candidatura
    simplificada” na própria vaga.
  - Quando **não dá para saber** (botão sem ícone, sem rótulo e sem link), a
    extensão também **não clica**: a vaga fica como
    `Botão de candidatura não reconhecido` e é tentada de novo mais adiante (as
    duas tentativas), caso o botão estivesse só demorando a renderizar.
  - A vaga externa é **pulada de vez**: não gasta cota, não entra na pausa longa
    e não é mais visitada nas próximas varreduras (mas continua no relatório).
- O script abre o formulário e **espera o sinal da própria página**: um
  `MutationObserver` avisa no instante em que o LinkedIn mexe na tela, então a
  espera acaba quando a etapa **para de mudar** (a tela fica quieta) — e não
  quando um tempo fixo passa. É isso que segura a automação quando a internet
  está lenta (sem clicar duas vezes nem dar a etapa por perdida cedo): clica em
  **Avançar / Revisar / Enviar candidatura** até o LinkedIn confirmar o envio
  (ou até 15 etapas / 2 min).
- **Popups do LinkedIn**: depois de candidatar, o LinkedIn costuma abrir um
  popup de **avaliação/pesquisa** ou avisos (“salvar vaga”, “seguir empresa”,
  “compartilhar”). O PegaVaga identifica esses dialogs (que **não** são o
  formulário) e fecha um a um — Fechar/Agora não/Não, obrigado/Entendi/Pular,
  ou `Esc`. Além da limpeza normal, um **guarda de popup** fica de olho nas
  mutações **durante todo o fluxo**: se um popup entrar na tela no meio de uma
  espera (etapa carregando, envio em andamento), ele é fechado na hora, em
  paralelo — o fluxo não precisa reiniciar, ele **continua de onde estava**.
  Sem isso o popup ficava na frente da lista e a varredura empacava.
- **Perguntas obrigatórias**: quando a etapa pede algo que o LinkedIn não
  respondeu sozinho (Sim/Não, listas e números), a extensão responde com o que
  está em **Formulário (perguntas e popups do LinkedIn)** — padrão: **Sim**,
  número **1** e o texto livre configurado. Perguntas de texto livre ficam **em
  branco** se você não preencher nada (a extensão não inventa respostas). Se
  quiser respostas específicas por pergunta, grave em
  `pegavaga_settings.apply.answers`, ex.:
  `{ "autorização de trabalho": "Não", "pretensão salarial": "5000" }`.
- **Ele não inventa o que não sabe**: se mesmo respondendo o possível o
  formulário parar numa pergunta que não dá para preencher (currículo anexo,
  telefone vazio, pergunta sem opção), ele **pede a sua ajuda** (item abaixo) e,
  sem resposta, é **descartado** e a vaga fica marcada como
  `Travada em campo obrigatório` — o motivo no relatório diz **qual campo** ficou
  pendente e **o que já foi respondido**
  (ex.: “Campos não preenchidos: Telefone. Respondi sozinho: Sim.”).
- **(temporário) Pedido de ajuda quando a vaga trava ou demora** — algumas empresas
  cadastram **campos personalizados** no formulário; a extensão ainda não os trata,
  então a candidatura pode parar num campo que ela não sabe responder (o LinkedIn
  marca o campo como inválido) ou o **envio pode demorar a confirmar**. Nesses
  casos, em vez de desistir calado, o PegaVaga mostra um **aviso na área de
  trabalho** com a vaga e dois botões:
  - **Vou preencher à mão** → a aba da vaga **vem para a frente** (com o foco na
    janela, caso ela esteja atrás de outra) e a automação **para e respeita**: não
    clica, não fecha nada e espera o formulário sair da tela (até 10 min) enquanto
    você responde e envia. Depois a varredura continua;
  - **Pular esta vaga** → o formulário é descartado e a vaga é **pulada de vez**
    (não gasta cota e não é visitada de novo); a varredura segue para a próxima.

  A recusa do LinkedIn é lida **a cada passo** — `aria-invalid`, `input:invalid` e
  as mensagens de erro do formulário — e o "Avançar" que não sai do lugar conta
  como recusa: a extensão tenta responder o que falta e, se o LinkedIn continuar
  recusando, **pede o aviso em vez de martelar o botão** (antes disso, o
  formulário era clicado até o limite de etapas e a vaga era descartada calada,
  como `Formulário incompleto`).

  O aviso fica na tela até você escolher (não expira sozinho) e, se ninguém
  responder em 5 min, a extensão segue o caminho de sempre (a vaga fica `Travada
  em campo obrigatório`/`Formulário incompleto` para a próxima passada). O de
  **demora** aparece no máximo **uma vez por minuto** (para não virar enxurrada);
  o de **campo recusado** tem só um respiro curto (**10 s**) entre um aviso e o
  seguinte — é justamente o caso em que a vaga **não** pode ser descartada em
  silêncio. `Parar Varredura` encerra a espera na hora. Este comportamento é
  **temporário**: sai quando os campos personalizados forem tratados de verdade
  (tudo nele está marcado com `TEMPORÁRIO` no código).
- **Ritmo humano**: todo intervalo tem variação aleatória, o clique é precedido
  de rolagem + passagem de mouse pelo elemento, há pausas de “leitura” da vaga,
  pausas longas periódicas e a extensão **cede a vez** para você quando está
  usando a página (mouse, teclado, rolagem).
- **Proteção da conta**: se aparecer aviso de limite de uso, verificação de
  segurança ou redirecionamento para `checkpoint`, a automação **para na hora**
  (a fila fica pausada, não é descartada) e só volta depois de ~1 h de descanso.
- Uma vaga **nunca** é candidatada duas vezes: o resultado fica gravado na vaga
  (`Candidatado em`, `Status da candidatura` e `Motivo da não candidatura`, que
  vão para o CSV).
- Se o **Parar Varredura** for clicado no meio de um formulário, ele é
  descartado (`Cancelada`).
- Vagas que a varredura **não chegou a tentar** (cota estourada, teto de vagas,
  janela fechada, você usando a página) ficam com o status
  `Adiada (sem cota ou fora do horário)` e o motivo — a próxima passada tenta de
  novo, sem gastar tentativa.

> **Use por sua conta e risco.** Automação de candidaturas é uma área cinzenta
> do LinkedIn: a extensão age na sua sessão, com os seus dados, e o envio é
> definitivo. Comece com cotas baixas (por exemplo 5/h, 20/dia) e acompanhe as
> primeiras execuções antes de deixar rodando sozinho.

### Arquivos gerados

**CSV completo** — nome `pegavaga_AAAA-MM-DD_HH-MM-SS.csv`:

- Colunas: `ID`, `Titulo`, `Empresa`, `Link`, `Descricao`, `Capturado em`,
  `Termo`, `Status da candidatura`, `Motivo da nao candidatura`, `Tentativas`,
  `Candidatado em`
- Separador: `;` (padrão do Excel pt-BR)
- Codificação: UTF-8 com BOM (acentos corretos no Excel)
- Campos sempre entre aspas, com aspas internas duplicadas e quebras de linha
  preservadas dentro do campo `Descricao`.
- `Motivo da nao candidatura` fica **vazio** quando a candidatura foi enviada.

Valores possíveis de `Status da candidatura`: `Enviada`,
`Externa (site da empresa)`, `Botão de candidatura não reconhecido`,
`Sem botão de candidatura`, `Formulário não abriu`,
`Travada em campo obrigatório`, `Formulário incompleto`, `Interrompida (Parar)`,
`Parada por proteção do LinkedIn`, `Erro na automação`,
`Preenchida por você (temporário)`, `Pulada por você (temporário)`,
`Adiada (sem cota ou fora do horário)` e `Não tentada`.

Exemplos de motivo gravado:

| Status                             | Motivo (resumo)                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `Externa (site da empresa)`        | A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então ela é pulada. `Botão "Candidatar-se no site da empresa", que aponta para careers.acme.com.` |
| `Botão de candidatura não reconhecido` | Não identifiquei a Candidatura Simplificada nesta vaga; para não sair do LinkedIn, não cliquei. |
| `Sem botão de candidatura`         | A página da vaga não oferece botão de candidatura.                               |
| `Travada em campo obrigatório`     | …+ `Campos não preenchidos: Telefone. Respondi sozinho: Sim.`                    |
| `Formulário incompleto`            | …+ `Parou na etapa 3 de 15.`                                                     |
| `Preenchida por você (temporário)` | A vaga demorou para confirmar (ou o LinkedIn recusou um campo personalizado) e você escolheu preencher à mão; o PegaVaga não mexeu mais na página. |
| `Pulada por você (temporário)`     | A vaga demorou para confirmar (ou o LinkedIn recusou um campo personalizado) e você escolheu pular; a varredura seguiu para a próxima. |
| `Parada por proteção do LinkedIn`  | O LinkedIn pediu verificação ou limite de uso (a automação descansou 1 h).        |
| `Adiada (sem cota ou fora do…)`    | A cota de candidaturas estourou; esta vaga ficou para a próxima passada.          |
| `Não tentada`                      | Ainda não chegou a vez desta vaga (teto de vagas por varredura).                 |

**CSV das não candidatadas** — nome
`pegavaga_nao_candidatadas_AAAA-MM-DD_HH-MM-SS.csv`, com colunas
`ID`, `Titulo`, `Empresa`, `Link`, `Termo`, `Status`, `Motivo`,
`Ultima tentativa`. Só entram as vagas que **não** foram candidatadas (as
definitivas e as que ficaram na fila).

## Permissões utilizadas

| Permissão        | Motivo                                                        |
| ---------------- | ------------------------------------------------------------- |
| `storage`        | Guardar a configuração, a fila, as vagas e as cotas.           |
| `activeTab`      | Falar com a aba ativa do LinkedIn a partir do pop-up.         |
| `alarms`         | Agendador: acordar o service worker no horário escolhido e quando uma cota libera. |
| `notifications`  | **(temporário)** Mostrar o aviso na área de trabalho quando uma vaga trava num campo personalizado ou o envio demora a confirmar (sai junto com o pedido de ajuda). |
| `https://www.linkedin.com/*` | Injetar o `content.js`, ler o DOM das vagas e navegar nas abas do LinkedIn. |

Não são necessárias as permissões `tabs` nem `downloads`: a URL da aba do
LinkedIn já é liberada pelo `host_permissions`, a procura por uma aba aberta é
feita com `chrome.tabs.query({ url: 'https://www.linkedin.com/*' })` (coberto
pelo `host_permissions`, com fallback para abrir uma aba nova) e o CSV é baixado
via `Blob` + `<a download>` gerados no próprio pop-up.

## Dados guardados em `chrome.storage.local`

| Chave                  | Conteúdo                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `pegavaga_settings`    | `{ baseUrl, location, terms[], apply{…}, schedule{…} }` — inclui as cotas, o ritmo humano (`minDelayMs`, `maxDelayMs`, `readMinMs`, `readMaxMs`, `respectUserActivity`, `breaksEnabled`, `breakEvery`, `breakMs`), as respostas do formulário (`fillRequired`, `answerYes`, `answerNumber`, `answerText`, `answers`) e o agendador. |
| `pegavaga_run`         | Fila atual: `{ running, paused, resumeAt, pauseReason, index, term, terms[], urls[], appliedInTerm, visitedInTerm, appliedTotal, sinceBreak, tabId, source }`. |
| `pegavaga_jobs`        | `{ [jobId]: { id, title, company, link, term, description, applyStatus, applyReason, applyAttempts, applyTriedAt, appliedAt, capturedAt } }`. |
| `pegavaga_meta`        | `{ lastRun, count, pageUrl }`.                                  |
| `pegavaga_apps`        | `[timestamp, …]` das candidaturas enviadas (base das cotas por hora/24 h/dia). |
| `pegavaga_guard`       | `{ blockedUntil, reason, at }` — descanso imposto quando o LinkedIn sinaliza limite de uso/verificação. Enquanto vale, **nada** roda (nem o agendador). |

`pauseReason` da fila diz por que ela está parada: `cota`, `guard`, `usuario`
(vez para você) ou `schedule` (fora da janela do agendador).

## Agendador (background.js)

- O service worker mantém **um alarme de 1 minuto** só quando faz sentido: com o
  agendador ligado, com alguma execução pausada ou com a proteção da conta ativa.
  Fora disso, ele fica dormindo.
- A cada tick ele decide:
  0. **proteção da conta ativa** → não inicia nada, não retoma nada e pausa
     qualquer execução em andamento até o fim do descanso (`pauseReason: guard`);
  1. **janela fechada + execução rodando** → encerra a execução (remove a fila e
     manda `PEGAVAGA_STOP` para a aba);
  2. **janela aberta + nenhuma execução** (e “começar sozinho” ligado) → monta a
     fila e abre/reaproveita a aba do LinkedIn no primeiro termo;
  3. **execução pausada com cota liberada** → manda `PEGAVAGA_RESUME` para a aba
     (se a aba não responder, recarrega a página, e o `content.js` retoma pelo
     `load`).
- O `content.js` também tem um timer local para retomar, então a execução
  continua mesmo se o alarme atrasar. Fechar o Chrome adia tudo para o próximo
  horário da janela.

## Luz de status no ícone

O ícone da extensão — e a bolinha ao lado do nome no pop-up — mostra o estado num
relance (a mesma cor nos dois lugares):

| Cor         | Quando aparece                                                                                                                                                  | Leitura         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 🟢 Verde     | A fila está ativa: o `content.js` está varrendo e candidatando agora (ou seja, há `PEGAVAGA_PROGRESS` com varredura em andamento).                                | **Capturando**  |
| 🟡 Amarela   | Parada esperando algo normal: nenhuma varredura, pausa por **cota**, janela do **agendador** fechada, **descanso longo** do ritmo humano ou “você estava usando o navegador”. | **Pronta** (volta sozinha) |
| 🔴 Vermelha  | **Proteção da conta** ligada (o LinkedIn sinalizou limite de uso) ou varredura que parou com **problema** (ex.: página sem a lista de vagas).                   | **Precisa de atenção** |

- A luz é desenhada **no próprio logo** (um ponto no canto inferior direito, com
  anel branco para não se perder no azul), pelo service worker, em 16 e 32 px. Se
  o navegador não tiver `OffscreenCanvas`/`createImageBitmap`, ele cai num **selo
  colorido** no canto do ícone — o recado é o mesmo.
- O estado também vira **tooltip**, ex.:
  `PegaVaga — Capturando vagas — termo 2 de 3: "react".` ou
  `PegaVaga — Pausada por cota de candidaturas até 14:30.`
- Quem decide a cor é o `statusLight()` do `shared.js` (função pura e testada), a
  partir do estado gravado no storage e dos `PEGAVAGA_PROGRESS` que o content
  script envia — funciona com o pop-up fechado.
- A luz só redesenha o ícone quando a **cor muda**; os PNGs do logo ficam em
  cache na memória do worker.

## Mensagens trocadas (popup ↔ content ↔ worker)

| Mensagem                | Direção        | Efeito                                   |
| ----------------------- | -------------- | ---------------------------------------- |
| `PEGAVAGA_START`        | popup → content| Inicia a varredura (pode trazer a fila).  |
| `PEGAVAGA_STOP`         | popup/worker → content | Interrompe a varredura e encerra a fila. |
| `PEGAVAGA_RESUME`       | worker → content | Sai da pausa por cota e retoma a fila.  |
| `PEGAVAGA_PING`         | popup → content| Consulta se está varrendo.               |
| `PEGAVAGA_CLEAR`        | popup → content| Zera o estado em memória e no storage.   |
| `PEGAVAGA_PROGRESS`     | content → popup/worker | Contador, cotas, pausa (+ motivo), pausa longa, proteção da conta e problema da varredura (é o que acende a **luz do ícone** em tempo real). |
| `PEGAVAGA_AJUDA_PEDIDO` | content → worker | **(temporário)** Pede o aviso na área de trabalho quando a vaga trava num campo personalizado ou o envio demora a confirmar. O worker só responde `ok` quando a notificação foi criada (sem isso o script não fica esperando à toa). |
| `PEGAVAGA_AJUDA_RESPOSTA` | worker → content | **(temporário)** A sua decisão no aviso: `manual` (preencher à mão — a automação para e espera) ou `pular` (descarta a vaga e segue para a próxima). |
| `PEGAVAGA_AJUDA_FECHAR` | content → worker | **(temporário)** A espera acabou (decisão tomada ou prazo estourado): tira o aviso da tela. |

## Observações importantes

- O DOM do LinkedIn muda com frequência. Todos os seletores estão agrupados nos
  objetos `SEL` (vagas) e `APPLY_SEL` (candidatura), no topo do `content.js`,
  com vários fallbacks — se algo parar de funcionar, ajuste apenas esses dois
  objetos.
- A descrição só existe no painel de detalhes, por isso o script **seleciona
  cada card** durante a varredura. Isso é intencional.
- A fila vive no `chrome.storage.local`, então sobrevive ao recarregamento da
  página a cada troca de termo. Fechar a aba ou usar **Parar Varredura** encerra
  a fila; uma pausa por cota sobrevive e volta no horário marcado.
- Se cair em uma tela de login/checkpoint do LinkedIn, a fila é encerrada
  automaticamente (e, se o checkpoint for por excesso de uso, também entra em
  descanso de 1 h antes de qualquer nova tentativa).
- **Abas em segundo plano**: o Chrome estrangula timers de abas escondidas
  (depois de ~5 min, para 1 execução por minuto). O PegaVaga continua
  funcionando, mas devagar; por isso o agendador tem a opção **“Trazer a aba
  para frente”**, e o alarme de 1 min do service worker serve de rede de
  segurança para retomar sozinho.
- **Limpar vagas capturadas** apaga o histórico de vagas, mas **não** apaga as
  cotas (`pegavaga_apps`) nem o descanso de proteção (`pegavaga_guard`): eles
  existem para proteger a sua conta.
- Se a extensão foi instalada com uma aba do LinkedIn já aberta, recarregue a
  página (F5) para o `content.js` ser injetado.
- Comece com cotas baixas (por exemplo 6/h, 25/dia) e com as opções de
  furtividade ligadas. Use de forma responsável, respeitando os Termos de Uso do
  LinkedIn.



