/* =============================================================================
 * PegaVaga - shared.js
 * Constantes e utilitários puros compartilhados pelo pop-up, pelo content
 * script e pelo service worker (background.js). O arquivo é carregado nos três
 * contextos, por isso anexa tudo em globalThis.PegaVagaShared em vez de usar
 * módulos ES. Não use APIs de DOM aqui: o service worker não tem `document`.
 * ===========================================================================*/

'use strict';

globalThis.PegaVagaShared = (() => {
  /* Chaves usadas em chrome.storage.local. */
  const STORAGE = {
    jobs: 'pegavaga_jobs', // { [jobId]: { id, title, company, link, description } }
    meta: 'pegavaga_meta', // { lastRun, count, pageUrl }
    settings: 'pegavaga_settings', // busca + cotas de candidatura + agendador
    run: 'pegavaga_run', // fila de termos em andamento
    apps: 'pegavaga_apps', // timestamps (ms) das candidaturas enviadas
    guard: 'pegavaga_guard', // bloqueio temporário detectado (proteção da conta)
  };

  /* Tipos de mensagem trocadas entre pop-up, content script e agendador. */
  const MSG = {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
  };

  const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';

  const MAX_TERMS = 40; // trava de segurança por execução
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const HISTORY_LIMIT = 500; // candidaturas guardadas (base das cotas móveis)
  const MIN_DELAY_MS = 1000;
  const MAX_DELAY_MS = 600000;

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const DEFAULT_SETTINGS = {
    baseUrl: LINKEDIN_SEARCH_URL,
    location: '',
    terms: [],
    apply: {
      enabled: false, // candidatar-se sozinho só se o usuário ligar
      perTerm: 8, // candidaturas por termo de busca
      perHour: 6, // janela móvel de 60 min
      per24h: 25, // janela móvel de 24 h
      perDay: 0, // dia corrido (00:00-23:59); 0 = sem limite
      scanPerTerm: 40, // teto de vagas visitadas por termo (trava de segurança)
      minDelayMs: 4000, // intervalo entre candidaturas (imita digitação humana)
      maxDelayMs: 12000,
      readMinMs: 1500, // pausa de "leitura" da vaga antes de se candidatar
      readMaxMs: 4500,
      respectUserActivity: true, // espera quando o usuário está mexendo na página
      breaksEnabled: true, // pausas longas periódicas entre candidaturas
      breakEvery: 10, // candidaturas entre uma pausa longa e outra
      breakMs: 90000, // duração base da pausa longa
      fillRequired: true, // responde sozinho perguntas obrigatórias do formulário
      answerYes: true, // resposta padrão em perguntas de Sim/Não
      answerNumber: 1, // resposta padrão em campo numérico (anos, quantidade…)
      answerText: '', // resposta padrão em texto livre (vazio = não inventa)
      answers: {}, // respostas específicas: { "palavra-chave da pergunta": "resposta" }
    },
    schedule: {
      enabled: false,
      autoStart: true, // liga sozinho quando a janela de horário abre
      startTime: '08:00',
      stopTime: '18:00',
      days: [1, 2, 3, 4, 5], // 0 = domingo
      focusTab: true, // trazer a aba para frente (o Chrome pausa abas ocultas)
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Edição (perfil free/premium)                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * O perfil da edição ativa (free/premium) vive no `edicoes.js`, carregado
   * antes deste arquivo nos três contextos. O perfil reserva abaixo só entra em
   * cena se o `edicoes.js` não estiver presente — e aí o comportamento é o
   * histórico, sem cortes, para nunca restringir por acidente.
   */
  const PERFIL_RESERVA = {
    chave: 'livre',
    rotulo: 'Livre',
    features: {
      autoApply: true,
      formFill: true,
      scheduler: true,
      export: true,
      furtividadeConfig: true,
      cotasAvancadas: true,
      scanConfig: true,
    },
    limites: {
      maxTermos: MAX_TERMS,
      cotasEditaveis: ['term', 'hour', 'day24', 'day'],
      tetoDiarioFixo: 0,
      scanPerTermFixo: 0,
      per24h: DEFAULT_SETTINGS.apply.per24h,
    },
    furtividadeFixa: null,
  };

  function perfilEdicao() {
    const edicoes = globalThis.PegaVagaEdicoes;
    if (edicoes && typeof edicoes.atual === 'function') return edicoes.atual();
    return PERFIL_RESERVA;
  }

  function temFeature(nome) {
    return Boolean(perfilEdicao().features[nome]);
  }

  /* ------------------------------------------------------------------------ */
  /* Utilidades numéricas                                                      */
  /* ------------------------------------------------------------------------ */

  /** Converte para inteiro dentro de [min, max]; usa o padrão se não der. */
  function num(value, min, max, fallback) {
    if (value === '' || value == null) return fallback;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  /** Transforma texto (uma linha por termo) em lista limpa e sem repetições. */
  /**
   * O que separa um termo do outro: quebra de linha, vírgula, ponto e vírgula,
   * barra vertical ou tabulação. Assim "react, node.js" e "react\nnode.js"
   * viram dois termos (um por busca) — do jeito que a fila em loop espera.
   */
  const TERM_SPLIT_RE = /\r?\n|[;|,\t]+/;

  /**
   * Lista limpa de termos: aceita texto (uma linha ou separado por vírgula) ou
   * array, tira espaços/aspas, descarta vazios e repetidos e respeita o teto de
   * termos da edição ativa (o free corta em poucos), mantendo a ordem digitada
   * (é a ordem da fila de busca).
   */
  function normalizeTerms(raw, max) {
    // Sem teto explícito, vale o da edição ativa.
    const limite =
      Number.isFinite(max) && max > 0 ? Math.floor(max) : perfilEdicao().limites.maxTermos;
    const list = Array.isArray(raw) ? raw : [raw];
    const seen = new Set();
    const out = [];

    for (const item of list) {
      const pieces = String(item == null ? '' : item).split(TERM_SPLIT_RE);

      for (const piece of pieces) {
        const term = piece
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/^["']+|["']+$/g, '')
          .trim();
        if (!term) continue;

        const key = term.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(term);
        if (out.length >= limite) return out;
      }
    }

    return out;
  }

  function isLinkedInUrl(url) {
    return /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(String(url || ''));
  }

  function isLinkedInJobsUrl(url) {
    return isLinkedInUrl(url) && /\/jobs(\/|$|\?)/i.test(String(url));
  }

  /** Monta a URL de busca de um termo, reaproveitando a URL base informada. */
  function buildSearchUrl(baseUrl, term, location) {
    let url;
    try {
      url = new URL(baseUrl || LINKEDIN_SEARCH_URL);
    } catch (error) {
      return baseUrl || LINKEDIN_SEARCH_URL;
    }

    if (term) url.searchParams.set('keywords', term);
    if (location) url.searchParams.set('location', location);

    return url.toString();
  }

  /* ------------------------------------------------------------------------ */
  /* Horário e dias da semana                                                  */
  /* ------------------------------------------------------------------------ */

  /** "HH:MM" -> minutos desde a meia-noite (ou null se não for um horário). */
  function timeToMinutes(raw) {
    const match = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(raw == null ? '' : raw));
    if (!match) return null;

    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;

    return hours * 60 + mins;
  }

  function minutesToTime(minutes) {
    const safe = Math.max(0, Math.min(1440 - 1, Math.round(Number(minutes) || 0)));
    const hh = String(Math.floor(safe / 60)).padStart(2, '0');
    const mm = String(safe % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  /** Aceita "8:5", "08:05" etc. e devolve sempre "HH:MM". */
  function normalizeTime(raw, fallback) {
    const minutes = timeToMinutes(raw);
    return minutes == null ? fallback : minutesToTime(minutes);
  }

  /** Lista de dias válidos (0=domingo … 6=sábado), sem repetições. */
  function normalizeDays(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? DEFAULT_SETTINGS.schedule.days : [raw];

    const out = [];
    for (const item of list) {
      if (item === '' || item == null) continue;

      const day = Math.round(Number(item));
      if (!Number.isFinite(day) || day < 0 || day > 6 || out.includes(day)) continue;

      out.push(day);
    }

    return out.sort((a, b) => a - b);
  }

  function formatDays(days) {
    const list = normalizeDays(days);
    if (list.length === 7) return 'todos os dias';
    if (!list.length) return 'nenhum dia';
    return list.map((day) => WEEKDAYS[day]).join(', ');
  }

  function startOfDayMs(ts) {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /** O instante está dentro da janela agendada? (sem agendador = sempre sim) */
  function isWithinSchedule(date, schedule) {
    const cfg = schedule || {};
    if (!cfg.enabled) return true;

    const days = normalizeDays(cfg.days);
    if (!days.length) return false;

    const start = timeToMinutes(cfg.startTime);
    const stop = timeToMinutes(cfg.stopTime);
    if (start == null || stop == null || start === stop) return true;

    const current = date.getHours() * 60 + date.getMinutes();
    const weekday = date.getDay();

    if (start < stop) {
      return days.includes(weekday) && current >= start && current < stop;
    }

    // Janela que cruza a meia-noite (ex.: 22:00 -> 06:00).
    if (current >= start) return days.includes(weekday);
    if (current < stop) return days.includes((weekday + 6) % 7);
    return false;
  }

  /** Próximo instante em que a janela agendada abre (Date ou null). */
  function nextScheduleStart(date, schedule) {
    const cfg = schedule || {};
    const start = timeToMinutes(cfg.startTime);
    const days = normalizeDays(cfg.days);
    if (start == null || !days.length) return null;

    const candidate = new Date(date);
    for (let i = 0; i < 8; i += 1) {
      if (i) candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(Math.floor(start / 60), start % 60, 0, 0);
      if (candidate.getTime() > date.getTime() && days.includes(candidate.getDay())) {
        return candidate;
      }
    }

    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* Configuração                                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Respostas específicas do usuário (opcional): { "pergunta": "resposta" }.
   * Só o que é texto útil sobrevive — chave vazia ou valor vazio não serve.
   */
  function normalizeAnswers(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const out = {};

    Object.keys(value).forEach((key) => {
      const name = String(key || '').trim().slice(0, 80);
      const answer = value[key];

      if (!name || answer == null || answer === '') return;
      out[name] = String(answer).trim().slice(0, 120);
    });

    return out;
  }

  /** Normaliza o que veio do storage/formulário para uma configuração válida. */
  function parseSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const apply = value.apply && typeof value.apply === 'object' ? value.apply : {};
    const schedule = value.schedule && typeof value.schedule === 'object' ? value.schedule : {};
    const defApply = DEFAULT_SETTINGS.apply;
    const defSchedule = DEFAULT_SETTINGS.schedule;

    const minDelayMs = num(apply.minDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.minDelayMs);
    const maxDelayMs = num(apply.maxDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.maxDelayMs);
    const readMinMs = num(apply.readMinMs, 0, 60000, defApply.readMinMs);
    const readMaxMs = num(apply.readMaxMs, 0, 60000, defApply.readMaxMs);

    const cfg = {
      baseUrl: String(value.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
      location: String(value.location || '').trim(),
      terms: normalizeTerms(value.terms),
      apply: {
        enabled: apply.enabled === true,
        perTerm: num(apply.perTerm, 1, 500, defApply.perTerm),
        perHour: num(apply.perHour, 1, 1000, defApply.perHour),
        per24h: num(apply.per24h, 1, 2000, defApply.per24h),
        perDay: num(apply.perDay, 0, 5000, defApply.perDay),
        scanPerTerm: num(apply.scanPerTerm, 1, 500, defApply.scanPerTerm),
        minDelayMs: Math.min(minDelayMs, maxDelayMs),
        maxDelayMs: Math.max(minDelayMs, maxDelayMs),
        readMinMs: Math.min(readMinMs, readMaxMs),
        readMaxMs: Math.max(readMinMs, readMaxMs),
        respectUserActivity: apply.respectUserActivity !== false,
        breaksEnabled: apply.breaksEnabled !== false,
        breakEvery: num(apply.breakEvery, 1, 100, defApply.breakEvery),
        breakMs: num(apply.breakMs, 10000, 600000, defApply.breakMs),
        fillRequired: apply.fillRequired !== false,
        answerYes: apply.answerYes !== false,
        answerNumber: num(apply.answerNumber, 0, 200, defApply.answerNumber),
        answerText: String(apply.answerText == null ? '' : apply.answerText)
          .trim()
          .slice(0, 120),
        answers: normalizeAnswers(apply.answers),
      },
      schedule: {
        enabled: schedule.enabled === true,
        autoStart: schedule.autoStart !== false,
        startTime: normalizeTime(schedule.startTime, defSchedule.startTime),
        stopTime: normalizeTime(schedule.stopTime, defSchedule.stopTime),
        days: normalizeDays(schedule.days),
        focusTab: schedule.focusTab !== false,
      },
    };

    return aplicarPerfilEdicao(cfg, perfilEdicao());
  }

  /**
   * Aplica o perfil da edição à configuração já normalizada: corta o que a edição
   * não oferece e impõe os valores fixos (furtividade segura, teto diário, a
   * ausência de agendador). É o funil por onde TODA a configuração passa —
   * pop-up, content script e agendador leem daqui, então a regra vale nos três.
   */
  function aplicarPerfilEdicao(cfg, perfil) {
    const limites = (perfil && perfil.limites) || {};

    // Termos: cada edição tem o seu teto.
    cfg.terms = normalizeTerms(cfg.terms, limites.maxTermos);

    // Cotas que a edição não expõe ficam impostas — e não voltam pela UI.
    if (limites.per24h != null) cfg.apply.per24h = limites.per24h;
    if (limites.tetoDiarioFixo > 0) cfg.apply.perDay = limites.tetoDiarioFixo;

    // Teto de vagas visitadas por termo: no free é trava fixa do motor (o campo
    // "Máx. vagas por termo" não existe na edição); no premium (0) o usuário manda.
    if (limites.scanPerTermFixo > 0) cfg.apply.scanPerTerm = limites.scanPerTermFixo;

    // Furtividade fixa (no free o usuário não ajusta; o motor impõe o seguro).
    const fixa = perfil && perfil.furtividadeFixa;
    if (fixa) {
      cfg.apply.respectUserActivity = true;
      cfg.apply.breaksEnabled = true;
      cfg.apply.minDelayMs = fixa.minDelayMs;
      cfg.apply.maxDelayMs = fixa.maxDelayMs;
      cfg.apply.readMinMs = fixa.readMinMs;
      cfg.apply.readMaxMs = fixa.readMaxMs;
      cfg.apply.breakEvery = fixa.breakEvery;
      cfg.apply.breakMs = fixa.breakMs;
    }

    // Sem agendador: desliga de vez (nem janela, nem auto-start).
    if (perfil && !perfil.features.scheduler) {
      cfg.schedule.enabled = false;
      cfg.schedule.autoStart = false;
    }

    return cfg;
  }

  /* ------------------------------------------------------------------------ */
  /* Fila de execução                                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * Monta a fila de termos: um item por termo, varrido em sequência. Sem termos
   * cadastrados, cai no modo antigo (varre a página de vagas aberta).
   */
  function buildRunQueue(settings) {
    const cfg = settings || DEFAULT_SETTINGS;
    const terms = Array.isArray(cfg.terms) ? cfg.terms : [];

    let urls;
    let runTerms;

    if (terms.length) {
      urls = terms.map((term) => buildSearchUrl(cfg.baseUrl, term, cfg.location));
      runTerms = terms.slice();
    } else {
      urls = [buildSearchUrl(cfg.baseUrl, '', cfg.location)];
      runTerms = [''];
    }

    return {
      running: true,
      paused: false,
      resumeAt: null,
      pauseReason: null,
      index: 0,
      term: runTerms[0],
      terms: runTerms,
      urls,
      appliedInTerm: 0,
      visitedInTerm: 0,
      appliedTotal: 0,
      sinceBreak: 0, // candidaturas desde a última pausa longa (ritmo humano)
      startedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Cotas de candidatura (dinâmicas)                                          */
  /* ------------------------------------------------------------------------ */

  function countBetween(timestamps, from, to) {
    let total = 0;
    for (const ts of timestamps) {
      if (ts >= from && ts < to) total += 1;
    }
    return total;
  }

  /** A candidatura mais antiga ainda dentro da janela (lista ordenada). */
  function firstBetween(timestamps, from, to) {
    for (const ts of timestamps) {
      if (ts >= from && ts < to) return ts;
    }
    return null;
  }

  /**
   * Calcula o que ainda cabe dentro das cotas.
   *
   * - `perHour`: janela móvel de 60 min;
   * - `per24h`: janela móvel de 24 h;
   * - `perDay`: dia corrido (zera à meia-noite local); 0 = sem limite;
   * - `perTerm`: reiniciado a cada termo pelo próprio content script.
   *
   * Quando uma cota estoura, devolvemos `resumeAt` (quando ela volta a ter
   * espaço) para o agendador retomar a execução sozinho.
   */
  function computeQuota(settings, appTimestamps, now, appliedInTerm) {
    const cfg = (settings && settings.apply) || DEFAULT_SETTINGS.apply;
    const when = Number.isFinite(now) ? now : Date.now();

    const timestamps = (Array.isArray(appTimestamps) ? appTimestamps : [])
      .map((value) => (typeof value === 'number' ? value : Date.parse(value)))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    const hourStart = when - HOUR_MS;
    const day24Start = when - DAY_MS;
    const dayStart = startOfDayMs(when);

    const used = {
      term: Math.max(0, Number(appliedInTerm) || 0),
      hour: countBetween(timestamps, hourStart, Infinity),
      day24: countBetween(timestamps, day24Start, Infinity),
      day: countBetween(timestamps, dayStart, Infinity),
    };

    const limits = {
      term: cfg.perTerm,
      hour: cfg.perHour,
      day24: cfg.per24h,
      day: cfg.perDay > 0 ? cfg.perDay : Infinity,
    };

    const remaining = {
      term: limits.term - used.term,
      hour: limits.hour - used.hour,
      day24: limits.day24 - used.day24,
      day: limits.day === Infinity ? Infinity : limits.day - used.day,
    };

    // Instante em que cada cota estourada volta a liberar uma vaga: a
    // candidatura mais antiga da janela é que precisa "sair" dela.
    const waits = [];
    const blocks = [];

    if (remaining.hour <= 0) {
      const oldest = firstBetween(timestamps, hourStart, Infinity);
      waits.push((oldest == null ? when : oldest) + HOUR_MS + 1000);
      blocks.push('hour');
    }
    if (remaining.day24 <= 0) {
      const oldest = firstBetween(timestamps, day24Start, Infinity);
      waits.push((oldest == null ? when : oldest) + DAY_MS + 1000);
      blocks.push('day24');
    }
    if (remaining.day <= 0) {
      waits.push(dayStart + DAY_MS + 1000); // o dia corrido zera à meia-noite
      blocks.push('day');
    }

    const blockedBy = waits.length ? blocks[waits.indexOf(Math.min(...waits))] : null;
    const ok = remaining.term > 0 && !waits.length;

    return {
      ok,
      blockedBy,
      resumeAt: waits.length ? Math.min(...waits) : null,
      used,
      limits,
      remaining,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: desfechos, motivos e resumo                       */
  /* ------------------------------------------------------------------------ */

  /**
   * Desfechos possíveis de uma tentativa de candidatura. `failure: false` é só
   * o sucesso; todo o resto entra no relatório de "não foi possível candidatar"
   * com o motivo legível em `reason`.
   */
  const APPLY_OUTCOMES = {
    enviada: {
      label: 'Enviada',
      failure: false,
      reason: '',
    },
    externa: {
      label: 'Externa (site da empresa)',
      failure: true,
      reason:
        'A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então ela é pulada.',
    },
    desconhecida: {
      label: 'Botão de candidatura não reconhecido',
      failure: true,
      reason:
        'Não identifiquei a Candidatura Simplificada nesta vaga; para não sair do LinkedIn, não cliquei.',
    },
    sem_botao: {
      label: 'Sem botão de candidatura',
      failure: true,
      reason: 'A página da vaga não oferece botão de candidatura.',
    },
    sem_modal: {
      label: 'Formulário não abriu',
      failure: true,
      reason: 'O botão foi clicado, mas o formulário de candidatura não abriu.',
    },
    travada: {
      label: 'Travada em campo obrigatório',
      failure: true,
      reason:
        'O formulário parou numa pergunta obrigatória que a extensão não conseguiu responder (mesmo preenchendo as anteriores).',
    },
    incompleta: {
      label: 'Formulário incompleto',
      failure: true,
      reason:
        'O formulário não foi concluído dentro do tempo e do número de etapas permitidos.',
    },
    cancelada: {
      label: 'Interrompida (Parar)',
      failure: true,
      reason: 'A candidatura foi abandonada porque você pediu para parar.',
    },
    bloqueio: {
      label: 'Parada por proteção do LinkedIn',
      failure: true,
      reason:
        'O LinkedIn pediu verificação ou limite de uso: a automação parou para proteger a sua conta.',
    },
    erro: {
      label: 'Erro na automação',
      failure: true,
      reason: 'Houve um erro inesperado durante a automação da candidatura.',
    },
  };

  /** Código de quem ainda não foi candidatado por falta de cota/horário. */
  const APPLY_PENDING = 'adiada';

  const APPLY_PENDING_LABEL = 'Adiada (sem cota ou fora do horário)';
  const APPLY_UNTOUCHED_LABEL = 'Não tentada';

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: motivos e resumo do relatório                     */
  /* ------------------------------------------------------------------------ */

  /** Variação aleatória em torno de um valor, para um ritmo menos robótico. */
  function jitter(baseMs, ratio, random) {
    const base = Math.max(0, Number(baseMs) || 0);
    const spread = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.3));
    const raw = typeof random === 'function' ? Number(random()) : Math.random();
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    return Math.max(0, Math.round(base * (1 - spread + value * spread * 2)));
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura dentro ou fora do LinkedIn                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Rótulos (pt/en) de botão que manda para fora do LinkedIn: é assim que o
   * LinkedIn anuncia as vagas que terminam no site da empresa.
   */
  const EXTERNAL_APPLY_LABEL =
    /site da empresa|site da companhia|site externo|no site da|no site do|fora do linkedin|company (web ?)?site|external (site|link|apply)|apply (externally|on)( the)? company/i;

  /**
   * Rótulos (pt/en) de botão de Candidatura Simplificada (formulário do próprio
   * LinkedIn).
   */
  const EASY_APPLY_LABEL =
    /candidatura simplificada|simplificada|easy apply|(no|pelo|com o|with) linkedin|linkedin (application|bug)/i;

  /** Resultado da leitura do botão de candidatura. */
  const APPLY_KINDS = {
    easy: 'simplificada', // Candidatura Simplificada: o formulário abre aqui dentro
    external: 'externa', // o botão leva para o site da empresa
    unknown: 'desconhecida', // não deu para saber (botão ainda sem rótulo/ícone)
  };

  /**
   * Domínio de um endereço (para o motivo do relatório). Entende o
   * redirecionador do LinkedIn e devolve o domínio de destino. '' se ilegível.
   */
  function hostOf(href, depth) {
    const level = Number(depth) || 0;

    try {
      const url = new URL(String(href), 'https://www.linkedin.com/');
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

      if (level < 3 && onLinkedIn && /\/redir\/redirect/i.test(url.pathname)) {
        const target = url.searchParams.get('url');
        if (target && isOffsiteUrl(target)) return hostOf(target, level + 1);
      }

      return host;
    } catch (error) {
      return '';
    }
  }

  /**
   * O endereço leva para fora do LinkedIn? Também entende o redirecionador do
   * LinkedIn (`/redir/redirect?url=<destino>`), que é como ele embrulha os links
   * externos.
   */
  function isOffsiteUrl(href, depth) {
    const level = Number(depth) || 0;
    if (!href || level > 3) return false;

    let url;
    try {
      url = new URL(String(href), 'https://www.linkedin.com/');
    } catch (error) {
      return false;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

    if (!onLinkedIn) return true;

    if (/\/redir\/redirect/i.test(url.pathname)) {
      const target = url.searchParams.get('url');
      return target ? isOffsiteUrl(target, level + 1) : false;
    }

    return false;
  }

  /**
   * Que tipo de candidatura é esta, a partir dos sinais lidos na página do
   * LinkedIn: { href, label, externalIcon, easyIcon, insight }.
   *
   * A ordem é do sinal mais forte para o mais fraco: link de fora → ícone/rótulo
   * de fora → ícone/rótulo do LinkedIn → aviso de "Candidatura simplificada" na
   * vaga. Sem nenhum sinal, devolvemos `unknown` e quem chama decide — na
   * extensão a regra é: na dúvida, não clica, para nunca te levar para fora.
   */
  function classifyApply(signals) {
    const data = signals || {};
    const label = String(data.label || '').trim();
    const insight = String(data.insight || '');

    if (data.href && isOffsiteUrl(data.href)) return APPLY_KINDS.external;
    if (data.externalIcon) return APPLY_KINDS.external;
    if (label && EXTERNAL_APPLY_LABEL.test(label)) return APPLY_KINDS.external;

    if (data.easyIcon) return APPLY_KINDS.easy;
    if (label && EASY_APPLY_LABEL.test(label)) return APPLY_KINDS.easy;
    if (insight && EASY_APPLY_LABEL.test(insight)) return APPLY_KINDS.easy;

    return APPLY_KINDS.unknown;
  }

  /* ------------------------------------------------------------------------ */
  /* Popups do LinkedIn: formulário x avisos/pesquisas                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Texto em minúsculas, sem acento e com espaços colapsados. É o formato usado
   * para comparar rótulos de botão e perguntas (o LinkedIn varia em caixa e
   * acentuação entre as versões pt/en).
   */
  function plainText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * O que cada dialog do LinkedIn é. Só um deles é o formulário da Candidatura
   * Simplificada — o resto (pesquisa de avaliação, "salvar vaga", "seguir
   * empresa"…) pode aparecer por cima e precisa ser fechado, não preenchido.
   */
  const DIALOG_KINDS = {
    form: 'formulario', // formulário da Candidatura Simplificada
    survey: 'pesquisa', // popup de avaliação/pesquisa que aparece depois de enviar
    notice: 'aviso', // recado/confirmação (ex.: vaga salva, seguir empresa)
    unknown: 'desconhecido',
  };

  /** Sinais de que o dialog é o formulário da Candidatura Simplificada. */
  const APPLY_FORM_RE =
    /candidatura simplificada|easy apply|enviar candidatura|submit application|revisar|review|avancar|avançar|proxima etapa|proximo|next|curr[íi]culo|resume|anexar|upload|termos/i;

  /** Sinais de popup pós-candidatura (avaliação, pesquisa ou recado). */
  const POST_APPLY_RE =
    /avalie|avaliacao|avaliação|avaliar|como foi sua experiencia|experiencia de candidatura|pesquisa|survey|feedback|nos ajude a melhorar|help us improve|rate your|give feedback|obrigado por se candidatar|thanks for applying|salvar (esta )?vaga|save (this )?job|seguir|follow|compartilhar|share|recomendar|recommend|candidatura (foi )?enviad|application (was )?sent|voce se candidatou/i;

  /**
   * Rótulos que fecham/recusam um popup (pt + en), do mais específico ao mais
   * genérico. A ordem importa: "agora nao" é melhor que "nao".
   */
  const DISMISS_PATTERNS = [
    { key: 'fechar', re: /^(fechar|close|dismiss|sair)\b/ },
    { key: 'concluir', re: /^(concluir|done|entendi|got it|certo|ok)\b/ },
    { key: 'agora_nao', re: /(agora nao|not now|mais tarde|maybe later|later|depois)/ },
    { key: 'nao_obrigado', re: /(nao,\s?obrigad|no,\s?thanks|nao,\s?grato)/ },
    { key: 'dispensar', re: /(dispensar|dispens|ignorar|skip|pular)/ },
    { key: 'cancelar', re: /^(cancelar|cancel)\b/ },
    { key: 'nao', re: /^(nao|no)$/ },
  ];

  /** Botões que nunca clicamos para fechar: descartar apaga a candidatura. */
  const NEVER_DISMISS_RE = /descartar|discard|excluir|deletar|delete|remover|apagar/;

  /**
   * Classifica um dialog a partir dos sinais lidos na página:
   * { text, hasForm, hasApplyAction, hasClose }.
   *
   * Regras (na ordem):
   *   1. rodapé com "Avançar/Enviar candidatura"   -> formulário;
   *   2. texto de pós-candidatura sem cara de form -> pesquisa;
   *   3. tem campos de formulário com cara de candidatura -> formulário;
   *   4. tem rótulo de candidatura -> formulário;
   *   5. tem texto de pós-candidatura -> pesquisa;
   *   6. tem botão de fechar -> aviso;
   *   7. nada disso -> desconhecido (quem chama decide com cautela).
   */
  function classifyDialog(signals) {
    const data = signals || {};
    const text = plainText(data.text);
    const looksForm = APPLY_FORM_RE.test(text);
    const looksPost = POST_APPLY_RE.test(text);

    if (data.hasApplyAction) return DIALOG_KINDS.form;
    if (looksPost && !looksForm) return DIALOG_KINDS.survey;
    if (data.hasForm && looksForm) return DIALOG_KINDS.form;
    if (looksForm) return DIALOG_KINDS.form;
    if (looksPost) return DIALOG_KINDS.survey;
    if (data.hasClose) return DIALOG_KINDS.notice;

    return DIALOG_KINDS.unknown;
  }

  /**
   * Devolve o tipo de ação de fechar/recusar que o rótulo representa ('' se
   * nenhum). É o que autoriza clicar num botão de popup sem risco de descartar
   * uma candidatura.
   */
  function matchDismissLabel(label) {
    const text = plainText(label);
    if (!text || NEVER_DISMISS_RE.test(text)) return '';

    for (const pattern of DISMISS_PATTERNS) {
      if (pattern.re.test(text)) return pattern.key;
    }

    return '';
  }

  /** Resposta específica configurada para a pergunta ('' se não houver). */
  function answerForQuestion(question, answers) {
    const hint = plainText(question);
    const map = answers && typeof answers === 'object' ? answers : {};

    if (!hint) return '';

    for (const key of Object.keys(map)) {
      const name = plainText(key);
      const value = map[key];

      if (name && value != null && value !== '' && hint.includes(name)) {
        return String(value);
      }
    }

    return '';
  }

  /**
   * Escolhe uma resposta entre as opções de uma pergunta (rádio/lista) que veio
   * em branco, na ordem:
   *   1. resposta específica do usuário (`answers`) que case com a pergunta;
   *   2. "Sim" (ou "Não", se `prefs.yes === false`) — é o que o LinkedIn mais
   *      pergunta ("tem autorização?", "tem experiência com…?");
   *   3. a primeira opção que não seja um aviso de "Selecione…".
   * Devolve o rótulo escolhido ('' quando não há opção utilizável).
   */
  function pickChoice(options, prefs) {
    const list = (Array.isArray(options) ? options : []).map((label) =>
      String(label == null ? '' : label).trim()
    );
    const cfg = prefs || {};

    if (!list.length) return '';

    const wanted = answerForQuestion(cfg.question, cfg.answers);

    if (wanted) {
      const needle = plainText(wanted);
      const match = list.find((label) => plainText(label).includes(needle));
      if (match) return match;
    }

    const plain = list.map(plainText);
    const wantsNo = cfg.yes === false;
    const preferred = wantsNo ? /^(nao|no)\b/ : /^(sim|yes)\b/;
    const index = plain.findIndex((label) => preferred.test(label));

    if (index >= 0) return list[index];

    return (
      list.find((label) => !/^(selecione|escolha|select|choose|--)/.test(plainText(label))) || ''
    );
  }

  function applyOutcomeLabel(code) {
    if (!code) return '';
    if (code === APPLY_PENDING) return APPLY_PENDING_LABEL;
    const outcome = APPLY_OUTCOMES[code];
    return outcome ? outcome.label : String(code);
  }

  /**
   * Por que esta vaga não foi candidatada? Devolve null quando a candidatura foi
   * enviada. Com `options.applyEnabled = false`, as vagas intocadas aparecem
   * como "candidatura automática desligada".
   */
  function describeApplyFailure(job, options) {
    const value = job || {};
    const code = value.applyStatus;

    if (code === 'enviada') return null;

    if (code === APPLY_PENDING) {
      return {
        code,
        label: APPLY_PENDING_LABEL,
        reason: value.applyReason || 'Aguardando a cota de candidaturas liberar.',
        pending: true,
      };
    }

    const outcome = APPLY_OUTCOMES[code];

    if (outcome) {
      return {
        code,
        label: outcome.label,
        reason: value.applyReason || outcome.reason,
        pending: false,
      };
    }

    const enabled = !options || options.applyEnabled !== false;

    return {
      code: 'nao_tentada',
      label: APPLY_UNTOUCHED_LABEL,
      reason: enabled
        ? value.description
          ? 'Ainda não chegou a vez desta vaga (teto de vagas por varredura).'
          : 'Vaga capturada sem a descrição completa.'
        : 'Candidatura automática desligada.',
      pending: true,
    };
  }

  /**
   * Totais do relatório: candidatadas x não candidatadas — que se divide em
   * definitivas (precisam de você) e adiadas (a extensão tenta depois).
   */
  function summarizeApply(jobs, options) {
    const list = Array.isArray(jobs) ? jobs : Object.values(jobs || {});
    const summary = { total: list.length, applied: 0, failed: 0, pending: 0, reasons: [] };
    const byLabel = new Map();

    for (const job of list) {
      const failure = describeApplyFailure(job, options);

      if (!failure) {
        summary.applied += 1;
        continue;
      }

      if (failure.pending) summary.pending += 1;
      else summary.failed += 1;

      const entry = byLabel.get(failure.label) || {
        code: failure.code,
        label: failure.label,
        pending: failure.pending,
        count: 0,
      };

      entry.count += 1;
      byLabel.set(failure.label, entry);
    }

    summary.reasons = Array.from(byLabel.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')
    );

    return summary;
  }

  /** Ex.: "12 candidatada(s) · 8 não candidatada(s): 4 travada em campo…". */
  function describeApplySummary(summary) {
    if (!summary || !summary.total) return 'Nenhuma vaga capturada ainda.';

    let text = summary.applied + ' candidatada(s)';
    if (summary.failed) text += ' · ' + summary.failed + ' não candidatada(s)';
    if (summary.pending) text += ' · ' + summary.pending + ' na fila';

    const top = (summary.reasons || [])
      .filter((entry) => !entry.pending)
      .slice(0, 3)
      .map((entry) => entry.count + ' ' + entry.label.toLowerCase());

    return text + (top.length ? ': ' + top.join(' · ') : '');
  }

  /* ------------------------------------------------------------------------ */
  /* Textos de apoio para a interface                                          */
  /* ------------------------------------------------------------------------ */

  const LIMIT_LABELS = {
    term: 'por termo',
    hour: 'por hora',
    day24: 'em 24 h',
    day: 'no dia',
  };

  function formatCount(used, limit) {
    return used + '/' + (limit === Infinity ? '∞' : limit);
  }

  function formatClock(ts) {
    if (!Number.isFinite(ts)) return '--:--';
    const date = new Date(ts);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  /** Ex.: "Candidaturas — 2/10 na hora · 5/40 em 24 h · 8 hoje". */
  function describeQuota(quota) {
    const used = quota.used;
    const limits = quota.limits;
    const parts = [formatCount(used.hour, limits.hour) + ' na hora'];

    // A janela que a edição não usa (∞) fica de fora — no free, por exemplo, não
    // existe a cota de 24 h.
    if (limits.day24 !== Infinity) parts.push(formatCount(used.day24, limits.day24) + ' em 24 h');
    if (limits.day !== Infinity) parts.push(formatCount(used.day, limits.day) + ' hoje');
    parts.push(formatCount(used.term, limits.term) + ' neste termo');

    return 'Candidaturas — ' + parts.join(' · ');
  }

  function describeSchedule(schedule, now) {
    const cfg = schedule || {};
    if (!cfg.enabled) return 'Agendador desativado.';

    const window = formatDays(cfg.days) + ', ' + cfg.startTime + ' → ' + cfg.stopTime;

    if (isWithinSchedule(now || new Date(), cfg)) return 'Janela ativa: ' + window + '.';

    const next = nextScheduleStart(now || new Date(), cfg);
    if (!next) return 'Janela: ' + window + '.';

    const stamp = next.toLocaleString('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return 'Janela: ' + window + ' · próxima: ' + stamp + '.';
  }

  /* ------------------------------------------------------------------------ */
  /* Luz de status (ícone da extensão e cabeçalho do pop-up)                   */
  /* ------------------------------------------------------------------------ */

  /** Como cada motivo de pausa aparece para o usuário. */
  const PAUSE_REASON_LABELS = {
    cota: 'cota de candidaturas',
    guard: 'proteção da conta (limite do LinkedIn)',
    usuario: 'você estava usando o navegador',
    schedule: 'janela do agendador',
  };

  /** As três luzinhas: verde capturando, amarela pronta, vermelha atenção. */
  const STATUS_LIGHTS = {
    capturing: { key: 'capturing', color: '#1f9d55', label: 'Capturando' },
    ready: { key: 'ready', color: '#f0a500', label: 'Pronta' },
    attention: { key: 'attention', color: '#d93025', label: 'Precisa de atenção' },
  };

  /**
   * Traduz o estado da extensão na luzinha do ícone:
   *   capturing (verde)    - está capturando vagas agora;
   *   ready (amarela)      - pronta ou esperando algo normal (cota, janela do
   *                          agendador, descanso, você no navegador): volta só;
   *   attention (vermelha) - proteção da conta ligada (o LinkedIn avisou limite)
   *                          ou varredura que parou com problema.
   * Aceita tanto o estado lido do storage quanto o `PEGAVAGA_PROGRESS` que o
   * content script envia (que traz `scanning`, `run`, `guard` e `breakUntil`).
   */
  function statusLight(input) {
    const state = input || {};
    const now = Number.isFinite(state.now) ? state.now : Date.now();
    const run = state.run && state.run.running === true ? state.run : null;
    const guard =
      state.guard && Number(state.guard.blockedUntil) > now ? state.guard : null;
    const paused = Boolean(run && run.paused);
    const reason = (run && run.pauseReason) || 'cota';
    const why = PAUSE_REASON_LABELS[reason] || 'cota de candidaturas';

    // 1) Proteção da conta: a extensão parou sozinha para o LinkedIn não
    //    bloquear você — precisa da sua atenção (e de paciência).
    if (guard || (paused && reason === 'guard')) {
      const until = guard ? guard.blockedUntil : run.resumeAt;
      const reasonText = guard && guard.reason ? ' (' + guard.reason + ')' : '';

      return light(
        'attention',
        'LinkedIn sinalizou limite de uso' +
          reasonText +
          '. Descanso até ' +
          formatClock(until) +
          '.'
      );
    }

    // 2) A varredura bateu em algo (ex.: página sem a lista de vagas).
    if (run && run.problem) return light('attention', String(run.problem));

    // 3) Pausa normal: cota, janela do agendador, descanso ou vez do usuário.
    if (paused) {
      return light(
        'ready',
        'Pausada por ' + why + ' até ' + formatClock(run.resumeAt) + '.'
      );
    }

    if (Number(state.breakUntil) > now) {
      return light('ready', 'Descansando até ' + formatClock(state.breakUntil) + '.');
    }

    // 4) Fila ativa (ou varredura em andamento): capturando agora.
    if (run || state.scanning === true) {
      if (!run) return light('capturing', 'Capturando a página de vagas aberta.');

      const total = Array.isArray(run.urls) ? run.urls.length : Number(run.total) || 1;
      const position = 'termo ' + ((Number(run.index) || 0) + 1) + (total > 1 ? ' de ' + total : '');
      const label = run.term ? '"' + run.term + '"' : 'página atual';

      return light('capturing', 'Capturando vagas — ' + position + ': ' + label + '.');
    }

    // 5) Nada rodando.
    return light('ready', 'Pronta: nenhuma varredura em andamento.');
  }

  /* ------------------------------------------------------------------------ */
  /* Espera por evento: o DOM avisa, ninguém fica perguntando de 250 em 250 ms  */
  /* ------------------------------------------------------------------------ */

  /**
   * Fila de quem está esperando um sinal da página. O `content.js` chama
   * `wake()` a cada mutação do MutationObserver; então quem espera reage no
   * mesmo instante em que o LinkedIn mexe na tela — em vez de descobrir depois,
   * numa checagem por tempo, que a internet demorou.
   *
   * Não usa DOM: é só uma lista de ouvintes, o que a torna testável de verdade.
   */
  function createSignal() {
    const listeners = new Set();

    return {
      /** Quantos estão esperando agora (0 = não há por que acordar ninguém). */
      get size() {
        return listeners.size;
      },

      /** A página mexeu: avisa todo mundo. Um erro não derruba os outros. */
      wake() {
        if (!listeners.size) return;

        Array.from(listeners).forEach((listener) => {
          try {
            listener();
          } catch (error) {
            /* segue avisando os demais */
          }
        });
      },

      /** Espera o próximo sinal. Devolve a função que cancela a inscrição. */
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  /**
   * Espera `check()` devolver algo. É acordada pelo sinal (mutação na página),
   * com `pollMs` apenas como rede de segurança — para o que muda sem gerar
   * mutação, como digitar num campo — e `timeoutMs` como prazo final.
   * Devolve o valor de `check()` ou `null`.
   */
  function waitUntil(signal, check, timeoutMs, pollMs) {
    const attempt = () => {
      try {
        return check() || null;
      } catch (error) {
        return null;
      }
    };

    const immediate = attempt();
    if (immediate) return Promise.resolve(immediate);

    const step = Number(pollMs) || 0;
    const budget = Number(timeoutMs) || 0;

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let poll = null;
      let off = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        if (off) off();
        resolve(value || null);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => {
        const value = attempt();
        if (value) finish(value);
      }) : null;

      if (step > 0) {
        poll = setInterval(() => {
          const value = attempt();
          if (value) finish(value);
        }, step);
      }

      if (budget > 0) timer = setTimeout(() => finish(null), budget);
    });
  }

  /**
   * Espera a página ficar quieta: nenhuma mutação dentro de `ms`. É assim que o
   * content script sabe que a etapa terminou de carregar — olhando o que a
   * página está fazendo, não quanto tempo a internet levou. Devolve `true` se
   * houve silêncio (e `false` se algo mexeu antes).
   */
  function waitForQuiet(signal, ms) {
    const silence = Math.max(16, Number(ms) || 0);

    return new Promise((resolve) => {
      let settled = false;
      let off = null;

      const finish = (quiet) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (off) off();
        resolve(quiet);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => finish(false)) : null;
      const timer = setTimeout(() => finish(true), silence);
    });
  }

  /** Monta a luzinha com a cor do nível e o texto (tooltip) já pronto. */
  function light(key, detail) {
    const preset = STATUS_LIGHTS[key] || STATUS_LIGHTS.ready;

    return {
      key: preset.key,
      color: preset.color,
      label: preset.label,
      detail: detail,
      title: 'PegaVaga — ' + detail,
    };
  }

  return {
    STORAGE,
    MSG,
    DEFAULT_SETTINGS,
    PAUSE_REASON_LABELS,
    STATUS_LIGHTS,
    statusLight,
    LINKEDIN_SEARCH_URL,
    MAX_TERMS,
    HOUR_MS,
    DAY_MS,
    HISTORY_LIMIT,
    WEEKDAYS,
    LIMIT_LABELS,
    APPLY_OUTCOMES,
    APPLY_PENDING,
    APPLY_KINDS,
    DIALOG_KINDS,
    num,
    normalizeTerms,
    isLinkedInUrl,
    isLinkedInJobsUrl,
    buildSearchUrl,
    normalizeTime,
    timeToMinutes,
    minutesToTime,
    normalizeDays,
    formatDays,
    startOfDayMs,
    isWithinSchedule,
    nextScheduleStart,
    parseSettings,
    buildRunQueue,
    computeQuota,
    jitter,
    applyOutcomeLabel,
    hostOf,
    isOffsiteUrl,
    classifyApply,
    plainText,
    classifyDialog,
    matchDismissLabel,
    answerForQuestion,
    pickChoice,
    createSignal,
    waitUntil,
    waitForQuiet,
    describeApplyFailure,
    summarizeApply,
    describeApplySummary,
    describeQuota,
    describeSchedule,
    formatClock,
    perfilEdicao,
    temFeature,
  };
})();
