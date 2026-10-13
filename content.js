/* =============================================================================
 * PegaVaga - content.js
 * Script injetado nas páginas do LinkedIn (https://www.linkedin.com/*).
 *
 * Responsabilidades:
 *   1. Observar com MutationObserver a página inteira: a lista de vagas (que o
 *      LinkedIn carrega conforme você rola) e os dialogs — formulário da
 *      Candidatura Simplificada, popups de avaliação e avisos. É esse observer
 *      que faz a extensão reagir na hora: quem está esperando é avisado da
 *      mutação em vez de perguntar "mudou?" a cada 250 ms.
 *   2. Extrair, de cada card de vaga, título, empresa, link e a descrição
 *      completa (a descrição vive no painel de detalhes à direita, então o
 *      script seleciona cada card e lê o painel).
 *   3. Persistir tudo em chrome.storage.local, com merge por ID de vaga, para
 *      que os dados não se percam ao fechar o pop-up ou a aba.
 *   4. Candidatar-se sozinho ("Candidatura Simplificada") enquanto houver cota
 *      sobrando no termo, na hora, nas últimas 24 h e no dia. Cada passo espera
 *      o sinal da própria página (a etapa ficar quieta, o botão mudar, o aviso
 *      de envio chegar) em vez de dormir um tempo fixo: internet lenta não faz
 *      o script clicar duas vezes nem dar a etapa por perdida cedo.
 *   5. Fechar, assim que entram na tela, os popups do LinkedIn (pesquisa de
 *      avaliação, "salvar vaga", "seguir empresa"): o guard de popup age no
 *      meio de qualquer espera e o fluxo continua de onde estava — inclusive
 *      depois do envio (o popup de avaliação costuma chegar atrasado), depois
 *      de a vaga passar para você e entre uma vaga e outra, quando um overlay
 *      parado na frente da lista empaca a varredura inteira. O aviso de limite
 *      do LinkedIn é a exceção: ele nunca é fechado — o guard para a varredura e
 *      impõe o descanso (ver `tripGuard`).
 *   6. Varrer termo por termo: ao atingir a cota do termo, avança para o
 *      próximo da fila; quando acaba a cota, pausa e retoma mais tarde.
 *   7. Imitar o ritmo humano (intervalos variáveis, leitura da vaga, pausas
 *      longas periódicas) e ceder a vez para o usuário: enquanto você mexe na
 *      página, a automação espera em vez de roubar o seu clique/rolagem.
 *   8. Anotar, por vaga, o motivo de não ter sido possível candidatar (site
 *      externo, campo obrigatório, formulário fora do prazo…), para o relatório.
 *   9. Parar tudo quando o LinkedIn sinaliza limite de uso/verificação, com um
 *      período de descanso — é melhor perder horas do que a conta.
 *
 * A fila de termos (chrome.storage.local) é a fonte da verdade: como cada termo
 * é uma navegação nova, a página recém-carregada relê a fila e continua sozinha.
 * ===========================================================================*/

