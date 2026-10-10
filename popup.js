/* =============================================================================
 * PegaVaga - popup.js
 * Interface do usuário: cadastra a busca (URL/perfil + termos), configura as
 * cotas de candidatura, o ritmo humano (furtividade) e o agendador, abre a aba
 * do LinkedIn quando necessário, dispara a varredura no content.js, mostra
 * contador/cotas e gera o .csv — inclusive o das vagas que não deu para
 * candidatar, com o motivo de cada uma.
 * ===========================================================================*/

'use strict';

/* -------------------------------------------------------------------------- */
/* Constantes compartilhadas com o content.js (ver shared.js)                  */
/* -------------------------------------------------------------------------- */

const SHARED = window.PegaVagaShared;
const MSG = SHARED.MSG;

const STORAGE_JOBS_KEY = SHARED.STORAGE.jobs;
const STORAGE_META_KEY = SHARED.STORAGE.meta;
const STORAGE_SETTINGS_KEY = SHARED.STORAGE.settings;
const STORAGE_RUN_KEY = SHARED.STORAGE.run;
const STORAGE_APPS_KEY = SHARED.STORAGE.apps;
const STORAGE_GUARD_KEY = SHARED.STORAGE.guard;

const CSV_HEADERS = [
  'ID',
  'Titulo',
  'Empresa',
  'Link',
  'Descricao',
  'Capturado em',
  'Termo',
  'Status da candidatura',
  'Motivo da nao candidatura',
  'Tentativas',
  'Candidatado em',
];

/* CSV enxuto, só com o que não deu para candidatar (e o porquê). */
const FAILURE_CSV_HEADERS = [
  'ID',
  'Titulo',
  'Empresa',
  'Link',
  'Termo',
  'Status',
  'Motivo',
  'Ultima tentativa',
];

const CSV_SEPARATOR = ';'; // Excel pt-BR usa ponto e vírgula como separador padrão

/** Como cada motivo de pausa aparece para o usuário (definido no shared.js). */
const PAUSE_LABELS = SHARED.PAUSE_REASON_LABELS;

const SAVE_DELAY_MS = 400; // debounce do salvamento automático da configuração
const DAY_LABELS = SHARED.WEEKDAYS;

/** Aviso quando o recurso pertence a outra edição (o free, por exemplo, não exporta). */
const AVISO_PREMIUM_EXPORT =
  'A exportação de relatórios é um recurso Premium — no free os dados ficam só neste navegador.';

/* -------------------------------------------------------------------------- */
/* Elementos da interface                                                      */
/* -------------------------------------------------------------------------- */

const els = {};
let saveTimer = null;
let settings = SHARED.parseSettings(null);
let appsCache = [];
let runCache = null;
let breakCache = null;
let guardCache = null; // proteção da conta em vigor (ou null)
let scanCache = false; // o content script está varrendo agora?

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  buildDayInputs();
  bindEvents();
  aplicarPerfilNaUI();

  await loadSettingsToForm();
  await refresh();
  await loadGuard();
  await syncScanningState();

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function cacheElements() {
  els.statusLight = document.getElementById('status-light');
  els.count = document.getElementById('count');
  els.lastRun = document.getElementById('last-run');
  els.runInfo = document.getElementById('run-info');
  els.quotaInfo = document.getElementById('quota-info');
  els.status = document.getElementById('status');
  els.btnStart = document.getElementById('btn-start');
  els.btnStop = document.getElementById('btn-stop');
  els.btnExport = document.getElementById('btn-export');
  els.btnClear = document.getElementById('btn-clear');
  els.settings = document.getElementById('settings');
  els.baseUrl = document.getElementById('base-url');
  els.location = document.getElementById('location');
  els.terms = document.getElementById('terms');
  els.termsPreview = document.getElementById('terms-preview');
  els.termsQueue = document.getElementById('terms-queue');
  els.settingsHint = document.getElementById('settings-hint');
  els.scheduleHint = document.getElementById('schedule-hint');
  els.applyEnabled = document.getElementById('apply-enabled');
  els.applyPerTerm = document.getElementById('apply-per-term');
  els.applyHour = document.getElementById('apply-hour');
  els.apply24h = document.getElementById('apply-24h');
  els.applyDay = document.getElementById('apply-day');
  els.applyScan = document.getElementById('apply-scan');
  els.applyRespectUser = document.getElementById('apply-respect-user');
  els.applyBreaks = document.getElementById('apply-breaks');
  els.applyDelayMin = document.getElementById('apply-delay-min');
  els.applyDelayMax = document.getElementById('apply-delay-max');
  els.applyBreakEvery = document.getElementById('apply-break-every');
  els.applyBreakSeconds = document.getElementById('apply-break-seconds');
  els.applyFillRequired = document.getElementById('apply-fill-required');
  els.applyAnswerYes = document.getElementById('apply-answer-yes');
  els.applyAnswerNumber = document.getElementById('apply-answer-number');
  els.applyAnswerText = document.getElementById('apply-answer-text');
  els.applySummary = document.getElementById('apply-summary');
  els.guardInfo = document.getElementById('guard-info');
  els.btnExportFailures = document.getElementById('btn-export-failures');
  els.scheduleEnabled = document.getElementById('schedule-enabled');
  els.scheduleStart = document.getElementById('schedule-start');
  els.scheduleStop = document.getElementById('schedule-stop');
  els.scheduleDays = document.getElementById('schedule-days');
  els.scheduleAutoStart = document.getElementById('schedule-autostart');
  els.scheduleFocus = document.getElementById('schedule-focus');

  // Elementos que só existem em certas edições (o perfil decide se aparecem).
  els.groupFurtividade = document.getElementById('group-furtividade');
  els.groupAgendador = document.getElementById('group-agendador');
  els.fieldApplyPerTerm = document.getElementById('field-apply-per-term');
  els.fieldApplyHour = document.getElementById('field-apply-hour');
  els.fieldApply24h = document.getElementById('field-apply-24h');
  els.fieldApplyDay = document.getElementById('field-apply-day');
  els.fieldApplyScan = document.getElementById('field-apply-scan');
  els.quotaFixedHint = document.getElementById('quota-fixed-hint');
  els.termsLimitHint = document.getElementById('terms-limit-hint');
  els.buildInfo = document.getElementById('build-info');
}

