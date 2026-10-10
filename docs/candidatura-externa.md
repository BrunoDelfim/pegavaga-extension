# PegaVaga — Candidatura externa (vaga no site da empresa)

> Documento de trabalho, no espírito do `docs/refatoracao-free-premium.md` da API:
> registra o desenho **antes** do código, para a implementação nascer cortada na
> fronteira certa. **Nada aqui está implementado** — é a pauta de trabalho.

## 1. O que existe hoje

Vaga cujo botão manda para fora do LinkedIn (site da empresa, Greenhouse, Workday…)
é **pulada sem clique nenhum** — de propósito, "para nunca levar a sua aba para
fora":

| Onde | O que faz |
| ---- | --------- |
| `content.js` `skipIfOffsite()` (~2836) | Lê o tipo do botão; se não for Easy Apply, grava o desfecho `externa`/`desconhecida` **antes** de clicar e devolve `true` (a varredura pula para a próxima). |
| `content.js` `runApplyFlow()` (~2148) | Mesma checagem depois: `if (kind !== APPLY_KINDS.easy) return { status: 'externa', detail }`. |
| `content.js` (~2510) | Ao receber `externa`, força `applyAttempts = applyMaxAttempts`: **nunca mais visita** a vaga (e não gasta cota). |
| `content.js` `needsWork()` (~2796) | `applyStatus === 'externa'` → a vaga não "precisa de trabalho": sai da fila de vez. |
| `shared.js` `APPLY_OUTCOMES.externa` (~920) | `label: 'Externa (site da empresa)'`, `failure: true`, com o motivo "o botão leva ao site da empresa, então ela é pulada". |
| `shared.js` `classifyApply()` (~1167) | Descobre o tipo por **link embutido** (incluindo `/redir/redirect?url=…`), **ícone** (`link-external`) e **rótulo** (`EXTERNAL_APPLY_LABEL`, ~1085). `hostOf()` (~1105) já extrai o host final do redirecionador. |

Ou seja: a extensão **já sabe** que a vaga é externa e **já sabe para onde ela
aponta** (`applyDetail()` monta "Botão …, que aponta para careers.acme.com.").
Falta só o passo seguinte.

## 2. O objetivo

Quando a vaga é externa, em vez de descartá-la:

1. **abrir a vaga numa aba nova** (sem tirar a aba do LinkedIn do lugar);
2. **preencher o que der** no formulário do site da empresa;
3. **parar antes do envio** e **avisar você** para revisar e enviar;
4. registrar o desfecho no relatório (`Candidatado`, `Aberta para revisão`,
   `Preenchida por você`, `Pulada`), com o host e o que ficou faltando.

A promessa da extensão continua a mesma: **não roubar a sua aba** e **não fazer
nada irreversível sem você**. Só muda o desfecho: antes era "pulada", passa a ser
"deixei pronta para você".

## 3. Decisões a confirmar (D1–D7)

- **D1 — Onde rodar.** Aba nova criada pelo service worker
  (`chrome.tabs.create({ url, active: false })` — o `background.js` já usa isso na
  linha ~521 para abrir a busca) e preenchida **em segundo plano**. A aba do
  LinkedIn e a posição da varredura ficam intactas. Quando você escolhe "abrir para
  revisar", o `focarAba()` que já existe traz a aba pronta para a frente, com o foco
  na janela.
- **D2 — Quem injeta o script.** O content script novo precisa rodar **no site da
  empresa**, o que o `manifest.json` não permite hoje (`matches` só do LinkedIn).
  Três caminhos:
  - **A)** `content_scripts` com `matches: ["https://*/*"]`: simples, mas o aviso de
    instalação passa a dizer "ler e alterar todos os seus dados em todos os sites"
    — caro para um repositório público/portfólio.
  - **B)** permissão `scripting` + `host_permissions` amplas, injetando **sob
    demanda** só no host da vaga (via `chrome.scripting.executeScript`). Mesmo aviso
    de instalação da A, mas o código só entra no site quando há candidatura externa.
  - **C)** `optional_host_permissions: ["https://*/*"]` + um botão no pop-up
    ("Permitir preencher sites de vagas") pedindo a permissão **com gesto do
    usuário**. Aviso mais honesto, mas exige um passo de configuração — e o
    `permissions.request()` precisa de gesto, então **não dá para pedir no meio da
    varredura** (só a partir do pop-up/aviso).
  - **Recomendação:** **B** para a primeira fatia (hosts restritos ao mapa de ATS da
    §6, não `https://*/*`, se der para listar os principais em `optional_*`),
    avaliando **C** se a Web Store/o usuário reclamar do escopo. Decidir amanhã.
- **D3 — Nunca enviar sozinho.** No LinkedIn a extensão envia porque o formulário é
  o mesmo de sempre e o risco é conhecido; num site de terceiro, enviar sozinho
  significa (a) consentimento/LGPD respondido por nós, (b) currículo anexado sem
  você ver, (c) um erro de campo virando candidatura de verdade. **Fase 1 para
  antes do botão de enviar**, sempre. Automatizar o envio (se um dia) só atrás de
  uma opção explícita, desligada por padrão.
