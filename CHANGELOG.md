# Changelog — PegaVaga (extensão do Chrome)

Todas as mudanças relevantes desta extensão, da mais nova para a mais antiga. O
formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e a
numeração, o SemVer adaptado descrito no
[README](README.md#versionamento): `0.x.x.x` enquanto desenvolve, `1.0.0.0` quando
estiver pronto para usar, e depois `1.1.0.0`, `2.0.0.0`… (a 4ª casa é só a revisão
da build).

> A numeração antiga ia até `1.4.2`, sem registro aqui. A **0.3.0.0** é a versão
> atual sob esta convenção — a `1.0.0.0` fica reservada para o lançamento estável.
>
> Este changelog cobre **só a extensão**: a API de licenças (Python) vive num
> repositório **privado** separado, com changelog próprio.

## [0.3.0.0] — em desenvolvimento

### Adicionado

- **Testes de DOM REAL** (`tests/smoke-dom.js` + `tests/dom-preenchimento.js` e
  `tests/smoke-dom-fluxo.js` + `tests/dom-fluxo.js`, sobre o harness
  `tests/dom-cromo.js`): montam o LinkedIn como ele é (o `<select>` sem caixa atrás
  do UI do artdeco, rádio sem `name` com cada bolinha no seu container,
  `role="radio"`, `role="combobox"`) e rodam o `content.js` num **Chromium de
  verdade** (`chrome-headless-shell`), conferindo o que ENTROU na página — os
  eventos (`input`/`change`/`blur`) e a hora de recarregar, no primeiro; e o
  **fluxo inteiro** da candidatura no segundo (a lista de vagas, o botão, o
  formulário, o pedido de ajuda respondido pelo roteiro como se fosse você, os
  campos preenchidos, a etapa avançando e o envio confirmado). Juntos, são 32
  verificações que só um browser com LAYOUT pode dar (quem decide o que é
  "visível" é o `getClientRects`). O browser vem de
  `tools/baixar-chromium.sh` (uma vez, ~120 MB, sem root, sem npm); sem ele os
  dois testes se pulam sozinhos e a suíte segue verde.
- **Build em TypeScript, sem npm** (`src/`, `tools/`, `tsconfig.json`): o código
  está migrando de JavaScript para TypeScript **um arquivo por vez** — começou pelos
  menores e sem DOM (`src/edicoes.ts`, `src/shared.ts`) e chegou ao service worker
  (`src/background.ts`). O compilador (TypeScript
  5.9.3) e os tipos do Chrome são baixados **pelo próprio Node**, em versão fixa
  (`tools/baixar-tipos.js`: `https` + `zlib` + um leitor de tar de ~40 linhas — sem
  `npm`, sem `package.json`, sem depender de registro de pacotes), e o `.js` gerado
  continua **versionado** e idêntico em comportamento (conferido a cada passo: os
  mesmos perfis e utilitários campo a campo, o mesmo `chrome.*` chamado na mesma
  ordem pelo worker, e os 272 testes passando). Quem instala a extensão **não**
  precisa compilar nada.
- **Guarda do artefato versionado** (`tools/conferir-gerado.sh`): como o `.js` da
  raiz é commitado, este script responde à pergunta que isso sempre levanta — *o
  arquivo versionado é mesmo o que `src/` produz?* Ele compila para um diretório
  temporário, aplica o mesmo cabeçalho e compara **byte a byte**: `ok`, `DIFERE`
  (artefato velho ou editado à mão), `FALTA` (fonte sem `.js` no repositório) e
  `órfão` (`.js` gerado sem fonte). Sai com código diferente de zero e **não escreve
  nada na raiz** — serve de pré-commit ou de CI. O `tools/cabecalho.js` ganhou um
  diretório de destino opcional para isso (o padrão continua sendo a raiz).
- **CI no GitHub Actions** (`.github/workflows/testes.yml`, badge no README): em cada
  push e pull request, dois jobs com os **mesmos scripts** de `tools/` que se roda na
  máquina — o primeiro confere os tipos, o artefato versionado e os cinco smokes; o
  segundo constrói a imagem, roda o build **dentro do container** e exige que o
  repositório fique limpo (prova de que o container gera byte a byte o mesmo `.js`) e
  roda os smokes lá dentro também. As duas regras que dependiam de disciplina —
  "não editar o artefato" e "não commitar o `.js` velho" — passam a ser cobradas por
  máquina.
- **`.gitattributes`** marcando os `.js` gerados com `linguist-generated=true -diff`:
  o GitHub recolhe esses arquivos no diff do PR e não os conta na estatística de
  linguagens, e o `git diff` local não despeja milhares de linhas de reformatação (o
  diff que se lê é o do `src/*.ts`). A lista é por arquivo — `popup.js` e
  `content.js` continuam fonte escrita à mão até migrarem.
- **Build e testes no Docker** (`Dockerfile`, `docker-compose.yml`, `docker/`): o
  mesmo build roda num container (Node 22 + o toolchain embutido na imagem), para
  máquina sem Node instalado. O container trabalha como o **seu** usuário — nada de
  arquivo como `root` na pasta do host — e o resultado é o mesmo da máquina de fora
  (conferido byte a byte).

- **Camada de edições** (`edicoes.js`): perfis `free` e `premium` com as features e
  os limites de cada um. A edição ativa começa na `free` (a mesma build do
  portfólio); desbloquear a premium não muda o código, muda o direito de uso.
- **Regra de edição no funil único** (`shared.js`): o `parseSettings` passou a
  aplicar o perfil, então pop-up, content script e service worker obedecem ao
  mesmo limite. No free: termos cortados em 2, cotas **fixas** de **4 por termo**,
  **3 por hora** e **9 por dia**, ritmo humano fixo, "máx. vagas por termo" fixo e
  agendador desligado.
- **UI por edição** (`popup.js`/`popup.html`): o free não mostra o Agendador, a
  Furtividade, os campos de cota (termo/hora/24 h/dia) nem "Máx. vagas por termo",
  e deixa a exportação em CSV visível porém **desabilitada** (sem função) — e avisa
  o teto de termos e as cotas fixas.
- **Encaixe da concessão por servidor** (`edicoes.js`): `aplicarDoServidor(perfil)`
  aplica os `features`/`limites` que a API devolver **depois de conta +
  assinatura** (é o que "libera campos e opções"), e `aplicarDoServidor(null)`
  volta ao free. O free segue **100% local e sem chamadas de rede** — a API só é
  consultada quando há assinatura.
- **Conta na extensão** (`popup.html`/`popup.js`/`shared.js`): seção **👤 Conta**
  para entrar (`POST /conta/login`), criar conta (`POST /conta/cadastro`) e sair. A
  sessão fica em `pegavaga_sessao` e o último perfil concedido em `pegavaga_perfil`
  — é esse cache que o content script e o service worker aplicam **antes** de
  normalizar as settings, sem nenhuma chamada de rede. O free anônimo segue **100%
  local**: sem sessão, a API não é consultada.
- **A conta na tela** (`popup.html`/`popup.js`): o avatar fica no topo, ao lado do
  nome, com as **iniciais do e-mail** numa cor fixa por conta e o anel do plano
  (verde no Premium, dourado no administrador — as iniciais substituem o ícone de
  pessoa). Com sessão, clicar abre o **menu** de opções (**Minha conta**, **Painel
  de administração** — só com o papel concedido — e **Sair**); sem sessão, leva
  direto à tela **Entrar**, que traz a aba **Criar conta** e pede a senha duas vezes
  (conferência local, antes de qualquer chamada). O menu fecha com `Esc` ou clique
  fora, e os ícones das seções viraram SVGs do mesmo tamanho.
- **O plano volta a ser conferido** (`shared.js`): `sincronizarPlano()` pergunta o
  `/plano` e aplica via `aplicarDoServidor`; `401`/`403` descartam a credencial e
  devolvem a tela ao free; falha de **rede** mantém o cache (6 h) em vez de derrubar
  quem tem assinatura.
- **Painel do administrador** (`popup.html`/`popup.js`): aparece **só** quando a
  resposta do servidor traz `features.painelAdmin: true` — nenhum atalho, botão ou
  opção o abre por conta própria. Dele saem "ver a tela como Free/Premium"
  (`/plano?simular=`, que **não** altera direito nenhum), emitir/renovar licença,
  revogar pela lista e trocar o endereço da API.
- `manifest.json`: `host_permissions` do backend de desenvolvimento
  (`http://127.0.0.1:8787` e `http://localhost:8787`), para o pop-up e o service
  worker poderem falar com a API.
- **(temporário) Pedido de ajuda quando a vaga trava ou demora** (`shared.js`,
  `content.js`, `background.js`): algumas empresas cadastram **campos
  personalizados** no formulário e a extensão ainda não os trata — a candidatura
  pode parar num campo que ela não sabe responder (o LinkedIn marca o campo como
  inválido) ou o **envio pode demorar a confirmar**. Nesses casos o PegaVaga mostra
  um **aviso na área de trabalho** (permissão `notifications`, com o título e a
  empresa da vaga) e pergunta o que fazer: **Vou preencher à mão** (a automação para
  e espera o formulário sair da tela, respeitando você) ou **Pular esta vaga** (o
  formulário é descartado e a vaga é pulada de vez, sem gastar cota). O aviso tem
  no máximo **um pedido por minuto**, espera até **5 min** pela resposta e o `Parar
  Varredura` encerra a espera na hora. Os desfechos novos são
  `Preenchida por você (temporário)` e `Pulada por você (temporário)`, e o id da
  notificação carrega a **aba de origem** (o clique pode acordar o worker do zero).
  Tudo nesse caminho está marcado com `TEMPORÁRIO` no código: sai quando os campos
  personalizados forem tratados de verdade.
- `tests/smoke-conta.js`: teste de fumaça da **interface sem navegador** — DOM falso
  (um elemento por `id` do `popup.html`, com os `hidden` do arquivo),
  `chrome.storage.local` em memória e um **servidor de mentira no `fetch`** rodando
  o `popup.js` de verdade. Cobre: free sem nenhuma chamada de rede; o avatar sem
  sessão levando à tela de entrar (e a de criar pedindo a senha duas vezes, sem
  rede quando diferem); login de cliente e de administrador; o menu do avatar com
  as opções de cada sessão (e o avatar em anel verde/dourado); o painel do admin
  aparecendo **só** com a concessão do servidor; emitir e revogar licença; a
  simulação não sobrescrevendo o cache; `401` voltando ao free; rede fora
  preservando o premium; e cache velho caindo no free.
- `pgv.sh test` passou a rodar os **três** testes da extensão.
- `tests/smoke-ajuda.js`: teste de fumaça do **(temporário) pedido de ajuda** — o
  contrato no `shared.js` (textos, botões, id do aviso e os desfechos
  `manual`/`pulada`) e o `background.js` **rodando** com um `chrome` falso
  (storage, alarms, tabs e notifications): o pedido vira notificação com os dois
  botões, o clique leva a decisão para a aba de origem e o aviso sai da tela.
- **Selo de versão e edição** no cabeçalho do pop-up.
- `tests/smoke-edicoes.js`: teste de fumaça que roda no Node puro (o `shared.js` é
  livre de DOM) cobrindo as regras de free e premium.

- **(temporário) O "Vou preencher à mão" traz a vaga para a frente**
  (`background.js`): quando você escolhe responder o formulário por conta própria, a
  aba do LinkedIn vai para a frente (`tabs.update` com `active: true`) e a **janela
  dela ganha o foco** (`windows.update` com `focused: true`) — o clique vem da área
  de trabalho, não de dentro do navegador, então a aba pode estar atrás de outra (ou
  a janela atrás da do terminal). "Pular esta vaga" não mexe em foco nenhum, e sem
  as APIs (ou se o navegador recusar) a decisão continua valendo.
- `tests/smoke-espera.js`: teste de fumaça do **motor de espera** que o content
  script usa para saber se a página mexeu (`createSignal`, `waitUntil` e
  `waitForQuiet` do `shared.js`): a página que mexe, a que fica quieta, o prazo, o
  `check` que estoura e a inscrição que precisa ser desfeita ao sair.
- `POPUP_GUARD` e `popupGuardMode` (`shared.js`): a decisão do **guard de popup**
  virou contrato puro, com três modos — `quieto` (nada a fazer), `proteger` (há um
  formulário na tela: todo outro dialog é popup) e `limpar` (sem formulário na
  tela: só o que a página já classificou como popup). O content script só informa o
  que sabe da página (varredura em andamento, formulário identificado e na tela,
  pós-envio).
- `tests/smoke-popups.js`: teste de fumaça do **guard de popup**, estado por
  estado — inclusive o caso que trouxe a correção (o formulário já saiu da tela,
  porque o LinkedIn trocou o nó do dialog, e o popup do pós-candidatura chega
  atrasado).
- **Notas de trabalho** (`docs/`): `candidatura-externa.md` — o esquema de **abrir,
  preencher e devolver para você revisar** as vagas cujo botão sai do LinkedIn
  (mapa de ATS, perguntas que não respondemos sozinhos, limite da permissão e as
  fases de execução) — e `migracao-typescript.md` — o plano de trocar o JS por TS,
  com o build **sem npm** já validado (o `tsc` sai do registry e roda com `node`).
  São desenho, não código: nada disso está implementado.
- **Configurações da conta no banco** (`GET`/`POST /conta/config`, `shared.js`
  `lerConfig`/`salvarConfig` e o `sincronizarConfiguracoes` no `popup.js`): a busca,
  as cotas de candidatura e o agendador deixam de ser só deste navegador. Ao
  **entrar**, a extensão puxa do banco; se a conta ainda não tem nada guardado
  (primeiro login), sobe o que já estava aqui — entrar não zera nada. A cada
  gravação, sobe de novo (melhor esforço: o local é o que a varredura lê). O
  **free continua 100% local**: sem sessão, a rota nem é chamada.
- **As configurações do free sobrevivem ao logout** (`pegavaga_settings_free`): no
  login, o `guardarSessao` guarda uma cópia do que estava configurado; no `sair`
  (e no 401/credencial vencida), o `limparSessao` devolve essa cópia ao lugar em vez
  de zerar tudo. Sair volta para as configurações do free — não para o padrão de
  fábrica.

### Alterado

- **A janelinha virou um popup de verdade**: **largura fixa** (372) e **altura que
  acompanha o conteúdo** — um campo só deixa a janela baixinha (o mínimo é um campo
  mais as margens), vários a esticam até o teto (o tamanho de antes); passando do
  teto, quem rola é o corpo do cartão (`ajustarAltura`). Sem cantos arredondados nem
  sombra: a moldura agora é a da janela. E ela abre **já na posição guardada** — o
  worker lê `pegavaga_ajuda_pos` antes de criar a janela (o service worker não tem
  `screen`, então o canto inferior direito da primeira vez continua sendo do
  `ajuda.js`, que também arrasta e memoriza). O que o Chrome **não** oferece é
  "sempre acima das outras" (é do gerenciador de janelas): o mais perto é abrir com
  foco e atenção, mais o aviso do desktop, que aparece por cima de tudo.

- **O administrador já entra Premium** — o plano dele passou a vir do PAPEL, como já
  vinha o painel: quem administra precisa poder usar o que administra, e exigir
  licença do admin só fazia ele ver a tela do free e perguntar por quê. O
  `/plano` (e o login) de uma conta `admin` responde `plano: "premium"` com
  `estado: "admin"` e sem prazo. Quem concede é o **servidor** (`_como_admin`): o
  cliente não mudou de ideia sobre plano nenhum — continua sem caminho para ligar
  o premium sozinho.
- **O "Ver a tela como" passou a avisar que é simulação.** Como o admin agora é
  premium, simular o Free mostraria uma tela igual à que ele teria se tivesse
  perdido o plano — e a dúvida era garantida. O perfil simulado chega marcado
  (`simulado`), e o selo da build diz `edição Free (simulação)`, em cor de aviso.
  A simulação também passou a ser **reversível**: o botão **Meu plano** reconsulta
  o `/plano` e desfaz.
- **O campo "Endereço da API" vem preenchido** com o endereço em vigor (o salvo ou
  o padrão `http://127.0.0.1:8787`, o mesmo do `docker compose`) em vez de vazio:
  um campo vazio não diria para onde a extensão está falando. O `lerApi` saiu do
  `shared.js` — quem responde isso agora é o `apiUrl`, que é o endereço que a
  extensão realmente usa.
- **Um dono só para o redesenho que depende do perfil** (`aplicarPerfilNaTela` no
  `popup.js`): entrar, sair, sincronizar e simular refazem a mesma lista de telas
  (formulário, conta, painel, contadores). Era a lista repetida em três lugares —
  e, na simulação, ela ficava pela metade (só o selo mudava), o que fazia o botão
  parecer quebrado.
- **`pgv.sh` ganhou `build` e `check`** (extensão): compilar e conferir os tipos
  viraram alvos do dia a dia, e eles caem **sozinhos no container** quando não há
  `node` no `PATH` (`PGV_DOCKER=1` força o container mesmo com Node instalado). O
  alvo `test` passou a chamar o script do repositório, em vez de repetir caminhos.

- **Cotas do free fixadas e reduzidas**: os campos "Por termo" e "Por hora" saíram
  da UI (`cotasEditaveis: []`) e o motor impôs **4 por termo**, **3 por hora** e
  **9 por dia** — o teto diário caiu de 20 para 9. O pop-up mostra só o aviso das
  cotas fixas, e o `parseSettings` ignora o que o formulário mandar (a regra vale
  no pop-up, no content script e no service worker).
- **Regras do free revisadas**: termos **2** (antes 3); **"Máx. vagas por termo"**
  saiu da UI e virou trava fixa no motor (`scanPerTerm = 40`, imposta em
  `aplicarPerfilEdicao`); a **exportação** agora aparece com o botão
  **desabilitado e sem função** (em vez de escondido), recusando o clique mesmo se
  reabilitado. O agendador, o "Ceder a vez" e os campos de ritmo humano já saem do
  free, com valores seguros fixos no código.
- `manifest.json`: `version` de `1.4.2` para `0.1`, já sob a nova convenção.
- `manifest.json`: `version` de `0.1` para **`0.3.0.0`** — a numeração passou a usar
  **quatro casas** (`MAIOR.MENOR.CORREÇÃO.REVISÃO`, sendo a última a revisão da
  build), e o `README.md` §Versionamento explica o formato.
- `README.md`: abertura corrigida (não promete mais recursos que a edição free não
  tem) e novas seções **Edições** e **Versionamento**.

### Removido

- **Painel de teste de edição** (o gatilho de 5 cliques no selo e o seletor
  Free/Premium/API): a edição deixou de ser escolha do cliente. Quem concede é o
  servidor, e o único caminho que tira a extensão do free é `aplicarDoServidor`.
- `PegaVagaEdicoes.definir()` — não existe mais função pública que ligue o premium
  localmente (o `smoke-edicoes.js` confere que ela não voltou).
- `PegaVagaShared.salvarEdicao`, `aplicarEdicaoSalva`, `modoEdicaoSalvo`,
  `modoEdicaoAtual`, `aplicarModoEdicao`, `lerPainelDev`, `salvarPainelDev` e as
  chaves `pegavaga_edicao`/`pegavaga_dev` — substituídas por sessão
  (`pegavaga_sessao`) e pelo cache do plano (`pegavaga_perfil`).
- `tests/smoke-painel-teste.js`, substituído por `tests/smoke-conta.js`.

### Corrigido

- **O cartão abria com TUDO em branco numa etapa que já estava preenchida**: o
  LinkedIn escreve os valores de PERFIL (nome, sobrenome, telefone, e-mail, país)
  **depois** de montar o formulário — é o React escrevendo a propriedade, não o
  atributo (ver `tests/fixtures/linkedin-etapa-contato.html`). Lendo os campos no
  primeiro instante, o cartão pedia nome/e-mail/telefone que já estavam na tela.
  Agora `camposTravadosCompletos` espera a etapa ficar quieta e, se ainda houver
  campo sem valor, faz uma SEGUNDA leitura um instante depois: o que chegou nesse
  meio tempo deixa de ser pedido (prova vermelho/verde: sem isso, o cartão lista
  os 6 campos da etapa; com isso, só o que falta).
- **O TYPEAHEAD ("Location (city)") não era preenchido**: é um
  `input role="combobox"` EDITÁVEL — a lista de sugestões só aparece depois de
  digitar, então abrir o campo não acha nada. Agora ele é escrito e a sugestão que
  casa é clicada (sem sugestão, vale o texto digitado).
- **Pergunta JÁ RESPONDIDA no LinkedIn não entra mais no cartão**: a rede de rótulos
  (`camposPorPergunta`) reportava o bloco mesmo com o campo resolvido — o cartão
  abria com TODOS os campos da etapa quando só um estava faltando. Agora o bloco só
  entra se o controle escolhido estiver sem resposta.
- **A janelinha não perde o cartão sem a API de janelas** (`chrome.windows`): a
  posição/arrasto ficava no caminho do resto do `iniciar()` — sem a API, os campos
  nem eram desenhados.
- **O PREENCHIMENTO dos campos (rádio, select e texto) não acontecia por um erro de
  seletor** (`queryAllUnique`): a função recebe a LISTA de seletores, e três chamadas
  novas passavam uma **string** — `for (const s of 'input, select')` itera os
  CARACTERES, e no `','` o `querySelectorAll` estoura
  (`SyntaxError: ',' is not a valid selector`). Com isso a busca do campo morria em
  **todos** os campos (o `try` da busca engolia o erro, com um
  `falha ao localizar o campo "…"` no console) e a extensão não escrevia NADA —
  era o "o select não preenche" e, depois, "nenhuma resposta do cartão pode ser
  escrita no formulário". Agora `queryAllUnique` aceita string OU lista (string =
  um seletor) e um seletor inválido não derruba os outros.