/** Versão declarada no manifest — é a mesma que o Chrome mostra em chrome://extensions. */
function versaoExtensao() {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch (erro) {
    return '';
  }
}

/**
 * Descreve as cotas que a edição impõe sozinha (as que não têm campo na UI).
 * Devolve '' quando nada é fixo (no premium o usuário ajusta tudo).
 */
function descreverCotasFixas(limites) {
  const fixas = limites || {};
  const partes = [];

  if (fixas.perTermFixo > 0) partes.push(fixas.perTermFixo + ' por termo');
  if (fixas.perHourFixo > 0) partes.push(fixas.perHourFixo + ' por hora');
  if (fixas.tetoDiarioFixo > 0) partes.push(fixas.tetoDiarioFixo + ' por dia');

  if (!partes.length) return '';
  return 'Cotas fixas nesta edição: ' + partes.join(' · ') + '.';
}

/**
 * Ajusta a cara da interface ao perfil da edição ativa: esconde o que a edição
 * não oferece (agendador, ritmo ajustável, cotas de termo/hora/24 h/dia e o teto
 * de vagas por termo) e deixa a exportação visível porém desabilitada. A regra de
 * verdade está no shared.js/parseSettings — aqui é só para o free não mostrar o
 * que não pode usar.
 */
function aplicarPerfilNaUI() {
  const perfil = SHARED.perfilEdicao();
  const cotas = perfil.limites.cotasEditaveis || [];

  const exibir = (el, mostrar) => {
    if (el) el.hidden = !mostrar;
  };

  exibir(els.groupAgendador, perfil.features.scheduler);
  exibir(els.groupFurtividade, perfil.features.furtividadeConfig);
  exibir(els.fieldApplyPerTerm, cotas.includes('term'));
  exibir(els.fieldApplyHour, cotas.includes('hour'));
  exibir(els.fieldApply24h, cotas.includes('day24'));
  exibir(els.fieldApplyDay, cotas.includes('day'));
  exibir(els.fieldApplyScan, perfil.features.scanConfig);

  // Sem campo na tela, as cotas impostas pelo motor viram um aviso legível.
  if (els.quotaFixedHint) {
    const texto = descreverCotasFixas(perfil.limites);
    els.quotaFixedHint.hidden = !texto;
    els.quotaFixedHint.textContent = texto;
  }

  // Exportação: o botão continua visível, mas desabilitado na edição que não
  // exporta (o free). O handler de clique recusa de novo — reativar o botão pelo
  // DevTools não adianta, pois quem decide é o perfil, não o atributo da tela.
  [els.btnExport, els.btnExportFailures].forEach((botao) => {
    if (!botao) return;
    botao.hidden = false;
    botao.disabled = !perfil.features.export;
    botao.title = perfil.features.export ? '' : AVISO_PREMIUM_EXPORT;
  });

  if (els.buildInfo) {
    const versao = versaoExtensao();
    els.buildInfo.textContent =
      (versao ? 'v' + versao + ' · ' : '') + 'edição ' + perfil.rotulo;
  }

  if (els.termsLimitHint) {
    const limitado = perfil.limites.maxTermos < SHARED.MAX_TERMS;
    els.termsLimitHint.hidden = !limitado;
    els.termsLimitHint.textContent =
      'A edição ' +
      perfil.rotulo +
      ' aceita até ' +
      perfil.limites.maxTermos +
      ' termos de vaga.';
  }
}