(() => {
  'use strict';

  /* ------------------------------------------------------------------------ */
  /* Constantes compartilhadas com o pop-up (ver shared.js)                    */
  /* ------------------------------------------------------------------------ */

  const SHARED = window.PegaVagaShared || {};
  const AJUDA_CAMPOS = window.PegaVagaAjuda || {};
  const STORAGE = SHARED.STORAGE || {};

  /* Casamento de texto/opções do cartão de ajuda — mora em ajuda-campos.js (o
   * manifest o carrega antes deste arquivo). */
  const normalizar = AJUDA_CAMPOS.normalizar;
  const escolherOpcao = AJUDA_CAMPOS.escolherOpcao;

  const STORAGE_JOBS_KEY = STORAGE.jobs || 'pegavaga_jobs';
  const STORAGE_META_KEY = STORAGE.meta || 'pegavaga_meta';
  const STORAGE_RUN_KEY = STORAGE.run || 'pegavaga_run';
  const STORAGE_APPS_KEY = STORAGE.apps || 'pegavaga_apps';
  const STORAGE_SETTINGS_KEY = STORAGE.settings || 'pegavaga_settings';
  const STORAGE_GUARD_KEY = STORAGE.guard || 'pegavaga_guard';

  const MSG = SHARED.MSG || {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
  };

  const DEFAULT_APPLY = (SHARED.DEFAULT_SETTINGS && SHARED.DEFAULT_SETTINGS.apply) || {
    enabled: false,
    perTerm: 10,
    perHour: 10,
    per24h: 40,
    perDay: 0,
    scanPerTerm: 60,
    minDelayMs: 4000,
    maxDelayMs: 12000,
  };

  const parseSettings = SHARED.parseSettings || ((raw) => raw || {});

  const HISTORY_LIMIT = SHARED.HISTORY_LIMIT || 500;

  /** Variação aleatória em torno de um intervalo (ritmo humano). */
  const jitter = SHARED.jitter || ((ms) => ms);

  const APPLY_PENDING = SHARED.APPLY_PENDING || 'adiada';
  const APPLY_OUTCOMES = SHARED.APPLY_OUTCOMES || {};

  /* Modos do guard de popup (a regra pura vive no shared.js: é a mesma nos três
   * contextos). O fallback existe só para o conteúdo não quebrar sem ele. */
  const POPUP_GUARD = SHARED.POPUP_GUARD || {
    quieto: 'quieto',
    proteger: 'proteger',
    limpar: 'limpar',
  };

  const popupGuardMode = SHARED.popupGuardMode || (() => POPUP_GUARD.quieto);

  const isWithinSchedule = SHARED.isWithinSchedule || (() => true);
  const nextScheduleStart = SHARED.nextScheduleStart || (() => null);

  /* A janela do agendador governa só a fila que ele montou: a varredura iniciada
   * à mão é do usuário e roda a qualquer hora. O fallback existe só para o
   * conteúdo não quebrar sem o shared.js. */
  const filaAutomatica =
    SHARED.filaAutomatica || ((run) => Boolean(run && run.source === 'agendador'));

  const buildQuota =
    SHARED.computeQuota ||
    (() => ({ ok: true, blockedBy: null, resumeAt: null, used: {}, limits: {}, remaining: {} }));

  const CONFIG = {
    clickDelayMs: 800, // espera após selecionar um card
    descriptionPollMs: 250, // intervalo de polling do painel de detalhes
    descriptionTimeoutMs: 6000, // tempo máximo esperando a descrição carregar
    scrollDelayMs: 900, // espera após rolar a lista
    maxScrollRounds: 60, // limite de rolagens por varredura
    maxJobVisitsPerRun: 300, // limite de vagas visitadas por varredura
    persistDebounceMs: 400, // debounce do salvamento em storage
    domDebounceMs: 300, // debounce do MutationObserver
    waitListPollMs: 300, // intervalo de espera da lista de vagas aparecer
    waitListTimeoutMs: 15000, // tempo máximo esperando os cards carregarem
    applyModalPollMs: 250, // rede de segurança: rechecagem sem mutação no DOM
    applyModalTimeoutMs: 10000, // tempo máximo esperando o modal abrir
    applyStepDelayMs: 1200, // espera entre etapas do formulário
    applySettleMs: 5000, // tempo máximo esperando a etapa "parar de mudar"
    applyQuietMs: 700, // silêncio no DOM que marca "a etapa terminou de carregar"
    applyStepWaitMs: 8000, // tempo máximo esperando a próxima etapa carregar
    applySubmitWaitMs: 20000, // tempo máximo esperando a confirmação do envio
    popupPollMs: 250, // rede de segurança: rechecagem sem mutação no DOM
    popupWaitMs: 3000, // tempo máximo esperando um popup fechar
    popupGraceMs: 600, // respiro para um popup recém-pedido ao servidor chegar
    popupLateMs: 2500, // espera ativa pelo popup que só chega depois do envio
    popupMaxCount: 6, // máximo de popups fechados numa rodada
    popupBudgetMs: 20000, // tempo máximo fechando os popups de uma vaga
    interruptDebounceMs: 150, // agrupa as mutações antes de mexer num popup
    applyMaxSteps: 15, // limite de "Avançar/Enviar" por vaga
    applyMaxAttempts: 2, // tentativas por vaga antes de desistir
    applyFlowTimeoutMs: 120000, // tempo máximo dentro do formulário de uma vaga
    applyKindWaitMs: 3000, // tempo máximo esperando o botão revelar o tipo (ícone/rótulo)
    applyKindPollMs: 200, // intervalo de releitura do botão de candidatura
    resumeTimerCapMs: 1800000, // teto do timer local de retomada (30 min)

    /* (TEMPORÁRIO) Pedido de ajuda quando o formulário trava num campo que a
     * extensão não sabe responder ou o envio demora a confirmar. Sai quando os
     * campos personalizados forem tratados de verdade. */
    ajudaEsperaMs: 300000, // quanto esperamos a sua resposta no aviso (5 min)
    ajudaPollMs: 500, // rede de segurança da espera (a resposta chega por mensagem)
    ajudaManualMs: 600000, // quanto esperamos você preencher à mão (10 min)

    /* Ritmo humano / furtividade */
    humanRatio: 0.3, // variação padrão aplicada aos intervalos
    applyPreClickMs: 700, // respiração antes de abrir o formulário
    longReadChance: 0.12, // chance de "reler" a vaga inteira antes de se candidatar
    longReadMs: 12000,
    userIdleMs: 4000, // tempo sem interação sua para considerar a página livre
    userWaitMaxMs: 300000, // teto da espera pela sua ociosidade (5 min)
    userBusyPauseMs: 180000, // descanso da varredura quando você está usando a página
    breakPollMs: 500, // intervalo de checagem durante pausas longas
    guardCooldownMs: 3600000, // descanso após sinal de limite do LinkedIn (1 h)
    guardTextLimit: 20000, // quanto do texto da página lemos procurando avisos
  };

  /* ------------------------------------------------------------------------ */
  /* Seletores do LinkedIn (com fallbacks, pois o DOM muda com frequência)     */
  /* ------------------------------------------------------------------------ */

  const SEL = {
    // Container que guarda a lista de vagas.
    list: [
      '.jobs-search-results-list',
      'ul.scaffold-layout__list-container',
      '.scaffold-layout__list > div > ul',
      '.scaffold-layout__list',
    ],
    // Um card individual de vaga.
    card: [
      'li.scaffold-layout__list-item',
      'li.jobs-search-results__list-item',
      'li[data-occludable-job-id]',
      'div.job-card-container',
    ],
    // Âncora com o link da vaga dentro do card.
    cardLink: [
      'a.job-card-container__link',
      'a.job-card-list__title',
      'a.job-card-list__title--link',
      'a[href*="/jobs/view/"]',
    ],
    // Título da vaga dentro do card.
    cardTitle: [
      '.job-card-list__title',
      '.job-card-container__link strong',
      '.job-card-container__link span[aria-hidden="true"]',
      'strong',
    ],
    // Empresa dentro do card.
    cardCompany: [
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.job-card-container__company-name',
    ],
    // Card atualmente selecionado (aberto no painel de detalhes).
    selectedCard: [
      'li.scaffold-layout__list-item.selected',
      'li[data-occludable-job-id].selected',
      'div.job-card-container--clickable.selected',
      'div.job-card-container.selected',
    ],
    // Painel de detalhes à direita.
    detailsRoot: [
      '#job-details',
      '.jobs-search__job-details--container',
      '.scaffold-layout__detail',
      '.jobs-details',
    ],
    detailsTitle: [
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.t-24',
    ],
    detailsCompany: [
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
    ],
    // Avisos da vaga (ex.: "Candidatura simplificada" aparece aqui).
    jobInsight: [
      '.job-details-jobs-unified-top-card__job-insight',
      '.jobs-unified-top-card__job-insight',
      '.jobs-unified-top-card__job-insight-view-model-secondary',
    ],
    detailsDescription: [
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      '#job-details article',
      '#job-details',
    ],
  };

  /* Seletores da Candidatura Simplificada (Easy Apply). Tudo com fallback,
   * porque o LinkedIn troca classes com frequência. */
  const APPLY_SEL = {
    button: [
      // O id é o mais estável de todos (o LinkedIn o usa para o teste de UI):
      // quando ele existe, é ESTE o botão da vaga aberta.
      'button#jobs-apply-button-id',
      'button[data-live-test-job-apply-button]',
      '.jobs-apply-button',
      'button.jobs-apply-button',
      '.jobs-details__main-content button.jobs-apply-button',
      '.jobs-unified-top-card__content--two-pane button.jobs-apply-button',
    ],
    // Qualquer dialog da página: é assim que achamos o formulário E os popups
    // que não são ele (pesquisa de avaliação, "salvar vaga", "seguir empresa"…).
    dialog: [
      '.jobs-easy-apply-modal',
      'div[data-test-modal-container] div[role="dialog"]',
      '.artdeco-modal[role="dialog"]',
      'div[role="dialog"][aria-labelledby]',
      'div[role="dialog"]',
    ],
    footer: ['footer', '.jobs-easy-apply-modal__footer', '.artdeco-modal__actionbar'],
    discard: [
      'button[data-control-name="discard_application_confirm_btn"]',
      'button[aria-label="Descartar"]',
      'button[aria-label="Discard"]',
    ],
    dismiss: [
      'button[aria-label="Fechar"]',
      'button[aria-label="Dismiss"]',
      '.artdeco-modal__dismiss',
      'button[aria-label="Concluir"]',
      'button[aria-label="Concluir candidatura"]',
      'button[aria-label="Done"]',
    ],
    /* (TEMPORÁRIO) Sinais de que o LinkedIn **recusou** um campo do formulário
     * (campo personalizado, formato fora do esperado, obrigatório em branco). Só
     * o pedido de ajuda usa isto — sai junto com ele. */
    invalid: [
      '[aria-invalid="true"]',
      '.artdeco-inline-feedback--error',
      '.artdeco-text-input--error',
      '.fb-dash-form-element--error',
      '[data-test-form-element-error]',
      '[data-test-form-element-error-message]',
      '.artdeco-inline-feedback__message--error',
      /* Campo marcado pelo próprio navegador (`required` em branco ou formato
       * fora do esperado): é o mesmo sinal que o LinkedIn usa para recusar o que
       * respondemos. Sem ele, um campo inválido passava batido e a vaga era
       * descartada em silêncio, sem o aviso na área de trabalho. */
      'input:invalid',
      'select:invalid',
      'textarea:invalid',
    ],
    // Mensagem de erro escrita na própria tela (é o que explica o "invalid").
    invalidText: [
      '.artdeco-inline-feedback__message',
      '.artdeco-inline-feedback__message--error',
      '[role="alert"]',
    ],
  };

  /* ------------------------------------------------------------------------ */
  /* Estado local                                                              */
  /* ------------------------------------------------------------------------ */

  const state = {
    jobs: {}, // { [jobId]: { id, title, company, link, description, ... } }
    scanning: false,
    abort: false,
    lastRun: null,
    observer: null,
    persistTimer: null,
    lastSyncedId: null,
    run: null, // fila de termos em andamento (vinda do pop-up/agendador)
    settings: null, // configuração carregada do storage
    apps: [], // timestamps (ms) das candidaturas enviadas
    resumeTimer: null, // retomada agendada após estourar uma cota
    lastUserActivity: 0, // última interação do usuário (clique, mouse, teclado)
    watchingUser: false, // listeners de atividade já instalados?
    userBusy: false, // o usuário mexeu na página durante a varredura
    sinceBreak: 0, // candidaturas desde a última pausa longa
    breakUntil: null, // fim da pausa longa em andamento (para a interface)
    guard: null, // bloqueio temporário detectado (proteção da conta)
    guardStopped: false, // a varredura parou por causa do bloqueio?
    keepDialog: null, // o formulário aberto: o único dialog que não pode ser fechado
    /* Pós-envio: a candidatura acabou de sair (ou a vaga ficou com você) e a tela
     * ainda não foi limpa para a próxima — aí todo dialog que aparecer é popup,
     * inclusive o que o LinkedIn manda atrasado. Fica de pé até o `closeStaleForm`
     * limpar a tela (o `applyToJob` também zera ao começar a próxima vaga). */
    posEnvio: false,
    /* O clique em "Candidatura Simplificada" acabou de sair e o formulário ainda
     * pode estar carregando: nesse intervalo o guard fica quieto, porque o dialog
     * que está entrando na tela pode ser a nossa própria candidatura (ver
     * `popupGuardMode`). Vive só durante o `runApplyFlow`. */
    abrirFormulario: false,
    interruptBusy: false, // já estamos fechando um popup que entrou na tela
    interruptTimer: null, // checagem de popup agendada pelas mutações
    /* (TEMPORÁRIO) Pedido de ajuda em andamento: { id, acao, avisoId }. Enquanto
     * existe, a automação está parada esperando a sua decisão. Sai junto com o
     * pedido de ajuda. */
    ajuda: null,
  };

  /* ------------------------------------------------------------------------ */
  /* Utilitários de DOM                                                        */
  /* ------------------------------------------------------------------------ */

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * O primeiro elemento que casa com QUALQUER um dos seletores (na ordem dada).
   *
   * Como o `queryAllUnique`, aceita um ARRAY de seletores — e também uma STRING,
   * tratada como UM seletor: iterar uma string devolveria os CARACTERES, e o
   * `querySelector` iria procurar `<i>`, `<n>`, `<p>`… (o resultado errado, calado).
   */
  function queryFirst(selectors, root = document) {
    const lista = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of lista) {
      try {
        const el = root.querySelector(selector);
        if (el) return el;
      } catch (error) {
        /* seletor inválido: tenta o próximo */
      }
    }

    return null;
  }

  /**
   * Todos os elementos que casam com QUALQUER um dos seletores, sem repetir.
   *
   * Aceita um ARRAY de seletores — e também uma STRING, tratada como UM seletor.
   *
   * A tolerância não é preguiça: passar string onde se espera array é uma
   * armadilha silenciosa. `for (const s of 'input, select')` itera os CARACTERES
   * ('i', 'n', 'p'…) e, no `','`, o `querySelectorAll` estoura
   * (`SyntaxError: ',' is not a valid selector`) — e como a busca do campo inteira
   * mora num `try`, o efeito era NENHUM campo ser preenchido, com o erro só no
   * console. Foi esse o "o select não preenche" e, depois, "nada é escrito".
   */
  function queryAllUnique(selectors, root = document) {
    const lista = Array.isArray(selectors) ? selectors : [selectors];
    const found = new Set();

    for (const selector of lista) {
      try {
        root.querySelectorAll(selector).forEach((el) => found.add(el));
      } catch (error) {
        /* seletor inválido: os outros ainda valem (a varredura não pode morrer) */
      }
    }

    return Array.from(found);
  }

  /**
   * Como `queryAllUnique`, mas **entra nos Shadow DOMs ABERTOS**.
   *
   * O LinkedIn monta parte do formulário em web components: o controle vive
   * dentro de um `shadowRoot` e, de fora, `querySelectorAll` não o vê — o campo
   * simplesmente "não existe" para a varredura. Era mais um jeito de o dropdown
   * ficar de fora do pedido.
   */
  function queryAllProfundo(selector, root = document) {
    const achados = [];

    const varrer = (no) => {
      let diretos = [];
      try {
        diretos = Array.from(no.querySelectorAll(selector));
      } catch (erro) {
        diretos = [];
      }
      for (const el of diretos) achados.push(el);

      let todos = [];
      try {
        todos = Array.from(no.querySelectorAll('*'));
      } catch (erro) {
        todos = [];
      }
      for (const el of todos) {
        if (el.shadowRoot) varrer(el.shadowRoot);
      }
    };

    varrer(root);
    return achados;
  }

  function clean(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Sinal do DOM: quem espera é avisado, não fica perguntando de 250 em 250ms  */
  /* ------------------------------------------------------------------------ */

  // A fila de espera (e a espera por evento) vive no shared.js: o observer
  // acorda todo mundo (`wake`) e cada espera sai no instante da mutação.
  const domSignal = SHARED.createSignal();

  /**
   * Avisa todo mundo que está esperando que a página mexeu. É chamado pelo
   * MutationObserver: a partir daqui a espera é por evento, não por tempo — o
   * `check` roda no mesmo instante em que o LinkedIn mexe na tela (abre o
   * modal, troca a etapa, tira o popup), sem depender da velocidade da internet.
   */
  function wakeWaiters() {
    domSignal.wake();
  }

  /**
   * Espera a página mexer (ou o tempo acabar) para reavaliar `check`, e devolve
   * o que ele devolver — ou `null` se o prazo acabou.
   *
   * O `pollMs` é só uma rede de segurança para o que não gera mutação (digitar
   * num campo, por exemplo): o caminho normal é o aviso do observer.
   */
  function waitUntil(check, timeoutMs, pollMs) {
    const step = pollMs == null ? CONFIG.applyModalPollMs : pollMs;

    return SHARED.waitUntil(domSignal, check, timeoutMs, step);
  }

  /**
   * Espera a página ficar quieta: nenhuma mutação dentro de `ms`. É o que diz
   * "a etapa terminou de carregar" — melhor que duas leituras iguais, porque
   * olha o que a página está fazendo, e não quanto tempo a internet levou.
   * Devolve `true` se houve silêncio.
   */
  function waitForQuiet(ms) {
    return SHARED.waitForQuiet(domSignal, ms);
  }

  function stripEmpty(patch) {
    const out = {};
    Object.keys(patch || {}).forEach((key) => {
      const value = patch[key];
      if (value !== undefined && value !== null && value !== '') out[key] = value;
    });
    return out;
  }

  /** Normaliza texto para comparar títulos (ignora acentos e caixa). */
  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titlesMatch(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  /* ------------------------------------------------------------------------ */
  /* Extração dos cards de vaga                                                */
  /* ------------------------------------------------------------------------ */

  function getCards() {
    const listRoot = queryFirst(SEL.list);
    const root = listRoot || document;

    let cards = queryAllUnique(SEL.card, root);

    // Fallback: se nenhum seletor de card casar, deduz o card pelo link da vaga.
    if (!cards.length) {
      const anchors = Array.from(root.querySelectorAll('a[href*="/jobs/view/"]'));
      cards = anchors
        .map((anchor) => anchor.closest('li') || anchor.parentElement)
        .filter(Boolean);
    }

    // Remove cards aninhados (ex.: o <li> e a <div.job-card-container> da
    // mesma vaga), mantendo sempre o elemento mais externo.
    return cards.filter(
      (card) => !cards.some((other) => other !== card && other.contains(card))
    );
  }

  function getJobId(card) {
    const direct =
      card.getAttribute('data-occludable-job-id') ||
      card.getAttribute('data-job-id') ||
      (card.querySelector('[data-job-id]') &&
        card.querySelector('[data-job-id]').getAttribute('data-job-id'));

    if (direct) return String(direct);

    const link = queryFirst(SEL.cardLink, card);
    const href = (link && link.getAttribute('href')) || '';
    const match = href.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : '';
  }

  function readCardMeta(card) {
    const id = getJobId(card);
    const linkEl = queryFirst(SEL.cardLink, card);
    const titleEl = queryFirst(SEL.cardTitle, card);
    const companyEl = queryFirst(SEL.cardCompany, card);

    let link = (linkEl && linkEl.href) || '';
    if (link) {
      try {
        const url = new URL(link);
        link = url.origin + url.pathname;
      } catch (error) {
        /* mantém o link original */
      }
    }

    return {
      id,
      title: clean(titleEl && titleEl.textContent) || clean(linkEl && linkEl.textContent),
      company: clean(companyEl && companyEl.textContent),
      link: link || (id ? 'https://www.linkedin.com/jobs/view/' + id + '/' : ''),
    };
  }


  /* ------------------------------------------------------------------------ */
  /* Painel de detalhes (descrição completa)                                   */
  /* ------------------------------------------------------------------------ */

  function readDetails() {
    const root = queryFirst(SEL.detailsRoot) || document;
    const titleEl = queryFirst(SEL.detailsTitle, root);
    const companyEl = queryFirst(SEL.detailsCompany, root);
    const descEl = queryFirst(SEL.detailsDescription, root);

    return {
      title: clean(titleEl && titleEl.textContent),
      company: clean(companyEl && companyEl.textContent),
      description: descEl ? clean(descEl.innerText || descEl.textContent) : '',
    };
  }

  /** Seleciona (clica) um card para abrir a vaga no painel de detalhes. */
  function selectCard(card) {
    const target =
      card.querySelector('.job-card-container') ||
      card.querySelector('a[href*="/jobs/view/"]') ||
      card;

    // Clique humanizado: o card do LinkedIn só abre com uma "passada de mouse".
    humanClick(target);
  }

  /** Clica no card e espera a descrição correspondente aparecer no painel. */
  async function captureForCard(card, id) {
    const meta = readCardMeta(card);
    selectCard(card);

    const deadline = Date.now() + CONFIG.descriptionTimeoutMs;

    while (Date.now() < deadline) {
      await humanPause(CONFIG.descriptionPollMs, 0.4);

      const details = readDetails();
      const looksRight =
        !meta.title || !details.title || titlesMatch(details.title, meta.title);

      if (details.description && looksRight) {
        upsertJob(id, {
          title: meta.title || details.title,
          company: meta.company || details.company,
          link: meta.link,
          description: details.description,
        });
        return true;
      }
    }

    // Timeout: guarda pelo menos os metadados do card.
    upsertJob(id, meta);
    return false;
  }

  /** Sincroniza a vaga que o usuário abriu manualmente (fora da varredura). */
  function syncSelectedJob() {
    const card = queryFirst(SEL.selectedCard);
    if (!card) return;

    const id = getJobId(card);
    if (!id || id === state.lastSyncedId) return;

    const details = readDetails();
    if (!details.description) return;

    const meta = readCardMeta(card);
    if (meta.title && details.title && !titlesMatch(details.title, meta.title)) return;

    state.lastSyncedId = id;
    upsertJob(id, {
      title: meta.title || details.title,
      company: meta.company || details.company,
      link: meta.link,
      description: details.description,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Persistência em chrome.storage.local                                      */
  /* ------------------------------------------------------------------------ */

  function upsertJob(id, patch) {
    if (!id) return;

    const previous = state.jobs[id] || {};
    const merged = Object.assign({}, previous, stripEmpty(patch));

    // Nunca sobrescreve uma descrição já capturada com um valor vazio.
    if (!patch.description && previous.description) {
      merged.description = previous.description;
    }

    merged.id = id;
    merged.capturedAt = merged.capturedAt || new Date().toISOString();
    merged.updatedAt = new Date().toISOString();

    // Registra por qual termo de busca a vaga apareceu (útil na planilha).
    if (!merged.term && state.run && state.run.term) merged.term = state.run.term;

    state.jobs[id] = merged;
    schedulePersist();
    broadcastProgress();
  }

  function schedulePersist() {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(persist, CONFIG.persistDebounceMs);
  }

  function persist() {
    const meta = {
      lastRun: state.lastRun,
      count: Object.keys(state.jobs).length,
      pageUrl: location.href,
    };

    return chrome.storage.local
      .set({ [STORAGE_JOBS_KEY]: state.jobs, [STORAGE_META_KEY]: meta })
      .catch(() => {});
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
      state.jobs = data[STORAGE_JOBS_KEY] || {};
      const meta = data[STORAGE_META_KEY] || {};
      state.lastRun = meta.lastRun || null;
    } catch (error) {
      state.jobs = {};
    }
  }

  function broadcastProgress() {
    const run = state.run;

    const payload = {
      type: MSG.PROGRESS,
      count: Object.keys(state.jobs).length,
      scanning: state.scanning,
      lastRun: state.lastRun,
      run: run
        ? {
            running: run.running === true,
            paused: run.paused === true,
            resumeAt: run.resumeAt || null,
            pauseReason: run.pauseReason || null,
            problem: run.problem || null,
            index: run.index || 0,
            total: Array.isArray(run.urls) ? run.urls.length : 1,
            term: run.term || '',
            appliedInTerm: run.appliedInTerm || 0,
            visitedInTerm: run.visitedInTerm || 0,
            appliedTotal: run.appliedTotal || 0,
          }
        : null,
      breakUntil: state.breakUntil || null,
      guard: state.guard
        ? { blockedUntil: state.guard.blockedUntil, reason: state.guard.reason || '' }
        : null,
    };

    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch (error) {
      /* pop-up fechado: sem receptor, apenas ignoramos */
    }
  }


  /* ------------------------------------------------------------------------ */
  /* Rolagem da lista                                                          */
  /* ------------------------------------------------------------------------ */

  function findScrollContainer() {
    const candidates = [];
    const listRoot = queryFirst(SEL.list);
    if (listRoot) candidates.push(listRoot);

    const cards = getCards();
    if (cards.length) candidates.push(cards[0].parentElement);

    for (const start of candidates) {
      let el = start;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  /** Rola a lista um "passo" e informa se houve progresso. */
  async function scrollList() {
    const before = getCards().length;

    // Rolagem de 60% a 95% da tela: nunca o mesmo passo, nunca "pulo" seco.
    const ratio = 0.6 + Math.random() * 0.35;
    const container = findScrollContainer();

    if (!container) {
      window.scrollBy(0, Math.round(window.innerHeight * ratio));
      await humanPause(CONFIG.scrollDelayMs);
      return getCards().length > before;
    }

    const previousTop = container.scrollTop;
    const step = Math.max(120, Math.round(container.clientHeight * ratio));

    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + step);

    await humanPause(CONFIG.scrollDelayMs);

    const grew = getCards().length > before;
    const moved = container.scrollTop > previousTop;
    return grew || moved;
  }

  /* ------------------------------------------------------------------------ */
  /* Cota e histórico de candidaturas                                          */
  /* ------------------------------------------------------------------------ */

  /** Configuração atual do storage (com padrões aplicados). */
  async function getSettings() {
    try {
      // O perfil concedido pelo servidor vale aqui também: a página acorda do
      // zero e normaliza as settings de novo, então reaplicamos o cache (local,
      // sem rede) antes de ler.
      if (typeof SHARED.aplicarPerfilSalvo === 'function') await SHARED.aplicarPerfilSalvo();

      const data = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
      return parseSettings(data[STORAGE_SETTINGS_KEY]);
    } catch (error) {
      return parseSettings(null);
    }
  }

  /** Timestamps (ms) das candidaturas enviadas — base das cotas móveis. */
  async function loadApps() {
    try {
      const data = await chrome.storage.local.get(STORAGE_APPS_KEY);
      const list = data[STORAGE_APPS_KEY];
      state.apps = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
    } catch (error) {
      state.apps = [];
    }

    return state.apps;
  }

  function persistApps() {
    const list = state.apps.slice(-HISTORY_LIMIT);
    state.apps = list;
    return chrome.storage.local.set({ [STORAGE_APPS_KEY]: list }).catch(() => {});
  }

  /** Quanto ainda cabe agora (hora / 24 h / dia / termo). */
  function quotaNow() {
    const settings = state.settings || parseSettings(null);
    const appliedInTerm = state.run ? state.run.appliedInTerm || 0 : 0;
    return buildQuota(settings, state.apps, Date.now(), appliedInTerm);
  }

  function randomDelay(min, max) {
    const lo = Math.max(0, Number(min) || 0);
    const hi = Math.max(lo, Number(max) || lo);
    return Math.round(lo + Math.random() * (hi - lo));
  }

  /* ------------------------------------------------------------------------ */
  /* Furtividade: ritmo humano, vez para o usuário e proteção da conta         */
  /* ------------------------------------------------------------------------ */

  /**
   * Avisos que o LinkedIn mostra quando desconfia de automação ou de excesso de
   * candidaturas. As redações vivem no shared.js (`looksRateLimited`), que é onde
   * a regra pura cabe e onde dá para conferi-las nos testes — aqui fica só um
   * fallback mínimo, para o content script não ficar sem proteção nenhuma se o
   * shared.js não carregar.
   */
  const looksRateLimited =
    SHARED.looksRateLimited ||
    ((texto) =>
      /checkpoint|limite de uso|too many requests|atividade suspeita|application limit/.test(
        normalize(texto)
      ));

  /** Marca que o usuário acabou de interagir com a página. */
  function noteUserActivity() {
    state.lastUserActivity = Date.now();
  }

  /** Escuta mouse/teclado/rolagem para ceder a vez a quem está usando a página. */
  function watchUserActivity() {
    if (state.watchingUser) return;
    if (typeof document.addEventListener !== 'function') return;

    state.watchingUser = true;

    for (const type of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
      try {
        document.addEventListener(type, noteUserActivity, { passive: true, capture: true });
      } catch (error) {
        /* navegador sem captura passiva: seguimos sem este listener */
      }
    }
  }

  /** A página está livre (o usuário não mexe nela há alguns segundos)? */
  function userIsIdle(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;
    if (cfg.respectUserActivity !== true) return true;
    if (!state.lastUserActivity) return true;

    return Date.now() - state.lastUserActivity >= CONFIG.userIdleMs;
  }

  /**
   * Espera o usuário parar de mexer na página. Nunca roubamos o clique nem a
   * rolagem de quem está usando o LinkedIn naquele momento; se a pessoa não
   * parar, devolvemos false e a varredura descansa um pouco (ver `userBusy`).
   */
  async function waitForUserIdle(settings) {
    if (userIsIdle(settings)) return true;

    const deadline = Date.now() + CONFIG.userWaitMaxMs;

    while (!state.abort && Date.now() < deadline && !userIsIdle(settings)) {
      await wait(CONFIG.breakPollMs);
    }

    return userIsIdle(settings);
  }

  /** Pausa curta com variação humana (nada de intervalos sempre iguais). */
  function humanPause(baseMs, ratio) {
    return wait(jitter(baseMs, ratio == null ? CONFIG.humanRatio : ratio));
  }

  /** Canto aleatório do elemento, para o clique não cair sempre no pixel exato. */
  function elementPoint(el) {
    let box = null;

    try {
      box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    } catch (error) {
      box = null;
    }

    if (!box || !box.width || !box.height) return null;

    return {
      x: box.left + box.width * (0.3 + Math.random() * 0.4),
      y: box.top + box.height * (0.35 + Math.random() * 0.3),
    };
  }

  /** Dispara um evento de mouse "de verdade" (quando o navegador permite). */
  function dispatchMouse(target, type, point) {
    if (!target || typeof target.dispatchEvent !== 'function') return false;

    try {
      let event = null;

      if (typeof MouseEvent === 'function') {
        event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: typeof window !== 'undefined' ? window : undefined,
          clientX: point ? Math.round(point.x) : 0,
          clientY: point ? Math.round(point.y) : 0,
        });
      } else if (typeof Event === 'function') {
        event = new Event(type, { bubbles: true, cancelable: true });
      }

      if (!event) return false;

      target.dispatchEvent(event);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Passa o mouse pelo elemento: é isso que revela botões escondidos no hover. */
  function hoverElement(el) {
    if (!el) return null;

    const point = elementPoint(el);

    dispatchMouse(el, 'mouseover', point);
    dispatchMouse(el, 'mouseenter', point);
    dispatchMouse(el, 'mousemove', point);

    if (point && typeof document.elementFromPoint === 'function') {
      const under = document.elementFromPoint(point.x, point.y);

      // O LinkedIn às vezes cobre o card com uma camada transparente.
      if (under && under !== el) dispatchMouse(under, 'mousemove', point);
    }

    return point;
  }

  /**
   * Clique humanizado: rola até o alvo, passa o mouse por cima e só então clica.
   * A página reage como se uma pessoa estivesse usando o site — e a lista de
   * vagas não denuncia a automação por cliques "secos".
   */
  function humanClick(el) {
    if (!el) return false;

    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (error) {
      /* elemento sem scrollIntoView: segue o jogo */
    }

    const point = hoverElement(el);

    dispatchMouse(el, 'pointerdown', point);
    dispatchMouse(el, 'mousedown', point);
    dispatchMouse(el, 'pointerup', point);
    dispatchMouse(el, 'mouseup', point);
    dispatchMouse(el, 'click', point);

    try {
      el.click();
    } catch (error) {
      return false;
    }

    return true;
  }

  /** Texto visível da página (usado só para farejar avisos do LinkedIn). */
  function pageText() {
    const body = document.body;
    if (!body) return '';
    return String(body.innerText || body.textContent || '').slice(0, CONFIG.guardTextLimit);
  }

  /** O LinkedIn está pedindo verificação / avisando de limite de uso? */
  function detectRateLimit() {
    try {
      if (/\/(checkpoint|authwall|uas)\b/i.test(location.pathname)) {
        return 'Redirecionado para verificação';
      }

      if (looksRateLimited(pageText())) return 'Aviso de limite de uso na página do LinkedIn';

      // O aviso de limite também vem como popup (é o dialog que a extensão não
      // fecha de propósito): sem olhar para ele, a varredura ficava presa com o
      // aviso na frente da lista — o texto da página pode não alcançá-lo (ele é
      // longo e o aviso entra no fim) e o guard não o fecharia de qualquer forma.
      if (restrictionNotice()) return 'Aviso de limite de uso no popup do LinkedIn';
    } catch (error) {
      return null;
    }

    return null;
  }

  /** Fim do período de descanso imposto pela proteção da conta (ou null). */
  function guardUntil() {
    if (!state.guard) return null;
    return state.guard.blockedUntil > Date.now() ? state.guard.blockedUntil : null;
  }

  /** Reativa a proteção gravada em uma execução anterior. */
  async function loadGuard() {
    try {
      const data = await chrome.storage.local.get(STORAGE_GUARD_KEY);
      const guard = data[STORAGE_GUARD_KEY] || null;
      state.guard = guard && guard.blockedUntil > Date.now() ? guard : null;
    } catch (error) {
      state.guard = null;
    }

    return state.guard;
  }

  /**
   * O LinkedIn (ou a nossa checagem) indicou abuso: paramos tudo por um tempo.
   * O estado vai para o storage, para o agendador respeitar o mesmo descanso, e
   * a fila fica pausada (não é apagada): ao fim do descanso ela volta sozinha.
   */
  async function tripGuard(reason) {
    state.abort = true;
    state.guardStopped = true;
    state.guard = {
      blockedUntil: Date.now() + CONFIG.guardCooldownMs,
      reason: reason || 'Limite de uso detectado',
      at: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [STORAGE_GUARD_KEY]: state.guard }).catch(() => {});
    broadcastProgress();
  }

  /** Pausa longa periódica: ninguém se candidata a dezenas de vagas sem parar. */
  async function longBreak(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;

    if (cfg.breaksEnabled !== true) return;
    if (!cfg.breakEvery || state.sinceBreak < cfg.breakEvery) return;

    const duration = jitter(cfg.breakMs, 0.4);
    const deadline = Date.now() + duration;

    setSinceBreak(0);
    state.breakUntil = deadline;
    broadcastProgress(); // a interface mostra "descansando até…"

    while (!state.abort && Date.now() < deadline) {
      await wait(Math.min(CONFIG.breakPollMs, Math.max(0, deadline - Date.now())));
    }

    state.breakUntil = null;
    broadcastProgress();
  }

  /** Finge que leu a vaga antes de se candidatar (e às vezes relê tudo). */
  async function readingPause(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;

    await humanPause(randomDelay(cfg.readMinMs, cfg.readMaxMs), 0.25);

    if (Math.random() < CONFIG.longReadChance) {
      await humanPause(CONFIG.longReadMs, 0.5);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática (Candidatura Simplificada)                         */
  /* ------------------------------------------------------------------------ */

  function isVisible(el) {
    if (!el || el.disabled) return false;
    return Boolean(el.getClientRects && el.getClientRects().length);
  }

  /**
   * Visível, OU um controle de formulário que EXISTE.
   *
   * O LinkedIn esconde o controle nativo atrás de um UI custom (o `<select>`
   * `fb-dash-form-element__select-dropdown` fica sem caixa): ele existe, tem as
   * opções e recebe a resposta — só não tem `getClientRects`. Exigir visibilidade
   * era o que o descartava, e era por isso que a pergunta de lista chegava ao
   * cartão como campo de TEXTO e sem opção nenhuma.
   */
  function visivelOuControle(el) {
    if (!el) return false;
    if (isVisible(el)) return true;
    if (el.disabled) return false;

    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'select' || tag === 'input' || tag === 'textarea';
  }

  /**
   * O botão de candidatura da vaga que está aberta AGORA.
   *
   * Não basta o primeiro da página: o LinkedIn deixa no DOM o botão de vagas que
   * já saíram da tela (o painel de detalhes é remontado a cada vaga), e um deles
   * — invisível — era o "primeiro" na ordem do documento. O clique caía nele, o
   * formulário não abria e a varredura lia aquilo como "vaga sem candidatura":
   * era o "não está clicando em candidatura", com o botão na tela.
   *
   * Então: entre os VISÍVEIS e habilitados, prefere o que pertence à vaga aberta
   * (`data-job-id` = id do card selecionado); sem essa pista, o primeiro visível.
   */
  function findApplyButton() {
    const botoes = queryAllUnique(APPLY_SEL.button).filter(isVisible);
    if (!botoes.length) return null;

    const card = queryFirst(SEL.selectedCard);
    const idAberto = card ? getJobId(card) : '';

    if (idAberto) {
      const bate = botoes.find((botao) => {
        const id = botao.getAttribute && botao.getAttribute('data-job-id');
        return id && String(id) === String(idAberto);
      });
      if (bate) return bate;
    }

    return botoes[0];
  }

  /**
   * Rótulo do botão de candidatura (aria-label + texto visível).
   */
  function applyButtonLabel(button) {
    if (!button) return '';
    return clean((button.getAttribute('aria-label') || '') + ' ' + (button.textContent || ''));
  }

  /**
   * Link escondido no botão de candidatura. No LinkedIn o botão das vagas de
   * fora é (ou contém) um `<a>` apontando para o site da empresa — às vezes
   * embrulhado no redirecionador `/redir/redirect?url=...`.
   */
  function applyButtonHref(button) {
    if (!button) return '';

    const own = button.getAttribute && button.getAttribute('href');
    if (own) return own;

    const links =
      typeof button.querySelectorAll === 'function' ? Array.from(button.querySelectorAll('a[href]')) : [];

    for (const link of links) {
      const href = (link.getAttribute && link.getAttribute('href')) || '';
      if (href) return href;
    }

    return '';
  }

  /**
   * Sinais que a página dá sobre o botão de candidatura, prontos para o
   * `SHARED.classifyApply` decidir.
   */
  function applySignals(button) {
    const icon = (type) =>
      Boolean(
        button &&
          typeof button.querySelector === 'function' &&
          button.querySelector('[data-test-icon*="' + type + '"], li-icon[type*="' + type + '"]')
      );

    const insight = queryFirst(SEL.jobInsight);

    return {
      label: applyButtonLabel(button),
      href: applyButtonHref(button),
      externalIcon: icon('link-external'),
      easyIcon: icon('linkedin-bug'),
      insight: insight ? clean(insight.textContent) : '',
    };
  }

  /**
   * O botão é de "Candidatura Simplificada" (formulário aqui dentro) ou manda
   * para um site de fora? Devolve `SHARED.APPLY_KINDS`.
   */
  function applyKind(button) {
    return SHARED.classifyApply(applySignals(button));
  }

  /**
   * Lê o tipo de candidatura dando um tempo para o LinkedIn terminar de
   * renderizar: o botão às vezes aparece antes do ícone/rótulo que o denuncia.
   * Sem sinal nenhum, devolve `desconhecida`.
   */
  async function resolveApplyKind(button) {
    if (applyKind(button) !== SHARED.APPLY_KINDS.unknown) return applyKind(button);

    // Espera o botão mudar (o ícone/rótulo que revela o tipo chega do servidor):
    // o observer avisa no instante da mutação, com o prazo como teto.
    const kind = await waitUntil(
      () => {
        if (!document.contains(button)) return 'sumiu';
        const current = applyKind(button);
        return current !== SHARED.APPLY_KINDS.unknown ? current : null;
      },
      CONFIG.applyKindWaitMs,
      CONFIG.applyKindPollMs
    );

    if (!kind || kind === 'sumiu') return SHARED.APPLY_KINDS.unknown;

    return kind;
  }

  /**
   * Detalhe legível do porquê a vaga não é candidatável aqui — vai para o
   * relatório junto do motivo (`applyReason`).
   */
  function applyDetail(button, kind) {
    const label = applyButtonLabel(button);
    const host = SHARED.hostOf(applyButtonHref(button));

    if (label && host) return 'Botão "' + label + '", que aponta para ' + host + '.';
    if (label) return 'Botão "' + label + '".';
    if (host) return 'O botão aponta para ' + host + '.';

    return kind === SHARED.APPLY_KINDS.external
      ? 'O botão leva para fora do LinkedIn.'
      : 'O botão não é de Candidatura Simplificada.';
  }

  /** Todos os dialogs visíveis, sem os que estão aninhados em outro dialog. */
  function dialogs() {
    const found = queryAllUnique(APPLY_SEL.dialog).filter(isVisible);
    return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
  }

  /** Sinais que dizem o que um dialog é (ver SHARED.classifyDialog). */
  function dialogSignals(dialog) {
    const footer = queryFirst(APPLY_SEL.footer, dialog) || dialog;
    const buttons = Array.from(footer.querySelectorAll('button')).filter(isVisible);

    // "Avançar/Enviar candidatura" é o que denuncia o formulário. Botões que só
    // fecham (Concluir/Fechar/Cancelar) valem zero aqui: o modal de sucesso tem
    // "Concluir" e não é o formulário.
    const hasApplyAction = buttons.some(
      (button) =>
        classifyAction(button) !== null &&
        !SHARED.matchDismissLabel(applyButtonLabel(button))
    );

    return {
      text: clean(dialog.innerText || dialog.textContent).slice(0, 4000),
      hasForm: Boolean(dialog.querySelector('form, fieldset, input, select, textarea')),
      hasApplyAction,
      hasClose: Boolean(queryFirst(APPLY_SEL.dismiss, dialog)),
    };
  }

  /** O que este dialog é, na classificação compartilhada (form/pesquisa/aviso). */
  function dialogKind(dialog) {
    if (!dialog) return SHARED.DIALOG_KINDS.unknown;

    return SHARED.classifyDialog(dialogSignals(dialog));
  }

  /**
   * Este dialog é o formulário da Candidatura Simplificada? O LinkedIn usa o
   * mesmo `role="dialog"` para o formulário e para os popups de pesquisa que
   * aparecem depois do envio — sem essa distinção, a automação confunde os dois.
   */
  function isApplyForm(dialog) {
    return dialogKind(dialog) === SHARED.DIALOG_KINDS.form;
  }

  /**
   * O formulário da candidatura aberto agora. Popups de avaliação/pesquisa e
   * avisos ("salvar vaga", "seguir empresa") são ignorados: eles não são o
   * formulário e precisam ser fechados, não preenchidos.
   */
  function findModal() {
    for (const dialog of dialogs()) {
      if (isApplyForm(dialog)) return dialog;
    }
    return null;
  }

  /**
   * Dialog que fala do limite de uso do LinkedIn. A extensão **não** o fecha: fechá-lo
   * esconderia justamente o recado que a proteção da conta precisa ler — quem decide
   * parar (e por quanto tempo) é o `tripGuard`.
   */
  function isRestrictionNotice(dialog) {
    if (!dialog) return false;

    try {
      return looksRateLimited(dialog.innerText || dialog.textContent || '');
    } catch (error) {
      return false;
    }
  }

  /**
   * Aviso de limite aberto agora, como popup (o formulário fica de fora: o recado
   * de limite não entra nele — o que aparece ali dentro é erro de campo, que quem
   * decide é o fluxo da candidatura). É o que faz a varredura parar sozinha em vez
   * de ficar presa com o aviso na frente da lista.
   */
  function restrictionNotice() {
    for (const dialog of dialogs()) {
      if (isApplyForm(dialog)) continue;
      if (isRestrictionNotice(dialog)) return dialog;
    }
    return null;
  }

  /** Popup aberto que NÃO é o formulário (ex.: "avalie a candidatura"). */
  function findPopup(except) {
    for (const dialog of dialogs()) {
      if (except && dialog.contains(except)) continue;
      if (isApplyForm(dialog)) continue;
      if (isRestrictionNotice(dialog)) continue;

      // Dialog com campos que ainda não deu para classificar: NÃO fechamos. Pode
      // ser a nossa própria candidatura carregando (o LinkedIn monta o formulário
      // em pedaços, e entre as etapas o rodapé some por um instante). Fechá-lo
      // descartaria a candidatura — e era assim que a vaga se perdia antes de o
      // cartão de ajuda aparecer.
      if (dialogKind(dialog) === SHARED.DIALOG_KINDS.unknown && dialogTemCampos(dialog)) {
        continue;
      }

      return dialog;
    }
    return null;
  }

  /** O dialog tem controle de formulário visível? (formulário carregando, ex.) */
  function dialogTemCampos(dialog) {
    try {
      return Array.from(
        dialog.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]')
      ).some(isVisible);
    } catch (error) {
      return false;
    }
  }

  /**
   * Popup que a página **já disse** que é popup (pesquisa de avaliação ou aviso).
   * Diferente do `findPopup`, ignora o que ainda não deu para classificar: sem o
   * formulário na tela, um dialog sem cara pode ser a etapa seguinte carregando —
   * e fechá-lo descartaria uma candidatura de verdade.
   */
  function findKnownPopup() {
    for (const dialog of dialogs()) {
      if (isApplyForm(dialog)) continue;
      if (isRestrictionNotice(dialog)) continue;
      if (dialogKind(dialog) !== SHARED.DIALOG_KINDS.unknown) return dialog;
    }
    return null;
  }

  async function waitForModal(timeoutMs) {
    return waitUntil(() => findModal(), Number(timeoutMs) || CONFIG.applyModalTimeoutMs);
  }

  /* ---- Popups que não são o formulário (fechar sem medo) ------------------ */

  /**
   * Qual dialog o guard precisa proteger AGORA.
   *
   * O LinkedIn troca o nó do dialog no meio da candidatura — e ao enviar —, então
   * o ponteiro que guardamos não pode ser a única referência: se ele já saiu da
   * tela, quem vale é o formulário que está nela neste instante. Sem isso o guard
   * ficava cego justamente depois do envio, e o popup que o LinkedIn manda
   * atrasado (a pesquisa de avaliação) ficava na frente da lista sem ninguém para
   * fechá-lo — a varredura não continuava.
   *
   * Devolve `null` quando não há formulário a proteger: o que fazer aí é decisão do
   * `popupGuardMode` (sem formulário na tela, o guard só mexe no que a página já
   * classificou como popup — e só quando a página está livre).
   */
  function keepDialogNow() {
    if (state.keepDialog === null) return null;
    if (document.contains(state.keepDialog)) return state.keepDialog;

    return findModal();
  }

  /** O que o guard deve fazer agora (ver SHARED.popupGuardMode) e o que proteger. */
  function guardState() {
    const protegido = keepDialogNow();

    return {
      protegido: protegido,
      modo: popupGuardMode({
        varrendo: state.scanning === true,
        abrindoFormulario: state.abrirFormulario === true,
        formularioIdentificado: state.keepDialog !== null,
        formularioNaTela: Boolean(protegido),
        posEnvio: state.posEnvio === true,
        usuarioOcioso: userIsIdle(state.settings),
      }),
    };
  }

  /**
   * Um popup entrou na tela? Fecha. É chamado pelo MutationObserver enquanto o
   * script trabalha: o fluxo em andamento nem precisa saber — o overlay sai da
   * frente e o trabalho continua de onde estava, sem esperar checagem por tempo.
   *
   * O aviso de limite do LinkedIn é a exceção: ele **não** é fechado (é o recado
   * que a proteção precisa ler) — o guard chama o `tripGuard` e a varredura para
   * sozinha, em vez de ficar presa com o aviso na frente da lista, sem parar nem
   * seguir.
   */
  async function handleInterrupt() {
    if (state.interruptBusy) return false;
    if (state.scanning !== true) return false;

    // Aviso de limite na tela: não fechamos (é o recado que a proteção precisa
    // ler) e não seguimos como se nada tivesse acontecido. Parar é decisão do
    // `tripGuard` — e é ele que impõe o descanso e pausa a fila. Sem isso a
    // varredura ficava presa com o aviso na frente da lista, e era justo onde ela
    // não podia continuar: o guard não fecha o aviso e o fluxo não tem o que
    // clicar. (`guardStopped` evita reescrever o descanso a cada mutação do aviso.)
    const aviso = restrictionNotice();

    if (aviso && state.guardStopped !== true) {
      await tripGuard('Aviso de limite de uso no popup do LinkedIn');
      return false;
    }

    const guard = guardState();
    if (guard.modo === POPUP_GUARD.quieto) return false;

    // Com o formulário na tela, qualquer outro dialog é popup. Sem ele (o
    // LinkedIn trocou o nó, ou a candidatura acabou de sair), só mexemos no que a
    // página já disse que é popup: o resto pode ser a etapa seguinte carregando.
    const popup = guard.modo === POPUP_GUARD.proteger ? findPopup(guard.protegido) : findKnownPopup();

    if (!popup) return false;

    state.interruptBusy = true;

    try {
      return await closePopup(popup);
    } catch (error) {
      return false;
    } finally {
      state.interruptBusy = false;
    }
  }

  /** As mutações vêm em rajada: agrupa antes de mexer na página. */
  function scheduleInterrupt() {
    if (state.interruptTimer) return;

    // Fora da varredura a página é sua e não há nada a fazer. O resto da decisão
    // é do `handleInterrupt`, que resolve o formulário que está na tela agora.
    if (state.scanning !== true) return;

    state.interruptTimer = setTimeout(() => {
      state.interruptTimer = null;
      handleInterrupt().catch(() => {});
    }, CONFIG.interruptDebounceMs);
  }

  function clearInterruptTimer() {
    if (!state.interruptTimer) return;

    clearTimeout(state.interruptTimer);
    state.interruptTimer = null;
  }

  /**
   * Botão que fecha/recusa um popup (Fechar, Agora não, Entendi…). Nunca devolve
   * botões de descarte — clicar neles apagaria uma candidatura de verdade.
   */
  function popupCloseButton(dialog) {
    if (!dialog) return null;

    const buttons = Array.from(
      dialog.querySelectorAll('button, [role="button"], a[role="button"]')
    ).filter(isVisible);

    const byLabel = buttons.filter((button) =>
      SHARED.matchDismissLabel(applyButtonLabel(button))
    );

    if (byLabel.length) return byLabel[0];

    // O "X" do canto (aria-label Fechar/Dismiss/Close/Concluir).
    return queryFirst(APPLY_SEL.dismiss, dialog);
  }

  /** Fecha um popup (e confirma que ele saiu da frente da página). */
  async function closePopup(dialog) {
    if (!dialog || !document.contains(dialog)) return true;

    const gone = () => !document.contains(dialog) || !isVisible(dialog);
    const button = popupCloseButton(dialog);

    if (button) {
      humanClick(button);
    } else {
      // Sem botão conhecido: um Esc costuma fechar os modais do LinkedIn.
      try {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
        );
      } catch (error) {
        /* sem KeyboardEvent: seguimos tentando pelo botão de fechar */
      }
    }

    // O observer avisa no instante em que o LinkedIn tira o dialog da tela.
    if (await waitUntil(gone, CONFIG.popupWaitMs)) return true;

    // Teimou? Um Esc extra costuma resolver os avisos do LinkedIn.
    try {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
      );
    } catch (error) {
      /* ignoramos */
    }

    return Boolean(await waitUntil(gone, CONFIG.popupWaitMs, CONFIG.popupPollMs));
  }

  /**
   * Fecha todos os popups que não são o formulário (pesquisa de avaliação,
   * "salvar vaga", "seguir empresa"…). É isso que destrava a varredura quando o
   * LinkedIn joga um desses na tela depois de uma candidatura. Devolve quantos
   * foram fechados.
   *
   * Se não tem nada aberto, espera só um respiro curto por um popup que acabou
   * de ser pedido ao servidor — e sai: quem pega o atrasado é o guard, que está
   * de olho nas mutações da página.
   */
  async function clearPopups(keep, budgetMs) {
    const deadline = Date.now() + (Number(budgetMs) || CONFIG.popupBudgetMs);
    let closed = 0;

    while (closed < CONFIG.popupMaxCount && Date.now() < deadline) {
      const waiting = Math.min(CONFIG.popupGraceMs, Math.max(0, deadline - Date.now()));
      const popup =
        findPopup(keep) || (await waitUntil(() => findPopup(keep), waiting, CONFIG.popupPollMs));

      if (!popup) break;
      if (!(await closePopup(popup))) break; // não insiste num popup teimoso

      closed += 1;
    }

    return closed;
  }

  /** "Enviar candidatura" x "Avançar/Revisar"? Desempata pelo texto do botão. */
  function classifyAction(button) {
    const label = normalize(
      (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '')
    );

    if (
      /enviar candidatura|submit application|enviar candidatura com o linkedin|submeter candidatura/.test(
        label
      )
    ) {
      return 'submit';
    }

    // "Concluir/Done" é a tela final do formulário (candidatura enviada).
    if (/^(concluir|concluir candidatura|finalizar|done)\b/.test(label)) return 'submit';

    if (/avançar|avancar|proxima|próxima|revisar|review|continuar|next/.test(label)) return 'next';

    return null;
  }

  /** Botão principal habilitado no rodapé do modal. */
  function getModalAction(modal) {
    const scope = queryFirst(APPLY_SEL.footer, modal) || modal;
    const buttons = Array.from(scope.querySelectorAll('button')).filter(isVisible);
    if (!buttons.length) return null;

    for (const button of buttons) {
      if (classifyAction(button) === 'submit') return { kind: 'submit', button };
    }

    for (const button of buttons) {
      if (classifyAction(button) === 'next') return { kind: 'next', button };
    }

    // Último recurso: o botão "primário" — mas nunca um botão de fechar/recusar,
    // que abortaria a candidatura no meio.
    const primary = buttons.find(
      (button) =>
        /artdeco-button--primary|artdeco-button--2|artdeco-button--3/.test(button.className) &&
        !SHARED.matchDismissLabel(applyButtonLabel(button))
    );

    return primary ? { kind: 'next', button: primary } : null;
  }

  /** O modal já está na tela de "candidatura enviada"? */
  function looksSubmitted(modal) {
    // O texto já passou por normalize(): sem acentos e em minúsculas.
    const text = normalize(modal.textContent || '');
    return /candidatura.{0,40}enviad|enviad.{0,20}candidatura|application.{0,20}sent|voce se candidatou/.test(
      text
    );
  }

  /* ---- Espera ativa: a página terminou de carregar a etapa? --------------- */

  /**
   * Assinatura do que está na tela (texto + botões visíveis). Muda quando o
   * LinkedIn troca de etapa ou abre um popup — é o nosso "a página reagiu?".
   */
  function scopeSignature(scope) {
    if (!scope) return '';

    const text = normalize(scope.innerText || scope.textContent).slice(0, 1200);
    const buttons = Array.from(scope.querySelectorAll('button'))
      .filter(isVisible)
      .map((button) =>
        normalize((button.textContent || '') + ' ' + (button.getAttribute('aria-label') || ''))
      )
      .join('|');

    return text + '::' + buttons;
  }

  /**
   * "Assinatura da etapa" do formulário: o que a etapa pede (título, campos e
   * botões) — de propósito **sem** as mensagens de erro, que o LinkedIn
   * reescreve a cada clique.
   *
   * É com ela que sabemos se o "Avançar" realmente avançou. Comparar o texto
   * inteiro da tela engana: quando o LinkedIn recusa um campo ele re-renderiza a
   * mesma etapa com a mensagem de erro (e às vezes com um "carregando"), a
   * assinatura muda sozinha e a contagem de tentativas nunca subiria — a vaga
   * acabava descartada em silêncio, sem o aviso pedir ajuda.
   */
  function stepSignature(modal) {
    if (!modal) return '';

    let titulo = '';
    let campos = '';
    let botoes = '';

    try {
      const cabecalho = modal.querySelector('h1, h2, h3, legend');
      titulo = cabecalho ? normalize(cabecalho.textContent || '') : '';
    } catch (error) {
      titulo = '';
    }

    try {
      // Só atributos estáveis — e NUNCA o `aria-label`: quando o LinkedIn mostra o
      // erro de validação ele reescreve o `aria-label` do campo, e a assinatura
      // mudava sozinha. Com isso a contagem de tentativas zerava a cada clique e
      // o pedido de ajuda nunca disparava: a vaga era descartada em silêncio.
      // `name`/`id`/`type` (e o texto do `legend`) não mudam com o erro.
      campos = Array.from(
        modal.querySelectorAll('input, select, textarea, [role="combobox"], fieldset legend')
      )
        .map((campo) => {
          const tag = String(campo.tagName || '').toLowerCase();
          if (tag === 'legend') return normalize(campo.textContent || ''); // título do passo
          return normalize(
            campo.getAttribute('name') || campo.getAttribute('id') || campo.getAttribute('type') || ''
          );
        })
        .join('|');
    } catch (error) {
      campos = '';
    }

    try {
      const rodape = queryFirst(APPLY_SEL.footer, modal) || modal;
      botoes = Array.from(rodape.querySelectorAll('button'))
        .filter(isVisible)
        .map((botao) => normalize(botao.textContent || botao.getAttribute('aria-label') || ''))
        .join('|');
    } catch (error) {
      botoes = '';
    }

    return (titulo + '::' + campos + '::' + botoes).slice(0, 600);
  }

  /**
   * Espera a etapa parar de carregar. O caminho normal é o silêncio no DOM: o
   * LinkedIn para de mexer quando terminou de montar a tela, então esperamos
   * esse silêncio (não o tempo da internet). Se a página ficar nervosa e nunca
   * silenciar, a assinatura do conteúdo entra como rede de segurança.
   */
  async function waitForSettle(scope, timeoutMs) {
    const deadline = Date.now() + (Number(timeoutMs) || CONFIG.applySettleMs);
    let previous = scopeSignature(scope);
    let stable = 0;

    while (Date.now() < deadline) {
      const quiet = await waitForQuiet(Math.min(CONFIG.applyQuietMs, deadline - Date.now()));

      if (quiet) return true; // a tela parou: está pronta para ser lida

      const current = scopeSignature(scope);

      if (current && current === previous) {
        stable += 1;
      } else {
        stable = 0;
        previous = current;
      }
    }

    return stable >= 1;
  }

  /** Espera a etapa mudar (o clique pegou?). Evita clicar duas vezes no mesmo botão. */
  async function waitForStepChange(scope, before, timeoutMs) {
    const changed = await waitUntil(
      () => {
        if (!scope || !document.contains(scope)) return 'saiu';
        return scopeSignature(scope) !== before ? 'mudou' : null;
      },
      Number(timeoutMs) || CONFIG.applyStepWaitMs
    );

    return Boolean(changed);
  }

  /** Espera a tela de "candidatura enviada" (a internet lenta atrasa esse aviso). */
  async function waitForSubmit(modal, timeoutMs) {
    const sent = await waitUntil(
      () => {
        if (!modal || !document.contains(modal)) return 'fechou';
        if (looksSubmitted(modal)) return 'enviada';
        if (!isApplyForm(modal)) return 'virou_popup'; // virou outro dialog: envio confirmado
        return null;
      },
      Number(timeoutMs) || CONFIG.applySubmitWaitMs
    );

    return Boolean(sent);
  }

  /**
   * Espera o aviso de envio chegar (o modal fechar ou dizer "candidatura
   * enviada"). Diferente do `waitForSubmit`, aqui só a confirmação de verdade
   * conta: é o que usamos quando ainda **não** clicamos em "Enviar candidatura"
   * e o dialog mudou de cara sozinho.
   */
  async function waitForConfirmation(modal, timeoutMs) {
    const confirmed = await waitUntil(
      () => {
        if (!modal || !document.contains(modal)) return 'fechou';
        return looksSubmitted(modal) ? 'enviada' : null;
      },
      Number(timeoutMs) || CONFIG.applySubmitWaitMs
    );

    return Boolean(confirmed);
  }

  /* Linhas que NÃO são a pergunta do campo: "Obrigatório", o texto do placeholder
   * ("Selecionar opção") e a instrução/erro ("Insira uma resposta válida",
   * "Insira um número decimal com mais de 0.0"). Antes o rótulo do campo saía
   * daqui — o cartão mostrava "Selecionar opção" em vez da pergunta. */
  const RUIDO_EXATO_RE =
    /^(obrigat[óo]rio|required|opcional|optional|selecione|selecionar|escolha|escolher|select|choose|selecionar op[çc][ãa]o|select an option|choose an option|escolha uma op[çc][ãa]o)$/i;
  const RUIDO_INSTRUCAO_RE = /^(insira|informe|digite|preencha|enter|type|provide|apenas n[úu]meros?)\b/i;

  /**
   * A PRIMEIRA linha do texto que parece a pergunta. O bloco do Easy Apply junta
   * pergunta + "Obrigatório" + placeholder + erro no mesmo `textContent`: aqui a
   * gente corta o ruído e devolve só a pergunta (é o rótulo que o cartão mostra).
   */
  function perguntaDoTexto(texto) {
    const linhas = String(texto || '')
      .split(/\n+/)
      .map((linha) => clean(linha))
      .filter(Boolean);

    for (const linha of linhas) {
      if (linha.length > 300) continue; // parágrafo de ajuda, não pergunta
      if (RUIDO_EXATO_RE.test(linha) || RUIDO_INSTRUCAO_RE.test(linha)) continue;
      return linha;
    }
    return linhas.length ? linhas[0] : '';
  }

  /**
   * Rótulo visível de um campo do formulário — a PERGUNTA, na ordem em que o
   * LinkedIn a entrega: `aria-labelledby` (o mais fiel), `aria-label`, `<label>`,
   * o rótulo do bloco do Easy Apply e, só no fim, o container e o placeholder.
   */
  function fieldLabel(field) {
    if (!field) return '';

    const limite = (texto) => perguntaDoTexto(texto).slice(0, 300);
    const get = (nome) => {
      try {
        return (field.getAttribute && field.getAttribute(nome)) || '';
      } catch (error) {
        return '';
      }
    };

    try {
      /* 0) RÁDIO: o `<label>` e o `aria-label` do input são a OPÇÃO ("YES"/"NO"),
       * não a pergunta — e era por isso que as perguntas de escolha chegavam ao
       * cartão com o rótulo "YES". A pergunta vem do GRUPO. */
      const ehRadio =
        String(field.type || '').toLowerCase() === 'radio' ||
        String((field.getAttribute && field.getAttribute('role')) || '').toLowerCase() === 'radio';

      if (ehRadio && opcoesDoGrupo(field).length >= 2) {
        const doGrupo = rotuloDaPerguntaDoGrupo(field);
        if (doGrupo) return doGrupo;
      }

      // 1) `aria-labelledby` aponta para o elemento com a pergunta.
      const ids = String(get('aria-labelledby')).split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const alvo = (field.ownerDocument || document).getElementById(id);
        if (alvo) {
          const texto = limite(alvo.textContent);
          if (texto) return texto;
        }
      }

      // 2) `aria-label` — desde que não seja o ruído do próprio campo.
      const aria = clean(get('aria-label'));
      if (aria && !RUIDO_EXATO_RE.test(aria) && !RUIDO_INSTRUCAO_RE.test(aria)) {
        return aria.slice(0, 300);
      }

      // 3) `<label for=…>`.
      if (field.labels && field.labels.length) {
        const texto = limite(field.labels[0].textContent);
        if (texto) return texto;
      }

      /* 4) O bloco da PERGUNTA — e só ele.
       *
       * Nunca o `<fieldset>` da ETAPA: a etapa "Perguntas adicionais" é um bloco
       * com várias perguntas, e usá-lo como rótulo dava a MESMA pergunta (a
       * primeira) para todos os campos. Com o dedupe por rótulo, isso deixava um
       * único campo no cartão — era o "ele só trouxe o campo de texto livre". */
      const bloco =
        field.closest && field.closest('.fb-dash-form-element, .jobs-easy-apply-form-element');

      if (bloco) {
        const dentro = bloco.querySelector(
          '.fb-dash-form-element__label, .artdeco-text-input--label, legend, label'
        );
        if (dentro) {
          const texto = limite(dentro.textContent);
          if (texto) return texto;
        }

        // O bloco inteiro vale só quando ele tem UM controle (é o bloco de UMA
        // pergunta). A primeira linha sem ruído é a pergunta.
        const controles = bloco.querySelectorAll(
          'input:not([type="hidden"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"], [aria-expanded]'
        );
        if (controles.length <= 1) {
          const texto = limite(bloco.textContent);
          if (texto) return texto;
        }
      }

      // 4c) Grupo de rádio/checkbox: a pergunta é o `<legend>` do fieldset.
      const grupo = field.closest && field.closest('fieldset');
      const legenda = grupo && grupo.querySelector('legend');
      if (legenda) {
        const texto = limite(legenda.textContent);
        if (texto) return texto;
      }

      // 5) O container do PRÓPRIO controle (nunca um `fieldset`/`div` genérico).
      const container =
        field.closest &&
        field.closest('.artdeco-text-input--container, .artdeco-text-input--label, label');
      if (container) {
        const texto = limite(container.textContent);
        if (texto) return texto;
      }

      // 6) Último recurso: o placeholder (é dica, não pergunta — mas melhor que nada).
      const ph = clean(get('placeholder'));
      if (ph && !RUIDO_EXATO_RE.test(ph) && !RUIDO_INSTRUCAO_RE.test(ph)) return ph.slice(0, 300);
    } catch (error) {
      /* campo quebrado: sem rótulo */
    }

    return '';
  }

  /**
   * Rótulos dos campos/perguntas que ficaram pendentes no formulário. É isso que
   * o relatório mostra quando uma candidatura para em campo obrigatório.
   */
  function describeBlocker(modal) {
    const labels = [];
    const seen = new Set();

    let fields = [];

    try {
      fields = Array.from(
        modal.querySelectorAll('input, select, textarea, fieldset legend, [role="combobox"]')
      );
    } catch (error) {
      return labels;
    }

    for (const field of fields) {
      const tag = String(field.tagName || '').toLowerCase();

      if (tag === 'legend') {
        const text = clean(field.textContent).slice(0, 60);
        if (text && !seen.has(text)) {
          seen.add(text);
          labels.push(text);
        }
        continue;
      }

      const type = String(field.type || '').toLowerCase();
      if (type === 'hidden' || type === 'checkbox' || type === 'radio') continue;
      if (field.value && String(field.value).trim()) continue;

      const label = fieldLabel(field);
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }

      if (labels.length >= 3) break;
    }

    return labels;
  }

  /* ---- (TEMPORÁRIO) Pedido de ajuda ao usuário ---------------------------- */
  //
  // Algumas vagas param num campo personalizado que não sabemos responder — ou
  // demoram para confirmar o envio. Nesses casos avisamos na área de trabalho e
  // perguntamos o que fazer (ver `shared.js` e `background.js`). Tudo desta seção
  // sai quando os campos personalizados forem tratados de verdade.

  /**
   * Campos que o LinkedIn marcou como inválidos dentro do formulário: é o sinal
   * de que ele recusou o que respondemos (campo personalizado, formato fora do
   * esperado, obrigatório em branco). Devolve os rótulos legíveis (até 3).
   */
  function invalidFields(modal) {
    if (!modal) return [];

    const labels = [];
    const seen = new Set();
    const guarda = (texto) => {
      const limpo = clean(texto).slice(0, 60);
      if (limpo && !seen.has(limpo) && labels.length < 3) {
        seen.add(limpo);
        labels.push(limpo);
      }
    };

    try {
      for (const campo of queryAllUnique(APPLY_SEL.invalid, modal)) {
        // Campo escondido (etapa que não está na tela) não trava nada: só o que
        // o usuário vê conta como motivo.
        if (!isVisible(campo)) continue;
        guarda(fieldLabel(campo) || campo.textContent);
      }

      for (const aviso of queryAllUnique(APPLY_SEL.invalidText, modal)) {
        if (!isVisible(aviso)) continue;
        const texto = clean(aviso.textContent);
        if (texto && texto.length <= 80) guarda(texto);
      }
    } catch (error) {
      return labels;
    }

    return labels;
  }

  /** Dados da vaga que o aviso mostra (título, empresa e o que travou). */
  function ajudaContexto(id, motivo, problema, campos) {
    const job = (id && state.jobs[id]) || {};

    return {
      motivo: motivo === 'demora' ? 'demora' : 'campos',
      titulo: String(job.title || '').slice(0, 80),
      empresa: String(job.company || '').slice(0, 60),
      problema: String(problema || '').slice(0, 120),
      // Campos travados já descritos ({ rotulo, tipo, opcoes }) para a janelinha
      // desenhar o controle CERTO com as opções originais do LinkedIn (ver
      // `camposTravados`). Preserva o tipo e as opções — não vira texto puro.
      campos: Array.isArray(campos)
        ? campos
            .filter((c) => c && typeof c === 'object')
            .slice(0, 8) // a etapa pode ter várias perguntas: cabem todas no cartão
            .map((c) => ({
              // 120: a pergunta vai INTEIRA (o cartão quebra linha em vez de cortar).
              rotulo: String(c.rotulo || '').slice(0, 300),
              tipo: String(c.tipo || 'texto'),
              opcoes: Array.isArray(c.opcoes)
                ? c.opcoes.map((o) => String(o).slice(0, 80)).slice(0, 30)
                : [],
            }))
        : [],
    };
  }

  /**
   * O input controlável de um elemento marcado como inválido. Alguns sinais do
   * `APPLY_SEL.invalid` são o próprio `<input>/<select>`, outros são o container
   * do erro (`.fb-dash-form-element--error`…). Aqui normalizamos: devolve o campo
   * de verdade (ou null quando não há um).
   */
  function resolverCampo(el) {
    if (!el) return null;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return el;

    try {
      const dentro = el.querySelector(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="combobox"], [aria-haspopup="listbox"], [aria-expanded]'
      );
      return dentro || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Descreve um campo para a janelinha: `{ rotulo, tipo, opcoes }`.
   *   - `tipo`: `'texto'` | `'select'` | `'radio'` | `'checkbox'`;
   *   - `opcoes`: as opções originais (texto do `<select>`, rótulos dos rádios…).
   */
  function descreverCampo(campo, modal) {
    const rotulo = fieldLabel(campo) || '';
    const tag = String(campo.tagName || '').toLowerCase();
    const type = String(campo.type || '').toLowerCase();

    if (tag === 'select') {
      let opcoes = Array.from(campo.options || [])
        .filter((o) => String(o.value) !== '' && !o.disabled)
        .map((o) => clean(o.textContent) || String(o.value))
        .filter(Boolean)
        .filter((texto) => !PLACEHOLDER_RE.test(texto)); // tira o "Selecionar opção"

      /* Sem opções de verdade e a pergunta é de sim/não? O LinkedIn oferece
       * exatamente "Sim"/"Não" nesses dropdowns — melhor mostrá-los do que
       * deixar o campo sem escolha nenhuma no cartão. */
      if (!opcoes.length && PERGUNTA_SIM_NAO_RE.test(rotulo)) opcoes = ['Sim', 'Não'];

      return { rotulo, tipo: 'select', opcoes };
    }

    /* Combobox/dropdown custom do Easy Apply: é uma div/botão que abre uma
     * lista (`listbox`) — sem <select>, então as opções se leem da lista
     * aberta ou dos itens escondidos no DOM. Sai como 'select' para a
     * janelinha (um <select> com as opções originais, como os outros).
     *
     * `ehPerguntaDeLista` é a rede de segurança: além dos sinais de ARIA, um
     * controle cujo texto visível é o placeholder ("Selecionar opção") É uma
     * lista — qualquer que seja a marcação que o LinkedIn usou naquela versão. O
     * `<input readonly>` entra aqui também: num formulário de candidatura ele é
     * um controle de ESCOLHA (não se digita, se clica). */
    if (ehPerguntaDeLista(campo) || (tag === 'input' && campo.readOnly)) {
      // Só o TEXTO de cada opção: antes esta lista ia com os objetos
      // (`{ texto, value, el }`) e o cartão mostrava "[object Object]".
      let opcoes = opcoesDoCombo(modal, campo)
        .map((o) => clean(o.texto || ''))
        .filter(Boolean);

      if (!opcoes.length && PERGUNTA_SIM_NAO_RE.test(rotulo)) opcoes = ['Sim', 'Não'];

      return { rotulo, tipo: 'select', opcoes };
    }

    /* Rádio (nativo ou `role="radio"`): as opções são o texto de CADA bolinha do
     * GRUPO (`opcoesDoGrupo` — todas as da mesma pergunta, mesmo sem `name`, que é o
     * que fazia o cartão trazer uma opção só por bolinha). */
    if (type === 'radio' || ehRadioCustom(campo)) {
      const grupo = opcoesDoGrupo(campo);
      const opcoes = grupo.map(rotuloDaOpcao).map((t) => clean(t)).filter(Boolean);
      return { rotulo, tipo: 'radio', opcoes };
    }

    if (type === 'checkbox') {
      // Binário: marcar ou não. O rótulo costuma ser a pergunta ("Autorizo…").
      return { rotulo, tipo: 'checkbox', opcoes: ['Sim', 'Não'] };
    }

    // input/textarea de texto (texto, número, e-mail…).
    return { rotulo, tipo: 'texto', opcoes: [] };
  }

  /**
   * O elemento pertence ao formulário de candidatura?
   *
   * Nem sempre o `modal` guardado CONTÉM o campo: o LinkedIn monta o Easy Apply
   * num **portal do React**, e o conteúdo pode viver noutro nó do documento (foi
   * assim que um `<select required>` ficou fora da varredura, que só olhava para
   * dentro do `modal`). Aqui vale o que está dentro do `modal` OU dentro de
   * qualquer modal de candidatura.
   */
  function pertenceAoFormulario(el, modal) {
    if (!el) return false;
    if (modal && modal.contains && modal.contains(el)) return true;

    try {
      return Boolean(
        el.closest &&
          el.closest('.jobs-easy-apply-modal, [data-test-modal-container], .artdeco-modal')
      );
    } catch (error) {
      return false;
    }
  }

  /** O campo já tem resposta? (o que está respondido não trava a etapa) */
  function jaRespondido(el) {
    if (!el) return true;

    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.type || '').toLowerCase();

    if (tag === 'select') return !selectVazio(el);

    // Rádio custom (`role="radio"`): respondido = o grupo tem um marcado.
    if (ehRadioCustom(el)) {
      return opcoesDeRadioCustom(el, document).some(
        (f) => String(f.getAttribute('aria-checked')) === 'true'
      );
    }

    if (type === 'radio') return opcoesDoGrupo(el).some((f) => f.checked);
    if (type === 'checkbox') return el.checked;
    if (textoEhPlaceholderDeLista(el)) return false;
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      return clean(el.textContent || '') !== '';
    }

    return el.value != null && String(el.value).trim() !== '';
  }

  /**
   * Os controles que mostram o placeholder de lista ("Selecionar opção").
   *
   * Rede de segurança do reconhecimento: o LinkedIn já usou `<select>`, `<input
   * readonly role="combobox">` e `<div role="button">` para a MESMA pergunta — e
   * em algumas versões não sobra sinal de ARIA nenhum. O que não muda é o texto
   * na tela, e é ele que denuncia "aqui é uma lista sem resposta". Devolve o
   * GATILHO (não o `<span>` de dentro dele).
   */
  function controlesDePlaceholder(modal) {
    const achados = [];
    const vistos = new Set();

    try {
      for (const el of queryAllProfundo('button, [role], input[readonly], span, div', modal)) {
        if (!isVisible(el)) continue;

        const texto = clean(el.textContent || '');
        if (!texto || texto.length > 40 || !PLACEHOLDER_TEXTO_RE.test(texto)) continue;

        const controle =
          (el.closest &&
            el.closest(
              'button, [role="button"], [role="combobox"], [aria-haspopup], [aria-expanded], input[readonly]'
            )) ||
          el;

        if (vistos.has(controle)) continue;
        vistos.add(controle);
        achados.push(controle);
      }
    } catch (error) {
      /* DOM mudou no meio: vale o que deu para achar */
    }

    return achados;
  }

  /**
   * Campos travados com o que a janelinha precisa para desenhá-los: até `TETO`,
   * cada um `{ rotulo, tipo, opcoes }`. É o mesmo sinal de `invalidFields`, mas
   * guardando o elemento para podermos reaplicar a resposta no campo certo.
   */
  function camposTravados(modal) {
    if (!modal) return [];

    const vistos = [];
    const vistosEl = new Set(); // não repete o MESMO campo
    const TETO = 12; // a etapa pode ter várias perguntas: cabem todas (o cartão rola)

    /* O dedupe é por ELEMENTO, e só. Antes havia também um dedupe por rótulo — e
     * bastava dois campos caírem com o mesmo texto (ou com texto vazio, quando a
     * chave virava `tipo:`) para o segundo ser descartado: o cartão trazia UM
     * campo e os outros sumiam. As perguntas da etapa têm de chegar TODAS juntas
     * no mesmo pedido. */
    const anotar = (campo) => {
      // `visivelOuControle`: o controle nativo que o LinkedIn esconde atrás do
      // UI custom (o `<select>` sem caixa) também conta.
      if (!campo || !visivelOuControle(campo) || vistos.length >= TETO) return;
      if (vistosEl.has(campo)) return;

      /* RÁDIO/CHECKBOX de um grupo: quem representa a PERGUNTA é a primeira opção
       * do grupo. Sem isto o MESMO grupo entrava uma vez por bolinha — o
       * `aria-required="true"` está em CADA `<input type=radio>` do LinkedIn (ver o
       * HTML real em `tests/fixtures/linkedin-etapa-radios.html`), então o laço dos
       * obrigatórios anotava as quatro bolinhas e o cartão trazia a mesma pergunta
       * quatro vezes. */
      if (ehOpcaoDeEscolha(campo)) {
        const grupo = opcoesDoGrupo(campo);
        if (grupo.length > 1 && grupo[0] !== campo) return;

        const raiz = raizDoGrupo(campo);
        const jaTemGrupo = vistos.some(
          (item) => item.campo && ehOpcaoDeEscolha(item.campo) && raizDoGrupo(item.campo) === raiz
        );
        if (jaTemGrupo) return;
      }

      vistosEl.add(campo);

      vistos.push({ descricao: descreverCampo(campo, modal), campo: campo });
    };

    try {
      /* 1) O sinal forte: campos que o LinkedIn JÁ marcou como recusados
       * (`[aria-invalid]`, classes de erro, `:invalid` do próprio navegador). */
      for (const el of queryAllUnique(APPLY_SEL.invalid, modal)) {
        if (!isVisible(el)) continue; // campo escondido (outra etapa) não trava
        anotar(resolverCampo(el));
        if (vistos.length >= TETO) break;
      }

      /* 2) Complemento de alta confiança — roda SEMPRE, mesmo com campos já
       * marcados como inválidos:
       *
       *   - o controle que mostra o placeholder de lista ("Selecionar opção") é
       *     uma pergunta SEM resposta, e o LinkedIn não o marca como `:invalid`
       *     (não é um campo nativo obrigatório);
       *   - o campo nativo `required`/`aria-required` que ficou em branco.
       *
       * Era aqui que a pergunta de lista sumia: quando os textos obrigatórios
       * vinham marcados como inválidos, a varredura "do que falta" nem rodava —
       * e o select não aparecia no cartão. */
      for (const el of controlesDePlaceholder(modal)) {
        if (vistos.length >= TETO) break;
        anotar(el);
      }

      for (const el of queryAllUnique(
        [
          'input[required]',
          'select[required]',
          'textarea[required]',
          '[aria-required="true"]',
        ],
        modal
      )) {
        if (vistos.length >= TETO) break;
        if (!visivelOuControle(el) || el.disabled) continue;

        /* `jaRespondido`, e NÃO `el.value`: o placeholder do `<select>` do LinkedIn
         * vem com TEXTO **e VALOR** ("Selecionar opção" — ver o HTML real em
         * `tests/fixtures/linkedin-etapa-select.html`), e comparar só o `value` dava
         * o campo como respondido. Era isso que fazia o select sumir do cartão (e,
         * sem outra via, chegar como campo de TEXTO). */
        if (jaRespondido(el)) continue;
        anotar(el);
      }

      /* 2b) E os OBRIGATÓRIOS do DOCUMENTO, restritos ao formulário de
       * candidatura. O conteúdo do Easy Apply pode estar num portal do React,
       * fora do nó do `modal` — e era por isso que um
       * `<select required aria-required="true">` não aparecia em varredura
       * nenhuma (nem nesta, nem na dos rótulos). */
      for (const el of queryAllProfundo(
        'select[required], input[required], textarea[required], [aria-required="true"]'
      )) {
        if (vistos.length >= TETO) break;
        if (!pertenceAoFormulario(el, modal)) continue;
        if (!visivelOuControle(el) || el.disabled) continue;
        if (jaRespondido(el)) continue;
        anotar(el);
      }

      /* 2c) E os controles de ESCOLHA ÚNICA do LinkedIn, pelos nomes que ele usa
       * (`select.fb-dash-form-element__select-dropdown`,
       * `[data-test-text-entity-list-form-select]`, `id` com `multipleChoice`).
       * É o sinal mais direto do dropdown que trava a etapa — e cobre também o
       * que NÃO é marcado como obrigatório. */
      for (const el of queryAllProfundo(
        'select.fb-dash-form-element__select-dropdown, [data-test-text-entity-list-form-select], ' +
          'select[id*="multipleChoice"]'
      )) {
        if (vistos.length >= TETO) break;
        if (!pertenceAoFormulario(el, modal)) continue;
        if (!visivelOuControle(el) || el.disabled) continue;
        if (jaRespondido(el)) continue;
        anotar(el);
      }

      /* 3) A varredura COMPLETA — roda SEMPRE.
       *
       * Ela lê o formulário inteiro e anota o que ainda NÃO foi respondido: um
       * select sem escolha, um campo em branco, um rádio sem marcação. Antes ela
       * só rodava quando NENHUM campo vinha marcado como inválido — e como o
       * LinkedIn marca `:invalid` só os nativos obrigatórios, bastava uma etapa
       * com textos obrigatórios em branco para ela ser pulada e a pergunta de
       * lista ficar de fora. Agora não há mais esse portão: TODOS os campos sem
       * resposta entram no mesmo pedido. */
      {
        // Varre tudo que pode pedir resposta no formulário — campos nativos e
        // controles customizados do LinkedIn (o dropdown é um `<select>`, um
        // `<button>` ou um `<input readonly>`, e nem sempre tem sinal de ARIA).
        /* `visivelOuControle`, e não `isVisible`: o LinkedIn ESCONDE o controle
         * nativo atrás do UI estilizado (o `<input type=radio>` e o `<select>` do
         * artdeco ficam sem caixa). Exigir visibilidade era o que tirava o rádio da
         * varredura — ele só sobrava para a rede de rótulo, que o reportava sem as
         * opções (e aí o cartão virava campo de texto). */
        const campos = queryAllProfundo(
          'input, select, textarea, [contenteditable="true"], [role="radio"], ' +
            '[role="combobox"], [aria-haspopup="listbox"], [aria-expanded]',
          modal
        ).filter(visivelOuControle);

        let listboxVisto = false; // o dropdown é filho do botão: conta como um só

        for (const campo of campos) {
          if (vistos.length >= TETO) break;

          const tag = String(campo.tagName || '').toLowerCase();
          const type = String(campo.type || '').toLowerCase();
          if (
            tag === 'input' &&
            (type === 'hidden' ||
              type === 'submit' ||
              type === 'button' ||
              type === 'file' || // currículo: não é pergunta, e não dá para digitar
              type === 'image' ||
              type === 'reset')
          ) {
            continue;
          }

          /* Combobox/dropdown custom: parece fechado mas tem opções (abre com
           * "Adicionar…" ou mostra o texto atual). É o controle mais comum do
           * Easy Apply de hoje — e o que mais passa batido. `ehCombo` cobre o
           * gatilho em `<button>`, em `<div role="button">` e no `<input
           * role="combobox" readonly>` do artdeco.
           *
           * Vem ANTES do teste de `readonly`: aquele input é readonly de
           * propósito (não se digita, se escolhe) e descartá-lo aqui era o que
           * fazia a pergunta de lista sumir do cartão. */
          if (ehCombo(campo)) {
            if (campo.disabled) continue;

            // O container da lista vive logo ao lado no DOM: não conta duas vezes.
            if (campo.getAttribute('role') === 'listbox') {
              if (listboxVisto) continue;
              listboxVisto = true;
            }
            // Já tem resposta escolhida (texto que não é placeholder)? Segue.
            if (comboTemValor(campo)) continue;
            anotar(campo);
            continue;
          }

          /* Lista SEM sinal de ARIA: o que denuncia é o texto/placeholder
           * ("Selecionar opção"). Vem ANTES do teste de `readonly`, porque o
           * dropdown do artdeco costuma ser um `<input readonly>` — e o
           * `readOnly` (que só impede digitar) o descartaria aqui. */
          if (textoEhPlaceholderDeLista(campo)) {
            if (!campo.disabled) anotar(campo);
            continue;
          }

          /* `<input readonly>` num formulário de candidatura é controle de
           * ESCOLHA (o dropdown/datepicker do artdeco, que não se digita: se
           * clica). Sem `role`/`aria`, era o `readOnly` que o descartava — e era
           * ESTE o campo que sumia do pedido. */
          if (tag === 'input' && campo.readOnly) {
            const temValor = campo.value != null && String(campo.value).trim() !== '';
            if (!temValor || textoEhPlaceholderDeLista(campo)) anotar(campo);
            continue;
          }

          if (campo.disabled || campo.readOnly) continue;

          /* Rádio CUSTOM (`role="radio"`): o artdeco de hoje usa div/botões, e o
           * grupo tem de ser lido para a pergunta não ir SEM OPÇÃO (o cartão, sem
           * opções, vira campo de texto). Só o primeiro do grupo representa a
           * pergunta; um já marcado (`aria-checked`) é resposta dada. */
          if (ehRadioCustom(campo)) {
            if (String(campo.getAttribute('role') || '').toLowerCase() === 'radiogroup') {
              continue; // o container do grupo: quem representa são os filhos
            }

            const grupo = opcoesDeRadioCustom(campo, modal);
            if (grupo.length && grupo[0] !== campo) continue;
            if (grupo.some((f) => String(f.getAttribute('aria-checked')) === 'true')) continue;

            anotar(campo);
            continue;
          }

          if (type === 'radio') {
            /* Só o primeiro do grupo representa a pergunta; um já marcado é
             * resposta dada (não trava nada). O grupo sai do `opcoesDoGrupo` — pelo
             * `name` quando existe e, SEM ele, pelo ancestral que reúne 2+ opções:
             * era o `name` ausente que fazia cada bolinha virar uma pergunta com
             * uma opção só ("muito rádio com o rótulo YES"). */
            const grupo = opcoesDoGrupo(campo);
            if (grupo.length > 1 && grupo[0] !== campo) continue;
            if (grupo.some((f) => f.checked)) continue;
            anotar(campo);
            continue;
          }

          if (type === 'checkbox') {
            if (campo.checked) continue; // já marcado
            // Checkbox sem pergunta (rótulo) é quase sempre opt-in de marketing:
            // não é isso que trava a candidatura.
            if (!fieldLabel(campo)) continue;
            anotar(campo);
            continue;
          }

          if (tag === 'select') {
            // Já escolhido? Segue (ver `selectVazio`: o placeholder pode ter
            // valor não-vazio). Sem opções legíveis NÃO pulamos: o campo ainda
            // travou a etapa e precisa aparecer no cartão (com Sim/Não quando for
            // pergunta de sim/não — ver `descreverCampo`).
            if (!selectVazio(campo)) continue;
            anotar(campo);
            continue;
          }

          // Texto/número/e-mail (e o `contenteditable`, que o LinkedIn usa em
          // alguns editores). Um botão ou uma div que caiu no `[aria-expanded]`
          // da varredura não é campo — viraria "pergunta" fantasma no cartão.
          const editavel = campo.getAttribute && campo.getAttribute('contenteditable') === 'true';
          if (tag !== 'input' && tag !== 'textarea' && !editavel) continue;

          const temValor = editavel
            ? clean(campo.textContent || '') !== ''
            : campo.value != null && String(campo.value).trim() !== '';
          if (temValor) continue;
          anotar(campo);
        }
      }
    } catch (error) {
      /* DOM mudou no meio: mostra o que deu para anotar até aqui */
    }

    // A descrição é o que a janelinha desenha. O `_campo` viaja junto (fora do
    // payload: `ajudaContexto` só copia rotulo/tipo/opcoes) porque é com ele que
    // `camposTravadosCompletos` abre o dropdown e lê as opções que o LinkedIn só
    // monta na hora de abrir.
    const encontrados = vistos.map((item) =>
      Object.assign({}, item.descricao, { _campo: item.campo })
    );

    /* Rede de segurança final: as perguntas que os reconhecedores acima não
     * pegaram (ex.: o dropdown do artdeco sem ARIA) entram pelo RÓTULO, que está
     * sempre na tela. Sem isto, uma etapa podia trazer menos campos do que
     * perguntas — e era exatamente o "não trouxe o select". */
    for (const extra of camposPorPergunta(modal, vistosEl)) {
      if (encontrados.length >= TETO) break;
      encontrados.push(extra);
    }

    /* A ORDEM do cartão é a ORDEM DA PÁGINA. A descoberta não segue a ordem do
     * DOM (o campo achado pela rede de segurança entrava por último), então
     * ordenamos pelo `compareDocumentPosition`: a lista fica na mesma sequência
     * das perguntas no LinkedIn. */
    try {
      const POS_PRECEDING = 2; // y vem antes de x
      const POS_FOLLOWING = 4; // y vem depois de x
      encontrados.sort((a, b) => {
        const x = a && a._campo;
        const y = b && b._campo;
        if (!x || !y || x === y || typeof x.compareDocumentPosition !== 'function') return 0;
        const pos = x.compareDocumentPosition(y);
        if (pos & POS_FOLLOWING) return -1;
        if (pos & POS_PRECEDING) return 1;
        return 0;
      });
    } catch (erro) {
      /* ordenar é cortesia: sem isso, vale a ordem da descoberta */
    }

    /* Diagnóstico barato e útil: o que foi reconhecido nesta etapa. Quando um
     * campo não aparece no cartão, é esta linha que diz se ele nem foi achado ou
     * se foi achado com o tipo errado. */
    // String (e não objeto): é o log que se copia para o relato de um campo que
    // não entrou no cartão.
    console.log(
      '[PegaVaga] campos reconhecidos nesta etapa: ' +
        encontrados
          .map(
            (c, i) =>
              '[' +
              (i + 1) +
              '] tipo=' +
              c.tipo +
              ' opcoes=' +
              (c.opcoes || []).length +
              (c.opcoes && c.opcoes.length ? '(' + c.opcoes.slice(0, 3).join('/') + ')' : '') +
              ' tag=' +
              ((c._campo && c._campo.tagName) || '?') +
              ' "' +
              String(c.rotulo || '').slice(0, 50) +
              '"'
          )
          .join(' | ')
    );

    /* Auditoria da etapa — só diagnóstico, e numa STRING (fácil de copiar): para
     * cada bloco de pergunta, o texto e os CONTROLES de dentro (tag, type, role,
     * `aria-checked`). É esta linha que diz o que é um campo que não entrou no
     * cartão. */
    try {
      const blocos = queryAllProfundo(
        '.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset',
        modal
      );

      const descreverControle = (el) => {
        const tag = String(el.tagName || '?').toLowerCase();
        const tipo = (el.getAttribute && el.getAttribute('type')) || '';
        const role = (el.getAttribute && el.getAttribute('role')) || '';
        const marcado = (el.getAttribute && el.getAttribute('aria-checked')) || '';
        const nome = (el.getAttribute && el.getAttribute('name')) || '';
        const valor = (el.getAttribute && el.getAttribute('value')) || '';
        const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';

        return (
          tag +
          (tipo ? ':' + tipo : '') +
          (role ? '[' + role + ']' : '') +
          // `name`/`value`/`aria-label` das opções: é o que diz por que um rádio veio
          // com uma opção só (ou com o rótulo da opção no lugar da pergunta).
          (nome ? '[name=' + clean(nome).slice(0, 12) + ']' : '') +
          (valor ? '[value=' + clean(valor).slice(0, 12) + ']' : '') +
          (aria ? '[aria-label=' + clean(aria).slice(0, 20) + ']' : '') +
          (marcado ? '(checked=' + marcado + ')' : '')
        );
      };

      const linhas = blocos.slice(0, 12).map((bloco, indice) => {
        const controles = queryAllProfundo(
          'input, select, textarea, [role], button, [contenteditable]',
          bloco
        )
          .map(descreverControle)
          .slice(0, 8)
          .join(', ');

        // O que conseguimos LER de cada opção de rádio/checkbox — é o texto que o
        // cartão mostra. Sem isso não dá para saber se o problema é achar a opção
        // ou ler o rótulo dela.
        const opcoesLidas = queryAllProfundo('input[type="radio"], input[type="checkbox"], [role="radio"]', bloco)
          .map((el) => rotuloDaOpcao(el) || '(sem rotulo)')
          .slice(0, 4)
          .join(' / ');

        return (
          '[' +
          (indice + 1) +
          '] "' +
          clean(bloco.textContent).slice(0, 40) +
          '" -> ' +
          (controles || '(sem controles)') +
          (opcoesLidas ? ' | opcoes: ' + opcoesLidas : '')
        );
      });

      console.log(
        '[PegaVaga] auditoria da etapa: ' +
          blocos.length +
          ' bloco(s) | inputs=' +
          queryAllProfundo('input', modal).length +
          ' selects=' +
          queryAllProfundo('select', modal).length +
          ' radio(role)=' +
          queryAllProfundo('[role="radio"]', modal).length +
          ' radio(input)=' +
          queryAllProfundo('input[type="radio"]', modal).length +
          ' combos=' +
          queryAllProfundo('[role="combobox"], [aria-haspopup], [aria-expanded]', modal).length +
          ' shadowHosts=' +
          queryAllProfundo('*', modal).filter((el) => el.shadowRoot).length +
          '\n' +
          linhas.join('\n')
      );
    } catch (erro) {
      /* auditoria é só diagnóstico: se falhar, o pedido segue igual */
    }

    /* Os GRUPOS de ESCOLHA como o fluxo os enxerga: a PERGUNTA lida e as OPÇÕES
     * lidas de cada bolinha. É esta linha que responde "por que o rádio veio com o
     * rótulo YES" (ou com uma opção só) sem precisar adivinhar. */
    try {
      const grupos = [];
      const raizes = new Set();

      for (const opcao of queryAllProfundo(OPCOES_SEL, modal)) {
        const raiz = raizDoGrupo(opcao);
        if (!raiz || raizes.has(raiz)) continue;
        raizes.add(raiz);

        grupos.push(
          '"' +
            clean(rotuloDaPerguntaDoGrupo(opcao)).slice(0, 40) +
            '" -> ' +
            (opcoesDoGrupo(opcao)
              .map((o) => rotuloDaOpcao(o) || '(sem rotulo)')
              .slice(0, 4)
              .join(' / ') || '(sem opcoes)')
        );

        if (grupos.length >= 6) break;
      }

      if (grupos.length) {
        console.log('[PegaVaga] grupos de escolha da etapa:\n' + grupos.join('\n'));
      }
    } catch (erro) {
      /* diagnóstico: se falhar, o pedido segue igual */
    }

    return encontrados;
  }

  /**
   * Rede de segurança FINAL: percorre os RÓTULOS das perguntas da etapa e garante
   * que cada uma entrou no pedido.
   *
   * O rótulo está SEMPRE no DOM (é o texto que a pessoa lê: "Você possui
   * disponibilidade…?"). Se o controle dele não foi reconhecido por nenhuma outra
   * via — o que acontece com o dropdown do artdeco em algumas versões —, é o
   * BLOCO da pergunta que entra no cartão: a pergunta aparece, e ao aplicar a
   * resposta o `aplicarRespostaNosCampos` desce até o controle de dentro do bloco.
   * Assim NENHUMA pergunta da etapa fica de fora.
   */
  function camposPorPergunta(modal, jaVistos) {
    const saida = [];

    let rotulos = [];
    try {
      rotulos = queryAllProfundo(
        '.fb-dash-form-element__label, .artdeco-text-input--label, .jobs-easy-apply-form-element__label, fieldset legend',
        modal
      );
    } catch (error) {
      return saida;
    }

    for (const rotulo of rotulos) {
      if (!isVisible(rotulo)) continue;

      const texto = clean(rotulo.textContent).slice(0, 300);
      if (!texto) continue;

      const bloco =
        (rotulo.closest &&
          rotulo.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset')) ||
        rotulo.parentElement;
      if (!bloco) continue;

      // Este bloco já rendeu um campo? Então não duplica.
      let jaTem = false;
      for (const el of jaVistos) {
        if (el === bloco || (bloco.contains && bloco.contains(el))) {
          jaTem = true;
          break;
        }
      }
      if (jaTem) continue;
      if (saida.some((c) => c.rotulo === texto)) continue;

      /* O controle de dentro é quem recebe a resposta — e é dele que sai o TIPO e
       * as OPÇÕES. Aqui estava o furo: esta rede fixava `tipo`/`opcoes`, então o
       * `<select>` do LinkedIn chegava ao cartão com `opcoes: []` — e o cartão,
       * sem opção, cai no campo de texto (era o "veio como input text").
       *
       * Preferimos o controle que está SEM resposta (`jaRespondido`), porque um
       * bloco pode conter mais de um. */
      const controles = queryAllProfundo(
        'select, input:not([type="hidden"]), textarea, [role="radio"], [role="combobox"], ' +
          '[aria-haspopup], [aria-expanded], input[readonly]',
        bloco
      );

      const candidatos = controles.filter((el) => !jaRespondido(el));

      /* O alvo é o CONTROLE, nunca o bloco — e o sem resposta vem primeiro.
       *
       * Devolver o bloco perdia o TIPO do campo: o `<select>` de "Qual seu nível de
       * proficiência em Inglês" (que o LinkedIn já entrega com uma opção marcada e
       * por isso NÃO conta como "sem resposta") chegava ao cartão como campo de
       * TEXTO — e o que você digitasse nunca entraria no `<select>`. Era o "select
       * veio como text input". Com UM controle no bloco, é ele; com vários, o
       * primeiro sem resposta e, sem nenhum, o primeiro (melhor um controle do que
       * uma `div`). */
      const controle = candidatos[0] || controles[0] || bloco;
      const descricao = descreverCampo(controle, modal);

      saida.push({
        rotulo: descricao.rotulo || texto,
        tipo: descricao.tipo,
        opcoes: descricao.opcoes,
        _campo: controle,
      });
    }

    return saida;
  }

  /**
   * Abre o dropdown, lê as opções e fecha — o LinkedIn só monta a lista quando
   * ele abre, então sem isso uma pergunta de lista chega ao cartão sem escolha
   * nenhuma. Devolve os textos das opções (vazio se não deu para ler).
   */
  async function lerOpcoesAbrindo(modal, campo) {
    if (!campo || !document.contains(campo)) return [];

    const lerDaTela = () =>
      Array.from(document.querySelectorAll('[role="listbox"] [role="option"]'))
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);

    // Algumas versões já deixam a lista no DOM (escondida): aí não precisa abrir.
    const jaTem = lerDaTela();
    if (jaTem.length) return jaTem;

    try {
      humanClick(campo);

      const itens = await waitUntil(
        () => {
          const lista = lerDaTela();
          return lista.length ? lista : null;
        },
        CONFIG.applyStepWaitMs,
        CONFIG.popupPollMs
      );

      /* Fecha a lista aberta. NADA de Escape: no LinkedIn ele fecha o MODAL
       * inteiro (e ainda pergunta se descarta a candidatura — foi assim que a
       * segunda janelinha vinha em branco). O que fecha só a lista é um clique
       * "fora dela", e o lugar seguro é o topo do próprio modal. */
      try {
        const neutro =
          (modal && modal.querySelector('h1, h2, h3, legend, header')) || modal || null;
        if (neutro && document.contains(neutro) && neutro !== campo) humanClick(neutro);
      } catch (erro) {
        /* sem um lugar neutro: a lista se fecha no próximo clique do fluxo */
      }
      await humanPause(CONFIG.applyStepDelayMs);

      return itens || [];
    } catch (erro) {
      return [];
    }
  }

  /**
   * Como `camposTravados`, mas COMPLETA as opções dos dropdowns: para cada
   * pergunta de lista que chegou sem opção, abre o controle, lê as escolhas
   * originais e fecha. É o que faz a pergunta de "Selecionar opção" chegar ao
   * cartão com as opções do LinkedIn (antes ela vinha como um campo de texto).
   */
  async function camposTravadosCompletos(modal) {
    const campos = camposTravados(modal);

    for (const campo of campos) {
      if (!campo || campo.tipo !== 'select' || (campo.opcoes && campo.opcoes.length)) continue;

      const el = campo._campo;
      const tagEl = String((el && el.tagName) || '').toLowerCase();
      // Select nativo já leu as opções; o `<input readonly>` (dropdown) abre.
      if (!ehPerguntaDeLista(el) && !(tagEl === 'input' && el.readOnly)) continue;

      const opcoes = await lerOpcoesAbrindo(modal, el);
      if (opcoes.length) campo.opcoes = opcoes;
    }

    return campos;
  }

  /* ------------------------------------------------------------------------ */
  /* (TEMPORÁRIO) O cartão DENTRO DA ABA — o plano B da janelinha              */
  /* ------------------------------------------------------------------------ */
  //
  // A janela no desktop (ajuda.html) é o caminho normal. Este cartão é o plano B:
  // se o worker não abrir a janela (serviço indisponível, janela bloqueada pelo
  // sistema…), em vez de DESCARTAR a vaga em silêncio, o pedido aparece aqui,
  // dentro da página, com os mesmos campos (tipo e opções originais) e as mesmas
  // três saídas. Era este fallback que faltava: os comentários prometiam ("se a
  // janela não abrir, o content cai no cartão dentro da aba"), mas ele não
  // existia — sem janela, a vaga era fechada e a varredura seguia. Sai junto com
  // o pedido de ajuda.

  /** Aplica estilo inline (usado só no posicionamento do host do cartão). */
  function estilo(el, regras) {
    Object.keys(regras).forEach((chave) => {
      el.style[chave] = regras[chave];
    });
    return el;
  }

  /**
   * O CSS do cartão. Vive DENTRO do Shadow DOM de propósito: o LinkedIn não
   * alcança estas regras (nem com `!important`) e o cartão não herda o
   * `color-scheme` da página. Era assim que o texto saía branco no fundo branco
   * (modo escuro do LinkedIn) e os rótulos vinham cortados por regras da página.
   */
  const CARTAO_CSS = `
    :host { all: initial; color-scheme: light; }
    .caixa {
      display: flex; flex-direction: column; width: 100%; max-height: 80vh;
      background: #ffffff; color: #1f2933; border: 1px solid #cbd5e1;
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 10px 34px rgba(15, 23, 42, .32);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .cabeca {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; background: linear-gradient(135deg, #0a66c2 0%, #004182 100%);
    }
    .cabeca strong { font-size: 14px; font-weight: 700; color: #ffffff; }
    .fechar {
      background: transparent; border: 0; color: #ffffff; font-size: 18px;
      line-height: 1; cursor: pointer; padding: 0 2px;
    }
    /* min-height 0 é o que deixa o corpo ROLAR quando o rótulo é longo: sem
       ele o flex não encolhe abaixo do conteúdo e o cartão estoura a tela. */
    .corpo { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 12px; }
    .vaga {
      margin: 0 0 8px; font-size: 12px; color: #334155;
      background: #eaf2fb; border-radius: 8px; padding: 6px 8px;
    }
    .msg { margin: 0 0 10px; font-size: 12.5px; color: #1f2933; }
    .campo { margin: 0 0 12px; }
    .campo label {
      display: block; margin-bottom: 4px; font-size: 12px; font-weight: 700;
      color: #1f2933; white-space: normal; overflow: visible; word-break: break-word;
    }
    .campo input, .campo select {
      display: block; width: 100%; padding: 7px 9px; border: 1px solid #94a3b8;
      border-radius: 8px; font-size: 13px; font-family: inherit;
      background: #ffffff; color: #1f2933;
    }
    .campo input:focus, .campo select:focus {
      outline: 2px solid #0a66c2; outline-offset: 1px; border-color: #0a66c2;
    }
    .acoes { display: flex; gap: 8px; padding: 0 12px 12px; }
    .acoes button {
      flex: 1; padding: 9px; border: 0; border-radius: 8px; font-size: 13px;
      font-weight: 600; cursor: pointer; font-family: inherit;
    }
    .aplicar { background: #0a66c2; color: #ffffff; }
    .aplicar:hover { background: #004182; }
    .manual { background: #ffffff; color: #1f2933; border: 1px solid #94a3b8; }
    .manual:hover { background: #eaf2fb; }
    .pular { background: #ffffff; color: #b91c1c; border: 1px solid #94a3b8; }
    .pular:hover { background: #fef2f2; }
  `;

  /** Cria um elemento com classe e texto (o cartão monta por aqui). */
  function no(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  /**
   * Desenha o cartão de resposta DENTRO da aba e espera a sua decisão. Devolve
   * `{ acao, resposta }` — o mesmo contrato do `pedirAjuda`.
   */
  function cartaoNaAba(dados) {
    const info = dados || {};
    const listaCampos = Array.isArray(info.campos) ? info.campos : [];
    const soManual = info.motivo === 'demora'; // não há campo para preencher

    return new Promise((resolve) => {
      let resolvido = false;
      let timer = null;
      const controles = [];

      // O HOST é o único ponto do cartão na página: fixo no canto inferior direito,
      // acima de tudo. O conteúdo vive no Shadow DOM (ver `CARTAO_CSS`), fora do
      // alcance do CSS do LinkedIn.
      const host = estilo(document.createElement('div'), {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483647',
        display: 'block', // `:host { all: initial }` põe `inline`; aqui fica block
        width: '360px',
        maxHeight: '80vh',
        margin: '0',
        padding: '0',
      });

      const raiz =
        typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;

      const folha = document.createElement('style');
      folha.textContent = CARTAO_CSS;
      raiz.appendChild(folha);

      const caixa = no('div', 'caixa');

      const cabeca = no('div', 'cabeca');
      cabeca.appendChild(no('strong', '', 'PegaVaga precisa de você'));

      const fechar = no('button', 'fechar', '×');
      fechar.type = 'button';
      fechar.title = 'Fechar (a vaga segue o caminho de sempre)';
      cabeca.appendChild(fechar);

      caixa.appendChild(cabeca);

      const corpo = no('div', 'corpo');

      const vaga = [info.titulo, info.empresa].filter(Boolean).join(' — ');
      if (vaga) corpo.appendChild(no('p', 'vaga', vaga));

      corpo.appendChild(
        no(
          'p',
          'msg',
          soManual
            ? 'O LinkedIn não confirmou o envio no tempo esperado. Você pode assumir a vaga à mão ou pular.'
            : listaCampos.length
            ? 'Responda os campos abaixo (com as opções originais do LinkedIn) e a extensão preenche e segue sozinha.'
            : 'Não consegui ler o campo travado. Assuma a vaga à mão ou pule.'
        )
      );

      caixa.appendChild(corpo);

      // Um controle por campo, com o tipo certo: <select> com as opções que o
      // LinkedIn oferece, ou <input> para texto.
      listaCampos.forEach((campo, indice) => {
        const bloco = no('div', 'campo');
        bloco.appendChild(
          no('label', '', (campo && campo.rotulo) || 'Pergunta ' + (indice + 1))
        );

        const opcoes = campo && Array.isArray(campo.opcoes) ? campo.opcoes : [];
        let controle;

        if ((campo && campo.tipo === 'texto') || !opcoes.length) {
          controle = no('input');
          controle.type = 'text';
        } else {
          controle = no('select');
          const vazia = document.createElement('option');
          vazia.value = '';
          vazia.textContent = '— escolher —';
          controle.appendChild(vazia);
          opcoes.forEach((opcao) => {
            const item = document.createElement('option');
            item.value = String(opcao);
            item.textContent = String(opcao);
            controle.appendChild(item);
          });
        }

        bloco.appendChild(controle);
        corpo.appendChild(bloco);
        controles.push({ rotulo: String((campo && campo.rotulo) || ''), el: controle });
      });

      const bAplicar = no('button', 'aplicar', 'Aplicar e continuar');
      const bManual = no('button', 'manual', 'Vou preencher à mão');
      const bPular = no('button', 'pular', 'Pular esta vaga');
      bAplicar.type = 'button';
      bManual.type = 'button';
      bPular.type = 'button';
      if (soManual) bAplicar.style.display = 'none';

      const acoes = no('div', 'acoes');
      acoes.appendChild(bAplicar);
      acoes.appendChild(bManual);
      acoes.appendChild(bPular);

      caixa.appendChild(acoes);
      raiz.appendChild(caixa);

      const encerrar = () => {
        if (timer) clearInterval(timer);
        timer = null;
        try {
          host.remove(); // tira o cartão inteiro da página (host + Shadow DOM)
        } catch (erro) {
          /* já saiu da tela */
        }
      };

      const decidir = (acao) => {
        if (resolvido) return;
        resolvido = true;

        const resposta = {};
        if (acao === 'aplicar') {
          controles.forEach((c) => {
            const valor = String((c.el && c.el.value) || '').trim();
            if (valor && c.rotulo) resposta[c.rotulo] = valor; // rótulo é a chave da reaplicação
          });
        }

        encerrar();
        resolve({ acao: acao, resposta: acao === 'aplicar' ? resposta : null });
      };

      bAplicar.addEventListener('click', () => decidir('aplicar'));
      bManual.addEventListener('click', () => decidir('manual'));
      bPular.addEventListener('click', () => decidir('pular'));
      fechar.addEventListener('click', () => decidir(''));

      // Enter num campo de texto aplica e segue (o mesmo atalho da janelinha).
      controles.forEach((c) => {
        if (!c.el || c.el.tagName === 'SELECT') return;
        c.el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            decidir('aplicar');
          }
        });
      });

      (document.body || document.documentElement).appendChild(host);
      if (controles.length && controles[0].el) controles[0].el.focus();

      // O prazo e o "Parar Varredura" encerram a espera (como na janelinha).
      const inicio = Date.now();
      timer = setInterval(() => {
        if (state.abort || Date.now() - inicio >= CONFIG.ajudaEsperaMs) decidir('');
      }, CONFIG.ajudaPollMs);
    });
  }


  /**
   * Pede a você o que a extensão não sabe responder, abrindo o cartão de
   * resposta como JANELA NO DESKTOP (ajuda.html — sem abas nem barra de
   * endereço, no canto inferior direito). A sua decisão volta por
   * AJUDA_RESPOSTA (o worker encaminha da janelinha para esta aba).
   *
   * Se a janela NÃO abrir (worker/serviço indisponível), o pedido desce para o
   * `cartaoNaAba`: o mesmo conteúdo, dentro da página, com as mesmas saídas —
   * assim a vaga nunca é descartada em silêncio por falta de cartão.
   *
   * Devolve `{ acao, resposta }`:
   *   - `acao: 'manual'`   → você vai preencher à mão (a automação para e respeita);
   *   - `acao: 'aplicar'`  → você respondeu os campos: `resposta` traz
   *                          `{ rótulo do campo: valor }` e a extensão escreve e segue;
   *   - `acao: 'pular'`    → a vaga é descartada e a varredura segue adiante;
   *   - `acao: ''`         → ninguém respondeu a tempo (prazo/aborto) — quem
   *                          chamou decide.
   */
  async function pedirAjuda(dados) {
    // Já há um pedido aberto (janelinha na tela): não empilha outro. Quem
    // decide é você, não a fila — a vaga atual espera a sua decisão.
    if (state.ajuda) return { acao: '', resposta: null };

    /* O intervalo engolia pedidos: como cada vaga nova travava logo depois da
     * anterior, a 2ª/3ª/… voltavam `{ acao: '' }` sem abrir janelinha nenhuma
     * — e a vaga era descartada em silêncio como "travada" com motivo vazio.
     * Não há mais intervalo: o `state.ajuda` acima já impede enxurrada, cada
     * vaga é um pedido novo e quem decide é você. */

    const pedido = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      acao: '',
      resposta: null,
      avisoId: '',
      resolver: null, // resolve quando a decisão chega da janelinha (AJUDA_RESPOSTA)
    };
    state.ajuda = pedido; // marca que há um pedido aberto (não empilha outro)

    try {
      // A janela no desktop é o caminho normal (o worker cuida dela).
      let erroDeEnvio = null;
      const aviso = await chrome.runtime
        .sendMessage({
          type: MSG.AJUDA_PEDIDO,
          pedidoId: pedido.id,
          motivo: dados && dados.motivo,
          titulo: dados && dados.titulo,
          empresa: dados && dados.empresa,
          campos: dados && dados.campos, // { rotulo, tipo, opcoes } — a janelinha desenha a partir deles
        })
        .catch((erro) => {
          erroDeEnvio = erro;
          return null;
        });

      let decisao;

      if (aviso && aviso.ok) {
        pedido.avisoId = aviso.id || '';

        // A janela abriu, mas o tipo `popup` foi recusado (saiu uma janela
        // normal): registramos o motivo para poder corrigir a moldura.
        if (aviso.recusa) {
          console.warn(
            '[PegaVaga] a janelinha abriu como janela NORMAL (o tipo popup foi recusado): ' +
              aviso.recusa
          );
        }

        decisao = await esperarRespostaDaJanela(pedido);
      } else {
        // A janelinha não abriu (worker/serviço indisponível, janela bloqueada…):
        // o pedido desce para o cartão DENTRO da página. Antes, este era o ponto
        // em que a vaga era descartada em silêncio. O aviso abaixo diz POR QUE
        // (motivo do worker, ou o erro de envio — worker sem ouvinte, contexto
        // invalidado…): é o que permite corrigir a causa raiz depois.
        console.warn(
          '[PegaVaga] nao consegui abrir a janelinha no desktop; cartao exibido na pagina.',
          { motivo: (aviso && aviso.motivo) || null, aviso: aviso, erroDeEnvio: erroDeEnvio }
        );
        decisao = await cartaoNaAba(dados);
      }

      pedido.acao = (decisao && decisao.acao) || '';
      pedido.resposta = (decisao && decisao.resposta) || null;
    } finally {
      state.ajuda = null;
      // Some com a janelinha se ela ainda estiver aberta (prazo/aborto): ela não
      // pode ficar na tela pedindo algo que não existe mais.
      if (pedido.avisoId) {
        try {
          chrome.runtime.sendMessage({ type: MSG.AJUDA_FECHAR, avisoId: pedido.avisoId });
        } catch (erroNoFechamento) {
          /* sem worker: a janelinha se fecha sozinha ao responder */
        }
      }
    }

    return { acao: pedido.acao || '', resposta: pedido.resposta };
  }

  /**
   * Espera a decisão que vem da JANELINHA DO DESKTOP: o case AJUDA_RESPOSTA do
   * onMessage resolve `pedido.resolver` quando o worker encaminha a sua escolha.
   * Mesmo prazo e mesmo corte do "Parar Varredura" do cartão na aba.
   */
  function esperarRespostaDaJanela(pedido) {
    return new Promise((resolve) => {
      let resolvido = false;
      const fim = (resultado) => {
        if (resolvido) return;
        resolvido = true;
        clearInterval(checagem);
        resolve(resultado || { acao: '', resposta: null });
      };

      pedido.resolver = fim; // é o que o case AJUDA_RESPOSTA chama

      // Prazo + "Parar Varredura": o que vier primeiro encerra a espera.
      const inicio = Date.now();
      const checagem = setInterval(() => {
        if (state.abort || Date.now() - inicio >= CONFIG.ajudaEsperaMs) {
          fim({ acao: '', resposta: null });
        }
      }, CONFIG.ajudaPollMs);
    });
  }

  /**
   * Você escolheu preencher à mão: a automação não toca mais na página e espera o
   * formulário sair da tela (você enviou/fechou) ou o prazo acabar. Devolve `true`
   * quando o formulário saiu.
   */
  async function esperarPreenchimentoManual(modal) {
    const saiu = await waitUntil(
      // O "Parar Varredura" também encerra esta espera (o formulário fica com você).
      () => !document.contains(modal) || !isVisible(modal) || looksSubmitted(modal) || state.abort,
      CONFIG.ajudaManualMs,
      CONFIG.ajudaPollMs
    );

    // O modal saiu sozinho (você enviou/fechou): limpamos o que veio depois. Se a
    // espera terminou por tempo/Parar, o modal pode estar aí — e ele é seu.
    if (saiu && (!document.contains(modal) || looksSubmitted(modal))) {
      await dismissAfterApply(modal);
    }

    return Boolean(saiu);
  }

  /**
   * Escreve a resposta que você digitou na janelinha nos campos travados do
   * formulário. `resposta` é `{ rótulo do campo: texto }`. Para cada rótulo,
   * acha o campo inválido cujo rótulo bate (normalizado) e preenche. Devolve
   * quantos campos conseguiu preencher.
   */
  /**
   * Versões texto das opções de um combobox: o texto que você escolher no
   * cartão é o que `aplicarRespostaNosCampos` procura na lista.
   */
  function textoOpcoesCombo(opcoes) {
    return (opcoes || []).map((o) => String(o.texto || o.value || '')).filter(Boolean);
  }

  /* ------------------------------------------------------------------------ */
  /* Combobox do Easy Apply: ler, detectar valor e aplicar resposta            */
  /* ------------------------------------------------------------------------ */
  // O dropdown de hoje é uma div/botão (`role=combobox`, `aria-haspopup`) que
  // abre uma `listbox`: sem <select>, então cada etapa precisa de código
  // próprio — ler, saber se já respondeu e clicar na opção certa.

  /**
   * O TEXTO do controle (ou o `placeholder`, ou o valor de um input readonly) é
   * o placeholder de uma lista — "Selecionar opção"? É o sinal que NÃO depende de
   * ARIA nenhuma: o artdeco já renderizou o dropdown como `<select>`, como botão
   * e como `<input readonly placeholder="Selecionar opção">`. Sem isto, um
   * dropdown sem ARIA era lido como campo de texto (ou descartado pelo
   * `readOnly`) e sumia do pedido.
   */
  function textoEhPlaceholderDeLista(campo) {
    if (!campo) return false;

    const tag = String(campo.tagName || '').toLowerCase();
    const textos = [
      campo.textContent,
      campo.getAttribute && campo.getAttribute('placeholder'),
      tag === 'input' ? campo.value : '',
    ];

    return textos.some((t) => {
      const texto = clean(t || '');
      return Boolean(texto) && texto.length <= 40 && PLACEHOLDER_TEXTO_RE.test(texto);
    });
  }

  /** É uma pergunta de lista? (sinal de ARIA OU o placeholder no texto) */
  function ehPerguntaDeLista(campo) {
    return ehCombo(campo) || textoEhPlaceholderDeLista(campo);
  }

  /**
   * É um controle de dropdown/combobox custom (a pergunta de "Selecionar opção")?
   *
   * O gatilho do Easy Apply NEM SEMPRE é um `<button>`: há versões que usam
   * `<div role="button" aria-haspopup="listbox">`. Antes só `<button>` entrava — e
   * era por isso que a pergunta de lista não aparecia como select no cartão (ela
   * caía no ramo de texto e virava um input sem opção).
   */
  /**
   * Resumo de um controle para os avisos do console: tag, papel, visibilidade, nº
   * de opções e o que ele mostra AGORA. É o que permite descobrir só pelo log por
   * que uma resposta não entrou — sem precisar adivinhar.
   */
  function diagnosticoDoCampo(el) {
    try {
      const tag = String(el.tagName || '?').toLowerCase();
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const tipo = (el.getAttribute && el.getAttribute('type')) || '';
      const opcoes = tag === 'select' && el.options ? el.options.length : -1;

      return (
        '(tag=' +
        tag +
        (tipo ? ':' + tipo : '') +
        (role ? '[' + role + ']' : '') +
        ' visivel=' +
        (isVisible(el) ? 'sim' : 'nao') +
        (opcoes >= 0 ? ' opcoes=' + opcoes : '') +
        ' valor=' +
        JSON.stringify(String(el.value == null ? '' : el.value).slice(0, 40)) +
        ' texto=' +
        JSON.stringify(clean(el.textContent || '').slice(0, 40)) +
        ')'
      );
    } catch (error) {
      return '(sem detalhes)';
    }
  }

  function ehCombo(el) {
    if (!el) return false;

    const tag = String(el.tagName || '').toLowerCase();
    const role = el.getAttribute('role');
    const haspopup = el.getAttribute('aria-haspopup');

    // Nativos que NÃO são dropdown: fora.
    if (tag === 'select' || tag === 'textarea') return false;

    /* `<input role="combobox">` ENTRA: o dropdown do artdeco é um input
     * `readonly` que só abre com clique (o `readOnly` é o que impede de digitar,
     * não de escolher). Era por ele ser descartado como "readonly" que a pergunta
     * de lista não chegava ao cartão. */
    if (tag === 'input' && role !== 'combobox' && haspopup !== 'listbox') return false;

    if (role === 'combobox') return true;
    if (role === 'listbox') return true;
    if (haspopup === 'listbox') return true;

    // `aria-expanded` sozinho é usado em muita coisa (accordion, "ver mais"):
    // só vale dentro de um bloco de pergunta do Easy Apply.
    if (el.hasAttribute('aria-expanded')) {
      return Boolean(
        el.closest && el.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset')
      );
    }

    return false;
  }

  /**
   * Caça a lista de opções de um combobox, onde ela estiver:
   *   1. a `listbox` aberta na tela;
   *   2. a lista escondida irmã/prima do botão (pronta para abrir);
   *   3. os itens `option`/`listitem` soltos dentro do fieldset do campo.
   * Devolve `[{ texto, value, el }]`.
   */
  function opcoesDoCombo(modal, campo) {
    const saida = [];
    const vistos = new Set();

    const anotar = (el) => {
      const texto = clean(el.textContent || '');
      if (!texto || texto.length > 80 || vistos.has(texto)) return;
      vistos.add(texto);
      saida.push({
        texto: texto,
        value: String(el.getAttribute('data-value') || el.getAttribute('value') || texto),
        el: el,
      });
    };

    try {
      const raiz = modal && document.contains(modal) ? modal : document;

      // 1) Lista aberta agora: itens visíveis da listbox.
      raiz
        .querySelectorAll('[role="listbox"] [role="option"]:not([aria-disabled="true"])')
        .forEach(anotar);
      if (saida.length) return saida;

      // 2) Lista ainda fechada: escondida ao lado do botão (irmãos do container).
      //    Só containers de UMA pergunta: com `fieldset`/`div` genéricos aqui, a
      //    "âncora" virava a etapa inteira e as opções de outro campo entravam.
      const ancora =
        (campo.closest &&
          campo.closest(
            '.fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input--container'
          )) ||
        campo.parentElement;

      if (ancora) {
        ancora
          .querySelectorAll(
            '[role="option"], [role="listitem"], li[data-value], div[data-value], li[data-test-list-item]'
          )
          .forEach(anotar);
        if (saida.length) return saida;

        // 2b) Container pai acima: alguns dropdowns penduram a lista um nível fora.
        const avo = ancora.parentElement;
        if (avo) {
          avo
            .querySelectorAll('[role="option"], li[data-value], div[data-value]')
            .forEach(anotar);
          if (saida.length) return saida;
        }
      }

      // 3) Último recurso: qualquer item de lista do modal com texto curto.
      raiz.querySelectorAll('[role="option"]').forEach(anotar);
    } catch (error) {
      /* DOM mudou no meio da leitura: vale o que deu para anotar */
    }

    return saida;
  }

  /** Texto/valor de PLACEHOLDER de um controle vazio ("Selecione…", "Choose…"). */
  const PLACEHOLDER_RE = /^(selecione|selecionar|escolha|escolher|select|choose|--|—|-)\b/i;

  /**
   * O texto é EXATAMENTE um placeholder de lista ("Selecionar opção", "Selecione
   * uma opção", "Select an option", "—")? É o que identifica o dropdown SEM
   * resposta mesmo quando não sobra nenhum sinal de ARIA — e sem confundir com
   * uma pergunta que comece com "Selecione o seu nível…".
   */
  const PLACEHOLDER_TEXTO_RE =
    /^((selecione|selecionar|escolha|escolher|select|choose)( uma op[çc][ãa]o| op[çc][ãa]o| um valor| an option| option| a value|\.\.\.|…)?|—+|--+|-+|\.{2,}|…)$/i;

  /**
   * A pergunta é de SIM/NÃO? Nesses dropdowns o LinkedIn oferece exatamente
   * "Sim"/"Não" — e é o que o cartão mostra quando a lista de opções não está no
   * DOM (o dropdown custom só revela as opções depois de abrir).
   */
  const PERGUNTA_SIM_NAO_RE =
    /(voc[êe]|aceita|concorda|de acordo|autoriza|dispon[íi]vel|sim ou n[ãa]o|\byes or no\b)/i;

  /**
   * O `<select>` está SEM resposta? O placeholder do LinkedIn nem sempre tem
   * `value=""` — às vezes é "Selecione uma opção" com valor "0". Então olhamos a
   * OPÇÃO escolhida: valor vazio, opção desabilitada ou texto de placeholder
   * contam como vazio (é o que trava a etapa e precisa aparecer no cartão).
   */
  function selectVazio(select) {
    try {
      const opcao = select && select.options ? select.options[select.selectedIndex] : null;
      if (!opcao) return true;

      const value = String(opcao.value == null ? '' : opcao.value).trim();
      if (value === '') return true;
      if (opcao.disabled) return true;

      const texto = clean(opcao.textContent || '');
      return PLACEHOLDER_RE.test(texto) || PLACEHOLDER_RE.test(value);
    } catch (error) {
      return false;
    }
  }

  /**
   * O combobox já tem resposta (não é placeholder)? Detecta pelos mesmos
   * sinais que uma pessoa veria: `aria-valuetext`, texto diferente do
   * "Selecione…", ou valor em data-attribute — e ignora o placeholder.
   */
  function comboTemValor(campo) {
    if (!campo) return false;

    try {
      const rotulo = fieldLabel(campo);
      const textos = [
        campo.getAttribute('aria-valuetext'),
        campo.getAttribute('data-value'),
        campo.textContent,
      ]
        .map((t) => clean(t || ''))
        .filter(Boolean);

      for (const texto of textos) {
        // Placeholder conta como vazio — inclusive "Choose…"/"Escolha…", que
        // antes passavam por "escolha de verdade" (texto curto) e escondiam o
        // campo do cartão de ajuda.
        if (PLACEHOLDER_RE.test(texto)) continue;
        if (normalizar(texto).indexOf('selecione') === 0) continue;
        if (rotulo && normalizar(texto) === normalizar(rotulo)) continue; // ecoa a pergunta
        if (texto.length <= 60) return true; // tem uma escolha de verdade
      }
    } catch (error) {
      /* campo quebrado: trata como vazio (mostra no cartão) */
    }

    return false;
  }

  /**
   * Aplica a sua escolha num combobox: abre a lista (sem abrir não há opção
   * para clicar), espera os itens entrarem na tela, clica no que casa com o
   * texto (exato, depois "contém") e avisa o React. Devolve `true` se marcou.
   */
  async function aplicarEmCombo(modal, campo, valor, alvoOpcao) {
    try {
      if (!modal || !document.contains(modal) || !document.contains(campo)) return false;

      const alvo = alvoOpcao || normalizar(valor);
      if (!alvo) return false;

      // Já respondeu (ou o humano respondeu no meio tempo)? Não mexe.
      if (comboTemValor(campo)) return true;

      // Abre a lista com um clique humano (e revalida: o DOM do modal muda).
      humanClick(campo);
      await waitUntil(
        () => opcoesDoCombo(modal, campo).length > 0,
        Math.min(CONFIG.popupWaitMs, 3000)
      );

      if (!document.contains(campo)) return false;

      const opcoes = opcoesDoCombo(modal, campo);
      const escolhida =
        opcoes.find((o) => normalizar(o.texto) === alvo) ||
        opcoes.find((o) => normalizar(o.texto).indexOf(alvo) >= 0) ||
        opcoes.find((o) => normalizar(o.value) === alvo);

      if (!escolhida || !escolhida.el || !document.contains(escolhida.el)) return false;

      humanClick(escolhida.el);
      await humanPause(CONFIG.applyStepDelayMs);

      // Conta como aplicado se a lista fechou ou o valor apareceu no combobox.
      return (
        opcoesDoCombo(modal, campo).length === 0 ||
        comboTemValor(campo) ||
        normalizar(campo.textContent || '').indexOf(normalizar(escolhida.texto)) >= 0
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Quando o `<select>` ESCONDIDO não aceita a resposta, quem manda é o UI VISÍVEL:
   * o LinkedIn desenha um botão/combobox por cima e é ele que o React escuta. Clica
   * no gatilho, espera a lista (`[role="listbox"]`) e clica na opção — a mesma
   * mecânica do `aplicarEmCombo`, com o gatilho caçado perto do `<select>`.
   */
  async function escolherNoDropdownVisivel(modal, campo, alvoOpcao, alvoValor) {
    try {
      if (!campo || !document.contains(campo)) return false;

      const bloco =
        (campo.closest &&
          campo.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset')) ||
        campo.parentElement;
      if (!bloco) return false;

      const gatilho = queryAllProfundo(
        'button, [role="combobox"], [aria-haspopup="listbox"], [aria-expanded]',
        bloco
      ).filter((el) => el !== campo && isVisible(el) && !el.disabled)[0];
      if (!gatilho) return false;

      const alvo = normalizar(alvoOpcao || '');
      if (!alvo) return false;

      humanClick(gatilho);
      await waitUntil(
        () => opcoesDoCombo(modal, gatilho).length > 0,
        Math.min(CONFIG.popupWaitMs, 2500)
      );

      const opcoes = opcoesDoCombo(modal, gatilho);
      const escolhida =
        opcoes.find((o) => normalizar(o.texto) === alvo) ||
        opcoes.find((o) => normalizar(o.texto).indexOf(alvo) >= 0) ||
        opcoes.find((o) => normalizar(o.value) === alvo);

      if (!escolhida || !escolhida.el || !document.contains(escolhida.el)) return false;

      humanClick(escolhida.el);
      await humanPause(CONFIG.applyStepDelayMs);

      /* Deu certo? O gatilho passou a mostrar a escolha, o `<select>` pegou o valor,
       * ou a lista fechou (o LinkedIn fecha a lista quando registra a escolha). */
      return (
        comboTemValor(gatilho) ||
        String(campo.value == null ? '' : campo.value) === String(alvoValor || '') ||
        opcoesDoCombo(modal, gatilho).length === 0
      );
    } catch (error) {
      return false;
    }
  }

  async function aplicarRespostaNosCampos(modal, resposta) {
    if (!modal || !resposta || typeof resposta !== 'object') return 0;

    let aplicados = 0;

    /* Quantas respostas vieram no cartão: a rede de segurança do fim do
     * `buscarCampo` só vale quando é UMA (com duas ou mais, escrever no campo
     * errado seria pior do que não escrever). */
    const chaves = Object.keys(resposta).filter((k) => String(resposta[k] == null ? '' : resposta[k]));

    /* Aqui vale a MESMA regra da detecção: o LinkedIn ESCONDE o controle nativo
     * atrás do UI estilizado (o `<select>` do artdeco fica sem caixa). Se a
     * varredura aceita o campo escondido (`visivelOuControle`), a busca para
     * ESCREVER também precisa aceitar — exigir `isVisible` aqui foi o que deixou o
     * select sem nunca ser encontrado na hora de preencher (o cartão pedia, a
     * resposta não entrava). */
    const buscarCampo = (alvoPergunta) => {
      // Re-busca o formulário AGORA (o modal pode ter sido reconstruído desde
      // que o cartão abriu): o rótulo manda, e vale campo nativo ou combobox.
      for (const el of queryAllUnique(APPLY_SEL.invalid, modal)) {
        if (!isVisible(el)) continue;
        const real = resolverCampo(el);
        if (!real || !visivelOuControle(real)) continue;
        if (normalizar(fieldLabel(real) || real.textContent).indexOf(alvoPergunta) >= 0) {
          return real;
        }
      }

      for (const el of queryAllUnique(
        [
          'input',
          'select',
          'textarea',
          '[role="combobox"]',
          '[aria-haspopup="listbox"]',
          '[aria-expanded]',
        ],
        modal
      )) {
        if (!visivelOuControle(el)) continue;
        if (normalizar(fieldLabel(el) || '').indexOf(alvoPergunta) >= 0) return el;
      }

      /* 3) O BLOCO da pergunta — devolvendo o CONTROLE de dentro dele, e só quando
       *    o bloco é o de UMA pergunta.
       *
       *    Cuidado que custou caro: o `<fieldset>` da ETAPA inteira também "contém"
       *    a pergunta (contém todas). Devolvê-lo fazia o chamador descer para o
       *    PRIMEIRO controle dele — que é o da primeira pergunta da etapa. A
       *    resposta ia para o campo ERRADO: o select do LinkedIn continuava vazio e
       *    o cartão voltava a pedir, num vaivém. */
      for (const bloco of queryAllUnique(
        ['.fb-dash-form-element', '.jobs-easy-apply-form-element', 'fieldset'],
        modal
      )) {
        if (!isVisible(bloco)) continue;
        if (normalizar(fieldLabel(bloco) || bloco.textContent).indexOf(alvoPergunta) < 0) continue;

        const controles = queryAllProfundo(
          'select, input:not([type="hidden"]), textarea, [role="combobox"], [role="radio"], ' +
            '[aria-haspopup], [aria-expanded]',
          bloco
        ).filter(visivelOuControle);

        if (controles.length === 1) return controles[0]; // bloco de UMA pergunta

        // Vários controles: só serve se forem o mesmo grupo de rádio/check.
        const radios = controles.filter(
          (el) => String(el.type || '').toLowerCase() === 'radio' || ehRadioCustom(el)
        );
        if (radios.length && radios.length === controles.length) return radios[0];

        continue; // bloco de várias perguntas: tenta um bloco menor
      }

      // 4) No DOCUMENTO, restrito ao formulário de candidatura: o conteúdo do
      //    Easy Apply pode estar num portal do React, fora do nó do `modal`.
      for (const el of queryAllProfundo(
        'input, select, textarea, [role="combobox"], [aria-haspopup="listbox"], [aria-expanded]'
      )) {
        if (!pertenceAoFormulario(el, modal) || !visivelOuControle(el)) continue;
        if (normalizar(fieldLabel(el) || '').indexOf(alvoPergunta) >= 0) return el;
      }

      /* 5) ÚLTIMA rede: o cartão trouxe UMA resposta e há UM só controle de escolha
       *    sem resposta no formulário. Aí não há como errar de campo — e é o que salva
       *    a etapa quando o rótulo que o cartão mostrou não bate com o do LinkedIn
       *    (texto montado por CSS, truncado, com o "Obrigatório" colado…).
       *
       *    Só com UMA resposta: com duas ou mais, escrever no campo errado seria pior
       *    do que não escrever. E só numérico o bastante para ser seguro: se houver
       *    mais de um candidato em aberto, não chuta. */
      if (chaves.length === 1) {
        const candidatos = queryAllProfundo(
          'select, [role="combobox"], [aria-haspopup="listbox"], [aria-expanded], input[readonly]',
          modal
        ).filter((el) => el !== null && visivelOuControle(el) && !el.disabled);

        const semResposta = candidatos.filter((el) =>
          ehCombo(el) ? !comboTemValor(el) : !jaRespondido(el)
        );

        if (semResposta.length === 1) {
          console.log(
            '[PegaVaga] o rotulo "' +
              alvoPergunta +
              '" nao bateu com nenhum campo; usando o unico campo de escolha sem resposta da etapa.'
          );
          return semResposta[0];
        }
      }

      return null;
    };

    for (const [rotulo, texto] of Object.entries(resposta)) {
      const valor = String(texto == null ? '' : texto);
      if (!valor) continue; // campo que você deixou em branco: não mexe

      const alvoPergunta = normalizar(rotulo);
      const alvoOpcao = normalizar(valor);

      // Acha o campo de verdade cujo rótulo (a pergunta) bate com o que a janelinha
      // mostrou — mesma origem (`fieldLabel`), para não escrever no campo errado.
      // A busca é feita na hora (o modal pode ter sido reconstruído desde que
      // o cartão abriu): inválidos primeiro, depois o formulário inteiro.
      /* A busca do campo fica FORA do `try` de cada ramo (logo abaixo) — então ela
       * também precisa da guarda: um campo quebrado aqui derrubava a varredura
       * inteira, e o `finally` do `startScan` ainda navegava para o próximo termo. */
      let campo = null;
      try {
        campo = buscarCampo(alvoPergunta);
      } catch (erroDeBusca) {
        console.error(
          '[PegaVaga] falha ao localizar o campo "' +
            rotulo +
            '" (seguindo): ' +
            ((erroDeBusca && erroDeBusca.name) || 'erro') +
            ': ' +
            ((erroDeBusca && erroDeBusca.message) || erroDeBusca)
        );
        continue;
      }

      if (!campo) continue;

      /* O alvo pode ser o BLOCO da pergunta: desce até o controle de verdade — mas
       * SÓ quando o bloco é o de UMA pergunta. Num bloco com vários controles (a
       * etapa inteira) escrever no primeiro deles punha a resposta no campo ERRADO,
       * e era isso que deixava o select do LinkedIn vazio e o cartão voltando a
       * pedir. Não dá para saber onde escrever: melhor não chutar. */
      const tagAlvo = String(campo.tagName || '').toLowerCase();
      const ehControle =
        tagAlvo === 'input' ||
        tagAlvo === 'select' ||
        tagAlvo === 'textarea' ||
        ehCombo(campo) ||
        ehRadioCustom(campo) ||
        String((campo.getAttribute && campo.getAttribute('contenteditable')) || '') === 'true';

      if (!ehControle) {
        const controles = queryAllProfundo(
          'select, input:not([type="hidden"]), textarea, [role="combobox"], [role="radio"], ' +
            '[aria-haspopup], [aria-expanded], input[readonly]',
          campo
        ).filter(visivelOuControle);

        const radios = controles.filter(
          (el) => String(el.type || '').toLowerCase() === 'radio' || ehRadioCustom(el)
        );

        if (controles.length === 1) campo = controles[0];
        else if (radios.length && radios.length === controles.length) campo = radios[0];
        else {
          console.warn(
            '[PegaVaga] nao achei onde escrever a resposta de "' +
              rotulo +
              '" (o bloco tem ' +
              controles.length +
              ' controles); seguindo sem chutar.'
          );
          campo = null;
        }
      }

      if (!campo) {
        console.warn(
          '[PegaVaga] nao achei o campo da pergunta "' + rotulo + '" para escrever a resposta; seguindo.'
        );
        continue;
      }

      const tag = String(campo.tagName || '').toLowerCase();
      const type = String(campo.type || '').toLowerCase();

      const antes = aplicados;
      try {
        if (tag === 'select') {
          // Escolhe a opção cujo texto/valor casa com o que VOCÊ escolheu (não com a
          // pergunta). Casa exato primeiro, depois "contém", para não errar de opção.
          const opcoes = Array.from(campo.options);
          const opcao =
            opcoes.find((o) => normalizar(o.textContent) === alvoOpcao) ||
            opcoes.find((o) => normalizar(o.textContent).indexOf(alvoOpcao) >= 0) ||
            opcoes.find((o) => normalizar(o.value) === alvoOpcao);

          if (opcao) {
            const alvoValor = String(opcao.value);

            /* Escreve passando pelo setter NATIVO (o React do LinkedIn instala um
             * descritor próprio no elemento) e avisa pelos eventos que ele escuta —
             * `fireFieldEvents` manda `input`, `change` e `blur`, exatamente como o
             * caminho antigo de preenchimento (que funcionava). Faltava o `blur`
             * aqui: é ao sair do campo que o LinkedIn valida o select. */
            setNativeValue(campo, alvoValor);
            fireFieldEvents(campo);

            /* CONFERE se a escrita PEGOU. O LinkedIn remonta o `<select>` em alguns
             * passos e a escolha volta ao placeholder: sem conferir, o fluxo dizia
             * "preenchi" com o campo vazio e a etapa travava de novo. Se o `value`
             * não pegou, marca pelo ÍNDICE (há select cujo `value` repete). */
            if (String(campo.value) !== alvoValor) {
              try {
                campo.selectedIndex = opcoes.indexOf(opcao);
                fireFieldEvents(campo);
              } catch (error) {
                /* select sem índice: fica com o que deu */
              }
            }

            if (String(campo.value) === alvoValor) {
              aplicados += 1;
            } else if (await escolherNoDropdownVisivel(modal, campo, valor, alvoValor)) {
              /* O `<select>` escondido não aceitou: quem manda é o UI VISÍVEL (o
               * botão/combobox que o LinkedIn desenha por cima). */
              console.log(
                '[PegaVaga] o select "' + rotulo + '" foi respondido pelo dropdown visivel.'
              );
              aplicados += 1;
            } else {
              console.warn(
                '[PegaVaga] o select "' +
                  rotulo +
                  '" nao aceitou "' +
                  alvoValor +
                  '" ' +
                  diagnosticoDoCampo(campo)
              );
            }
          } else if (await escolherNoDropdownVisivel(modal, campo, valor, '')) {
            aplicados += 1;
          } else {
            console.warn(
              '[PegaVaga] a resposta "' +
                valor +
                '" nao esta entre as opcoes do select "' +
                rotulo +
                '" ' +
                diagnosticoDoCampo(campo)
            );
          }
        } else if (ehCombo(campo) || (tag === 'input' && campo.readOnly)) {
          // Dropdown custom (ou `<input readonly>` de escolha — o do artdeco):
          // abre, acha a opção pelo texto e clica. Sem abrir não há lista no DOM
          // para clicar, e escrever o valor num readonly não adianta (o LinkedIn
          // ignora). O `fireFieldEvents` conta a escolha como preenchimento.
          const aplicado = await aplicarEmCombo(modal, campo, valor, alvoOpcao);
          if (aplicado) aplicados += 1;
        } else if (type === 'radio' || ehRadioCustom(campo)) {
          // Grupo de rádios (input NATIVO ou `role="radio"`): marca o que tem o
          // rótulo da OPÇÃO escolhida — o mesmo texto que o cartão mostrou (ver
          // `rotuloDaOpcao`), para casar com o que você respondeu.
          const grupo = ehRadioCustom(campo)
            ? opcoesDeRadioCustom(campo, modal)
            : opcoesDoGrupo(campo);

          const alvo =
            grupo.find((f) => normalizar(rotuloDaOpcao(f)) === alvoOpcao) ||
            grupo.find((f) => normalizar(rotuloDaOpcao(f)).indexOf(alvoOpcao) >= 0);

          if (alvo) {
            const clicavel = (alvo.labels && alvo.labels[0]) || alvo;
            humanClick(clicavel);

            // Marcou mesmo? (o LinkedIn remonta o grupo em alguns passos; e um
            // `role="radio"` marca por `aria-checked`, não por `checked`.)
            const marcado = (f) =>
              f.checked === true ||
              String((f.getAttribute && f.getAttribute('aria-checked')) || '') === 'true';

            if (grupo.some(marcado)) {
              aplicados += 1;
            } else {
              console.warn(
                '[PegaVaga] o radio "' +
                  rotulo +
                  '" nao ficou marcado ' +
                  diagnosticoDoCampo(alvo)
              );
            }
          }
        } else if (type === 'checkbox') {
          // Binário ("Sim"/"Não"): "Sim" marca; "Não" deixa como está (desmarcado).
          if (alvoOpcao === 'sim') {
            if (!campo.checked) {
              const clicavel = (campo.labels && campo.labels[0]) || campo;
              clicavel.click();
            }
            aplicados += 1;
          }
        } else if (
          tag === 'input' ||
          tag === 'textarea' ||
          String((campo.getAttribute && campo.getAttribute('contenteditable')) || '') === 'true'
        ) {
          // Texto de verdade (input/textarea/contenteditable): escreve e avisa o
          // React do LinkedIn — `fireFieldEvents` manda `input`, `change` e `blur`
          // (o `blur` é o que faz o LinkedIn validar e habilitar o "Avançar").
          setNativeValue(campo, valor);
          fireFieldEvents(campo);
          aplicados += 1;
        }
        /* Qualquer outro elemento (div/bloco) NÃO conta como aplicado: é melhor
         * dizer que não deu do que fingir que preencheu e ficar pedindo de novo no
         * vaivém (o `resolverComAjuda` transforma isso no desfecho honesto). */
      } catch (error) {
        /* campo não reagiu: segue para o próximo */
      }

      /* Uma linha por resposta do cartão: o que aconteceu com CADA uma (aplicada ou
       * não, e em que controle ela caiu). É o log que responde "por que o select não
       * preencheu?" sem precisar adivinhar. */
      console.log(
        '[PegaVaga] "' +
          rotulo +
          '": ' +
          (aplicados > antes ? 'aplicado' : 'NAO aplicado') +
          ' ' +
          diagnosticoDoCampo(campo)
      );
    }

    /* Deixa o LinkedIn digerir o preenchimento (revalidar a etapa, reabilitar o
     * "Avançar") antes de quem chamou tentar o próximo passo — é o que o caminho
     * antigo de preenchimento também fazia (`fillPendingFields`). Sem essa pausa o
     * clique no "Avançar" podia sair antes de o LinkedIn registrar a resposta. */
    if (aplicados) {
      const deadline = Date.now() + CONFIG.applyModalPollMs * 3;
      while (Date.now() < deadline) {
        if (await waitForQuiet(Math.min(CONFIG.applyQuietMs, deadline - Date.now()))) break;
      }
    }

    return aplicados;
  }

  /**
   * Tenta resolver com você uma vaga que travou num campo ou não confirmou o
   * envio. Devolve o desfecho a usar (`manual`/`pulada`/`continuar`), ou `null`
   * quando não houve aviso — aí vale o desfecho de sempre.
   *
   * `continuar` é o caso novo: você respondeu os campos na janelinha, a extensão
   * preencheu e a candidatura tenta seguir sozinha (sem te levar para a aba).
   */
  async function resolverComAjuda(modal, dados) {
    const decisao = await pedirAjuda(dados);
    if (!decisao || !decisao.acao) return null;

    if (decisao.acao === 'manual') {
      await esperarPreenchimentoManual(modal);
      return { status: 'manual' };
    }

    if (decisao.acao === 'aplicar') {
      // Você respondeu na janelinha: preenche os campos travados e deixa o fluxo
      // seguir. Devolve `continuar` para quem chamou tentar o próximo passo.
      const aplicados = await aplicarRespostaNosCampos(modal, decisao.resposta);

      /* Nada foi escrito: ou não achamos ONDE escrever, ou o formulário já saiu da
       * tela. Não finge que deu certo — devolve o desfecho honesto em vez de voltar
       * a pedir e ficar no vaivém (era o "o cartão fica voltando a pedir"). */
      if (!aplicados) {
        console.warn(
          '[PegaVaga] nenhuma resposta do cartao pode ser escrita no formulario; a vaga segue como incompleta.'
        );
        return { status: 'incompleta' };
      }

      return { status: 'continuar' };
    }

    // Você mandou pular: a vaga é descartada e não volta (sem gastar cota).
    await closeModal(modal, true);
    return { status: 'pulada' };
  }

  /* ---- Perguntas obrigatórias: responder sozinho -------------------------- */

  /** Preferências de resposta lidas da configuração (ver shared.js). */
  function answerPrefs(cfg) {
    const apply = cfg || {};

    return {
      yes: apply.answerYes !== false,
      number: apply.answerNumber == null ? 1 : apply.answerNumber,
      text: apply.answerText || '',
      answers: apply.answers || {},
    };
  }

  /** Dispara os eventos que o LinkedIn escuta quando alguém preenche um campo. */
  function fireFieldEvents(field) {
    if (!field || typeof field.dispatchEvent !== 'function') return;

    ['input', 'change', 'blur'].forEach((type) => {
      try {
        field.dispatchEvent(new Event(type, { bubbles: true }));
      } catch (error) {
        /* sem Event: o LinkedIn não reage a este campo */
      }
    });
  }

  /**
   * Escreve num campo passando pelo setter nativo (`HTMLInputElement.value`).
   * O LinkedIn é React: atribuir `field.value` direto não avisa o framework,
   * mas o setter nativo + evento `input` sim.
   */
  function setNativeValue(field, value) {
    try {
      const proto = Object.getPrototypeOf(field);
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');

      if (descriptor && descriptor.set) {
        descriptor.set.call(field, value);
        return;
      }
    } catch (error) {
      /* sem descritor: cai no value direto */
    }

    field.value = value;
  }

  /**
   * Todos os rádios do MESMO grupo (nome), habilitados.
   *
   * Procura no `root` (o modal) e, se não achar, no DOCUMENTO — e **entra nos
   * Shadow DOMs** (`queryAllProfundo`). O formulário do Easy Apply é montado em
   * pedaços (portais/web components), e um grupo não encontrado deixava a pergunta
   * **sem opção nenhuma** — e o cartão, sem opções, vira campo de TEXTO. Era o
   * radio que aparecia como input.
   */
  function radioGroup(root, field) {
    if (!field) return [];
    if (!field.name) return [field];

    let seletor = '';
    try {
      seletor = 'input[type="radio"][name="' + String(field.name).replace(/"/g, '\\"') + '"]';
    } catch (error) {
      return [field];
    }

    const achar = (base) => {
      try {
        return queryAllProfundo(seletor, base || document).filter((input) => !input.disabled);
      } catch (error) {
        return [];
      }
    };

    let grupo = achar(root);
    if (!grupo.length && root && root !== document) grupo = achar(document);

    return grupo.length ? grupo : [field];
  }

  /** É um rádio/check CUSTOM (div/botão com `role`), e não um `<input>`? */
  function ehRadioCustom(el) {
    if (!el) return false;
    const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    return role === 'radio' || role === 'radiogroup';
  }

  /**
   * As OPÇÕES de um grupo de rádio custom (`role="radio"`).
   *
   * O artdeco de hoje **não usa `<input type=radio>` em todas as telas**: são
   * div/botões com `role="radio"` dentro de um `radiogroup`/`fieldset`. Como nada
   * lia esse grupo, a pergunta ficava **sem opção** — e o cartão, sem opções, cai
   * no campo de texto (era o radio que vinha como input).
   */
  function opcoesDeRadioCustom(el, modal) {
    if (!el) return [];

    const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    const raiz = role === 'radiogroup' ? el : raizDoGrupo(el);

    /* Sem filtro de visibilidade: o artdeco esconde o controle custom em algumas
     * telas e deixa só o rótulo visível — filtrar aqui zerava as opções e a pergunta
     * voltava ao cartão como campo de TEXTO. A raiz do grupo já é local (o ancestral
     * com 2+ opções), então não há risco de puxar opção de outra pergunta. */
    return queryAllProfundo('[role="radio"]', raiz);
  }

  /* -------------------------------------------------------------------------- */
  /* Grupos de ESCOLHA (rádio/checkbox): o que é PERGUNTA e o que é OPÇÃO        */
  /* -------------------------------------------------------------------------- */
  //
  // O artdeco marca cada bolinha de formas diferentes conforme a tela: `<input
  // type=radio>`, `<input>` escondido com o `<label>` visível, ou div/botão com
  // `role="radio"`. Em todas vale a mesma separação:
  //
  //   - a PERGUNTA vem do GRUPO (`<legend>`, `[role="radiogroup"]`, rótulo do bloco
  //     do Easy Apply);
  //   - a OPÇÃO é o `<label>` colado na bolinha ("YES"/"NO").
  //
  // Trocar os dois era o cartão trazendo "muito rádio com o rótulo YES": o
  // `fieldLabel` do input devolvia o `<label>` da OPÇÃO como se fosse a pergunta, e
  // o grupo saía com UMA opção só (o `radioGroup` depende do `name`, que nem sempre
  // existe nesse HTML).

  const OPCOES_SEL =
    'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]';

  /** As opções (rádio/checkbox) DENTRO de um nó. */
  function opcoesDentro(raiz) {
    if (!raiz) return [];
    try {
      return queryAllProfundo(OPCOES_SEL, raiz).filter((el) => !el.disabled);
    } catch (error) {
      return [];
    }
  }

  /** A opção é de ESCOLHA (rádio/checkbox, nativo ou com `role`)? */
  function ehOpcaoDeEscolha(el) {
    if (!el) return false;
    const type = String(el.type || '').toLowerCase();
    const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    return type === 'radio' || type === 'checkbox' || role === 'radio' || role === 'checkbox';
  }

  /**
   * A RAIZ do grupo de uma opção: o ancestral que reúne as opções da MESMA pergunta.
   *
   * Subir até o primeiro ancestral com 2+ opções é o que conserta o caso em que o
   * artdeco embrulha cada bolinha no seu próprio container: parar ali (era o que o
   * `closest('[role=radiogroup], fieldset, .fb-dash-form-element')` fazia) dava um
   * grupo de UMA opção — e cada bolinha virava uma pergunta no cartão.
   */
  function raizDoGrupo(el) {
    if (!el) return null;

    try {
      const explicito = el.closest && el.closest('[role="radiogroup"]');
      if (explicito && explicito !== el) return explicito;

      let no = el.parentElement;
      let subiu = 0;
      while (no && no !== document.body && no !== document.documentElement && subiu < 8) {
        if (opcoesDentro(no).length >= 2) return no;
        no = no.parentElement;
        subiu += 1;
      }

      // Sem ancestral comum (opções soltas): vale o agrupamento pelo `name`.
      if (el.name) {
        const porNome = queryAllProfundo(
          'input[type="radio"][name="' + String(el.name).replace(/"/g, '\\"') + '"]'
        );
        if (porNome.length >= 2) return porNome[0].parentElement || el.parentElement;
      }
    } catch (error) {
      /* sem grupo: a própria opção responde por si */
    }

    return el.parentElement || el;
  }

  /**
   * As OPÇÕES do grupo de uma opção — TODAS as da mesma pergunta (nunca uma só).
   *
   * Pelo `name` quando existe (é o agrupamento que o navegador conhece) e, sem ele,
   * pela raiz do grupo.
   */
  function opcoesDoGrupo(el) {
    if (!el) return [];

    try {
      if (el.name) {
        const porNome = radioGroup(document, el);
        if (porNome.length >= 2) return porNome;
      }
      return opcoesDentro(raizDoGrupo(el));
    } catch (error) {
      return [el];
    }
  }

  /**
   * A PERGUNTA de um grupo de escolha — NUNCA o texto de uma opção.
   */
  function rotuloDaPerguntaDoGrupo(el) {
    if (!el) return '';

    try {
      const raiz = raizDoGrupo(el);
      const blocos = [
        raiz,
        el.closest && el.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset'),
      ].filter(Boolean);

      for (const no of blocos) {
        const ids = String(no.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .filter(Boolean);

        for (const id of ids) {
          const alvo = (no.ownerDocument || document).getElementById(id);
          const texto = clean((alvo && alvo.textContent) || '');
          if (texto) return texto.slice(0, 300);
        }

        const aria = clean(no.getAttribute('aria-label') || '');
        if (aria) return aria.slice(0, 300);

        /* O rótulo da pergunta, do mais ESPECÍFICO para o mais genérico.
         *
         * A ordem importa e não pode ser um seletor só: o `querySelector` com
         * lista devolve o primeiro na ORDEM DO DOCUMENTO, e o `<legend>` (ancestral)
         * ganharia do `<span class="fb-dash-form-element__label">` — arrastando o
         * "Obrigatório" escondido junto (foi o que o HTML real do LinkedIn mostrou:
         * `<legend>` = pergunta + `<span class="visually-hidden">Obrigatório</span>`). */
        const rotulos = [
          '.fb-dash-form-element__label',
          '.jobs-easy-apply-form-element__label',
          '.artdeco-text-input--label',
          'legend',
        ];

        for (const seletor of rotulos) {
          const el = no.querySelector && no.querySelector(seletor);
          if (!el) continue;

          const texto = clean(el.textContent);
          if (texto) return texto.slice(0, 300);
        }
      }

      /* Sem rótulo marcado: sobra do TEXTO DO BLOCO menos os rótulos das opções —
       * "Você aceita…? YES NO" vira "Você aceita…?". É o caso do bloco montado com
       * `<input type=radio>` + `<label>YES</label>`, sem `legend` nem ARIA. */
      const bloco =
        raiz ||
        (el.closest && el.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, fieldset'));

      if (bloco) {
        let sobra = String(bloco.textContent || '');
        for (const opcao of opcoesDoGrupo(el)) {
          const texto = rotuloDaOpcao(opcao);
          if (texto) sobra = sobra.split(texto).join(' ');
        }

        const pergunta = perguntaDoTexto(sobra);
        if (pergunta) return pergunta.slice(0, 300);
      }
    } catch (error) {
      /* sem pergunta: quem chamou segue com o que tiver */
    }

    return '';
  }

  /**
   * O rótulo da OPÇÃO de um rádio/checkbox — o texto ao lado da bolinha
   * ("Sim"/"Não"/"YES"), que NÃO é a pergunta. É ele que o cartão oferece.
   */
  function rotuloDaOpcao(input) {
    if (!input) return '';

    const tag = String(input.tagName || '').toLowerCase();
    const ehInput = tag === 'input';

    try {
      /* O LinkedIn põe o texto da OPÇÃO num `data-` do próprio input no Easy Apply
       * (`data-test-text-selectable-option__input="Yes"`, como no HTML real): é o
       * rótulo mais direto que existe e não depende de `<label>`/CSS. */
      const dataOpcao = clean(
        (input.getAttribute && input.getAttribute('data-test-text-selectable-option__input')) ||
          (input.getAttribute && input.getAttribute('data-test-selectable-option__input')) ||
          ''
      );
      if (dataOpcao && dataOpcao.length <= 80) return dataOpcao;

      if (ehInput && input.labels && input.labels.length) {
        const label = input.labels[0];

        /* Um `<label>` que embrulha o GRUPO inteiro (2+ opções) tem o texto da
         * PERGUNTA + o de todas as opções: não é o rótulo desta bolinha. Nesse caso
         * vale o irmão colado no input (o `<span>` do artdeco) ou, no fim, o `value`. */
        if (opcoesDentro(label).length >= 2) {
          const irmao = input.nextElementSibling;
          const textoIrmao = clean((irmao && irmao.textContent) || '');
          if (textoIrmao && textoIrmao.length <= 80) return textoIrmao;
        } else {
          const texto = perguntaDoTexto(label.textContent).slice(0, 80);
          if (texto) return texto;
        }
      }

      const aria = clean((input.getAttribute && input.getAttribute('aria-label')) || '');
      if (aria) return aria.slice(0, 80);

      // Div/botão com `role="radio"`: o texto da opção é o próprio conteúdo.
      if (!ehInput) {
        const proprio = clean(input.textContent || '');
        if (proprio && proprio.length <= 80) return proprio;
      }

      // O texto mora num <label>/<span> dentro do bloco da opção (o
      // `.artdeco-radio-button`, por exemplo) — nunca num `div`, que poderia ser o
      // grupo inteiro.
      const bloco = input.parentElement;
      if (bloco) {
        const perto = bloco.querySelector('label, span');
        if (perto && perto !== input) {
          const texto = clean(perto.textContent).slice(0, 80);
          if (texto) return texto;
        }
      }
    } catch (error) {
      /* campo quebrado: cai no valor */
    }

    return String(input.value || '').slice(0, 80);
  }

  /** Responde um grupo de rádio obrigatório (devolve o rótulo escolhido). */
  function answerRadio(fields, prefs, question) {
    if (!fields.length) return '';
    if (fields.some((field) => field.checked)) return '';

    // O mesmo rótulo de opção que o cartão mostra (`rotuloDaOpcao`): é ele que
    // casa com a resposta escolhida e com o "respondo sozinho".
    const labels = fields.map((field) => rotuloDaOpcao(field) || String(field.value || ''));
    const choice = SHARED.pickChoice(labels, Object.assign({}, prefs, { question }));
    const index = labels.indexOf(choice);
    const field = fields[index >= 0 ? index : 0];

    if (!field) return '';

    // O LinkedIn esconde o input e estiliza o label: clicar no label é o que
    // uma pessoa faria (e é o que o React escuta de verdade).
    const target = (field.labels && field.labels[0]) || field;

    humanClick(target);

    if (!field.checked) {
      field.checked = true;
      fireFieldEvents(field);
    }

    return clean(labels[index >= 0 ? index : 0] || field.value).slice(0, 60);
  }

  /** Responde uma lista (select) obrigatória (devolve o rótulo escolhido). */
  function answerSelect(select, prefs, question) {
    if (!select || select.disabled || String(select.value || '')) return '';

    const options = Array.from(select.options || []).filter(
      (option) => !option.disabled && String(option.value) !== ''
    );

    if (!options.length) return '';

    const labels = options.map((option) => clean(option.textContent));
    const choice = SHARED.pickChoice(labels, Object.assign({}, prefs, { question }));
    const index = labels.indexOf(choice);
    const option = options[index >= 0 ? index : 0];

    if (!option) return '';

    setNativeValue(select, option.value);
    fireFieldEvents(select);

    return clean(option.textContent).slice(0, 60);
  }

  /** Escreve num campo de texto obrigatório vazio (número/anos ou texto padrão). */
  function answerText(field, prefs, question) {
    if (!field || field.disabled || field.readOnly) return '';
    if (String(field.value || '').trim()) return '';

    const type = String(field.type || '').toLowerCase();
    if (type === 'hidden' || type === 'file' || type === 'radio' || type === 'checkbox') return '';

    const specific = SHARED.answerForQuestion(question, prefs.answers);
    const looksNumber =
      type === 'number' ||
      /ano|anos|quantidade|experiencia|salario|pretensao|nota|valor/.test(normalize(question));

    const value = specific || (looksNumber ? String(prefs.number) : prefs.text || '');
    if (value === '' || value == null) return '';

    setNativeValue(field, value);
    fireFieldEvents(field);

    return clean(question || value).slice(0, 60);
  }

  /**
   * Responde o que dá das perguntas obrigatórias que ficaram em branco (Sim/Não,
   * listas e números): é o que evita desistir da vaga por causa de uma etapa a
   * mais. Devolve os rótulos respondidos, para entrarem no relatório.
   */
  async function fillPendingFields(dialog, cfg) {
    const prefs = answerPrefs(cfg);
    const filled = [];
    const seen = new Set();

    if (!dialog || (cfg && cfg.fillRequired === false)) return filled;

    let fields = [];
    try {
      fields = Array.from(dialog.querySelectorAll('input, select, textarea'));
    } catch (error) {
      return filled;
    }

    for (const field of fields) {
      const question = fieldLabel(field);
      const type = String(field.type || '').toLowerCase();
      const tag = String(field.tagName || '').toLowerCase();

      if (type === 'checkbox') continue; // marcar por conta própria é arriscado

      if (type === 'radio') {
        const key = field.name || question || 'radio';
        if (seen.has(key)) continue;
        seen.add(key);

        const answer = answerRadio(radioGroup(dialog, field), prefs, question);
        if (answer) filled.push(answer);
        continue;
      }

      if (tag === 'select') {
        const answer = answerSelect(field, prefs, question);
        if (answer) filled.push(answer);
        continue;
      }

      const answer = answerText(field, prefs, question);
      if (answer) filled.push(answer);
    }

    if (filled.length) {
      // Espera o LinkedIn reagir ao que respondemos (reabilitar o botão):
      // a tela fica quieta quando terminou; o prazo antigo vira teto.
      const deadline = Date.now() + CONFIG.applyModalPollMs * 3;

      while (Date.now() < deadline) {
        if (await waitForQuiet(Math.min(CONFIG.applyQuietMs, deadline - Date.now()))) break;
      }
    }

    return filled;
  }

  /** Fecha o modal (descartando o formulário) para não deixar lixo na tela. */
  async function closeModal(modal, discard) {
    if (modal && document.contains(modal)) {
      const button =
        (discard && queryFirst(APPLY_SEL.discard, modal)) ||
        queryFirst(APPLY_SEL.discard, modal) ||
        popupCloseButton(modal) ||
        queryFirst(APPLY_SEL.dismiss, modal);

      if (button) {
        humanClick(button);
        await humanPause(CONFIG.applyStepDelayMs);

        // O LinkedIn pede confirmação antes de descartar ("Descartar candidatura?").
        const confirm = queryFirst(APPLY_SEL.discard);
        if (confirm && confirm !== button && isVisible(confirm)) {
          humanClick(confirm);
          await humanPause(CONFIG.applyStepDelayMs);
        }
      }

      if (document.contains(modal)) {
        const dismiss =
          popupCloseButton(modal) ||
          queryFirst(APPLY_SEL.dismiss, modal) ||
          queryFirst(APPLY_SEL.dismiss);

        if (dismiss) {
          humanClick(dismiss);
          await humanPause(CONFIG.applyStepDelayMs);
        }
      }
    }

    // Um descarte que falhou deixa o modal na frente da lista: limpamos tudo.
    await clearPopups(null, CONFIG.popupWaitMs * 2);
  }

  /**
   * Fecha o que ficou aberto de uma vaga anterior: um formulário descartado que
   * não saiu da tela (o LinkedIn às vezes engasga no descarte) ou popups
   * sobrantes. Sem isso, a próxima vaga trabalharia no formulário errado.
   *
   * É aqui também que o pós-envio termina: com a tela limpa para a próxima vaga,
   * o guard pode descansar. Quando a página é sua e nem chegamos a limpar (ver o
   * `processCard`), o pós-envio continua de pé — é o guard, de olho nas mutações,
   * que fecha o popup atrasado assim que ele entra na tela.
   */
  async function closeStaleForm(budgetMs) {
    const modal = findModal();

    if (modal) {
      await closeModal(modal, true); // o closeModal já limpa os popups no fim
      state.posEnvio = false;
      return;
    }

    await clearPopups(null, Number(budgetMs) || CONFIG.popupWaitMs * 2);
    state.posEnvio = false;
  }

  /**
   * Depois do envio: fecha a confirmação e mais qualquer popup que o LinkedIn
   * jogue na tela (pesquisa de avaliação, "salvar vaga", "seguir empresa"…).
   * Sem isso, o overlay fica na frente da lista e a varredura empaca.
   *
   * O pós-envio fica de pé **depois** daqui (ver `state.posEnvio`): o popup de
   * avaliação costuma chegar segundos depois do envio, e quem o pega no instante
   * em que ele entra na tela é o guard do MutationObserver.
   */
  async function dismissAfterApply(modal) {
    state.posEnvio = true;

    if (modal && document.contains(modal) && looksSubmitted(modal)) {
      const done = popupCloseButton(modal);

      if (done) {
        humanClick(done);
        await waitUntil(
          () => !document.contains(modal) || !isVisible(modal),
          CONFIG.popupWaitMs,
          CONFIG.popupPollMs
        );
      }
    }

    await clearPopups(null, CONFIG.popupBudgetMs);

    // O popup de avaliação/pesquisa às vezes só chega depois do envio (vem do
    // servidor). Em vez de dormir um tempo fixo, esperamos o sinal da tela: se
    // ele chegar em 300 ms, fechamos em 300 ms.
    await waitUntil(() => findPopup(null), CONFIG.popupLateMs, CONFIG.popupPollMs);
    await clearPopups(null, CONFIG.popupBudgetMs);
  }

  /**
   * Preenche e envia a candidatura simplificada da vaga aberta no painel.
   * Devolve { status, missing?, filled?, steps?, error? }, com estes status:
   *   enviada   → candidatura confirmada pelo LinkedIn;
   *   externa   → botão manda para um site de fora: pulada, sem clique;
   *   desconhecida → o botão não se parece com a Candidatura Simplificada:
   *               também pulada, sem clique (tentamos de novo mais tarde);
   *   sem_botao → a vaga não tem botão de candidatura;
   *   sem_modal → clicou e o formulário não abriu;
   *   travada   → parou numa pergunta obrigatória que não deu para responder
   *               (`missing` traz os rótulos pendentes, `filled` o respondido);
   *   incompleta→ estourou o tempo/etapas do formulário (`steps` diz onde parou);
   *   cancelada → o usuário pediu para parar no meio;
   *   bloqueio  → o LinkedIn sinalizou limite de uso/verificação (`error`).
   *
   * O fluxo é "espera ativa": em vez de dormir um tempo fixo (que quebra com
   * internet lenta), esperamos a etapa carregar de verdade, fechamos os popups
   * que o LinkedIn joga por cima e respondemos as perguntas obrigatórias.
   */
  async function applyToJob(jobId) {
    // O guard de popup precisa saber qual dialog é o formulário. A vaga começa
    // sem nenhum identificado: até o modal abrir o guard fica quieto, para não
    // confundir um dialog que ainda está carregando com popup.
    clearInterruptTimer(); // nada de guard atrasado de uma vaga anterior
    state.keepDialog = null;
    state.posEnvio = false;
    state.abrirFormulario = false;

    try {
      // `continuar` = você respondeu os campos na janelinha e a extensão seguiu
      // sozinha. Se, ao reavaliar, ainda falta algo, o fluxo já devolve o
      // desfecho honesto (enviada/incompleta/…); o limite de reentradas evita
      // um laço infinito caso o LinkedIn continue recusando.
      let resultado = await runApplyFlow(jobId);
      let reentradas = 0;

      while (resultado && resultado.status === 'continuar' && reentradas < 2 && !state.abort) {
        reentradas += 1;
        resultado = await runApplyFlow(jobId);
      }

      // Ainda "continuar" depois das reentradas: não conseguimos enviar sozinho.
      // Registramos como travada (sem gastar cota) com o que faltou.
      if (resultado && resultado.status === 'continuar') {
        return { status: 'travada', missing: resultado.missing, filled: resultado.filled, steps: resultado.steps };
      }

      return resultado;
    } finally {
      // O ponteiro morre com a vaga (o formulário pode ter sido descartado ou
      // trocado pelo LinkedIn), mas o guard **não sai de serviço**: se a
      // candidatura saiu, o pós-envio continua de pé até a tela ser limpa para a
      // próxima vaga, e é ele que fecha o popup atrasado que ainda vai aparecer.
      // Fora do formulário (entre uma etapa e outra) quem manda é o `posEnvio`.
      state.keepDialog = null;
      state.abrirFormulario = false;
    }
  }

  async function runApplyFlow(jobId) {
    // Antes de qualquer coisa: será que a página está avisando de limite?
    const blockedBefore = detectRateLimit();
    if (blockedBefore) return { status: 'bloqueio', error: blockedBefore };

    // Popup sobrando da vaga anterior? Sai da frente antes de qualquer clique.
    await closeStaleForm(CONFIG.popupBudgetMs);

    const button = findApplyButton();

    if (!button) return { status: 'sem_botao' };

    // Vaga que sai do LinkedIn (site da empresa)? Não clicamos: só registramos o
    // motivo, para nunca levar a sua aba para fora.
    const kind = await resolveApplyKind(button);
    if (kind !== SHARED.APPLY_KINDS.easy) {
      return { status: kind === SHARED.APPLY_KINDS.external ? 'externa' : 'desconhecida', detail: applyDetail(button, kind) };
    }

    await humanPause(CONFIG.applyPreClickMs); // respira antes de abrir o formulário

    // Daqui até o formulário estar na tela, o guard fica quieto: o dialog que
    // entrar agora pode ser a nossa própria candidatura carregando, e fechá-la
    // seria perdê-la. (Depois disso quem manda é o `keepDialog`/`posEnvio`.)
    state.abrirFormulario = true;

    let modal = null;

    try {
      humanClick(button);
      modal = await waitForModal(CONFIG.applyModalTimeoutMs);

      // Internet lenta: o formulário pode demorar, ou um popup rouba a vez. Nesse
      // caso limpamos a tela e damos mais uma rodada de espera.
      if (!modal) {
        await clearPopups(null, CONFIG.popupWaitMs * 2);
        modal = await waitForModal(CONFIG.applyModalTimeoutMs);
      }
    } finally {
      state.abrirFormulario = false;
    }

    if (!modal) return { status: 'sem_modal' };

    // A partir daqui o formulário está identificado: é ele que o guard protege
    // enquanto fecha, na hora, qualquer popup que entrar na tela.
    state.keepDialog = modal;

    const settings = state.settings || (await getSettings());
    const cfg = settings.apply || DEFAULT_APPLY;

    await waitForSettle(modal, CONFIG.applySettleMs);

    const deadline = Date.now() + CONFIG.applyFlowTimeoutMs;
    let steps = 0;
    let filled = [];
    let stalled = 0;
    let etapa = ''; // assinatura da etapa atual (sem as mensagens de erro)
    let tentativas = 0; // cliques em "Avançar" que não mudaram de etapa

    while (Date.now() < deadline && steps < CONFIG.applyMaxSteps) {
      // Antes do abort: se a varredura parou foi porque o LinkedIn sinalizou algo
      // (o guard que viu o aviso de limite chama o `tripGuard`), e o desfecho
      // honesto é `bloqueio` — não um "você pediu para parar" que não houve.
      const blocked = detectRateLimit();
      if (blocked) {
        await closeModal(modal, true);
        return { status: 'bloqueio', error: blocked, steps };
      }

      if (state.abort) {
        await closeModal(modal, true);
        return { status: 'cancelada', steps };
      }

      // A candidatura já está enviada? (o modal fechou ou mostra a confirmação)
      if (!document.contains(modal) || looksSubmitted(modal)) {
        await dismissAfterApply(modal);
        return { status: 'enviada', filled, steps };
      }

      // O dialog mudou de cara sem confirmação (o LinkedIn re-renderiza bastante
      // ao enviar): esperamos o aviso de envio chegar antes de dar a vaga por
      // candidatada — melhor tentar de novo do que contar uma candidatura a mais.
      if (!isApplyForm(modal)) {
        const confirmed = await waitForConfirmation(modal, CONFIG.applySubmitWaitMs);

        await dismissAfterApply(modal);

        if (confirmed) return { status: 'enviada', filled, steps };

        return { status: 'incompleta', missing: describeBlocker(modal), filled, steps };
      }

      // O LinkedIn às vezes troca o nó do dialog entre etapas: o guard precisa
      // continuar apontando para o formulário que está na tela agora.
      if (state.keepDialog !== modal) state.keepDialog = modal;

      // Popup de pesquisa/aviso por cima do formulário: fechamos e seguimos.
      if (findPopup(modal)) {
        // Se o guard já está fechando um deles, não clicamos no mesmo botão
        // duas vezes: damos a vez a ele e conferimos de novo em seguida.
        if (state.interruptBusy) {
          await waitUntil(() => !state.interruptBusy, CONFIG.popupWaitMs, CONFIG.popupPollMs);
        }

        const closed = await clearPopups(modal, CONFIG.popupBudgetMs);

        if (!closed) {
          // Popup teimoso na frente do formulário: não dá para continuar hoje.
          const missing = describeBlocker(modal);
          await closeModal(modal, true);
          return { status: 'incompleta', missing, filled, steps };
        }

        continue;
      }

      await waitForSettle(modal, CONFIG.applySettleMs);

      // A etapa (título + campos + botões, sem as mensagens de erro) mudou desde
      // a última tentativa? Então o LinkedIn aceitou o que fizemos e a contagem
      // de tentativas desta etapa começa de novo.
      const etapaAgora = stepSignature(modal);
      if (etapaAgora && etapaAgora !== etapa) {
        etapa = etapaAgora;
        tentativas = 0;
      }

      let action = getModalAction(modal);

      // Sem botão principal: pergunta obrigatória pendente. Tentamos responder.
      if (!action) {
        filled = filled.concat(await fillPendingFields(modal, cfg));
        action = getModalAction(modal);

        if (!action) {
          // A etapa ainda pode estar carregando (internet lenta): esperamos o
          // botão aparecer na tela em vez de dormir um tempo fixo.
          action = await waitUntil(() => getModalAction(modal), CONFIG.applyStepWaitMs);
          await clearPopups(modal, CONFIG.popupWaitMs);
        }

        if (!action) {
          const missing = describeBlocker(modal).concat(invalidFields(modal));

          // (TEMPORÁRIO) A etapa não oferece botão nenhum: normalmente é um campo
          // que não sabemos responder (ou um que o LinkedIn recusou). Antes de
          // descartar, perguntamos se você quer assumir esta vaga à mão.
          const ajuda = await resolverComAjuda(
            modal,
            ajudaContexto(
              jobId,
              'campos',
              missing.slice(0, 3).join(', '),
              await camposTravadosCompletos(modal)
            )
          );

          // Você respondeu na janelinha: os campos já foram preenchidos, então
          // voltamos ao topo do laço para reavaliar a etapa (agora deve haver
          // botão) em vez de encerrar a candidatura aqui.
          if (ajuda && ajuda.status === 'continuar') {
            tentativas = 0;
            stalled = 0;
            continue;
          }

          if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

          await closeModal(modal, true);
          return { status: 'travada', missing, filled, steps };
        }
      }

      // O "Avançar" anterior não saiu do lugar? Então esta etapa tem um campo que
      // ainda está sem resposta. Tentamos responder o que dá e, se sobrar campo
      // em branco, pedimos ajuda na área de trabalho — em vez de martelar o botão
      // até estourar o limite de etapas (era assim que a vaga era descartada
      // sozinha, sem aviso e sem chance de preencher).
      //
      // Quem diz o que falta é o `camposTravados`: ele olha primeiro o que o
      // LinkedIn marcou como recusado e, se nada veio marcado (as classes mudam),
      // varre o formulário procurando o que um humano veria em branco — um campo
      // sem valor, um select sem escolha, um rádio sem marcação. Antes daqui só
      // o `invalidFields` valia: quando o LinkedIn não marcava o campo, o aviso
      // nunca aparecia e a vaga era pulada em silêncio.
      if (tentativas > 0) {
        filled = filled.concat(await fillPendingFields(modal, cfg));

        const pendentes = await camposTravadosCompletos(modal);

        if (pendentes.length) {
          const missing = describeBlocker(modal).concat(invalidFields(modal));
          const ajuda = await resolverComAjuda(
            modal,
            ajudaContexto(jobId, 'campos', missing.slice(0, 3).join(', '), pendentes)
          );

          // Você respondeu na janelinha: campos preenchidos, então voltamos ao
          // topo do laço para reavaliar a etapa (e seguir para o "Avançar").
          if (ajuda && ajuda.status === 'continuar') {
            tentativas = 0;
            stalled = 0;
            continue;
          }

          if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

          await closeModal(modal, true);
          return { status: 'travada', missing, filled, steps };
        }
      }

      const before = scopeSignature(modal);
      humanClick(action.button);
      steps += 1;

      const changed = await waitForStepChange(modal, before, CONFIG.applyStepWaitMs);

      // Continuamos na mesma etapa? A tela pode ter mudado só por causa da
      // mensagem de erro (o que engana o `changed`): quem manda aqui é a
      // assinatura da etapa.
      if (stepSignature(modal) === etapa) tentativas += 1;

      if (action.kind === 'submit') {
        // É o envio: esperamos a confirmação do LinkedIn aparecer (mesmo devagar).
        const sent = await waitForSubmit(modal, CONFIG.applySubmitWaitMs);

        if (sent) {
          await dismissAfterApply(modal);
          return { status: 'enviada', filled, steps };
        }

        // (TEMPORÁRIO) Não confirmou dentro do tempo — e o LinkedIn pode ter
        // recusado um campo personalizado. Antes de descartar, perguntamos se você
        // quer preencher esta vaga à mão (ou pular para a próxima).
        const invalidos = invalidFields(modal);
        const missing = describeBlocker(modal).concat(invalidos);
        const ajuda = await resolverComAjuda(
          modal,
          ajudaContexto(
            jobId,
            invalidos.length ? 'campos' : 'demora',
            missing.slice(0, 3).join(', '),
            await camposTravadosCompletos(modal)
          )
        );

        // Você respondeu na janelinha: preenchemos e voltamos ao topo do laço —
        // agora o botão de envio deve funcionar (ou a confirmação já chegou).
        if (ajuda && ajuda.status === 'continuar') {
          tentativas = 0;
          stalled = 0;
          continue;
        }

        if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

        await dismissAfterApply(modal);

        // Sem aviso: fica para a próxima passada, sem contar como candidatura
        // enviada.
        return { status: 'incompleta', missing, filled, steps };
      }

      // O clique não mexeu na tela? Damos mais uma chance antes de desistir —
      // normalmente é o botão que estava desabilitado na hora exata do clique.
      if (!changed) {
        stalled += 1;

        if (stalled >= 2) {
          const invalidos = invalidFields(modal);
          const missing = describeBlocker(modal).concat(invalidos);

          // (TEMPORÁRIO) O clique não mexeu na tela: pode ser um campo que o
          // LinkedIn recusou. Antes de desistir, perguntamos se você quer assumir
          // esta vaga à mão.
          const ajuda = await resolverComAjuda(
            modal,
            ajudaContexto(
              jobId,
              'campos',
              missing.slice(0, 3).join(', '),
              await camposTravadosCompletos(modal)
            )
          );

          // Você respondeu na janelinha: campos preenchidos, voltamos ao topo do
          // laço para tentar o "Avançar" de novo.
          if (ajuda && ajuda.status === 'continuar') {
            tentativas = 0;
            stalled = 0;
            continue;
          }

          if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

          await closeModal(modal, true);
          return { status: 'incompleta', missing, filled, steps };
        }
      } else {
        stalled = 0;
      }
    }

    // Estourou o limite de etapas/tempo com campo ainda sem resposta na tela:
    // antes de descartar, avisamos na área de trabalho — quem decide é você, não
    // a contagem de etapas. O `camposTravados` pega tanto o campo que o LinkedIn
    // recusou quanto o que ficou em branco sem ele marcar.
    const pendentesNoFim = document.contains(modal) ? await camposTravadosCompletos(modal) : [];
    const missing = describeBlocker(modal).concat(invalidFields(modal));

    if (pendentesNoFim.length) {
      const ajuda = await resolverComAjuda(
        modal,
        ajudaContexto(jobId, 'campos', missing.slice(0, 3).join(', '), pendentesNoFim)
      );

      // Você respondeu na janelinha: os campos foram preenchidos. Devolvemos
      // `continuar` e a varredura revisita a vaga para tentar enviar (não
      // gastamos cota com um retrato de "travada" que já dá para resolver).
      if (ajuda && ajuda.status === 'continuar') {
        return { status: 'continuar', missing, filled, steps };
      }

      if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);
    }

    await closeModal(modal, true);
    return { status: 'incompleta', missing, filled, steps };
  }

  /** Conta a candidatura no termo e grava a fila (sobrevive a reloads). */
  async function bumpApplied() {
    if (!state.run) return;

    const next = Object.assign({}, state.run, {
      appliedInTerm: (state.run.appliedInTerm || 0) + 1,
      appliedTotal: (state.run.appliedTotal || 0) + 1,
    });

    state.run = next;
    await saveRun(next);
  }

  /**
   * Contador da pausa longa. Vive na fila (e não só na memória) porque cada
   * termo é uma navegação nova: sem isso o ritmo humano nunca "cansaria".
   */
  function setSinceBreak(value) {
    state.sinceBreak = Math.max(0, Number(value) || 0);

    if (state.run && state.run.running) {
      state.run = Object.assign({}, state.run, { sinceBreak: state.sinceBreak });
      scheduleRunPersist();
    }

    return state.sinceBreak;
  }

  /**
   * Motivo legível da não candidatura — é o texto que vai para o relatório.
   * Junta o motivo padrão do desfecho com os detalhes que só a página sabe
   * (campos que faltaram, etapa em que travou…).
   */
  function applyReasonText(result) {
    const outcome = APPLY_OUTCOMES[result.status] || {};
    const parts = [];

    if (outcome.reason) parts.push(outcome.reason);

    if (result.status === 'incompleta' && result.steps) {
      parts.push('Parou na etapa ' + result.steps + ' de ' + CONFIG.applyMaxSteps + '.');
    }

    if (result.missing && result.missing.length) {
      parts.push('Campos não preenchidos: ' + result.missing.slice(0, 3).join(', ') + '.');
    }

    // O que a extensão respondeu sozinha nas perguntas do formulário.
    if (result.filled && result.filled.length) {
      parts.push('Respondi sozinho: ' + result.filled.slice(0, 3).join(', ') + '.');
    }

    if (result.error) parts.push('Detalhe: ' + String(result.error).slice(0, 160) + '.');

    // Detalhes lidos na própria página (ex.: para onde o botão externo aponta).
    if (result.detail) parts.push(result.detail);

    return parts.join(' ').trim();
  }

  /**
   * Marca a vaga como "não candidatada (ainda)", com o motivo, sem gastar
   * tentativa: a próxima passada tenta de novo. Os dados do card (título,
   * empresa, link) entram junto, para a linha do relatório fazer sentido.
   */
  function markPending(id, reason, card) {
    const job = state.jobs[id] || {};
    if (job.appliedAt) return;

    const meta = card ? readCardMeta(card) : {};

    upsertJob(
      id,
      Object.assign(meta, {
        applyStatus: APPLY_PENDING,
        applyReason: reason || '',
        applyAttempts: job.applyAttempts || 0,
      })
    );
  }

  /** Guarda o resultado na vaga e, se enviou, lança na cota. */
  async function recordApplyResult(id, result) {
    const current = state.jobs[id] || {};
    const now = new Date().toISOString();

    /* Só status que DECIDEM a vaga gastam tentativa: finais (enviada, manual,
     * pulada, externa) e os que pedem você (travada, incompleta — precisam da
     * janelinha). Status transitórios de página/lista (sem_botao, sem_modal,
     * sem clique porque você estava usando o navegador…) NÃO gastam: duas
     * passadas com o formulário lento matavam a vaga para sempre, e ela nunca
     * tinha sido nem tentada. */
    const gastatentativa =
      result.status === 'enviada' ||
      result.status === 'manual' ||
      result.status === 'pulada' ||
      result.status === 'externa' ||
      result.status === 'travada' ||
      result.status === 'incompleta' ||
      // Uma falha inesperada na vaga conta tentativa: sem isso, uma vaga que
      // quebra sempre seria retentada a cada passada, para sempre.
      result.status === 'erro';

    const attempts = gastatentativa
      ? Math.min(CONFIG.applyMaxAttempts, (current.applyAttempts || 0) + 1)
      : current.applyAttempts || 0;

    const patch = {
      applyStatus: result.status,
      applyAttempts: attempts,
      applyReason: applyReasonText(result),
      applyTriedAt: now,
    };

    if (result.status === 'enviada') {
      patch.appliedAt = now;
      state.apps.push(Date.now());
      setSinceBreak(state.sinceBreak + 1);
      await persistApps();
      await bumpApplied();
    } else if (result.status === 'externa') {
      // Vaga fora do LinkedIn: não é para nós nem vale gastar outra tentativa —
      // ela nunca mais é visitada (e não consome cota nenhuma).
      patch.applyAttempts = CONFIG.applyMaxAttempts;
    } else if (result.status === 'manual' || result.status === 'pulada') {
      // (TEMPORÁRIO) Vaga que você assumiu (preencher à mão) ou mandou pular: o
      // PegaVaga sai do caminho e nunca mais mexe nela. Sai com o pedido de ajuda.
      patch.applyAttempts = CONFIG.applyMaxAttempts;
    }

    upsertJob(id, patch);

    // Quem foi candidatado não guarda motivo antigo (de uma tentativa anterior).
    if (result.status === 'enviada' && state.jobs[id]) {
      state.jobs[id].applyReason = '';
      schedulePersist();
    }

    broadcastProgress();
  }

  /* ------------------------------------------------------------------------ */
  /* Fila de termos (orquestrada pelo pop-up, pelo agendador ou por retomada)  */
  /* ------------------------------------------------------------------------ */

  /** Lê a fila atual do storage. */
  async function getRun() {
    try {
      const data = await chrome.storage.local.get(STORAGE_RUN_KEY);
      return data[STORAGE_RUN_KEY] || null;
    } catch (error) {
      return null;
    }
  }

  function saveRun(run) {
    return chrome.storage.local.set({ [STORAGE_RUN_KEY]: run }).catch(() => {});
  }

  function clearRun() {
    state.run = null;
    clearResumeTimer();
    return chrome.storage.local.remove(STORAGE_RUN_KEY).catch(() => {});
  }

  function clearResumeTimer() {
    if (state.resumeTimer) clearTimeout(state.resumeTimer);
    state.resumeTimer = null;
  }

  /** A página atual serve para varredura? (evita login/authwall/checkpoint) */
  function isUsablePage() {
    return (
      /\/jobs/.test(location.pathname) &&
      !/\/login|\/authwall|\/checkpoint|\/uas\//.test(location.pathname)
    );
  }

  /** Espera os cards aparecerem (o LinkedIn monta a lista de forma assíncrona). */
  async function waitForList(timeoutMs) {
    const cards = await waitUntil(
      () => {
        if (state.abort) return 'abortado';
        return getCards().length ? getCards() : null;
      },
      Number(timeoutMs) || CONFIG.waitListTimeoutMs,
      CONFIG.waitListPollMs
    );

    return Array.isArray(cards) && cards.length > 0;
  }

  /**
   * Retoma uma fila deixada pelo pop-up. É chamado no load da página, para a
   * varredura continuar sozinha depois de cada navegação (uma por termo).
   */
  async function resumeRun() {
    const run = await getRun();

    if (!run || run.running !== true) return false;

    if (!isUsablePage()) {
      await clearRun(); // caímos em login/checkpoint: encerra a fila
      return false;
    }

    state.run = run;
    state.sinceBreak = Math.max(0, Number(run.sinceBreak) || 0);
    broadcastProgress();
    return true;
  }

  /**
   * Dá para RECARREGAR a página (trocar de termo) AGORA?
   *
   * Não, se houver formulário de candidatura aberto na tela: navegar por cima dele
   * perde o que estava preenchido — e, se o formulário é SEU (o "vou preencher à
   * mão"), perde o que você digitou. Era esse o recarregamento no meio do fluxo.
   * Também não, se você estiver mexendo na página (`userBusy`).
   */
  function podeRecarregar() {
    if (state.userBusy) return false;

    const modal = queryFirst(APPLY_SEL.dialog);
    if (modal && isVisible(modal)) return false;

    return true;
  }

  /** Espera o formulário fechar (ou você parar de mexer) para poder navegar. */
  async function esperarPoderRecarregar(limiteMs) {
    const fim = Date.now() + (limiteMs || CONFIG.userBusyPauseMs);

    while (Date.now() < fim) {
      if (podeRecarregar()) return true;
      await humanPause(CONFIG.applyModalPollMs);
    }

    return false;
  }

  /**
   * Avança para o próximo termo da fila (ou encerra). O storage é a fonte da
   * verdade: se o pop-up removeu a fila (botão Parar), paramos aqui mesmo.
   *
   * `motivo` é o `stop` da varredura ('' = a lista acabou). É o que explica no
   * console POR QUE a página vai ser recarregada: troca de termo, ou o cap do
   * termo batido.
   */
  async function advanceRun(motivo) {
    /* Formulário aberto: a troca de termo ESPERA. Recarregar por cima de um
     * formulário em preenchimento era o "recarrega a página no meio do fluxo" —
     * e o LinkedIn nem sempre avisa antes. A fila fica como está (nada foi
     * gravado ainda), então nada se perde: quando o modal fechar, a troca de termo
     * acontece (e, se não fechar, ela fica para a próxima passada). */
    if (!podeRecarregar()) {
      console.log(
        '[PegaVaga] formulario aberto: a troca de termo espera o formulario fechar (a fila esta salva).'
      );

      esperarPoderRecarregar().then((liberou) => {
        if (liberou && !state.scanning) {
          advanceRun(motivo).catch(() => {});
          return;
        }

        console.log(
          '[PegaVaga] o formulario continuou aberto: a troca de termo fica para a proxima passada.'
        );
      });

      return;
    }

    const run = await getRun();

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const urls = Array.isArray(run.urls) ? run.urls : [''];
    const nextIndex = (run.index || 0) + 1;

    if (nextIndex >= urls.length) {
      console.log(
        '[PegaVaga] fila encerrada (' +
          (motivo ? 'motivo: ' + motivo : 'fim da lista') +
          '): nao ha proximo termo.'
      );
      await clearRun();
      broadcastProgress();
      return;
    }

    console.log(
      '[PegaVaga] termo encerrado (' +
        (motivo ? 'motivo: ' + motivo : 'fim da lista') +
        '): indo para o termo ' +
        (nextIndex + 1) +
        '/' +
        urls.length +
        '.'
    );

    const nextRun = Object.assign({}, run, {
      index: nextIndex,
      term: (run.terms && run.terms[nextIndex]) || '',
      appliedInTerm: 0, // as cotas por termo zeram a cada termo
      visitedInTerm: 0,
      paused: false,
      resumeAt: null,
    });

    state.run = nextRun;
    await saveRun(nextRun);
    broadcastProgress();

    const nextUrl = urls[nextIndex];

    if (nextUrl && nextUrl !== location.href) {
      console.log('[PegaVaga] recarregando a pagina para o proximo termo:', nextUrl);
      location.assign(nextUrl); // recarrega a página; a fila é retomada no load
    } else {
      console.log('[PegaVaga] mesmo termo/URL: recomecando a varredura por aqui.');
      startScan(); // mesma URL: apenas recomeça a varredura por aqui
    }
  }

  /**
   * A página abriu a lista de vagas? Separa "a busca não achou nada" (a lista
   * está lá, só vazia — segue o jogo normalmente) de "isto nem parece a página de
   * vagas" (login, verificação de segurança, aba errada). Só o segundo caso
   * merece a luz vermelha de atenção no ícone.
   */
  function scanProblem() {
    if (getCards().length) return null;
    if (queryFirst(SEL.list) || queryFirst(SEL.detailsRoot)) return null;

    return 'Não encontrei a lista de vagas nesta página.';
  }

  /**
   * Marca (ou limpa, com `null`) o problema da varredura atual. Fica gravado na
   * fila e é o que acende a luz vermelha do ícone da extensão. A fila não para
   * por causa disso: o problema pode ser só desta página/termo.
   */
  async function setRunProblem(text) {
    const run = state.run;
    const problem = text || null;

    if (!run || run.running !== true) return;
    if ((run.problem || null) === problem) return;

    const next = Object.assign({}, run, { problem });
    state.run = next;
    await saveRun(next);
    broadcastProgress();
  }

  /* ------------------------------------------------------------------------ */
  /* Pausa e retomada dinâmica (cotas e janela do agendador)                   */
  /* ------------------------------------------------------------------------ */

  /** A janela do agendador está aberta? Se não, quando ela abre? */
  function windowState() {
    const schedule = (state.settings || parseSettings(null)).schedule;

    if (!schedule.enabled) return { open: true, resumeAt: null, reason: 'schedule' };
    if (isWithinSchedule(new Date(), schedule)) return { open: true, resumeAt: null, reason: 'schedule' };

    const next = nextScheduleStart(new Date(), schedule);
    return { open: false, resumeAt: next ? next.getTime() : null, reason: 'schedule' };
  }

  /**
   * Podemos rodar agora? Considera o período de descanso imposto pela proteção da
   * conta (quando o LinkedIn sinaliza limite de uso) e a janela do agendador — mas
   * a janela só vale para a fila que o próprio agendador montou: uma varredura
   * iniciada à mão roda a qualquer hora.
   */
  function gateState() {
    const guard = guardUntil();
    if (guard) return { open: false, resumeAt: guard, reason: 'guard' };

    // Filas do pop-up não têm `source`: são do usuário.
    if (!filaAutomatica(state.run)) return { open: true, resumeAt: null, reason: 'schedule' };

    return windowState();
  }

  /**
   * Mantém a fila viva, porém pausada, até o horário liberar (cota estourada,
   * janela do agendador fechada, descanso de proteção ou vez do usuário). O
   * service worker também cutuca a aba nesse horário, então a retomada acontece
   * mesmo se esta página for recarregada.
   */
  async function pauseRunUntil(resumeAt, reason) {
    const run = await getRun();
    const when =
      Number.isFinite(resumeAt) && resumeAt > Date.now() ? resumeAt : Date.now() + 60000;

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const next = Object.assign({}, run, {
      paused: true,
      resumeAt: when,
      pauseReason: reason || 'cota',
    });

    state.run = next;
    await saveRun(next);
    broadcastProgress();

    scheduleResume(when);
  }

  function scheduleResume(atMs) {
    clearResumeTimer();

    const delay = Math.max(1000, Math.min(atMs - Date.now(), CONFIG.resumeTimerCapMs));
    state.resumeTimer = setTimeout(() => {
      resumeNow().catch(() => {});
    }, delay);
  }

  /** Retoma a fila pausada (timer local ou pedido do agendador). */
  async function resumeNow() {
    clearResumeTimer();

    const run = await getRun();

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const next = Object.assign({}, run, {
      paused: false,
      resumeAt: null,
      pauseReason: null,
    });

    state.run = next;
    await saveRun(next);
    broadcastProgress();

    await waitForList(CONFIG.waitListTimeoutMs);
    await startScan();
  }

  /* ------------------------------------------------------------------------ */
  /* Varredura (loop principal)                                                */
  /* ------------------------------------------------------------------------ */

  /** Persiste a fila com debounce (não vale gravar a cada vaga visitada). */
  const scheduleRunPersist = debounce(() => {
    if (state.run && state.run.running) saveRun(state.run);
  }, 2000);

  /** Conta a vaga visitada neste termo. */
  function bumpVisited() {
    if (!state.run) return;

    state.run = Object.assign({}, state.run, {
      visitedInTerm: (state.run.visitedInTerm || 0) + 1,
    });

    scheduleRunPersist();
  }

  /** A vaga ainda precisa de trabalho? (falta descrição ou candidatura) */
  function needsWork(id, settings) {
    const job = state.jobs[id] || {};

    if (!job.description) return true;
    if (!settings.apply.enabled) return false;
    if (job.appliedAt) return false;
    // Vaga que sai do LinkedIn: já sabemos o desfecho, não voltamos nela.
    if (job.applyStatus === 'externa') return false;

    return (job.applyAttempts || 0) < CONFIG.applyMaxAttempts;
  }

  /**
   * Motivos usados no relatório quando a vaga fica sem candidatura porque a
   * varredura parou antes de chegar nela.
   */
  const STOP_REASONS = {
    quota: 'A cota de candidaturas estourou; esta vaga ficou para a próxima passada.',
    term_done: 'A cota de candidaturas deste termo acabou; esta vaga ficou para a próxima passada.',
    scan_cap: 'A varredura deste termo atingiu o teto de vagas; esta vaga ficou para a próxima passada.',
    usuario: 'Você estava usando o navegador; a vaga ficou para a próxima passada.',
  };

  /** Por que paramos o termo atual (ou null para continuar varrendo). */
  function stopReason(settings) {
    const run = state.run || {};
    const visited = run.visitedInTerm || 0;
    const applied = run.appliedInTerm || 0;

    if (!settings.apply.enabled) {
      return visited >= CONFIG.maxJobVisitsPerRun ? 'scan_cap' : null;
    }

    if (visited >= settings.apply.scanPerTerm) return 'scan_cap';
    if (applied >= settings.apply.perTerm) return 'term_done';
    if (!quotaNow().ok) return 'quota';

    return null;
  }

  /**
   * A vaga aberta no painel é candidatável aqui no LinkedIn? Se não for (o botão
   * manda para o site da empresa, ou não é a Candidatura Simplificada), registra
   * o motivo na vaga e devolve `true`: a varredura pula para a próxima sem
   * clicar em nada. Devolve `false` quando é para seguir com a candidatura.
   */
  async function skipIfOffsite(id) {
    const button = findApplyButton();
    if (!button) return false; // sem botão: o fluxo normal decide o desfecho

    const kind = await resolveApplyKind(button);
    if (kind === SHARED.APPLY_KINDS.easy) return false;

    const status = kind === SHARED.APPLY_KINDS.external ? 'externa' : 'desconhecida';
    await recordApplyResult(id, { status, detail: applyDetail(button, kind) });

    return true;
  }

  /**
   * Visita a vaga: captura a descrição e, se a cota permitir, candidata-se.
   *
   * O corpo vive no `visitarVaga` de propósito: uma falha em UMA vaga não pode
   * derrubar a varredura — sem isso, a exceção subia até o `finally` do
   * `startScan`, que a lia como fim de termo e **recarregava a página** no meio da
   * lista. Aqui a falha fica registrada na vaga e a varredura segue para a próxima.
   */
  async function processCard(card, id, settings) {
    try {
      await visitarVaga(card, id, settings);
    } catch (erro) {
      console.error('[PegaVaga] falha ao processar a vaga ' + id + ' (seguindo):', erro);

      try {
        await recordApplyResult(id, {
          status: 'erro',
          error: String((erro && erro.message) || erro),
        });
      } catch (erroAoRegistrar) {
        /* registrar é cortesia: o que importa é não derrubar a varredura */
      }
    }
  }

  /** O corpo do `processCard` (isolado para a falha de UMA vaga não parar tudo). */
  async function visitarVaga(card, id, settings) {
    // Formulário/popup de uma vaga anterior pode estar cobrindo a lista: sem
    // isso, o clique no card não abre a vaga. Só mexemos na página se ela
    // estiver livre — a sua vez vem antes de tudo. Quando não está, o guard
    // continua de serviço no pós-envio: o popup que o LinkedIn mandar depois é
    // fechado no instante em que entra na tela (ver `state.posEnvio`).
    if (userIsIdle(settings)) await closeStaleForm();

    bumpVisited();
    await captureForCard(card, id);
    await humanPause(CONFIG.clickDelayMs);

    if (state.abort || !settings.apply.enabled) return;

    const job = state.jobs[id] || {};
    if (job.appliedAt) return;
    if ((job.applyAttempts || 0) >= CONFIG.applyMaxAttempts) return;
    if (!quotaNow().ok) return;

    // Você está usando a página agora? Então esperamos (sem roubar o seu clique).
    if (!(await waitForUserIdle(settings))) {
      markPending(id, STOP_REASONS.usuario, card);
      state.userBusy = true;
      return;
    }

    if (state.abort) return;

    // Vaga que sai do LinkedIn (site da empresa): registramos o motivo e pulamos
    // na hora — sem clique, sem pausa de leitura e sem gastar cota de candidatura.
    if (await skipIfOffsite(id)) return;

    if (state.abort) return;

    // Finge que leu a vaga antes de decidir se candidatar.
    await readingPause(settings);
    if (state.abort) return;

    // Intervalo variável entre candidaturas (evita rajada robotizada).
    await humanPause(randomDelay(settings.apply.minDelayMs, settings.apply.maxDelayMs), 0.25);
    if (state.abort) return;

    // A cada N candidaturas, uma pausa longa de verdade.
    await longBreak(settings);
    if (state.abort) return;

    // Antes de mexer em qualquer coisa: será que o LinkedIn já está barrando?
    const blocked = detectRateLimit();

    if (blocked) {
      await recordApplyResult(id, { status: 'bloqueio', error: blocked });
      await tripGuard(blocked);
      return;
    }

    const result = await applyToJob(id);
    await recordApplyResult(id, result);

    if (result.status === 'bloqueio') {
      await tripGuard(result.error);
      return;
    }

    // Candidatura enviada e, mesmo assim, aviso de limite: descansamos.
    const afterBlock = result.status === 'enviada' ? detectRateLimit() : null;

    if (afterBlock) await tripGuard(afterBlock);
  }

  async function startScan() {
    if (state.scanning) return;

    // Fora da janela do agendador (ou no descanso de proteção) a fila AUTOMÁTICA
    // não varre: ela fica parada e volta sozinha quando o horário abrir. A
    // varredura iniciada à mão não passa por aqui — ela roda a qualquer hora.
    const gate = gateState();
    if (!gate.open) {
      await pauseRunUntil(gate.resumeAt, gate.reason);
      return;
    }

    state.scanning = true;
    state.abort = false;
    state.posEnvio = false; // varredura nova: a tela ainda não tem nada nosso
    state.abrirFormulario = false; // e nenhum clique em "Candidatura Simplificada" pendente
    state.lastRun = new Date().toISOString();
    broadcastProgress();

    const settings = state.settings || (await getSettings());
    state.settings = settings;

    let stop = null; // 'quota' | 'term_done' | 'scan_cap' | 'usuario'
    let round = 0;
    let erroRegistrado = null; // exceção no meio da varredura: NÃO é fim de termo

    try {
      await loadApps();

      while (!state.abort && round <= CONFIG.maxScrollRounds) {
        for (const card of getCards()) {
          if (state.abort) break;

          // Antes de mexer na página: sinal de bloqueio do LinkedIn?
          const blocked = detectRateLimit();

          if (blocked) {
            await tripGuard(blocked);
            break;
          }

          const id = getJobId(card);
          if (!id || !needsWork(id, settings)) continue;

          stop = stopReason(settings);
          if (stop) {
            if (settings.apply.enabled) markPending(id, STOP_REASONS[stop], card);
            break;
          }

          await processCard(card, id, settings);

          // Você assumiu a página: paramos de mexer nela e descansamos um pouco.
          if (state.userBusy) {
            state.userBusy = false;
            stop = 'usuario';
            break;
          }
        }

        if (state.abort || stop) break;

        // Se você está mexendo na página agora, deixamos a rolagem em paz.
        if (!(await waitForUserIdle(settings))) {
          stop = 'usuario';
          break;
        }

        const progressed = await scrollList();

        if (!progressed) {
          /* Fim da lista — mas com CARÊNCIA.
           *
           * Depois de uma candidatura o LinkedIn REMONTA o painel: a lista fica
           * vazia por um instante e/ou o container de rolagem troca, e a rolagem
           * falha sem que o termo tenha acabado. Era assim que a varredura
           * encerrava o termo cedo e NAVEGAVA para o próximo — a página recarregava
           * logo depois de você enviar os dados no cartão.
           *
           * Então, antes de encerrar: esperamos a lista existir e tentamos rolar de
           * novo. Só encerra se falhar DE NOVO. */
          const temLista = getCards().length
            ? true
            : Boolean(await waitForList(CONFIG.waitListTimeoutMs));

          if (!temLista) {
            console.log(
              '[PegaVaga] a lista sumiu (o LinkedIn remonta o painel apos a candidatura) e nao voltou: fim do termo.'
            );
            break;
          }

          console.log(
            '[PegaVaga] a rolagem nao trouxe nada novo; vou tentar mais uma vez antes de encerrar o termo.'
          );
          const insistiu = await scrollList();
          if (!insistiu) break; // aí sim: fim da lista
        }

        round += 1;
      }
    } catch (erroNaVarredura) {
      /* Uma exceção no meio da varredura NÃO é "o termo acabou".
       *
       * Sem este catch, o `finally` abaixo tratava a queda como fim de termo e
       * chamava o `advanceRun()` — que NAVEGA para o próximo termo. Era isso que
       * recarregava a página logo depois de você enviar os dados no cartão (e o
       * log ia junto com o recarregamento, o que fazia parecer que nada tinha
       * acontecido). Agora a falha é registrada, a fila fica como está e a
       * próxima passada tenta de novo. */
      erroRegistrado = erroNaVarredura;
      console.error(
        '[PegaVaga] erro inesperado na varredura (a fila NAO avanca; a pagina nao recarrega):',
        erroNaVarredura
      );
    } finally {
      state.scanning = false;
      const aborted = state.abort;
      state.abort = false;

      // Página sem a lista de vagas: é o caso que acende a luz vermelha do ícone
      // ("precisa de atenção"). O aviso é recalculado a cada varredura, então
      // nunca fica velho — basta a próxima página carregar bem para apagar. Um
      // erro inesperado vira esse mesmo aviso (fica no storage, então sobrevive a
      // recarregamentos e aparece no pop-up).
      await setRunProblem(
        erroRegistrado
          ? 'erro: ' + String((erroRegistrado && erroRegistrado.message) || erroRegistrado).slice(0, 120)
          : scanProblem()
      );

      await persist();
      broadcastProgress();

      /* Com erro na varredura, NÃO avança de termo: a fila fica onde está e a
       * próxima passada tenta de novo (era o `advanceRun` aqui que recarregava a
       * página depois de uma queda no meio do fluxo). */
      if (!aborted && !erroRegistrado) {
        // Cota estourada (ou vez do usuário): pausa e volta sozinho. Nos demais
        // casos, segue para o próximo termo da fila.
        if (stop === 'quota') {
          await pauseRunUntil(quotaNow().resumeAt, 'cota');
        } else if (stop === 'usuario') {
          await pauseRunUntil(Date.now() + CONFIG.userBusyPauseMs, 'usuario');
        } else {
          await advanceRun(stop);
        }
      } else if (state.guardStopped) {
        // O LinkedIn sinalizou limite de uso: a fila fica pausada e volta só
        // depois do descanso (a proteção também vale para o agendador).
        state.guardStopped = false;
        await pauseRunUntil(guardUntil(), 'guard');
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* MutationObserver: reage ao carregamento dinâmico do LinkedIn              */
  /* ------------------------------------------------------------------------ */

  const onDomChanged = debounce(() => {
    // Durante a varredura o loop principal já controla tudo; fora dela,
    // aproveitamos para capturar a vaga que o usuário abriu manualmente.
    if (!state.scanning) syncSelectedJob();
  }, CONFIG.domDebounceMs);

  /**
   * Avisa quem espera (espera por evento, não por tempo) e chama o guard de
   * popup. Isso roda no mesmo instante da mutação — é o que faz o script parar
   * para fechar um popup que acabou de entrar na tela e voltar ao que estava
   * fazendo, sem consultar o relógio.
   */
  function onDomMutation() {
    wakeWaiters();
    scheduleInterrupt();
  }

  function startObserver() {
    if (state.observer) return;

    // Observamos o corpo inteiro (não só a lista): é no body que o LinkedIn
    // pendura os dialogs — formulário, popups de avaliação, avisos.
    const root = document.body || queryFirst(SEL.list);
    if (!root) return;

    state.observer = new MutationObserver(() => {
      onDomMutation();
      onDomChanged();
    });

    state.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      // `class`/`style`/`aria-hidden`/`hidden` são como o LinkedIn mostra e
      // esconde os dialogs; `disabled` marca o botão que acabou de habilitar.
      attributeFilter: ['class', 'style', 'aria-hidden', 'hidden', 'role', 'disabled'],
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Mensageria com o pop-up                                                   */
  /* ------------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message && message.type) {
      case MSG.AJUDA_RESPOSTA:
        // A decisão veio da janelinha do desktop (encaminhada pelo worker):
        // resolve quem está esperando em `pedirAjuda` — o resto do fluxo é o
        // mesmo do cartão na aba (aplicar escreve e segue / à mão espera /
        // pular descarta).
        if (
          state.ajuda &&
          state.ajuda.id === String(message.pedidoId || '') &&
          typeof state.ajuda.resolver === 'function'
        ) {
          state.ajuda.resolver({
            acao: String(message.acao || ''),
            resposta:
              message.resposta && typeof message.resposta === 'object' ? message.resposta : null,
          });
        }
        sendResponse({ ok: true });
        break;

      case MSG.PING:
        sendResponse({
          ok: true,
          count: Object.keys(state.jobs).length,
          scanning: state.scanning,
        });
        break;

      case MSG.START:
        if (state.scanning) {
          sendResponse({ ok: false, reason: 'already_scanning' });
          break;
        }
        if (message.run) {
          state.run = message.run;
          state.sinceBreak = Math.max(0, Number(message.run.sinceBreak) || 0);
          clearResumeTimer();
        }
        sendResponse({ ok: true, started: true });
        startScan().catch(() => {});
        break;

      case MSG.RESUME:
        // O agendador (background.js) cutuca a aba quando a cota libera.
        sendResponse({ ok: true, resuming: true });
        resumeNow().catch(() => {});
        break;

      case MSG.STOP:
        state.abort = true;
        clearRun();
        sendResponse({ ok: true, stopping: true });
        break;

      case MSG.CLEAR:
        // Apaga as vagas capturadas. O histórico de candidaturas (pegavaga_apps)
        // fica de pé de propósito: as cotas protegem a conta de uma rajada.
        state.abort = true;
        state.jobs = {};
        state.lastSyncedId = null;
        state.lastRun = null;
        clearRun();
        persist();
        broadcastProgress();
        sendResponse({ ok: true });
        break;
      default:
        break;
    }

    return false; // todas as respostas são síncronas
  });

  /* ------------------------------------------------------------------------ */
  /* Gancho de TESTE (não existe no LinkedIn)                                  */
  /* ------------------------------------------------------------------------ */
  //
  // `tests/smoke-dom.js` roda este arquivo num Chromium DE VERDADE (via
  // `tools/baixar-chromium.sh` + `chrome-headless-shell`) e precisa chamar as
  // funções daqui de dentro: a página de teste define `window.__pgvTeste` ANTES de
  // carregar este script e, só nesse caso, o gancho é publicado. No LinkedIn a
  // variável não existe — nada é exposto na página de produção.
  if (window.__pgvTeste) {
    window.__pgvTeste = {
      aplicarRespostaNosCampos: aplicarRespostaNosCampos,
      camposTravados: camposTravados,
      camposTravadosCompletos: camposTravadosCompletos,
      descreverCampo: descreverCampo,
      rotuloDaPerguntaDoGrupo: rotuloDaPerguntaDoGrupo,
      rotuloDaOpcao: rotuloDaOpcao,
      opcoesDoGrupo: opcoesDoGrupo,
      fieldLabel: fieldLabel,
      isVisible: isVisible,
      diagnosticoDoCampo: diagnosticoDoCampo,
      podeRecarregar: podeRecarregar,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Inicialização                                                             */
  /* ------------------------------------------------------------------------ */

  async function init() {
    // Diagnóstico: toda carga da página passa por aqui (é a prova de que a página
    // recarregou — e com qual URL).
    console.log('[PegaVaga] pagina carregada:', location.href);

    await loadState();
    state.settings = await getSettings();
    await loadApps();
    await loadGuard();
    watchUserActivity();
    startObserver();
    broadcastProgress();

    // Fila ativa deixada pelo pop-up/agendador: espera a lista e já inicia.
    if (!(await resumeRun())) return;

    const run = state.run;

    // Veio pausada (cota estourada ou janela fechada): só volta no horário.
    if (run.paused && run.resumeAt && run.resumeAt > Date.now()) {
      scheduleResume(run.resumeAt);
      return;
    }

    await waitForList(CONFIG.waitListTimeoutMs);
    await startScan();
  }

  init().catch(() => {});
})();