- **D4 — Perguntas sensíveis não são inventadas.** Salário, deficiência, raça/gênero,
  veteranos, autorização de trabalho, consentimento: só preenche se estiver em
  `settings.apply.answers` (as respostas que você já grava hoje); senão **deixa em
  branco, marca na tela e diz no relatório**. Nunca chutar.
- **D5 — Currículo.** Upload de arquivo é seu: o `<input type="file">` fica
  destacado, com o resto pronto. (Se um dia guardarmos o arquivo, que seja com
  autorização explícita e aviso na UI.)
- **D6 — Cota.** Hoje a externa **não gasta cota**. Proposta: continua não gastando
  enquanto o desfecho for "aberta/preenchida por você" — ela vira candidatura de
  verdade só quando **você** confirma o envio (ou a página confirma). Assim o teto
  horário/diário continua medindo o que a extensão fez sozinha.
- **D7 — Quando falhar.** Sem perfil para o host, ou com o formulário diferente do
  previsto: **não apostar** — abre a aba, registra `externa_sem_perfil` com o host e
  avisa você (o mesmo caminho do "Vou preencher à mão" que já existe). Nunca
  preencher "no chute" com seletores genéricos agressivos.

## 4. O fluxo novo, passo a passo

```
varredura (LinkedIn)                    worker                      aba da empresa
─────────────────────                   ──────                      ───────────────
acha o botão externo
  ├─ registra: status externa_aberta,
  │  host=careers.acme.com, detail
  └─ pede a abertura ────────────────►  tabs.create(active:false) ──►  carrega a vaga
                                        espera a aba ficar pronta
                                        injeta externas.js ────────►  lê o formulário
                                                                      preenche o que sabe
                                                                      marca o que faltou
                                                                      (não envia)
     ◄──── "vaga pronta para revisar (4 campos: 1 em branco)" ────────┘
     ├─ "Abrir para revisar" ──► focarAba() → você revisa e envia
     │                             └─ pop-up pergunta "enviei" → Candidatado
     └─ "Pular" ───────────────► fecha a aba, status pulada
     a varredura continua do mesmo ponto (não perdeu a fila)
```

O aviso reusa o **canal do pedido de ajuda** que existe hoje (notificação com
botões, `background.js` ~109, e o `focarAba` do "Vou preencher à mão"): é o mesmo
problema ("a extensão parou, precisa de você") e o mesmo cuidado (não roubar a aba
até você pedir).

## 5. Peças a construir

| Arquivo | O que entra |
| ------- | ----------- |
| `shared.js` | O **cérebro puro, testável no Node**: `EXTERNAL_ATS` (mapa host → perfil), `externalProfileFor(host, url)`, `classifyExternalField(sinais)` (rótulo/name/type → categoria), `planExternalFill(campos, respostas)` (o que preencher, o que deixar, o que marcar), `EXTERNAL_NEVER` (perguntas que não respondemos sozinhos). Nada de DOM aqui. |
| `externas.js` (novo) | O content script do site de fora: espera a página ficar quieta (o motor de espera do `shared.js` já serve), lê os campos de verdade, aplica o plano, destaca na tela o que preencheu e o que ficou em branco, e **observa** a confirmação de envio. |
| `background.js` | `abrirExterna(url, jobId)`: cria a aba em segundo plano, injeta o script, guarda `pendentes[jobId] = tabId`, reaproveita `focarAba(tabId)` no "abrir para revisar" e fecha a aba no "pular". |
| `content.js` | Troca o "pula de vez" por **registrar e seguir**: `skipIfOffsite()` deixa de forçar `applyAttempts` no máximo quando o desfecho for aproveitável; `needsWork()` passa a considerar o novo status. |
| `popup.js`/`popup.html` | O painel de externas: "N abertas · M prontas para revisar · K puladas", botão **Abrir** por vaga (para retomar depois) e o "**enviei**" (confirmação manual, que é o que vira `Candidatado`). |
| `shared.js` `APPLY_OUTCOMES` | Os desfechos novos (`externa_aberta`, `externa_pronta`, `externa_sem_perfil`, `externa_enviada`, `pulada`) com rótulo e motivo legível — é isso que alimenta o CSV e o relatório. |

## 6. Perfis por ATS (dados, não código)

O mapa é **dado** (em `shared.js`), para poder ser testado sem navegador e
crescido sem tocar na lógica:

