# Changelog — PegaVaga (extensão do Chrome)

Todas as mudanças relevantes desta extensão, da mais nova para a mais antiga. O
formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e a
numeração, o SemVer adaptado descrito no
[README](README.md#versionamento): `0.x` enquanto desenvolve, `1.0` quando estiver
pronto para usar, e depois `1.1`, `2.0`…

> A numeração antiga ia até `1.4.2`, sem registro aqui. A **0.1** marca o reinício
> sob esta convenção — a `1.0` fica reservada para o lançamento estável.
>
> Este changelog cobre **só a extensão**: a API de licenças (Python) vive num
> repositório **privado** separado, com changelog próprio.

## [0.1] — em desenvolvimento

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
- **Selo de versão e edição** no cabeçalho do pop-up.
- `tests/smoke-edicoes.js`: teste de fumaça que roda no Node puro (o `shared.js` é
  livre de DOM) cobrindo as regras de free e premium.

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
- `README.md`: abertura corrigida (não promete mais recursos que a edição free não
  tem) e novas seções **Edições** e **Versionamento**.
