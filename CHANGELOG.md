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

### Alterado

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
