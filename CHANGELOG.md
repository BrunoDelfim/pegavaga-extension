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

- **Build em TypeScript, sem npm** (`src/`, `tools/`, `tsconfig.json`): o código
  está migrando de JavaScript para TypeScript **um arquivo por vez**, começando pelo
  `edicoes.js` (`src/edicoes.ts` — o menor e sem DOM). O compilador (TypeScript
  5.9.3) e os tipos do Chrome são baixados **pelo próprio Node**, em versão fixa
  (`tools/baixar-tipos.js`: `https` + `zlib` + um leitor de tar de ~40 linhas — sem
  `npm`, sem `package.json`, sem depender de registro de pacotes), e o `.js` gerado
  continua **versionado** e idêntico em comportamento (conferido: mesmos perfis,
  mesma superfície de API e os 272 testes passando). Quem instala a extensão **não**
  precisa compilar nada.
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

### Alterado

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