- **A página não é mais recarregada no meio do fluxo** (`podeRecarregar`): a troca
  de termo (que NAVEGA para o próximo termo) agora ESPERA quando há formulário de
  candidatura aberto na tela ou quando você está mexendo na página. Recarregar por
  cima de um formulário em preenchimento perdia o que estava respondido (e o que
  você tinha digitado, no "vou preencher à mão"). A fila fica salva como está e a
  navegação acontece quando o modal fechar.
- **`falha ao localizar o campo "…"` agora diz QUAL erro** (nome e mensagem, não
  `[object DOMException]`): é esse log que aponta o seletor quebrado no console.
- **O `<select>` cujo placeholder tem VALOR não vazio sumia** (`jaRespondido`): o
  LinkedIn entrega `<option value="Selecionar opção">` (texto **e** valor, sem
  `value=""`), e o laço dos campos obrigatórios comparava só o `value` — o campo
  era dado como respondido e saía do cartão. Era também o que fazia, sem outra via,
  a pergunta chegar como campo de TEXTO. Comparar "respondido" passou a ser sempre
  pelo `jaRespondido` (que já entende o placeholder do `<select>`).
- **A mesma pergunta saía 4× no cartão** (grupo de rádio): `aria-required="true"`
  está em **cada** `<input type=radio>` do LinkedIn (ver o HTML real em
  `tests/fixtures/linkedin-etapa-radios.html`), então o laço dos obrigatórios
  anotava as quatro bolinhas. `anotar` agora aceita só a PRIMEIRA opção do grupo e
  nunca duas do mesmo grupo.
