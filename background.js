/* =============================================================================
 * PegaVaga - background.js (service worker)
 *
 * É o agendador da extensão: roda independente do pop-up estar aberto.
 *
 *   - acorda a cada minuto (chrome.alarms) enquanto existir agendador ativo ou
 *     alguma execução pausada por cota;
 *   - dentro da janela de horário configurada, abre a busca do LinkedIn e
 *     deixa o content.js varrer termo por termo;
 *   - fora da janela, encerra a execução que estiver rodando;
 *   - respeita o período de descanso (proteção da conta) quando o LinkedIn
 *     sinaliza limite de uso: nem inicia, nem retoma nada enquanto ele durar;
 *   - quando uma cota (hora/24h/dia) libera espaço, cutuca a aba para o
 *     content.js retomar a varredura sozinho.
 *
 * O alarme só existe quando há algo para fazer, para não acordar o worker à
 * toa. O estado real vive em chrome.storage.local (fonte da verdade).
 * ===========================================================================*/

'use strict';

importScripts('edicoes.js');
importScripts('shared.js');

const SHARED = globalThis.PegaVagaShared;
const STORAGE = SHARED.STORAGE;
const MSG = SHARED.MSG;

const ALARM_NAME = 'pegavaga-tick';
const TICK_MINUTES = 1;
const LINKEDIN_TAB_PATTERN = 'https://www.linkedin.com/*';

/* Luzinha do ícone: o ponto colorido é desenhado por cima do próprio logo. Se o
 * canvas não estiver disponível, o selo colorido no canto assume o recado. */
const ICON_SIZES = [16, 32];
const ICON_FILES = { 16: 'icons/pg-16.png', 32: 'icons/pg-48.png' };

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  syncAlarm()
    .then(() => tick())
    .then(() => refreshStatus());
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarm()
    .then(() => tick())
    .then(() => refreshStatus());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) tick().then(() => refreshStatus());
});

/* O pop-up e o content script mudam settings/run direto no storage: aqui só
 * mantemos o alarme (e a luz do ícone) alinhados com o que precisa acontecer. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE.settings] || changes[STORAGE.run]) syncAlarm();
  if (changes[STORAGE.settings] || changes[STORAGE.run] || changes[STORAGE.guard]) {
    refreshStatus();
  }
});

/* O content script avisa o andamento mesmo com o pop-up fechado: assim a luz do
 * ícone acompanha a varredura em tempo real. */
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === MSG.PROGRESS) refreshStatus(message);
});

/* Ao subir um service worker novo, garante o alarme e a luz certos. */
syncAlarm();
refreshStatus();

/* -------------------------------------------------------------------------- */
/* Leitura de estado                                                           */
/* -------------------------------------------------------------------------- */

async function readState() {
  const data = await chrome.storage.local.get([
    STORAGE.settings,
    STORAGE.run,
    STORAGE.apps,
    STORAGE.guard,
  ]);

  const guard = data[STORAGE.guard] || null;

  return {
    settings: SHARED.parseSettings(data[STORAGE.settings]),
    run: data[STORAGE.run] || null,
    apps: Array.isArray(data[STORAGE.apps]) ? data[STORAGE.apps] : [],
    // Proteção da conta: enquanto durar, não automatizamos nada.
    guard: guard && guard.blockedUntil > Date.now() ? guard : null,
  };
}

