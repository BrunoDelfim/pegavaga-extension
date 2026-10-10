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
 *      meio de qualquer espera e o fluxo continua de onde estava.
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
  const STORAGE = SHARED.STORAGE || {};

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
    AJUDA_PEDIDO: 'PEGAVAGA_AJUDA_PEDIDO',
    AJUDA_RESPOSTA: 'PEGAVAGA_AJUDA_RESPOSTA',
    AJUDA_FECHAR: 'PEGAVAGA_AJUDA_FECHAR',
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

  const isWithinSchedule = SHARED.isWithinSchedule || (() => true);
  const nextScheduleStart = SHARED.nextScheduleStart || (() => null);

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
    ajudaIntervaloMs: 60000, // no máximo um aviso por minuto (evita enxurrada)

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
      '.jobs-apply-button',
      'button.jobs-apply-button',
      '.jobs-details__main-content button.jobs-apply-button',
      '.jobs-unified-top-card__content--two-pane button.jobs-apply-button',
      'button[data-live-test-job-apply-button]',
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
    ],
    // Mensagem de erro escrita na própria tela (é o que explica o "invalid").
    invalidText: ['.artdeco-inline-feedback__message', '[role="alert"]'],
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
    dismissing: false, // fechando o pós-candidatura (aí todo dialog é popup)
    interruptBusy: false, // já estamos fechando um popup que entrou na tela
    interruptTimer: null, // checagem de popup agendada pelas mutações
    /* (TEMPORÁRIO) Pedido de ajuda em andamento: { id, acao, avisoId }. Enquanto
     * existe, a automação está parada esperando a sua decisão. Sai junto com o
     * pedido de ajuda. */
    ajuda: null,
    ajudaTardia: null, // resposta que chegou antes de a espera começar
    ultimaAjuda: 0, // instante do último aviso (contém a enxurrada de avisos)
  };

  /* ------------------------------------------------------------------------ */
  /* Utilitários de DOM                                                        */
  /* ------------------------------------------------------------------------ */

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function queryAllUnique(selectors, root = document) {
    const found = new Set();
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((el) => found.add(el));
    }
    return Array.from(found);
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
   * candidaturas. O texto é comparado sem acentos e em minúsculas.
   */
  const RATE_LIMIT_RE = new RegExp(
    [
      'checkpoint',
      'verificacao de seguranca',
      'security verification',
      'unusual activity',
      'atividade suspeita',
      'atividade incomum',
      'muitas solicitacoes',
      'too many requests',
      'rate limit',
      'limite de uso',
      'temporarily restricted',
      'restricao temporaria',
      'tente novamente mais tarde',
      'prove que voce',
      'voce atingiu o limite',
    ].join('|')
  );

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

      const text = normalize(pageText());
      if (RATE_LIMIT_RE.test(text)) return 'Aviso de limite de uso na página do LinkedIn';
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

  function findApplyButton() {
    return queryFirst(APPLY_SEL.button);
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

  /**
   * Este dialog é o formulário da Candidatura Simplificada? O LinkedIn usa o
   * mesmo `role="dialog"` para o formulário e para os popups de pesquisa que
   * aparecem depois do envio — sem essa distinção, a automação confunde os dois.
   */
  function isApplyForm(dialog) {
    if (!dialog) return false;
    return SHARED.classifyDialog(dialogSignals(dialog)) === SHARED.DIALOG_KINDS.form;
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

  /** Popup aberto que NÃO é o formulário (ex.: "avalie a candidatura"). */
  function findPopup(except) {
    for (const dialog of dialogs()) {
      if (except && dialog.contains(except)) continue;
      if (!isApplyForm(dialog)) return dialog;
    }
    return null;
  }

  async function waitForModal(timeoutMs) {
    return waitUntil(() => findModal(), Number(timeoutMs) || CONFIG.applyModalTimeoutMs);
  }

  /* ---- Popups que não são o formulário (fechar sem medo) ------------------ */

  /**
   * O guarda de popup está de serviço? Só durante uma varredura e só quando já
   * sabemos qual é o formulário (ou quando estamos fechando o pós-candidatura,
   * que aí não há nada a proteger).
   *
   * Antes do formulário estar identificado o guard fica quieto de propósito:
   * um dialog que ainda está carregando não pode ser confundido com popup.
   */
  function popupGuardActive() {
    if (state.scanning !== true) return false;
    if (state.dismissing === true) return true;

    return Boolean(state.keepDialog) && document.contains(state.keepDialog);
  }

  /**
   * Um popup entrou na tela? Fecha. É chamado pelo MutationObserver enquanto o
   * script trabalha: o fluxo em andamento nem precisa saber — o overlay sai da
   * frente e o trabalho continua de onde estava, sem esperar checagem por tempo.
   */
  async function handleInterrupt() {
    if (state.interruptBusy || !popupGuardActive()) return false;

    const popup = findPopup(state.keepDialog);
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
    if (state.interruptTimer || !popupGuardActive()) return;

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

  /** Rótulo visível de um campo do formulário (para o relatório de motivos). */
  function fieldLabel(field) {
    let direct = '';

    try {
      direct = clean(
        (field.getAttribute && field.getAttribute('aria-label')) ||
          (field.getAttribute && field.getAttribute('placeholder'))
      );
    } catch (error) {
      direct = '';
    }

    if (direct) return direct.slice(0, 60);

    try {
      if (field.labels && field.labels.length) return clean(field.labels[0].textContent).slice(0, 60);
    } catch (error) {
      /* sem labels: tentamos o container abaixo */
    }

    try {
      const container =
        field.closest &&
        field.closest(
          '.fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input--container, label, fieldset'
        );

      if (container) return clean(container.textContent).slice(0, 60);
    } catch (error) {
      /* sem closest: desistimos do rótulo */
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
        guarda(fieldLabel(campo) || campo.textContent);
      }

      for (const aviso of queryAllUnique(APPLY_SEL.invalidText, modal)) {
        const texto = clean(aviso.textContent);
        if (texto && texto.length <= 80) guarda(texto);
      }
    } catch (error) {
      return labels;
    }

    return labels;
  }

  /** Dados da vaga que o aviso mostra (título, empresa e o que travou). */
  function ajudaContexto(id, motivo, problema) {
    const job = (id && state.jobs[id]) || {};

    return {
      motivo: motivo === 'demora' ? 'demora' : 'campos',
      titulo: String(job.title || '').slice(0, 80),
      empresa: String(job.company || '').slice(0, 60),
      problema: String(problema || '').slice(0, 120),
    };
  }

  /** Pede ao service worker para mostrar o aviso. `{ ok, id }` ('' = não deu). */
  function avisarNoSistema(dados) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: MSG.AJUDA_PEDIDO }, dados), (resposta) => {
          resolve(resposta && resposta.ok ? resposta : null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  /** Some com o aviso da área de trabalho (a decisão já foi tomada). */
  function fecharAviso(avisoId) {
    try {
      chrome.runtime.sendMessage(
        { type: MSG.AJUDA_FECHAR, avisoId: avisoId },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      /* sem aviso aberto: nada a fazer */
    }
  }

  /**
   * Avisa na área de trabalho e espera a sua decisão.
   *
   * Devolve `'manual'` (você vai preencher à mão: a automação para e respeita),
   * `'pular'` (a vaga é descartada e a varredura segue para a próxima) ou `''`
   * (ninguém respondeu a tempo — quem chamou decide o que fazer).
   */
  async function pedirAjuda(dados) {
    if (state.ajuda) return ''; // já há um aviso na tela: não empilha
    if (Date.now() - state.ultimaAjuda < CONFIG.ajudaIntervaloMs) return '';

    const pedido = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      acao: '',
      avisoId: '',
    };

    const aviso = await avisarNoSistema(Object.assign({ pedidoId: pedido.id }, dados));

    if (!aviso) return ''; // sem aviso na tela não faz sentido esperar
    pedido.avisoId = aviso.id;

    state.ajuda = pedido;
    state.ultimaAjuda = Date.now();

    // O clique é humano, mas a resposta pode chegar antes de a espera começar.
    if (state.ajudaTardia && state.ajudaTardia.id === pedido.id) {
      pedido.acao = state.ajudaTardia.acao;
      state.ajudaTardia = null;
    }

    try {
      // O "Parar Varredura" vale na hora: não ficamos presos esperando resposta.
      await waitUntil(() => pedido.acao || state.abort, CONFIG.ajudaEsperaMs, CONFIG.ajudaPollMs);
    } finally {
      state.ajuda = null;
      fecharAviso(pedido.avisoId);
    }

    return pedido.acao || '';
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
   * Tenta resolver com você uma vaga que travou num campo ou não confirmou o
   * envio. Devolve o desfecho a usar (`manual`/`pulada`), ou `null` quando não
   * houve aviso — aí vale o desfecho de sempre.
   */
  async function resolverComAjuda(modal, dados) {
    const acao = await pedirAjuda(dados);
    if (!acao) return null;

    if (acao === 'manual') {
      await esperarPreenchimentoManual(modal);
      return { status: 'manual' };
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

  /** Todos os rádios do mesmo grupo (nome), habilitados. */
  function radioGroup(dialog, field) {
    if (!field.name) return [field];

    try {
      const selector =
        'input[type="radio"][name="' + String(field.name).replace(/"/g, '\\"') + '"]';
      return Array.from(dialog.querySelectorAll(selector)).filter((input) => !input.disabled);
    } catch (error) {
      return [field];
    }
  }

  /** Responde um grupo de rádio obrigatório (devolve o rótulo escolhido). */
  function answerRadio(fields, prefs, question) {
    if (!fields.length) return '';
    if (fields.some((field) => field.checked)) return '';

    const labels = fields.map((field) => fieldLabel(field) || String(field.value || ''));
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
   */
  async function closeStaleForm(budgetMs) {
    const modal = findModal();

    if (modal) {
      await closeModal(modal, true); // o closeModal já limpa os popups no fim
      return;
    }

    await clearPopups(null, Number(budgetMs) || CONFIG.popupWaitMs * 2);
  }

  /**
   * Depois do envio: fecha a confirmação e mais qualquer popup que o LinkedIn
   * jogue na tela (pesquisa de avaliação, "salvar vaga", "seguir empresa"…).
   * Sem isso, o overlay fica na frente da lista e a varredura empaca.
   */
  async function dismissAfterApply(modal) {
    // Enquanto isso, todo dialog que aparecer é popup (não há formulário a
    // proteger): o guard fecha sozinho, no instante em que entrar na tela.
    state.dismissing = true;

    try {
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
    } finally {
      state.dismissing = false;
    }
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
    // O guard de popup precisa saber qual dialog é o formulário — e sair de
    // serviço no fim, mesmo se o fluxo estourar no meio.
    clearInterruptTimer(); // nada de guard atrasado de uma vaga anterior
    state.keepDialog = null;
    state.dismissing = false;

    try {
      return await runApplyFlow(jobId);
    } finally {
      state.keepDialog = null;
      state.dismissing = false;
      clearInterruptTimer();
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
    humanClick(button);

    let modal = await waitForModal(CONFIG.applyModalTimeoutMs);

    // Internet lenta: o formulário pode demorar, ou um popup rouba a vez. Nesse
    // caso limpamos a tela e damos mais uma rodada de espera.
    if (!modal) {
      await clearPopups(null, CONFIG.popupWaitMs * 2);
      modal = await waitForModal(CONFIG.applyModalTimeoutMs);
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

    while (Date.now() < deadline && steps < CONFIG.applyMaxSteps) {
      if (state.abort) {
        await closeModal(modal, true);
        return { status: 'cancelada', steps };
      }

      const blocked = detectRateLimit();
      if (blocked) {
        await closeModal(modal, true);
        return { status: 'bloqueio', error: blocked, steps };
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
            ajudaContexto(jobId, 'campos', missing.slice(0, 3).join(', '))
          );

          if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

          await closeModal(modal, true);
          return { status: 'travada', missing, filled, steps };
        }
      }

      const before = scopeSignature(modal);
      humanClick(action.button);
      steps += 1;

      const changed = await waitForStepChange(modal, before, CONFIG.applyStepWaitMs);

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
          ajudaContexto(jobId, invalidos.length ? 'campos' : 'demora', missing.slice(0, 3).join(', '))
        );

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
            ajudaContexto(jobId, 'campos', missing.slice(0, 3).join(', '))
          );

          if (ajuda) return Object.assign({ missing, filled, steps }, ajuda);

          await closeModal(modal, true);
          return { status: 'incompleta', missing, filled, steps };
        }
      } else {
        stalled = 0;
      }
    }

    const missing = describeBlocker(modal);
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
    const attempts = Math.min(CONFIG.applyMaxAttempts, (current.applyAttempts || 0) + 1);
    const now = new Date().toISOString();

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
   * Avança para o próximo termo da fila (ou encerra). O storage é a fonte da
   * verdade: se o pop-up removeu a fila (botão Parar), paramos aqui mesmo.
   */
  async function advanceRun() {
    const run = await getRun();

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const urls = Array.isArray(run.urls) ? run.urls : [''];
    const nextIndex = (run.index || 0) + 1;

    if (nextIndex >= urls.length) {
      await clearRun();
      broadcastProgress();
      return;
    }

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
      location.assign(nextUrl); // recarrega a página; a fila é retomada no load
    } else {
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
   * Podemos rodar agora? Considera a janela do agendador e o período de descanso
   * imposto pela proteção da conta (quando o LinkedIn sinaliza limite de uso).
   */
  function gateState() {
    const guard = guardUntil();
    if (guard) return { open: false, resumeAt: guard, reason: 'guard' };

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
   */
  async function processCard(card, id, settings) {
    // Formulário/popup de uma vaga anterior pode estar cobrindo a lista: sem
    // isso, o clique no card não abre a vaga. Só mexemos na página se ela
    // estiver livre — a sua vez vem antes de tudo.
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

    // Fora da janela do agendador (ou no descanso de proteção) não varremos: a
    // fila fica parada e volta sozinha quando o horário abrir.
    const gate = gateState();
    if (!gate.open) {
      await pauseRunUntil(gate.resumeAt, gate.reason);
      return;
    }

    state.scanning = true;
    state.abort = false;
    state.lastRun = new Date().toISOString();
    broadcastProgress();

    const settings = state.settings || (await getSettings());
    state.settings = settings;

    let stop = null; // 'quota' | 'term_done' | 'scan_cap' | 'usuario'
    let round = 0;

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
        if (!progressed) break; // nada novo carregou: fim da lista
        round += 1;
      }
    } finally {
      state.scanning = false;
      const aborted = state.abort;
      state.abort = false;

      // Página sem a lista de vagas: é o caso que acende a luz vermelha do ícone
      // ("precisa de atenção"). O aviso é recalculado a cada varredura, então
      // nunca fica velho — basta a próxima página carregar bem para apagar.
      await setRunProblem(scanProblem());

      await persist();
      broadcastProgress();

      if (!aborted) {
        // Cota estourada (ou vez do usuário): pausa e volta sozinho. Nos demais
        // casos, segue para o próximo termo da fila.
        if (stop === 'quota') {
          await pauseRunUntil(quotaNow().resumeAt, 'cota');
        } else if (stop === 'usuario') {
          await pauseRunUntil(Date.now() + CONFIG.userBusyPauseMs, 'usuario');
        } else {
          await advanceRun();
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
      // (TEMPORÁRIO) A sua decisão no aviso da área de trabalho chegou: guardamos
      // no pedido que está esperando (o id evita que uma resposta velha, de outro
      // pedido, acorde a espera errada).
      case MSG.AJUDA_RESPOSTA: {
        const acao = message.acao === 'pular' ? 'pular' : 'manual';

        if (state.ajuda && state.ajuda.id === message.pedidoId) {
          state.ajuda.acao = acao;
        } else {
          state.ajudaTardia = { id: message.pedidoId, acao: acao };
        }

        sendResponse({ ok: true });
        break;
      }

      default:
        break;
    }

    return false; // todas as respostas são síncronas
  });

  /* ------------------------------------------------------------------------ */
  /* Inicialização                                                             */
  /* ------------------------------------------------------------------------ */

  async function init() {
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