- **O rótulo da pergunta vinha com o "Obrigatório" colado e, em alguns casos, com o
  texto da OPÇÃO**: a pergunta de rádio mora no `<legend>`, que também carrega o
  `<span class="visually-hidden">Obrigatório</span>`; e o `<label>` do input é a
  OPÇÃO ("Yes"). `rotuloDaPerguntaDoGrupo` passa a tentar os rótulos do mais
  específico para o mais genérico (`.fb-dash-form-element__label` antes do
  `legend` — um seletor com lista não serve: o `querySelector` devolve o primeiro
  na ordem do DOCUMENTO), e `rotuloDaOpcao` usa o
  `data-test-text-selectable-option__input`, que é o texto da opção sem depender de
  `<label>`/CSS.
- **O select marca por TIPO de campo, não pelo bloco** (`camposPorPergunta`): a rede
  de rótulos devolvia o BLOCO quando nenhum controle de dentro contava como "sem
  resposta" — e o select já vem com uma opção marcada em algumas etapas. Com o
  bloco no lugar do controle, o cartão perdia o tipo e virava campo de TEXTO (o
  "select veio como text input"). Agora o alvo é sempre o CONTROLE.

### Adicionado

- **O cartão abre PREENCHIDO com o que já está no LinkedIn**: cada campo levou o
  `valor` (o que ele mostra na página, com placeholder contando como vazio) e a
  janelinha/aba pré-seleciona a opção ou preenche o texto. Numa etapa em que falta
  UM campo, você confere o que já está lá e responde só o que falta — a resposta sai
  com tudo (o que estava preenchido junto), então nada se perde.