/** Monta as caixinhas dos dias da semana (0 = domingo). */
function buildDayInputs() {
  els.scheduleDays.textContent = '';
  els.dayInputs = [];

  DAY_LABELS.forEach((label, day) => {
    const wrapper = document.createElement('label');
    const input = document.createElement('input');

    input.type = 'checkbox';
    input.value = String(day);

    wrapper.appendChild(input);
    wrapper.appendChild(document.createTextNode(label));
    els.scheduleDays.appendChild(wrapper);

    els.dayInputs.push(input);
  });
}

function bindEvents() {
  els.btnStart.addEventListener('click', onStartClick);
  els.btnStop.addEventListener('click', onStopClick);
  els.btnExport.addEventListener('click', onExportClick);
  els.btnExportFailures.addEventListener('click', onExportFailuresClick);
  els.btnClear.addEventListener('click', onClearClick);

  // A configuração é salva sozinha alguns instantes após a digitação parar.
  const textInputs = [els.baseUrl, els.location, els.terms];
  const fieldInputs = [
    els.applyPerTerm,
    els.applyHour,
    els.apply24h,
    els.applyDay,
    els.applyScan,
    els.applyDelayMin,
    els.applyDelayMax,
    els.applyBreakEvery,
    els.applyBreakSeconds,
    els.applyAnswerNumber,
    els.applyAnswerText,
    els.scheduleStart,
    els.scheduleStop,
  ];

  textInputs.forEach((input) => input.addEventListener('input', onSettingsInput));
  fieldInputs.forEach((input) => input.addEventListener('input', onSettingsInput));

  [
    els.applyEnabled,
    els.applyRespectUser,
    els.applyBreaks,
    els.applyFillRequired,
    els.applyAnswerYes,
    els.scheduleEnabled,
    els.scheduleAutoStart,
    els.scheduleFocus,
  ].forEach((input) => input.addEventListener('change', onSettingsInput));

  els.dayInputs.forEach((input) => input.addEventListener('change', onSettingsInput));

  // Ao sair do campo, "limpa" a lista de termos (sem vazios e sem repetidos).
  els.terms.addEventListener('blur', () => saveSettingsFromForm({ normalizeForm: true }));
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Monta a fila de execução e garante que exista uma aba do LinkedIn na URL
 * correta. A fila é gravada em chrome.storage.local: se a aba for recarregada
 * (uma navegação por termo), o content.js retoma a fila sozinho ao carregar.
 */
async function onStartClick() {
  const parsed = await saveSettingsFromForm({ silent: true, normalizeForm: true });

  if (!parsed.baseUrl || !SHARED.isLinkedInUrl(parsed.baseUrl)) {
    setStatus(
      'Configure uma URL do LinkedIn (ex.: https://www.linkedin.com/jobs/search/).',
      'error'
    );
    openSettings();
    els.baseUrl.focus();
    return;
  }

  const tab = await getActiveTab();
  const tabUrl = (tab && tab.url) || '';
  const onLinkedIn = Boolean(tab && tab.id && SHARED.isLinkedInUrl(tabUrl));
  const onJobsPage = onLinkedIn && SHARED.isLinkedInJobsUrl(tabUrl);

  const run = SHARED.buildRunQueue(parsed);

  // Sem termos cadastrados e já na lista de vagas: varre o que está aberto.
  if (!parsed.terms.length && onJobsPage) {
    run.terms = [''];
    run.urls = [''];
    run.term = '';
  }

  // Resumo da fila, usado nas mensagens de início ("3 termos em loop (a → b)").
  const queue = describeQueue(run);

  // Se o agendador estiver ligado (ou a proteção da conta ativa), a execução
  // vai esperar: avisamos no mesmo lugar.
  const warn = buildWindowWarning(parsed) || buildGuardWarning(await getGuard());

  /** Fala na barra de status, avisando do agendador quando for o caso. */
  const say = (message, type) =>
    setStatus(warn ? message + ' ' + warn : message, warn ? 'warn' : type);

  await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });
  renderRun(run, run.urls.length);

  const firstUrl = run.urls[0];

  // 1) Já estamos na lista de vagas: dispara sem navegar.
  if (firstUrl === '' && onJobsPage) {
    await kickOffTab(tab.id, run, say);
    return;
  }

  // 2) Temos uma aba do LinkedIn: navega até a primeira busca configurada.
  if (onLinkedIn && tab.id) {
    if (tabUrl === firstUrl) {
      await kickOffTab(tab.id, run, say);
      return;
    }

    run.tabId = tab.id;
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });

    say(
      'Navegando para a primeira busca' +
        (queue ? ' (' + queue + ')' : '') +
        ' e iniciando a varredura…',
      'ok'
    );
    await chrome.tabs.update(tab.id, { url: firstUrl });
    return;
  }

  // 3) Não é uma aba do LinkedIn: abre uma nova aba já na busca configurada.
  say(
    'Abrindo a busca do LinkedIn em uma nova aba' +
      (queue ? ' (' + queue + ')' : '') +
      '…',
    'ok'
  );

  const created = await chrome.tabs.create({ url: firstUrl, active: true });

  if (created && created.id) {
    run.tabId = created.id;
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });
  }
}