function writeRun(run) {
  return chrome.storage.local.set({ [STORAGE.run]: run }).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* Luz do ícone (verde capturando · amarela pronta · vermelha atenção)         */
/* -------------------------------------------------------------------------- */

const iconBitmaps = new Map(); // PNGs do logo já decodificados
let paintedLight = null; // cor que está desenhada no ícone agora

/**
 * Acende a luz do ícone. Aceita um `PEGAVAGA_PROGRESS` recém-chegado (mais fresco
 * que o storage) ou lê o estado gravado. Nada disso é crítico: se o navegador
 * recusar, a extensão continua funcionando normalmente.
 */
async function refreshStatus(progress) {
  let source = progress && progress.type === MSG.PROGRESS ? progress : null;

  if (!source) {
    try {
      const state = await readState();
      source = { run: state.run, guard: state.guard };
    } catch (error) {
      return;
    }
  }

  try {
    await applyLight(SHARED.statusLight(source));
  } catch (error) {
    /* ícone é enfeite: falhar aqui não pode atrapalhar a varredura */
  }
}

async function applyLight(light) {
  setAction('setTitle', { title: light.title });

  if (paintedLight === light.color) return; // luz já está nesta cor

  const painted = await paintIcon(light.color).catch(() => false);

  if (painted) {
    paintedLight = light.color;
    setAction('setBadgeText', { text: '' });
    return;
  }

  // Plano B (sem OffscreenCanvas): logo original + selo colorido no canto.
  paintedLight = null;
  setAction('setIcon', { path: ICON_FILES });
  setAction('setBadgeText', { text: ' ' });
  setAction('setBadgeBackgroundColor', { color: light.color });
  setAction('setBadgeTextColor', { color: '#ffffff' });
}

/** Chama a API do ícone sem deixar promise solta nem derrubar o worker. */
function setAction(method, details) {
  try {
    const result = chrome.action[method](details);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (error) {
    /* método indisponível nesta versão do Chrome */
  }
}

/**
 * Desenha o ponto colorido por cima do logo. Devolve `false` quando o canvas não
 * está disponível, para o selo do canto assumir o recado.
 */
async function paintIcon(color) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
    return false;
  }

  const imageData = {};

  for (const size of ICON_SIZES) imageData[size] = await dotImage(size, color);

  await chrome.action.setIcon({ imageData });
  return true;
}