- **A página REAL da extensão nos testes de DOM**: o harness carrega `ajuda.html`
  (a janelinha) com o `chrome` falso e roda o `ajuda.js` de verdade —
  `tests/smoke-dom-janelinha.js`, que confere o cartão preenchido e a resposta no
  mesmo contrato que o content script espera.
- **Suíte dirigida por FIXTURES do LinkedIn real** (`tests/smoke-dom-linkedin.js`):
  cada arquivo em `tests/fixtures/*.html` é uma etapa copiada da página (Copy
  outerHTML) e roda no Chromium com o `content.js` de verdade. O roteiro é
  `tests/dom-<nome>.js` quando existe e, senão, o genérico `tests/dom-linkedin.js`,
  que confere a varredura, o rótulo (nunca a opção), a repetição por bolinha, as
  opções dos campos de escolha e a VOLTA (a resposta entrando no formulário).
  **Copiar uma etapa nova do LinkedIn passou a ser só salvar o HTML.**
- **Build em TypeScript, sem npm** (`src/`, `tools/`, `tsconfig.json`): o código
  artdeco não usa `<input type=radio>` em todas as telas — as opções são
  div/botões com `role="radio"` dentro de um `radiogroup`/`fieldset`. Nada lia
  esse grupo, então a pergunta ia **sem opções** e o cartão (sem opções) virava
  campo de texto. Agora o grupo é lido (entrando em Shadow DOM), o campo sai como
  **rádio com as opções**, o "respondido" é `aria-checked` e a resposta é aplicada
  **clicando a opção certa** (pelo mesmo texto que o cartão mostrou).