/** Aviso quando o agendador está ligado e o horário ainda não chegou. */
function buildWindowWarning(parsed) {
  const now = new Date();

  if (!parsed.schedule.enabled) return '';
  if (SHARED.isWithinSchedule(now, parsed.schedule)) return '';

  const next = SHARED.nextScheduleStart(now, parsed.schedule);
  const when = next ? ' às ' + SHARED.formatClock(next.getTime()) : '';

  return 'Fora da janela do agendador' + when + ': a varredura fica aguardando o horário.';
}

/** Dispara a varredura numa aba já carregada e trata a resposta. */
async function kickOffTab(tabId, run, say) {
  const report = typeof say === 'function' ? say : setStatus;

  try {
    // Guardamos o id da aba na fila: é por ele que o agendador cutuca a página
    // depois, quando uma cota libera espaço.
    const payload = Object.assign({}, run, { tabId });
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: payload });
    run.tabId = tabId;

    const response = await sendToTab(tabId, { type: MSG.START, run: payload });

    if (!response || response.ok === false) {
      report(
        response && response.reason === 'already_scanning'
          ? 'A varredura já está em andamento.'
          : 'Não foi possível iniciar a varredura nesta página.',
        'warn'
      );
      return;
    }

    setScanning(true);

    const queue = describeQueue(run);
    report(
      'Varredura em andamento' +
        (queue ? ': ' + queue : '.') +
        ' O PegaVaga avança pelos termos sozinho.',
      'ok'
    );
  } catch (error) {
    setStatus(
      'Não consegui falar com a página. Recarregue o LinkedIn (F5) e tente de novo.',
      'error'
    );
  }
}

async function onStopClick() {
  // Remover a fila primeiro garante que o content.js não avance para o próximo
  // termo, mesmo que a aba que está varrendo não seja a aba ativa.
  await chrome.storage.local.remove(STORAGE_RUN_KEY);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      await sendToTab(tab.id, { type: MSG.STOP });
    } catch (error) {
      /* a página pode ter sido fechada; ignoramos */
    }
  }

  renderRun(null);
  setScanning(false);
  setStatus('Varredura interrompida.', 'warn');
}