/** O logo do tamanho pedido, com a luz no canto inferior direito. */
async function dotImage(size, color) {
  const context = new OffscreenCanvas(size, size).getContext('2d');

  context.drawImage(await baseIcon(size), 0, 0, size, size);

  const radius = Math.max(3, Math.round(size * 0.2));
  const ring = Math.max(1, Math.round(size / 16));
  const center = size - radius - ring;

  // Anel branco: sem ele o ponto se perde no azul do logo.
  context.beginPath();
  context.arc(center, center, radius + ring, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();

  return context.getImageData(0, 0, size, size);
}

async function baseIcon(size) {
  if (!iconBitmaps.has(size)) {
    const response = await fetch(chrome.runtime.getURL(ICON_FILES[size]));
    iconBitmaps.set(size, await createImageBitmap(await response.blob()));
  }

  return iconBitmaps.get(size);
}

/* -------------------------------------------------------------------------- */
/* Alarme                                                                      */
/* -------------------------------------------------------------------------- */

/** Só mantém o alarme ligado quando há agendador ativo ou execução pausada. */
async function syncAlarm() {
  let state;

  try {
    state = await readState();
  } catch (error) {
    return;
  }

  const needed =
    state.settings.schedule.enabled || Boolean(state.run && state.run.paused) || Boolean(state.guard);
  const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);

  if (needed && !existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: TICK_MINUTES,
      periodInMinutes: TICK_MINUTES,
    });
    return;
  }

  if (!needed && existing) {
    await chrome.alarms.clear(ALARM_NAME).catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* Tick: o cérebro do agendador                                                */
/* -------------------------------------------------------------------------- */

async function tick() {
  let state;

  try {
    state = await readState();
  } catch (error) {
    return;
  }

  const { settings, run, guard } = state;
  const now = Date.now();
  const inWindow = SHARED.isWithinSchedule(new Date(now), settings.schedule);

  // 0) Proteção da conta ligada (o LinkedIn sinalizou limite de uso): nada de
  //    automação enquanto durar o descanso, nem retomada por cota.
  if (guard) {
    if (run && run.running && !run.paused) {
      await pauseRun(run, guard.blockedUntil, 'guard');
    }

    await syncAlarm();
    return;
  }

  // 1) Passou do horário: encerra a execução em andamento (a pausada espera).
  if (run && run.running && !run.paused && settings.schedule.enabled && !inWindow) {
    await stopRun(run);
    await syncAlarm();
    return;
  }

  // 2) Chegou o horário: começa sozinho.
  if (!run && canAutoStart(settings, now)) {
    await startRun(settings);
    await syncAlarm();
    return;
  }

  // 3) Execução pausada por cota: retoma quando a próxima vaga liberar.
  //    Fora da janela agendada ela continua parada (volta quando o horário abrir).
  if (run && run.running && run.paused && (!settings.schedule.enabled || inWindow)) {
    const quota = SHARED.computeQuota(settings, state.apps, now, run.appliedInTerm || 0);

    if (quota.ok) {
      await nudge(run);
    } else if (quota.resumeAt && quota.resumeAt !== run.resumeAt) {
      await writeRun(Object.assign({}, run, { resumeAt: quota.resumeAt, pauseReason: 'cota' }));
    }
  }

  await syncAlarm();
}

/** Guarda a fila pausada até `resumeAt`, explicando o motivo. */
function pauseRun(run, resumeAt, reason) {
  return writeRun(
    Object.assign({}, run, {
      paused: true,
      resumeAt: Number.isFinite(resumeAt) ? resumeAt : Date.now() + 60000,
      pauseReason: reason || 'cota',
    })
  );
}

function canAutoStart(settings, now) {
  if (!settings.schedule.enabled || !settings.schedule.autoStart) return false;
  if (!settings.terms.length) return false; // sem termos não há o que buscar
  return SHARED.isWithinSchedule(new Date(now), settings.schedule);
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

/** Monta a fila e manda a aba do LinkedIn carregar o primeiro termo. */
async function startRun(settings) {
  const run = SHARED.buildRunQueue(settings);
  run.source = 'agendador';

  const firstUrl = run.urls[0] || SHARED.LINKEDIN_SEARCH_URL;
  const focus = settings.schedule.focusTab !== false;

  // A fila é gravada ANTES de navegar: o content.js retoma ao carregar.
  await writeRun(run);

  const tab = await findLinkedInTab();
  let tabId = null;

  try {
    if (tab && tab.id != null) {
      tabId = tab.id;
      if (tab.url === firstUrl) {
        await chrome.tabs.reload(tabId);
      } else {
        await chrome.tabs.update(tabId, { url: firstUrl, active: focus });
      }
    } else {
      const created = await chrome.tabs.create({ url: firstUrl, active: focus });
      tabId = created && created.id;
    }
  } catch (error) {
    // Sem a aba, a fila fica gravada e o usuário pode clicar em Iniciar.
    return;
  }

  if (tabId != null) {
    run.tabId = tabId;
    await writeRun(run);
  }
}

/** Encerra a execução: apaga a fila (fonte da verdade) e avisa a aba. */
async function stopRun(run) {
  await chrome.storage.local.remove(STORAGE.run).catch(() => {});
  await sendToTab(run && run.tabId, { type: MSG.STOP });
}

/** Cutuca a aba pausada; se ninguém responder, recarrega (o load retoma). */
async function nudge(run) {
  const delivered = await sendToTab(run && run.tabId, { type: MSG.RESUME });
  if (delivered) return;

  if (run && run.tabId != null) {
    await chrome.tabs.reload(run.tabId).catch(() => {});
  }
}

/**
 * Procura uma aba do LinkedIn já aberta. O filtro por URL exige permissão de
 * host para o padrão (temos host_permissions para o LinkedIn); se o navegador
 * recusar, simplesmente abrimos uma aba nova.
 */
async function findLinkedInTab() {
  try {
    const tabs = await chrome.tabs.query({ url: LINKEDIN_TAB_PATTERN });
    const usable = (tabs || []).filter((tab) => tab && tab.id != null);
    return usable[0] || null;
  } catch (error) {
    return null;
  }
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    if (tabId == null) {
      resolve(false);
      return;
    }

    try {
      chrome.tabs.sendMessage(tabId, message, () => resolve(!chrome.runtime.lastError));
    } catch (error) {
      resolve(false);
    }
  });
}