- **Fechar a janelinha sem decidir agora avisa a aba** (`responderAjuda`): a
  decisão VAZIA (o "×") era descartada pelo worker, e o content script continuava
  esperando a resposta pelo prazo cheio (**5 minutos**) — a varredura ficava
  parada, parecendo travada. Agora a decisão vazia volta para a aba na hora e o
  fluxo segue o caminho de sempre.
- **Diagnóstico afiado**: a auditoria da etapa agora sai numa **string** (fácil de
  copiar), com o texto de cada bloco e os **controles** de dentro (tag, `type`,
  `role`, `aria-checked`) mais as contagens de `input`/`select`/`radio`/`combos`;
  e cada **carga de página** registra `[PegaVaga] pagina carregada: <url>` — é o
  que prova se houve recarga e para QUAL URL.

- **A pergunta de rádio chegava como campo de texto** (`radioGroup`/`rotuloDaOpcao`):
  o `radioGroup` procurava o grupo só DENTRO do nó `modal` e sem entrar em Shadow
  DOM — o grupo não era encontrado, a pergunta ficava **sem opção nenhuma** e o
  cartão, sem opções, cai no campo de texto (era o "radio veio como text"). Agora
  ele procura no modal e **cai para o documento**, entrando nos Shadow DOMs; e o
  rótulo de cada OPÇÃO vem do `rotuloDaOpcao` (o texto ao lado da bolinha —
  "Sim"/"Não" —, não a pergunta), usado também ao **aplicar a resposta** e no
  "respondo sozinho" (os três casam pelo mesmo texto).
- **O termo não é mais encerrado cedo depois de uma candidatura** (`startScan`):
  o LinkedIn **remonta o painel** depois de candidatar, a lista fica vazia por um
  instante e/ou o container de rolagem troca — a rolagem falhava e a varredura dava
  a lista por encerrada, **navegando para o próximo termo** (recarregando a página)
  logo depois do envio. Agora há **carência**: espera a lista existir e tenta rolar
  de novo; só encerra o termo se falhar de novo.
- **Logs de navegação**: `[PegaVaga] termo encerrado (motivo: …)`, `fila encerrada`
  e `recarregando a pagina para o proximo termo`, mais os do agendador (recarga ao
  reiniciar no 1º termo e ao cutucar a aba) — para saber qual caminho recarregou.

- **A pergunta de lista não chega mais sem opções** (`camposPorPergunta`): a rede
  de segurança por rótulo montava o campo com `tipo`/`opcoes` FIXOS
  (`opcoes: []`) — e o cartão, **sem opção nenhuma, cai no campo de texto**, por
  isso o `<select>` aparecia como input. Agora a descrição vem do **controle de
  verdade** (`descreverCampo`), então o tipo e as **opções do LinkedIn** vêm
  juntos (`Yes`/`No`, com o `Selecionar opção` filtrado); e, dentro do bloco,
  escolhemos o controle que ainda está **sem resposta**.

- **O `<select>` que o LinkedIn esconde atrás do UI custom agora conta**
  (`visivelOuControle`): o `fb-dash-form-element__select-dropdown` fica **sem
  caixa** (`getClientRects` vazio) — ele existe, tem as opções e recebe a
  resposta, mas não é "visível". Exigir visibilidade o descartava, e era por isso
  que a pergunta de lista chegava ao cartão como **campo de texto e sem opção**
  (a rede de segurança a pegava pelo rótulo, sem ler as opções). Agora o controle
  nativo que existe entra, com o tipo e as **opções lidas do próprio LinkedIn**
  (`Yes`/`No`, com o `Selecionar opção` filtrado).
- **A ordem do cartão é a ORDEM DA PÁGINA** (`compareDocumentPosition`): a lista
  seguia a ordem da DESCOBERTA, então um campo achado pela rede final aparecia por
  último. Agora as perguntas saem na mesma sequência em que estão no LinkedIn.

- **O campo de lista agora é achado mesmo FORA do nó do modal**
  (`pertenceAoFormulario` + busca no documento): o Easy Apply é montado num
  **portal do React**, e o conteúdo pode não ser descendente do `modal` que o
  fluxo guarda. Era esta a causa do `<select required aria-required="true">`
  (classe `fb-dash-form-element__select-dropdown`, `data-test-text-entity-list-form-select`,
  `id` com `multipleChoice`) não aparecer em **nenhuma** varredura — nem na do
  formulário, nem na dos rótulos. Agora, além do `modal`, a varredura procura no
  DOCUMENTO os campos **obrigatórios** (`required`/`aria-required`) e os
  **controles de escolha única** do LinkedIn, aceitando só o que está dentro de um
  modal de candidatura. E o `buscarCampo` (que escreve a resposta) faz a mesma
  busca — então a resposta chega no controle certo.
- **A varredura entra nos Shadow DOMs abertos** (`queryAllProfundo`): o LinkedIn
  monta parte do formulário em web components, e um controle dentro de um
  `shadowRoot` é invisível para `querySelectorAll` — o campo simplesmente "não
  existia" para a varredura (nem pelo rótulo, nem pelo texto). Agora a busca
  desce nos shadow roots (no formulário, nos rótulos, no placeholder e na
  reaplicação da resposta).
- **`contenteditable` também é campo de texto** (`camposTravados`): alguns
  editores do LinkedIn não são `<input>`, e o campo ficava de fora.
- **Auditoria da etapa no console** (`[PegaVaga] auditoria da etapa`): registra
  quantos blocos de pergunta existem, o texto e os CONTROLES de cada um
  (`input:text`, `select`, `div[role=button]`…), a contagem de cada tipo e quantos
  hosts de Shadow DOM há no formulário. É o que permite corrigir o reconhecimento
  de um campo sem tentativa e erro.

- **`<input readonly>` é um controle de ESCOLHA, não um campo de texto**
  (`camposTravados`/`descreverCampo`): o dropdown do artdeco, em algumas versões,
  não traz `role` nem `aria-*` — é só um `<input readonly>`. O teste de `readOnly`
  (feito para não mexer em campo calculado) o descartava, e era **ele** o campo que
  sumia do pedido. Agora um `input readonly` em branco entra como pergunta de
  lista, e as opções são lidas abrindo o controle (e aplicadas clicando na opção —
  escrever num readonly não adianta).
- **Rede de segurança final: as perguntas entram pelo RÓTULO**
  (`camposPorPergunta`): o rótulo da pergunta está **sempre** no DOM (é o texto que
  a pessoa lê). Depois de todos os reconhecedores, uma varredura percorre os
  rótulos da etapa e, para cada pergunta cujo controle não foi reconhecido, põe a
  própria pergunta no pedido (o bloco do campo entra como alvo). Assim **nenhuma
  pergunta da etapa fica de fora** — mesmo que a marcação do controle seja
  desconhecida. Ao aplicar a resposta, o `aplicarRespostaNosCampos` desce do bloco
  até o controle de dentro dele (e `buscarCampo` passou a achar o bloco pelo
  rótulo).