async function onClearClick() {
  await chrome.storage.local.remove(STORAGE_RUN_KEY);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      await sendToTab(tab.id, { type: MSG.CLEAR });
    } catch (error) {
      /* ignoramos */
    }
  }

  await chrome.storage.local.remove([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
  await refresh();
  renderRun(null);
  setStatus('Dados limpos.', 'ok');
}


/* -------------------------------------------------------------------------- */
/* Configuração da busca                                                       */
/* -------------------------------------------------------------------------- */

async function loadSettingsToForm() {
  settings = await getSettings();

  els.baseUrl.value = settings.baseUrl;
  els.location.value = settings.location;
  els.terms.value = settings.terms.join('\n');

  els.applyEnabled.checked = settings.apply.enabled;
  els.applyPerTerm.value = String(settings.apply.perTerm);
  els.applyHour.value = String(settings.apply.perHour);
  els.apply24h.value = String(settings.apply.per24h);
  els.applyDay.value = String(settings.apply.perDay);
  els.applyScan.value = String(settings.apply.scanPerTerm);
  els.applyRespectUser.checked = settings.apply.respectUserActivity;
  els.applyBreaks.checked = settings.apply.breaksEnabled;
  els.applyDelayMin.value = String(secondsFromMs(settings.apply.minDelayMs));
  els.applyDelayMax.value = String(secondsFromMs(settings.apply.maxDelayMs));
  els.applyBreakEvery.value = String(settings.apply.breakEvery);
  els.applyBreakSeconds.value = String(secondsFromMs(settings.apply.breakMs));
  els.applyFillRequired.checked = settings.apply.fillRequired;
  els.applyAnswerYes.value = settings.apply.answerYes ? 'yes' : 'no';
  els.applyAnswerNumber.value = String(settings.apply.answerNumber);
  els.applyAnswerText.value = settings.apply.answerText;

  els.scheduleEnabled.checked = settings.schedule.enabled;
  els.scheduleStart.value = settings.schedule.startTime;
  els.scheduleStop.value = settings.schedule.stopTime;
  els.scheduleAutoStart.checked = settings.schedule.autoStart;
  els.scheduleFocus.checked = settings.schedule.focusTab;

  els.dayInputs.forEach((input) => {
    input.checked = settings.schedule.days.includes(Number(input.value));
  });

  renderTermsQueue();
  renderQuota();
  renderScheduleHint();
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  return SHARED.parseSettings(data[STORAGE_SETTINGS_KEY]);
}

/** O formulário mostra segundos; o storage guarda milissegundos. */
function secondsFromMs(value) {
  return Math.max(1, Math.round((Number(value) || 0) / 1000));
}

function msFromSeconds(value, fallbackMs) {
  const seconds = Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return Math.round(seconds * 1000);
}

function onSettingsInput() {
  renderTermsQueue(); // a fila de busca aparece na hora, antes de salvar
  els.settingsHint.className = 'hint';
  els.settingsHint.textContent = 'Salvando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettingsFromForm(), SAVE_DELAY_MS);
}

/**
 * Mostra, embaixo do campo, a fila de busca que vai rodar: os termos na ordem
 * digitada, um por vez, em loop. É o que deixa visível que vários termos foram
 * cadastrados (e não um único termo gigante).
 */
function renderTermsQueue() {
  const terms = SHARED.normalizeTerms(els.terms.value);
  const baseUrl = els.baseUrl.value || SHARED.DEFAULT_SETTINGS.baseUrl;
  const location = els.location.value;

  els.termsPreview.textContent = '';

  terms.forEach((term, index) => {
    const item = document.createElement('li');
    const order = document.createElement('b');

    order.textContent = String(index + 1) + '. ';
    item.appendChild(order);
    item.appendChild(document.createTextNode(term));
    item.title = SHARED.buildSearchUrl(baseUrl, term, location); // a busca de cada termo

    els.termsPreview.appendChild(item);
  });

  els.termsPreview.hidden = !terms.length;
  els.termsQueue.className = 'hint';
  els.termsQueue.textContent = terms.length
    ? 'A busca roda em loop, um termo por vez, nesta ordem (' +
      terms.length +
      (terms.length === 1 ? ' termo' : ' termos') +
      '). Passe o mouse sobre cada um para ver a busca.'
    : 'Sem termos: a varredura percorre a página de vagas que estiver aberta.';
}

/** Resume a fila que vai rodar: "3 termos em loop (react → node.js → vue)". */
function describeQueue(run) {
  const terms = (run && Array.isArray(run.terms) ? run.terms : []).filter(Boolean);
  if (!terms.length) return '';
  if (terms.length === 1) return 'Termo: ' + terms[0] + '.';

  const shown = terms.slice(0, 5).join(' → ') + (terms.length > 5 ? ' → …' : '');
  return terms.length + ' termos em loop (' + shown + ').';
}

/** Lê o formulário (busca + cotas + agendador) e grava no storage. */
async function saveSettingsFromForm(options) {
  const silent = Boolean(options && options.silent);
  const normalizeForm = Boolean(options && options.normalizeForm);

  const parsed = SHARED.parseSettings({
    baseUrl: els.baseUrl.value,
    location: els.location.value,
    terms: els.terms.value,
    apply: {
      enabled: els.applyEnabled.checked,
      perTerm: els.applyPerTerm.value,
      perHour: els.applyHour.value,
      per24h: els.apply24h.value,
      perDay: els.applyDay.value,
      scanPerTerm: els.applyScan.value,
      minDelayMs: msFromSeconds(els.applyDelayMin.value, settings.apply.minDelayMs),
      maxDelayMs: msFromSeconds(els.applyDelayMax.value, settings.apply.maxDelayMs),
      respectUserActivity: els.applyRespectUser.checked,
      breaksEnabled: els.applyBreaks.checked,
      breakEvery: els.applyBreakEvery.value,
      breakMs: msFromSeconds(els.applyBreakSeconds.value, settings.apply.breakMs),
      fillRequired: els.applyFillRequired.checked,
      answerYes: els.applyAnswerYes.value === 'yes',
      answerNumber: els.applyAnswerNumber.value,
      answerText: els.applyAnswerText.value,
      answers: settings.apply.answers, // respostas específicas: só o storage as guarda
    },
    schedule: {
      enabled: els.scheduleEnabled.checked,
      autoStart: els.scheduleAutoStart.checked,
      startTime: els.scheduleStart.value,
      stopTime: els.scheduleStop.value,
      days: els.dayInputs.filter((input) => input.checked).map((input) => Number(input.value)),
      focusTab: els.scheduleFocus.checked,
    },
  });

  // Só mexemos nos campos quando não estamos no meio da digitação.
  if (normalizeForm) {
    const normalizedText = parsed.terms.join('\n');
    if (els.terms.value !== normalizedText) els.terms.value = normalizedText;

    els.applyPerTerm.value = String(parsed.apply.perTerm);
    els.applyHour.value = String(parsed.apply.perHour);
    els.apply24h.value = String(parsed.apply.per24h);
    els.applyDay.value = String(parsed.apply.perDay);
    els.applyScan.value = String(parsed.apply.scanPerTerm);
    els.applyBreakEvery.value = String(parsed.apply.breakEvery);
  }

  settings = parsed;
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: parsed });

  renderTermsQueue();
  renderQuota();
  renderScheduleHint();

  if (!silent) {
    els.settingsHint.className = 'hint ok';
    els.settingsHint.textContent =
      'Salvo automaticamente às ' + new Date().toLocaleTimeString('pt-BR') + '.';
  }

  return parsed;
}

