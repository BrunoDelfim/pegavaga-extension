/* =============================================================================
 * PegaVaga - tests/smoke-agendador.js
 *
 * Teste de fumaca da INDEPENDENCIA entre as duas varreduras: a automatica (do
 * agendador) e a do usuario (o botao Iniciar do pop-up).
 *
 * O caso que trouxe este teste (relato de 12/10/2026, 02:35): com o agendador
 * ligado na janela 08:00 -> 18:00, clicar em Iniciar montava a fila e ela ficava
 * parada ate o horario abrir — e, antes disso, o worker encerrava a fila quando a
 * janela fechava. Agora as duas sao independentes:
 *
 *   1. a janela governa SO a fila que o agendador montou (a que tem
 *      `source: 'agendador'`): a do usuario roda a qualquer hora;
 *   2. o worker nao encerra nem segura a fila do usuario fora da janela — e
 *      continua encerrando/segurando a dele, exatamente como antes;
 *   3. a protecao da conta (descanso pedido pelo LinkedIn) vale para as duas;
 *   4. com o agendador no comando da janela (janela aberta + "comecar sozinho"),
 *      o pop-up tira o botao Iniciar de cena e o rotulo vira "Varredura
 *      automatica em execucao" — a nao ser que a fila em andamento seja do
 *      usuario, que continua sendo dele.
 *
 * Roda no Node puro, sem npm install, e exercita as tres pontas de verdade:
 *
 *   1. a regra pura do shared.js (`filaAutomatica` e `agendadorNoComando`), que e
 *      quem decide nos tres contextos;
 *   2. o background.js RODANDO com um `chrome` falso (o alarme de 1 minuto e
 *      disparado a mao), com o perfil premium em cache — sem ele o `parseSettings`
 *      desliga o agendador e o cenario nem existe;
 *   3. o popup.js rodando num DOM falso (um elemento por id), como o navegador
 *      faria.
 *
 *   node tests/smoke-agendador.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');

let falhas = 0;
let total = 0;

function ok(nome, cond, detalhe) {
  total += 1;
  if (!cond) {
    falhas += 1;
    console.log('  FALHA ' + nome + (detalhe === undefined ? '' : '  -> ' + detalhe));
    return;
  }
  console.log('  ok    ' + nome);
}

/** Deixa as promessas pendentes da ponta testada terminarem. */
async function respirar(voltas) {
  const n = voltas || 20;
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

for (const arquivo of ['edicoes.js', 'shared.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), { filename: arquivo });
}

// Sem rede: o perfil vem do cache local, como num navegador offline.
globalThis.fetch = () => Promise.reject(new Error('sem rede no teste'));

const S = globalThis.PegaVagaShared;

if (!S || typeof S.filaAutomatica !== 'function' || typeof S.agendadorNoComando !== 'function') {
  console.log('FALHA: o shared.js nao carregou (ou perdeu filaAutomatica/agendadorNoComando).');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* A fila de teste, a configuracao e o perfil                                  */
/* -------------------------------------------------------------------------- */

/** Uma fila em andamento. Sem `source`: e do pop-up (o usuario). */
function fila(extras) {
  return Object.assign(
    {
      running: true,
      paused: false,
      resumeAt: null,
      pauseReason: null,
      index: 0,
      term: 'desenvolvedor fullstack',
      terms: ['desenvolvedor fullstack'],
      urls: ['https://www.linkedin.com/jobs/search/?keywords=desenvolvedor+fullstack'],
      appliedInTerm: 0,
      visitedInTerm: 0,
      appliedTotal: 0,
      sinceBreak: 0,
      startedAt: new Date().toISOString(),
    },
    extras || {}
  );
}

/** "HH:MM" de agora mais um deslocamento em minutos (para a janela do teste). */
function relogio(deslocamentoMin) {
  const quando = new Date(Date.now() + deslocamentoMin * 60000);
  return (
    String(quando.getHours()).padStart(2, '0') + ':' + String(quando.getMinutes()).padStart(2, '0')
  );
}

/**
 * Uma configuracao com o agendador ligado. `dentro` escolhe a janela: cobrindo
 * agora (-30/+30 min) ou excluindo agora (+2h/+3h) — assim o teste vale em
 * qualquer hora do dia (ou da noite) em que ele rodar.
 */
function configComJanela(dentro) {
  return {
    baseUrl: 'https://www.linkedin.com/jobs/search/',
    location: 'São Paulo',
    terms: ['desenvolvedor fullstack'],
    apply: { enabled: true, perTerm: 4, perHour: 3, per24h: 25, perDay: 9, scanPerTerm: 40 },
    schedule: {
      enabled: true,
      autoStart: true,
      startTime: dentro ? relogio(-30) : relogio(120),
      stopTime: dentro ? relogio(30) : relogio(180),
      days: [0, 1, 2, 3, 4, 5, 6],
      focusTab: false,
    },
  };
}

/** A mesma configuracao com um campo do agendador trocado. */
function configComAgendador(dentro, mudanca) {
  const config = configComJanela(dentro);
  config.schedule = Object.assign({}, config.schedule, mudanca || {});
  return config;
}

/**
 * O perfil premium em cache (`pegavaga_perfil`), como o servidor grava. Sem ele o
 * `parseSettings` corta o agendador (o free nao tem) e o cenario nem existe.
 */
const PERFIL_PREMIUM = {
  perfil: {
    plano: 'premium',
    rotulo: 'Premium',
    estado: 'active',
    expiresAt: '2027-01-15T08:00:00Z',
    conta: { email: 'cliente@exemplo.com', papel: 'usuario' },
    features: {
      autoApply: true,
      formFill: true,
      scheduler: true,
      export: true,
      furtividadeConfig: true,
      cotasAvancadas: true,
      scanConfig: true,
      painelAdmin: false,
    },
    limites: {
      maxTermos: 40,
      cotasEditaveis: ['term', 'hour', 'day24', 'day'],
      perTermFixo: 0,
      perHourFixo: 0,
      tetoDiarioFixo: 0,
      scanPerTermFixo: 0,
      per24h: 25,
    },
  },
  salvoEm: Date.now(),
};

/**
 * A sessao em cache (`pegavaga_sessao`), como o login grava. O pop-up so mantem
 * uma assinatura no cache LOCAL quando existe sessao: sem ela, a sincronizacao sem
 * rede cai para o free — e o free nem tem agendador.
 */
const SESSAO_DE_TESTE = {
  email: 'cliente@exemplo.com',
  papel: 'usuario',
  expiraEm: '2027-01-15T08:00:00Z',
  token: 'token-de-mentira',
};

/* -------------------------------------------------------------------------- */
/* 1) As regras puras (shared.js)                                              */
/* -------------------------------------------------------------------------- */
//
// A regra e o coracao da mudanca, e ela vive no shared.js justamente para poder
// ser conferida assim: sem DOM, sinal por sinal.

function conferirRegras() {
  console.log('== A MARCA DA FILA ==');

  ok('a origem do agendador vive no contrato', S.ORIGEM_AGENDADOR === 'agendador', S.ORIGEM_AGENDADOR);
  ok(
    'fila marcada pelo agendador: automatica',
    S.filaAutomatica({ source: S.ORIGEM_AGENDADOR }) === true
  );
  ok('fila do pop-up (sem marca): e do usuario', S.filaAutomatica(fila()) === false);
  ok('sem fila: nao e automatica', S.filaAutomatica(null) === false);
  ok('fila vazia: nao e automatica', S.filaAutomatica({}) === false);

  console.log('');
  console.log('== QUEM ESTA NO COMANDO ==');

  const dentro = new Date(2026, 9, 12, 10, 0); // 12/10/2026, 10:00 (dentro da janela)
  const fora = new Date(2026, 9, 12, 3, 0); // o mesmo dia as 03:00 (o caso do relato)
  const janela = {
    enabled: true,
    autoStart: true,
    startTime: '08:00',
    stopTime: '18:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    focusTab: false,
  };

  ok(
    'janela aberta + comecar sozinho, nada rodando: o agendador manda',
    S.agendadorNoComando(janela, null, dentro) === true
  );
  ok(
    'janela aberta + fila do agendador: ele manda',
    S.agendadorNoComando(janela, fila({ source: S.ORIGEM_AGENDADOR }), dentro) === true
  );
  ok(
    'janela aberta + fila do USUARIO rodando: quem manda e o usuario',
    S.agendadorNoComando(janela, fila(), dentro) === false
  );
  ok(
    'fila do usuario ja parada nao segura o agendador',
    S.agendadorNoComando(janela, fila({ running: false }), dentro) === true
  );
  ok(
    'fora da janela: o agendador nao esta no comando',
    S.agendadorNoComando(janela, null, fora) === false
  );
  ok(
    'sem "comecar sozinho": o agendador nao assume a janela',
    S.agendadorNoComando(Object.assign({}, janela, { autoStart: false }), null, dentro) === false
  );
  ok(
    'sem agendador ligado: ninguem no comando',
    S.agendadorNoComando(Object.assign({}, janela, { enabled: false }), null, dentro) === false
  );
  ok('sem configuracao: ninguem no comando', S.agendadorNoComando(null, null, dentro) === false);
}

/* -------------------------------------------------------------------------- */
/* 2) O worker (background.js) com um `chrome` falso                           */
/* -------------------------------------------------------------------------- */
//
// So o que o background.js usa. O que interessa ao teste: `armazem` (o storage,
// fonte da verdade da fila), `enviados` (o que chega na aba) e `ouvintesAlarme`
// (por onde o alarme de 1 minuto dispara o tick).

const armazem = new Map();
const enviados = []; // { tabId, mensagem } mandados para a aba
const ouvintesAlarme = [];
const ouvintesStorage = [];

/** O `chrome.storage.local` de mentira — o mesmo para o worker e o pop-up. */
function storageFalso(ouvintes) {
  return {
    local: {
      async get(chaves) {
        const lista = Array.isArray(chaves) ? chaves : [chaves];
        const saida = {};
        lista.forEach((chave) => {
          if (armazem.has(chave)) saida[chave] = armazem.get(chave);
        });
        return saida;
      },
      async set(objeto) {
        Object.entries(objeto).forEach(([chave, valor]) => armazem.set(chave, valor));
      },
      async remove(chaves) {
        (Array.isArray(chaves) ? chaves : [chaves]).forEach((chave) => armazem.delete(chave));
      },
    },
    onChanged: {
      addListener(fn) {
        ouvintes.push(fn);
      },
    },
  };
}

/** Dispara o onChanged do storage, como outro contexto faria. */
async function mudarPorFora(alteracoes) {
  const changes = {};

  Object.keys(alteracoes).forEach((chave) => {
    const valor = alteracoes[chave];
    if (valor === null) armazem.delete(chave);
    else armazem.set(chave, valor);
    changes[chave] = { newValue: valor === null ? undefined : valor };
  });

  ouvintesStorage.forEach((fn) => fn(changes, 'local'));
  await respirar(25);
}

const chromeDoWorker = {
  runtime: {
    getManifest: () => ({ version: '0.3.0.0' }),
    getURL: (caminho) => 'chrome-extension://pegavaga/' + caminho,
    lastError: undefined,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
  },
  storage: storageFalso([]),
  alarms: {
    get: async () => null,
    create() {},
    clear: async () => true,
    onAlarm: {
      addListener(fn) {
        ouvintesAlarme.push(fn);
      },
    },
  },
  tabs: {
    query: async () => [],
    reload: async () => {},
    create() {},
    update: async () => ({}),
    sendMessage(tabId, mensagem, callback) {
      enviados.push({ tabId, mensagem });
      if (callback) callback(undefined);
    },
  },
  windows: { update: async () => ({}) },
  action: {
    setTitle() {},
    setIcon() {},
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setBadgeTextColor() {},
  },
  notifications: {
    create(id, opcoes, callback) {
      if (callback) callback(id);
    },
    clear: async () => true,
    onButtonClicked: { addListener() {} },
  },
};

globalThis.chrome = chromeDoWorker;
globalThis.importScripts = () => {}; // o worker carrega edicoes/shared "do navegador"

vm.runInThisContext(fs.readFileSync(path.join(raiz, 'background.js'), 'utf8'), {
  filename: 'background.js',
});

/** Um tick do agendador, como o alarme de 1 minuto faria. */
async function tick() {
  ouvintesAlarme.forEach((fn) => fn({ name: 'pegavaga-tick' }));
  await respirar(25);
}

/** Prepara o cenario do worker: perfil premium, config e a fila (se houver). */
function cenario(config, run, guard) {
  armazem.clear();
  armazem.set('pegavaga_perfil', PERFIL_PREMIUM);
  armazem.set('pegavaga_settings', config);
  armazem.set('pegavaga_apps', []);
  if (run) armazem.set('pegavaga_run', run);
  if (guard) armazem.set('pegavaga_guard', guard);
  enviados.length = 0;
}

const filaGravada = () => armazem.get('pegavaga_run') || null;
const mandouPara = (tipo) =>
  enviados.filter((envio) => envio.mensagem && envio.mensagem.type === tipo);


/** O tick do agendador, cenario por cenario. */
async function conferirWorker() {
  console.log('');
  console.log('== O WORKER: A JANELA NAO ENCERRA A FILA DO USUARIO ==');

  const fora = configComJanela(false);
  const dentro = configComJanela(true);

  // O cenario do relato: 02:35, janela 08:00 -> 18:00, e a fila veio do Iniciar.
  cenario(fora, fila());
  await tick();
  ok('o perfil premium em cache valeu (sem ele nao ha agendador)', S.temFeature('scheduler') === true);
  ok('fila do usuario fora da janela: continua viva', filaGravada() !== null);
  ok('e ninguem manda STOP para a aba', mandouPara(S.MSG.STOP).length === 0);

  // A fila do agendador e dele: fora da janela ela e encerrada, como sempre foi.
  cenario(fora, fila({ source: S.ORIGEM_AGENDADOR, tabId: 42 }));
  await tick();
  ok('fila do agendador fora da janela: encerrada', filaGravada() === null);
  ok(
    'e a aba dela recebe STOP',
    mandouPara(S.MSG.STOP).some((envio) => envio.tabId === 42),
    JSON.stringify(mandouPara(S.MSG.STOP))
  );

  console.log('');
  console.log('== A FILA PAUSADA POR COTA RETOMA (OU ESPERA) ==');

  cenario(fora, fila({ paused: true, resumeAt: Date.now() + 60000, pauseReason: 'cota', tabId: 7 }));
  await tick();
  ok(
    'fila do usuario pausada: retoma fora da janela',
    mandouPara(S.MSG.RESUME).some((envio) => envio.tabId === 7),
    JSON.stringify(enviados)
  );

  cenario(
    fora,
    fila({
      source: S.ORIGEM_AGENDADOR,
      paused: true,
      resumeAt: Date.now() + 60000,
      pauseReason: 'cota',
      tabId: 7,
    })
  );
  await tick();
  ok('fila do agendador pausada: espera a janela abrir', mandouPara(S.MSG.RESUME).length === 0);

  console.log('');
  console.log('== E O RESTO CONTINUA VALENDO ==');

  // Sem agendador ligado nao existe janela: nada e encerrado por horario.
  cenario(configComAgendador(false, { enabled: false }), fila());
  await tick();
  ok('sem agendador ligado, a fila do usuario segue', filaGravada() !== null);

  // O descanso da protecao da conta vale para as duas: e o LinkedIn pedindo calma.
  cenario(dentro, fila(), { blockedUntil: Date.now() + 3600000, reason: 'limite' });
  await tick();
  const parada = filaGravada();
  ok(
    'o descanso pausa ate a fila do usuario',
    Boolean(parada && parada.paused === true && parada.pauseReason === 'guard'),
    JSON.stringify(parada)
  );

  // Dentro da janela com a fila do usuario rodando, o agendador espera a vez: nao
  // troca a fila dela por uma dele (nem para o outro lado).
  cenario(dentro, fila());
  const antes = JSON.parse(JSON.stringify(filaGravada()));
  await tick();
  ok(
    'a fila do usuario nao e trocada por uma do agendador',
    Boolean(filaGravada()) && filaGravada().startedAt === antes.startedAt,
    JSON.stringify(filaGravada())
  );
}


/* -------------------------------------------------------------------------- */
/* 3) O pop-up (popup.js) num DOM falso                                        */
/* -------------------------------------------------------------------------- */
//
// O pop-up tem uma pergunta so para responder aqui: com o agendador no comando da
// janela, o botao Iniciar sai de cena e o rotulo avisa o que esta rodando.

class Elemento {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.className = '';
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.type = '';
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = {};
  }

  addEventListener(tipo, fn) {
    (this.listeners[tipo] = this.listeners[tipo] || []).push(fn);
  }

  appendChild(filho) {
    this.children.push(filho);
    return filho;
  }

  setAttribute(nome, valor) {
    this[nome] = valor;
  }

  remove() {}

  focus() {}

  /** Dispara um evento como o navegador faria (click, change…). */
  disparar(tipo) {
    (this.listeners[tipo] || []).forEach((fn) => fn({ target: this, type: tipo }));
  }
}

const elementosPorId = new Map();
const documentListeners = {};

const documentFalso = {
  getElementById(id) {
    if (!elementosPorId.has(id)) elementosPorId.set(id, new Elemento(id));
    return elementosPorId.get(id);
  },
  createElement: (tag) => new Elemento(tag),
  createTextNode: (texto) => ({ nodeType: 3, textContent: texto }),
  addEventListener(tipo, fn) {
    (documentListeners[tipo] = documentListeners[tipo] || []).push(fn);
  },
  body: new Elemento('body'),
};

/** Atalho: o elemento daquele id (criado sob demanda, como o fake faz). */
const el = (id) => documentFalso.getElementById(id);

const chromeDoPopup = {
  runtime: {
    getManifest: () => ({ version: '0.3.0.0' }),
    onMessage: { addListener() {} },
    lastError: null,
  },
  storage: storageFalso(ouvintesStorage),
  tabs: {
    async query() {
      return []; // sem aba ativa: o PING da varredura nem chega a acontecer
    },
    sendMessage(tabId, mensagem, callback) {
      if (callback) callback(undefined);
    },
    create() {},
    update() {},
  },
};

/** O pop-up rodando de verdade, com o agendador ocupando (ou nao) a janela. */
async function conferirPopup() {
  console.log('');
  console.log('== O POP-UP: COM O AGENDADOR NO COMANDO, O INICIAR SAI DE CENA ==');

  globalThis.window = globalThis;
  globalThis.document = documentFalso;
  globalThis.chrome = chromeDoPopup;

  vm.runInThisContext(fs.readFileSync(path.join(raiz, 'popup.js'), 'utf8'), { filename: 'popup.js' });

  armazem.set('pegavaga_perfil', PERFIL_PREMIUM);
  armazem.set('pegavaga_sessao', SESSAO_DE_TESTE);
  armazem.set('pegavaga_settings', configComJanela(true));
  armazem.set('pegavaga_jobs', {});
  armazem.delete('pegavaga_run');

  let erroNoInit = null;
  for (const fn of documentListeners.DOMContentLoaded || []) {
    try {
      await fn();
    } catch (erro) {
      erroNoInit = erro;
    }
  }
  await respirar(25);

  ok('o pop-up abriu sem erro', !erroNoInit, erroNoInit && erroNoInit.message);

  const ROTULO_NORMAL = '▶ Iniciar Busca e Varredura';
  const ROTULO_AUTOMATICO = 'Varredura automática em execução';

  // Janela aberta + "comecar sozinho": a varredura e do agendador.
  ok(
    'agendador no comando: o Iniciar fica travado',
    el('btn-start').disabled === true,
    el('btn-start').textContent
  );
  ok(
    'e o rotulo diz o que esta rodando',
    el('btn-start').textContent === ROTULO_AUTOMATICO,
    el('btn-start').textContent
  );
  ok('o Parar so acorda com varredura em andamento', el('btn-stop').disabled === true);

  // "Comecar sozinho" desligado: a janela nao e do agendador — o Iniciar volta.
  await mudarPorFora({ pegavaga_settings: configComAgendador(true, { autoStart: false }) });
  ok('sem "comecar sozinho", o Iniciar volta', el('btn-start').disabled === false);
  ok('e o rotulo e o de sempre', el('btn-start').textContent === ROTULO_NORMAL);

  // Fora da janela: idem (a janela so governa o que o agendador monta).
  await mudarPorFora({ pegavaga_settings: configComJanela(false) });
  ok(
    'fora da janela, o Iniciar tambem volta',
    el('btn-start').disabled === false && el('btn-start').textContent === ROTULO_NORMAL
  );

  // Janela aberta de novo, mas com uma fila do USUARIO rodando: ela e do usuario,
  // e o rotulo nao mente dizendo que a varredura e automatica.
  await mudarPorFora({ pegavaga_settings: configComJanela(true) });
  await mudarPorFora({ pegavaga_run: fila() });
  ok(
    'fila do usuario rodando: o rotulo nao vira o automatico',
    el('btn-start').textContent === ROTULO_NORMAL,
    el('btn-start').textContent
  );
  ok('e o Iniciar esta travado por ja estar varrendo', el('btn-start').disabled === true);
  ok('com a varredura do usuario em andamento, da para parar', el('btn-stop').disabled === false);

  // Agendador desligado: nenhuma janela, nenhum comando.
  await mudarPorFora({ pegavaga_run: null });
  await mudarPorFora({ pegavaga_settings: configComAgendador(true, { enabled: false }) });
  ok(
    'com o agendador desligado, o Iniciar e o de sempre',
    el('btn-start').disabled === false && el('btn-start').textContent === ROTULO_NORMAL
  );
}

/* -------------------------------------------------------------------------- */
/* Roteiro                                                                     */
/* -------------------------------------------------------------------------- */

async function principal() {
  conferirRegras();
  await conferirWorker();
  await conferirPopup();

  console.log('');

  if (falhas) {
    console.log(falhas + '/' + total + ' FALHARAM');
    process.exit(1);
  }

  console.log('Todos os ' + total + ' testes do agendador passaram.');
  process.exit(0);
}

try {
  principal();
} catch (erro) {
  console.log('FALHA INESPERADA: ' + (erro && erro.stack ? erro.stack : erro));
  process.exit(1);
}