- **TODO campo sem resposta entra no pedido** (`camposTravados`): a varredura
  completa do formulário estava atrás de um portão — `if (!vistos.length)` — e só
  rodava quando **nenhum** campo vinha marcado como inválido. Como o LinkedIn
  marca `:invalid` apenas os nativos obrigatórios, bastava uma etapa com textos
  obrigatórios em branco (o caso comum) para a varredura ser **pulada** e a
  pergunta de lista ficar de fora. O portão saiu: agora a varredura roda SEMPRE e
  junta ao pedido tudo o que ainda não foi respondido. O teto de campos subiu de
  8 para 12.
- **A pergunta de lista é reconhecida pelo TEXTO, sem depender de ARIA**
  (`textoEhPlaceholderDeLista`/`ehPerguntaDeLista`): o mesmo dropdown já apareceu
  como `<select>`, como `<button>` e como **`<input readonly placeholder="Selecionar
  opção">`** — e no último caso, sem `role` nem `aria-*`, ele era lido como campo de
  texto (ou descartado pelo `readOnly`, que só impede digitar). Agora o texto do
  controle (ou o `placeholder`, ou o valor do input readonly) decide: se é o
  placeholder de lista, é pergunta de lista — e as opções são lidas abrindo o
  controle.
- **Diagnóstico no console**: ao montar o cartão, o `content.js` registra
  `[PegaVaga] campos reconhecidos nesta etapa: [{ rotulo, tipo, opcoes, tag }]`.
  Quando algum campo não aparece (ou aparece com o tipo errado), é essa linha que
  diz o que o reconhecimento viu.

- **As perguntas da etapa agora vão TODAS no mesmo pedido** — dois defeitos
  somados deixavam um campo só no cartão:
  1. o `fieldLabel` podia pegar o **`<fieldset>` da etapa inteira** (o passo
     "Perguntas adicionais" é um bloco com várias perguntas) e devolver a
     **primeira** pergunta como rótulo de todos os campos — e o dedupe por
     rótulo descartava as demais. Agora o bloco é o da PERGUNTA
     (`.fb-dash-form-element`), o `fieldset` só entra pelo `legend` de
     rádio/checkbox, e o texto do bloco inteiro só vale quando ele tem **um**
     controle;
  2. o `camposTravados` deduplicava por RÓTULO. Dois campos com o mesmo texto (ou
     sem texto) reduíam a um. Agora o dedupe é por **ELEMENTO**, e só.
- **A segunda janelinha vinha em branco** — o `lerOpcoesAbrindo` fechava o
  dropdown com **Escape no documento**, e no LinkedIn o Escape fecha o **modal
  inteiro** (com o "descartar candidatura?"). Resultado: o formulário saía da
  tela, a resposta não tinha onde ser escrita e o pedido seguinte era montado sem
  campo nenhum. O fechamento passou a ser um **clique no topo do próprio modal**
  (o "clique fora" que fecha só a lista). E o `resolverComAjuda` deixou de dizer
  "continuar" quando **nada** foi escrito com o formulário fora da tela — nesse
  caso o desfecho é `incompleta`, que não reabre a janelinha vazia.
- **Opções de outro campo no dropdown** (`opcoesDoCombo`): a "âncora" descia até
  `fieldset`/`div` genéricos e podia ler a lista de outra pergunta. Agora só
  containers de UMA pergunta (ou o pai direto do controle).

- **A janelinha volta a ser `popup` (o mais capado que o Chrome permite)**
  (`background.ts`): o worker agora tenta na ordem do mais restrito ao menos —
  `type: 'popup'` no formato mínimo, `type: 'popup'` com `setSelfAsOpener`, e só
  por último uma janela normal (para o pedido não se perder). Se o tipo `popup`
  for recusado, a **recusa volta na resposta** (`recusa`) e o content script a
  registra no console — assim a moldura errada não passa em silêncio e dá para
  corrigir a causa.
- **O rótulo de cada campo agora é a PERGUNTA, não o texto de ajuda**
  (`fieldLabel`): a leitura começava por `aria-label || placeholder` e, no fim,
  pegava o `textContent` do bloco inteiro — e é justamente ele que junta a
  pergunta com "Obrigatório", "Selecionar opção" e "Insira uma resposta válida".
  O cartão mostrava o ruído no lugar da pergunta. Agora a ordem é
  `aria-labelledby` → `aria-label` → `<label for>` → rótulo do bloco do Easy
  Apply → container → placeholder, e **todo texto passa por um filtro de ruído**
  (`perguntaDoTexto` + `RUIDO_EXATO_RE`/`RUIDO_INSTRUCAO_RE`): "Obrigatório",
  "Selecionar opção", "Insira uma resposta válida" e "Insira um número decimal…"
  deixam de virar rótulo. O limite subiu de 60 para 120 caracteres, para a
  pergunta ir inteira.
- **Sem mapear todos os campos da etapa** (`camposTravados`): o dedupe era por
  texto, e a chave de um campo SEM rótulo era `tipo:` — igual para todos —, então
  a 2ª pergunta obrigatória era descartada como "repetida". Agora o dedupe é por
  ELEMENTO, e por rótulo só quando ele existe; o teto subiu de 4 para 8 campos
  (a etapa cabe no cartão, que rola).
- **As opções de um dropdown custom iam como objeto** (`descreverCampo`): o cartão
  mostrava `[object Object]` em cada opção (a lista preservava `{ texto, value,
  el }` em vez do texto). Agora só o texto vai. E quando a lista só existe depois
  de abrir o dropdown (ele não a deixa no DOM) e a pergunta é de **sim/não**
  ("Você tem conhecimento em .Net Core?", "Você aceita?"), o cartão oferece
  **Sim/Não**, que é exatamente o que o LinkedIn dá nesses campos — em vez de
  ficar sem opção nenhuma.
- **A pergunta de lista ("Selecionar opção") não chegava ao cartão** — quatro
  causas, todas no reconhecimento do controle:
  1. o dropdown do artdeco é um **`<input readonly role="combobox">`**, e o scan
     descartava todo campo `readOnly` ANTES de olhar se era combobox (o
     `readOnly` ali impede de digitar, não de escolher) — a checagem de combobox
     passou a vir antes;
  2. o `ehCombo` só aceitava `<button>` como gatilho, mas o LinkedIn também usa
     `<div role="button" aria-haspopup="listbox">` — agora qualquer elemento com
     `role="combobox"`, `aria-haspopup="listbox"` ou `[aria-expanded]` (dentro de
     um bloco de pergunta) conta;
  3. o ramo do `<select>` exigia opções legíveis para reportar o campo — um
     select obrigatório em branco passou a ser reportado sempre;
  4. **a lista de opções só existe no DOM depois de o dropdown abrir**: o
     `camposTravadosCompletos` agora abre o controle, lê as escolhas originais e
     fecha (Escape) antes de montar o cartão — em vez de mandar a pergunta sem
     opção nenhuma.
  Junto, `resolverCampo`/`buscarCampo` passaram a procurar o gatilho por
  `[aria-haspopup]`/`[aria-expanded]` (não só em `<button>`), para a resposta
  escolhida no cartão ser aplicada no controle certo.