function openSettings() {
  els.settings.open = true;
}

/* -------------------------------------------------------------------------- */
/* Leitura de dados                                                            */
/* -------------------------------------------------------------------------- */

async function getJobsArray() {
  const data = await chrome.storage.local.get([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
  const map = data[STORAGE_JOBS_KEY] || {};

  return Object.values(map).sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR')
  );
}

async function getMeta() {
  const data = await chrome.storage.local.get(STORAGE_META_KEY);
  return data[STORAGE_META_KEY] || null;
}

async function getRun() {
  const data = await chrome.storage.local.get(STORAGE_RUN_KEY);
  runCache = data[STORAGE_RUN_KEY] || null;
  return runCache;
}

/** Histórico de candidaturas (base das cotas por hora/24 h/dia). */
async function loadAppsCache() {
  try {
    const data = await chrome.storage.local.get(STORAGE_APPS_KEY);
    const list = data[STORAGE_APPS_KEY];
    appsCache = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
  } catch (error) {
    appsCache = [];
  }

  return appsCache;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

async function refresh() {
  const jobs = await getJobsArray();
  const meta = await getMeta();

  await loadAppsCache();

  els.count.textContent = String(jobs.length);

  if (meta && meta.lastRun) {
    const when = new Date(meta.lastRun);
    els.lastRun.textContent = isNaN(when.getTime())
      ? 'Última varredura: —'
      : 'Última varredura: ' + when.toLocaleString('pt-BR');
  } else {
    els.lastRun.textContent = 'Nenhuma varredura realizada';
  }

  // A edição manda: sem feature de exportação, o botão fica desabilitado mesmo
  // com vagas capturadas (o handler recusa de novo, por garantia).
  els.btnExport.disabled = !SHARED.temFeature('export') || jobs.length === 0;
  renderApplySummary(jobs);
  renderQuota();
}

/**
 * Resumo do relatório: quantas vagas foram candidatadas, quantas não foram e,
 * no fim, o motivo mais frequente. Também liga/desliga o botão de exportar só
 * as não candidatadas.
 */
function renderApplySummary(jobs) {
  if (!els.applySummary) return;

  const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });

  els.applySummary.textContent = SHARED.describeApplySummary(summary);

  if (els.btnExportFailures) {
    const podeExportar = SHARED.temFeature('export');
    const semCandidatura = summary.failed + summary.pending;

    els.btnExportFailures.disabled = !podeExportar || semCandidatura === 0;

    // Sem a feature, o título continua sendo o aviso de recurso Premium definido
    // ao aplicar o perfil (não o sobrescrevemos aqui).
    if (podeExportar) {
      els.btnExportFailures.title = summary.failed
        ? summary.failed + ' vaga(s) definitivamente não candidatada(s)'
        : 'Vagas que ainda não foram candidatadas';
    }
  }
}

/** Faixa de aviso quando a proteção da conta (limite do LinkedIn) está ligada. */
function renderGuard(guard) {
  guardCache = guard || null;
  renderStatusLight();

  if (!els.guardInfo) return;

  const active = guard && guard.blockedUntil > Date.now();

  if (!active) {
    els.guardInfo.hidden = true;
    els.guardInfo.textContent = '';
    return;
  }

  els.guardInfo.hidden = false;
  els.guardInfo.textContent =
    '⛔ LinkedIn sinalizou limite de uso' +
    (guard.reason ? ' (' + guard.reason + ')' : '') +
    ': a automação está descansando até ' +
    SHARED.formatClock(guard.blockedUntil) +
    '. Aproveite para revisar as vagas já capturadas.';
}

/** Reativa o aviso de proteção gravado no storage. */
async function loadGuard() {
  renderGuard(await getGuard());
}

/** Proteção da conta ativa (ou null), lida do storage. */
async function getGuard() {
  try {
    const data = await chrome.storage.local.get(STORAGE_GUARD_KEY);
    const guard = data[STORAGE_GUARD_KEY] || null;
    return guard && guard.blockedUntil > Date.now() ? guard : null;
  } catch (error) {
    return null;
  }
}

/** Aviso quando o LinkedIn sinalizou limite de uso e a extensão está descansando. */
function buildGuardWarning(guard) {
  if (!guard) return '';

  return (
    'O LinkedIn sinalizou limite de uso: a automação fica parada até ' +
    SHARED.formatClock(guard.blockedUntil) +
    '.'
  );
}