| ATS | Hosts | Armadilhas conhecidas |
| --- | ----- | --------------------- |
| Greenhouse | `boards.greenhouse.io`, `job-boards.greenhouse.io` | `#application_form`, campos `job_application[first_name]`…, "Apply with LinkedIn" |
| Workday | `*.myworkdayjobs.com`, `*.wd1.myworkdayjobs.com` | fluxo em **5+ passos**, "Autofill with Resume", conta obrigatória |
| Lever | `jobs.lever.co` | URL `/apply`, `input[name="name"]` + `input[name="resume"]` |
| Gupy | `*.gupy.io`, `*.gupy.com.br` | cadastro próprio antes do formulário |
| SmartRecruiters | `jobs.smartrecruiters.com`, `*.smartrecruiters.com` | `input[name="firstName"]`…, "Apply with LinkedIn" |
| Workable | `apply.workable.com`, `*.workable.com` | multi-etapa, "Autofill with resume" |
| Recruitee / BambooHR / Taleo / SuccessFactors | `*.recruitee.com`, `*.bamboohr.com`, `*.taleo.net`, `*.sapsf.com` | login, "copy from profile", CAPTCHA |

**Fallback genérico** (host fora do mapa, D7): casa por **rótulo/`aria-label`/
`placeholder`/`name`/`id`/`type`** com categorias seguras — `first_name`,
`last_name`, `email`, `phone`, `city`/`location`, `linkedin`, `website`,
`resume` (só destaca), `cover_letter`, `consent`/LGPD, `how_did_you_hear`,
`authorization`. Fora isso, **em branco** com marcação na tela.

## 7. Perguntas que nunca respondemos sozinhos

Salário/pretensão, deficiência, raça/etnia, gênero, veteranos, data de nascimento,
documento/CPF, autorização de trabalho e consentimentos — só com valor **escrito por
você** em `settings.apply.answers`; senão fica em branco, **destacado** na tela e
registrado no relatório ("deixei 3 campos para você: Pretensão salarial, …"). É a
mesma regra que o LinkedIn já segue hoje ("ele não inventa o que não sabe").

## 8. Limites, riscos e o que fica fora

- **CAPTCHA/reCAPTCHA**: nunca resolver. Achar um é motivo para parar e pedir você
  (o mesmo aviso).
- **"Apply with LinkedIn"/importar perfil**: não clicar sozinho — é login/sessão de
  terceiro.
- **Criar conta no site da empresa**: fora de escopo. Sem conta, a vaga fica
  `externa_sem_perfil` e o relatório diz por quê.
- **Antes de 3-validações**: começar com **1 vaga por vez** e revisão obrigatória.
  Preencher formulário em nome do usuário num site de terceiro é mais sensível que
  o LinkedIn (ToS/robots próprios) — o ritmo humano e a revisão manual são o que
  mantém isso defensável.
- **Sem perfil para o host**: não preencher nada (D7). Melhor uma aba aberta do que
  dados errados num formulário de empresa.

## 9. Testes (o padrão da casa)

- **`tests/smoke-externas.js`** (novo): o mapa de hosts (`externalProfileFor` por
  host e por URL real de cada ATS), o `classifyExternalField` e o
  `planExternalFill` com **fixtures de formulário** de cada ATS (só rótulos/names,
  sem DOM): campo conhecido, campo sensível sem resposta, pergunta desconhecida,
  consentimento, arquivo de currículo. Sem rede.
- **`tests/smoke-ajuda.js`** (estender): o aviso novo "vaga pronta para revisar"
  (abrir para revisar traz a aba para frente; pular fecha) tem a mesma mecânica da
  ajuda — é ali que se prova.
- Regra que vale para os dois: **se dá para testar no Node, a decisão não pode
  estar no DOM** — daí `shared.js` carregar o mapa e o plano de preenchimento.

## 10. Ordem de execução

| Fase | Entrega | Por que nesta ordem |
| ---- | ------- | ------------------- |
| **0** | Fechar D1–D7 (§3) e o caminho de permissão (D2) | É o que trava/destrava o resto; a escolha de permissão muda o `manifest.json`. |
| **1** | **Abrir a aba + avisar + trazer para frente** — sem preencher nada ainda. Do "pulada" para "aberta para você" | Menor fatia que já tem valor: a vaga externa deixa de ser lixo do relatório e vira uma aba pronta. Testa o canal do aviso e a permissão, sem risco. |
| **2** | **Preenchimento genérico seguro** (nome, e-mail, telefone, LinkedIn, cidade) + destacar o resto | É o grosso do trabalho manual que some, sem perfil nenhum por ATS. |
| **3** | **Perfis por ATS** (§6) + perguntas (`apply.answers`) + consentimento (§7) | Ganho incremental, um ATS por vez, cada um com a sua fixture de teste. |
| **4** | Contadores, "enviei" no pop-up, colunas do CSV e status novos | Fecha o ciclo do relatório; só faz sentido depois que o preenchimento existe. |

> Observação de sequência: as **fases 2 e 3** ficam bem mais baratas se o
> `shared.js` já estiver em TypeScript (ver `migracao-typescript.md`) — o mapa de
> ATS e o plano de preenchimento são exatamente o tipo de dado que o compilador
> ajuda a manter honesto.