- **O campo de lista ainda sumia quando os outros vinham marcados como inválidos**
  (`camposTravados`): a varredura "do que falta" só rodava quando **nada** tinha
  sido marcado como recusado (`if (!vistos.length)`). Numa etapa com 4 textos
  obrigatórios em branco, o LinkedIn marca todos como `:invalid` — e a varredura
  nem acontecia, então a pergunta de lista (que ele **não** marca como `:invalid`,
  por não ser campo nativo) ficava de fora. Agora duas passagens de ALTA confiança
  rodam **sempre**, depois dos campos marcados: o controle que mostra o
  placeholder de lista e o campo nativo `required`/`aria-required` em branco.
- **O controle de lista agora é achado pelo TEXTO, sem depender da marcação**
  (`controlesDePlaceholder` + `PLACEHOLDER_TEXTO_RE`): o LinkedIn já usou
  `<select>`, `<input readonly role="combobox">` e `<div role="button">` para a
  mesma pergunta, e há versões sem ARIA nenhuma. O que nunca muda é o texto na
  tela — "Selecionar opção"/"Selecione uma opção"/"Select an option"/"—" — e é ele
  que identifica o dropdown sem resposta (sem confundir com uma pergunta que
  comece com "Selecione o seu nível…"). Achado o controle, o `camposTravadosCompletos`
  abre a lista, lê as opções e fecha.
- **A pergunta vinha cortada** (`fieldLabel`/`ajudaContexto`): o rótulo era
  truncado em 120 caracteres — e perguntas como "…Machine Learning de ponta a
  ponta, incluindo modelagem, implantação e monitoramento em produção?" passam
  disso. O limite subiu para **300** (o cartão quebra linha e rola), e uma linha
  só é descartada como "ajuda" acima de 300 caracteres.