/** Linha de cotas: quantas candidaturas cabem agora em cada janela. */
function renderQuota() {
  if (!els.quotaInfo) return;

  const quota = SHARED.computeQuota(
    settings,
    appsCache,
    Date.now(),
    (runCache && runCache.appliedInTerm) || 0
  );

  els.quotaInfo.textContent = SHARED.describeQuota(quota);
}

/** Explica o agendador: janela, próxima abertura ou pausa por cota. */
function renderScheduleHint() {
  if (!els.scheduleHint) return;

  const now = new Date();
  const paused = runCache && runCache.paused && runCache.resumeAt;

  if (paused) {
    const why = PAUSE_LABELS[runCache.pauseReason] || 'cota de candidaturas';
    els.scheduleHint.className = 'hint';
    els.scheduleHint.textContent =
      'Pausado por ' +
      why +
      ' até ' +
      SHARED.formatClock(runCache.resumeAt) +
      '. ' +
      SHARED.describeSchedule(settings.schedule, now);
    return;
  }

  els.scheduleHint.className = 'hint' + (settings.schedule.enabled ? ' ok' : '');
  els.scheduleHint.textContent = SHARED.describeSchedule(settings.schedule, now);
}

/** Mostra na interface em qual termo da fila a varredura está. */
function renderRun(run, totalFallback, breakUntil) {
  runCache = run || null;
  if (breakUntil) breakCache = breakUntil;
  if (!breakUntil && !(run && run.running)) breakCache = null;

  renderQuota();
  renderScheduleHint();
  renderStatusLight();

  if (run && run.running) {
    const total =
      totalFallback || (Array.isArray(run.urls) ? run.urls.length : 1) || 1;
    const label = run.term ? `"${run.term}"` : 'página atual';

    let info =
      total > 1
        ? `Termo ${(run.index || 0) + 1} de ${total}: ${label}`
        : `Buscando ${label}`;

    if (settings.apply.enabled) {
      info += ` · ${run.appliedInTerm || 0} candidatura(s) neste termo`;
    }

    if (run.paused && run.resumeAt) {
      const why = PAUSE_LABELS[run.pauseReason] || 'cota de candidaturas';
      info += ` · pausado por ${why} até ${SHARED.formatClock(run.resumeAt)}`;
    }

    if (breakCache) {
      info += ` · descansando até ${SHARED.formatClock(breakCache)}`;
    }

    if (run.problem) {
      info += ` · ⚠ ${run.problem}`; // mesmo aviso da luz vermelha do ícone
    }

    els.runInfo.textContent = info;
    els.runInfo.hidden = false;
    return;
  }

  els.runInfo.hidden = true;
  els.runInfo.textContent = '';
}

/** Descobre se há varredura em andamento (fila no storage ou ping na aba). */
async function syncScanningState() {
  const run = await getRun();
  renderRun(run);

  let scanning = Boolean(run && run.running);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      const response = await sendToTab(tab.id, { type: MSG.PING });
      scanning = scanning || Boolean(response && response.scanning);
    } catch (error) {
      /* aba sem content script: mantém o que a fila informou */
    }
  }

  setScanning(scanning);
}

function setScanning(isScanning) {
  scanCache = Boolean(isScanning);
  els.btnStart.disabled = scanCache;
  els.btnStop.disabled = !scanCache;
  renderStatusLight();
}

/**
 * Acende a luzinha do cabeçalho com a mesma leitura que o ícone da extensão usa:
 * verde capturando, amarela pronta, vermelha quando precisa de atenção.
 */
function renderStatusLight() {
  if (!els.statusLight) return;

  const light = SHARED.statusLight({
    run: runCache,
    guard: guardCache,
    scanning: scanCache,
    breakUntil: breakCache,
  });

  els.statusLight.className = 'light ' + light.key;
  els.statusLight.title = light.title;
  els.statusLight.setAttribute('aria-label', light.label);
}

function setStatus(message, type) {
  els.status.textContent = message;
  els.status.className = 'status' + (type ? ' ' + type : '');
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function buildCSV(jobs) {
  const options = { applyEnabled: settings.apply.enabled };
  const rows = [CSV_HEADERS];

  for (const job of jobs) {
    const failure = SHARED.describeApplyFailure(job, options);

    rows.push([
      job.id || '',
      job.title || '',
      job.company || '',
      job.link || '',
      job.description || '',
      formatDate(job.capturedAt),
      job.term || '',
      failure ? failure.label : SHARED.applyOutcomeLabel(job.applyStatus),
      failure ? failure.reason : '', // em branco quando a candidatura foi enviada
      job.applyStatus ? String(job.applyAttempts || 0) : '',
      formatDate(job.appliedAt),
    ]);
  }

  const body = rows.map((row) => row.map(escapeCSVField).join(CSV_SEPARATOR));

  // \uFEFF (BOM) garante que o Excel reconheça o arquivo como UTF-8.
  return '\uFEFF' + body.join('\r\n');
}

/**
 * CSV só com as vagas que não foi possível candidatar, cada uma com o motivo.
 * Devolve null quando todas as vagas capturadas foram candidatadas.
 */
function buildFailuresCSV(jobs) {
  const options = { applyEnabled: settings.apply.enabled };
  const rows = [];

  for (const job of jobs) {
    const failure = SHARED.describeApplyFailure(job, options);
    if (!failure) continue;

    rows.push([
      job.id || '',
      job.title || '',
      job.company || '',
      job.link || '',
      job.term || '',
      failure.label,
      failure.reason,
      formatDate(job.applyTriedAt || job.appliedAt),
    ]);
  }

  if (!rows.length) return null;

  const body = [FAILURE_CSV_HEADERS]
    .concat(rows)
    .map((row) => row.map(escapeCSVField).join(CSV_SEPARATOR));

  return '\uFEFF' + body.join('\r\n');
}

function escapeCSVField(value) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Sempre entre aspas: protege separadores, quebras de linha e acentos.
  return '"' + text.replace(/"/g, '""') + '"';
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
}

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Libera a memória depois que o download já foi iniciado.
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function timestampForFilename() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
}

/* -------------------------------------------------------------------------- */
/* Utilidades de mensageria                                                    */
/* -------------------------------------------------------------------------- */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function onRuntimeMessage(message) {
  if (!message || message.type !== MSG.PROGRESS) return;

  els.count.textContent = String(message.count || 0);
  renderRun(message.run, null, message.breakUntil);
  renderGuard(message.guard || null);
  setScanning(
    Boolean(message.scanning) || Boolean(message.run && message.run.running)
  );
}

function onStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes[STORAGE_JOBS_KEY]) refresh();

  if (changes[STORAGE_GUARD_KEY]) renderGuard(changes[STORAGE_GUARD_KEY].newValue || null);

  if (changes[STORAGE_SETTINGS_KEY] && changes[STORAGE_SETTINGS_KEY].newValue) {
    settings = SHARED.parseSettings(changes[STORAGE_SETTINGS_KEY].newValue);
  }

  if (changes[STORAGE_APPS_KEY]) {
    const list = changes[STORAGE_APPS_KEY].newValue;
    appsCache = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
  }

  if (
    changes[STORAGE_APPS_KEY] ||
    changes[STORAGE_SETTINGS_KEY] ||
    changes[STORAGE_RUN_KEY]
  ) {
    renderQuota();
    renderScheduleHint();
  }

  if (changes[STORAGE_RUN_KEY]) {
    const run = changes[STORAGE_RUN_KEY].newValue || null;
    renderRun(run);
    setScanning(Boolean(run && run.running));
  }
}

async function onExportClick() {
  if (!SHARED.temFeature('export')) {
    setStatus(AVISO_PREMIUM_EXPORT, 'warn');
    return;
  }

  const jobs = await getJobsArray();

  if (!jobs.length) {
    setStatus('Nenhuma vaga capturada ainda. Rode a varredura primeiro.', 'warn');
    return;
  }

  try {
    const csv = buildCSV(jobs);
    downloadFile(csv, `pegavaga_${timestampForFilename()}.csv`);

    const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });

    setStatus(
      `${jobs.length} vaga(s) exportada(s) — ` + SHARED.describeApplySummary(summary) + '.',
      'ok'
    );
  } catch (error) {
    setStatus('Falha ao gerar o arquivo: ' + error.message, 'error');
  }
}

/**
 * Exporta apenas as vagas que não foi possível candidatar, uma por linha, com o
 * motivo (site externo, campo obrigatório, cota estourada…).
 */
async function onExportFailuresClick() {
  if (!SHARED.temFeature('export')) {
    setStatus(AVISO_PREMIUM_EXPORT, 'warn');
    return;
  }

  const jobs = await getJobsArray();

  try {
    const csv = buildFailuresCSV(jobs);

    if (!csv) {
      setStatus('Todas as vagas capturadas foram candidatadas. Nada a relatar.', 'ok');
      return;
    }

    const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });
    const semCandidatura = summary.failed + summary.pending;

    downloadFile(csv, `pegavaga_nao_candidatadas_${timestampForFilename()}.csv`);

    setStatus(
      semCandidatura +
        ' vaga(s) sem candidatura exportada(s) com o motivo (' +
        summary.failed +
        ' definitiva(s) e ' +
        summary.pending +
        ' na fila).',
      summary.failed ? 'warn' : 'ok'
    );
  } catch (error) {
    setStatus('Falha ao gerar o arquivo: ' + error.message, 'error');
  }
}