- **A vaga não é mais descartada quando a janelinha de ajuda não abre**
  (`content.js`): a janela no desktop (ajuda.html) é o caminho normal, mas quando
  ela não abria (worker/serviço indisponível, janela bloqueada pelo sistema) o
  `pedirAjuda` voltava vazio e o fluxo **fechava o formulário e seguia para a
  próxima vaga** — era o "fecha e avança" com campo personalizado em branco. O
  fallback que os comentários já prometiam ("se a janela não abrir, o content cai
  no cartão dentro da aba") **não existia**: agora existe (`cartaoNaAba`), com os
  mesmos campos (tipo e opções originais do LinkedIn) e as mesmas três saídas —
  **Aplicar e continuar**, **Vou preencher à mão** e **Pular esta vaga** — dentro
  da própria página, no canto inferior direito.
- **O cartão dentro da aba ficou imune ao CSS do LinkedIn** (`content.js`): ele
  agora vive num **Shadow DOM** (`CARTAO_CSS`), então nada da página o alcança.
  Era por herança das regras da página que o texto saía **branco no fundo branco**
  (o LinkedIn em modo escuro marca os controles com `color-scheme: dark`) e os
  rótulos vinham **cortados**. Dentro do Shadow DOM o cartão fixa
  `color-scheme: light`, as cores do PegaVaga (azul `#0a66c2`/`#004182` no
  cabeçalho e no botão principal, texto `#1f2933`, bordas `#94a3b8`, ações
  secundárias com contraste) e o rótulo quebra linha em vez de ser cortado — com
  o corpo do cartão **rolando** (`overflow-y: auto` + `min-height: 0`) quando a
  pergunta é longa.
- **Por que a janela do desktop não abriu, agora dá para saber** (`background.js`):
  o `mostrarAjuda` devolve `motivo` (`sem_api_windows`, `sem_aba`, `sem_pedido`,
  `create_falhou:…`, `sem_janela`) e tenta de novo **sem** `type: 'popup'` se a
  plataforma recusar o tipo. O content script registra o motivo (e um eventual
  erro de envio — worker sem ouvinte, contexto invalidado) no `console.warn`
  junto do cartão na página.
- **A etapa estagnada agora dispara o pedido de ajuda** (`stepSignature`): a
  assinatura da etapa incluía o `aria-label` do campo, e o LinkedIn **reescreve
  esse atributo** ao mostrar o erro de validação. Resultado: a assinatura mudava a
  cada clique, a contagem de tentativas zerava e o aviso nunca aparecia — a vaga
  era descartada em silêncio. A assinatura passou a usar só `name`/`id`/`type` (e o
  texto do `legend`), que não mudam com o erro.
- **Campo vazio escondido por placeholder** (`selectVazio`): o `<select>` do
  LinkedIn às vezes tem um placeholder **com valor não-vazio** ("Selecione uma
  opção", value="0"), e o combobox custom às vezes mostra "Choose…" — os dois
  passavam por "já respondido" e a pergunta não chegava ao cartão. Agora
  `selecione|selecionar|escolha|escolher|select|choose|--|—` contam como vazio.
- **O guarda de popup não fecha um dialog não classificado que tenha campos**
  (`findPopup`): entre as etapas o LinkedIn remonta o rodapé e há um instante em
  que o formulário não casa com nenhuma classificação. Fechá-lo descartava a
  candidatura. Agora um dialog **desconhecido com campos de formulário** é
  poupado; os popups já classificados (pesquisa/aviso) continuam sendo fechados.

- **O botão de candidatura certo agora é encontrado** (`content.js`): o
  `findApplyButton` pegava o **primeiro** `.jobs-apply-button` do documento, e o
  LinkedIn deixa no DOM o botão de vagas que já saíram do painel — um deles,
  invisível, vinha antes. O clique caía nele, o formulário não abria e a varredura
  lia aquilo como "vaga sem candidatura": era o "não está clicando em candidatura",
  com o botão na tela. Agora só entram botões **visíveis e habilitados**, e, entre
  eles, tem preferência o da vaga aberta (`data-job-id` = id do card selecionado).
  Os seletores ganharam os endereços estáveis (`#jobs-apply-button-id`,
  `data-live-test-job-apply-button`) na frente dos de classe.
- **A vaga não é mais descartada em silêncio quando a etapa tem campo sem valor**:
  quando o "Avançar" não saía do lugar, o pedido de ajuda só era feito se o
  LinkedIn **marcasse** o campo como inválido (`invalidFields`); quando ele não
  marcava (as classes mudam), a extensão repetia o clique até estourar o limite de
  etapas e descartava a vaga sozinha. O gatilho passou a ser o `camposTravados` —
  que, além do campo marcado, varre o formulário atrás do que um humano veria em
  branco (campo sem valor, select sem escolha, rádio sem marcação) — tanto no meio
  do laço quanto no fim. É a janelinha que abre o campo para você preencher, manda
  à página ou pula a vaga.

- **`pgv.sh test` não rodava todos os testes da extensão**: a lista era fixa em
  três suítes e as duas mais novas (`smoke-espera` e `smoke-popups`) ficavam de
  fora sem avisar. Agora o `tools/testar.sh` acha os testes pelo glob
  (`tests/smoke-*.js`) — suíte nova entra sozinha.

- **O guard de popup ficava cego depois do envio — e o popup do pós-candidatura
  ficava na frente da lista** (`content.js`): o guard só agia enquanto
  `document.contains(keepDialog)` fosse verdadeiro, e o LinkedIn **troca o nó** do
  dialog — ao enviar, e também quando a vaga passa a ser sua (você preenche o campo
  à mão, envia, e a confirmação/pesquisa de avaliação entra na tela). Com o
  ponteiro apontando para um nó que não existe mais, o observer ficava defasado:
  não fechava mais nada, a varredura seguia com o overlay na frente da lista — e o
  `closeStaleForm` do card seguinte ainda era **pulado**, porque você tinha acabado
  de mexer na página (`userIsIdle` falso). Agora o formulário protegido é resolvido
  na hora (`keepDialogNow()`: o ponteiro guardado, se ainda está na tela, ou o
  formulário que está nela agora) e o **pós-envio continua de serviço** depois do
  `dismissAfterApply` (`state.posEnvio`, ex-`dismissing`) — até a tela ser limpa
  para a próxima vaga (`closeStaleForm`) ou a próxima vaga começar —, então o popup
  atrasado é fechado no instante em que entra na tela. Sem formulário na tela o
  guard fecha só o que a página já classificou como popup (`findKnownPopup`):
  fechar um dialog ainda sem cara (a etapa seguinte carregando) descartaria uma
  candidatura de verdade.
- **O guard nunca fecha o aviso de limite do LinkedIn — e agora é ele que para a
  varredura** (`content.js`/`shared.js`): o dialog cujo texto casa com o sinal de
  restrição fica de fora do `findPopup`/`findKnownPopup` — quem lê esse recado é a
  proteção da conta (`detectRateLimit`/`tripGuard`), e fechá-lo esconderia justamente
  o aviso que faz a varredura parar. Só que "não fechar" não bastava: o aviso entra
  como popup **no fim do `<body>`** (o texto da página é lido só nos primeiros
  20 000 caracteres, e a lista de vagas ocupa bem mais que isso) e as redações que o
  LinkedIn usa para ele são muitas — o resultado era o pior dos dois mundos: o guard
  não fechava o aviso, o detector não o reconhecia e a varredura ficava **presa em
  "Parar"**, sem parar nem seguir. Agora (1) as redações vivem no `shared.js`
  (`RATE_LIMIT_PATTERNS`/`looksRateLimited`, com as formas de limite de candidaturas
  em pt e en) e são procuradas **no texto dos dialogs também**, (2) o guard que vê o
  aviso chama o `tripGuard` — a varredura para sozinha, com o motivo no aviso do
  pop-up, e a fila volta depois do descanso — e (3) o laço do formulário relê o
  sinal **antes** do `abort`, para o desfecho ser `bloqueio` (parada por proteção do
  LinkedIn) e não um "você pediu para parar" que não houve.
- **Um popup parado na frente da lista empacava a varredura inteira — o guard só
  agia depois do formulário identificado** (`content.js`/`shared.js`): entre uma vaga
  e outra (`state.keepDialog` já zerado, sem pós-envio) o guard ficava **quieto** de
  propósito, para não confundir um dialog que ainda está carregando com popup. Mas a
  página inteira passa por esse estado: o clique no card não abria a vaga (o overlay
  engolia o clique), o painel de detalhes não carregava, a vaga era dada por perdida
  e o quadro se repetia com o botão em **"Parar"** — a varredura parecia travada. O
  `popupGuardMode` ganhou dois sinais: `usuarioOcioso` (entre uma vaga e outra o
  guard fecha só o que a página já classificou como popup — `limpar` — e **só**
  quando a página está livre, então ele não briga com o seu clique) e
  `abrindoFormulario` (do clique em "Candidatura Simplificada" até o formulário
  entrar na tela o guard volta a ficar quieto, porque o dialog que entra nesse
  intervalo pode ser a nossa própria candidatura carregando).

- **(temporário) A vaga travada num campo recusado era descartada em silêncio, sem
  o aviso na área de trabalho** (`content.js`): o formulário era clicado em
  "Avançar" até estourar o limite de etapas e só então fechado, como `Formulário
  incompleto`. Duas causas: (1) a espera por mudança de etapa comparava o **texto
  inteiro** da tela e a mensagem de erro — que o LinkedIn reescreve a cada
  clique — fazia a tela parecer que tinha mudado, então a contagem de tentativas
  travadas nunca subia; (2) os sinais de campo inválido não eram lidos por
  completo (`input:invalid`/`select:invalid`/`textarea:invalid` e as mensagens
  `[data-test-form-element-error-message]`/`.artdeco-inline-feedback__message--error`
  ficavam de fora). Agora a etapa tem assinatura própria (`stepSignature`: título +
  campos + botões, **sem** as mensagens de erro), os campos recusados são checados
  **a cada passo** — com `fillPendingFields` antes de decidir — e o aviso é pedido
  assim que o LinkedIn continua recusando; o fim do laço (limite de etapas/tempo)
  também pergunta antes de fechar, e a vaga fica `Travada em campo obrigatório`.
- **O aviso de campo recusado não é mais engolido pelo intervalo de um por
  minuto** (`content.js`): o intervalo cheio (`ajudaIntervaloMs`) continua valendo
  para o aviso de **demora**; o de campo recusado usa um respiro curto
  (`ajudaIntervaloCamposMs`, 10 s), porque cada vaga é um caso novo e ela era
  descartada sem ninguém ser avisado. Quando a notificação não pode ser criada
  (permissão de área de trabalho negada no sistema, por exemplo), o content script
  avisa no **console do LinkedIn** — antes disso, a vaga era descartada sem deixar
  rastro do motivo.
- **O `waitForQuiet` usava o `timer` antes de ele ser declarado** (`shared.js`): se o
  sinal acordasse na **mesma volta** do `subscribe` — a página mexeu antes de a
  espera começar —, o `clearTimeout(timer)` estourava `ReferenceError: Cannot access
  'timer' before initialization` em vez de devolver `false`. O `timer` agora é
  declarado antes (`let timer = null`) e só é cancelado se existir, como no
  `waitUntil`. Coberto pelo `tests/smoke-espera.js`.
