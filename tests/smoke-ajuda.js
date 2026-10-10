/* =============================================================================
 * PegaVaga - tests/smoke-ajuda.js
 *
 * Teste de fumaca do (temporario) pedido de ajuda ao usuario: quando a
 * Candidatura Simplificada trava num campo que a extensao nao sabe responder — ou
 * o envio demora a confirmar — o PegaVaga avisa na area de trabalho e pergunta se
 * voce quer preencher a vaga a mao ou pular para a proxima.
 *
 * O teste roda no Node puro, sem npm install, e cobre as duas pontas de verdade:
 *
 *   1. o CONTRATO no shared.js (textos, botoes, id do aviso e os desfechos
 *      `manual`/`pulada`), que e o unico lugar que sabe o que o aviso diz;
 *   2. o background.js RODANDO com um `chrome` falso (storage, alarms, tabs e
 *      notifications): o pedido vira notificacao com os dois botoes, o clique
 *      leva a decisao para a aba de origem e o aviso sai da tela.
 *
 *   node tests/smoke-ajuda.js
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

const respirar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* shared.js e edicoes.js: carregados como o navegador faz (sem DOM)           */
/* -------------------------------------------------------------------------- */

for (const arquivo of ['edicoes.js', 'shared.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), { filename: arquivo });
}

// Sem rede: o perfil vem do cache local, como num navegador offline.
globalThis.fetch = () => Promise.reject(new Error('sem rede no teste'));

const S = globalThis.PegaVagaShared;

if (!S) {
  console.log('FALHA: os modulos nao carregaram (shared/edicoes).');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* chrome falso do service worker                                              */
/* -------------------------------------------------------------------------- */
//
// So o que o background.js usa: storage, alarms, tabs, action e a API de
// notificacoes (o aviso na area de trabalho). `avisos`/`limpos`/`enviados` sao o
// que o teste confere depois.

const armazem = new Map();
const ouvintes = { mensagem: [], botao: [] };
const avisos = []; // { id, opcoes } criados
const limpos = []; // ids de aviso tirados da tela
const enviados = []; // { tabId, mensagem } mandados para a aba

const chromeFalso = {
  runtime: {
    getManifest: () => ({ version: '0.1' }),
    getURL: (caminho) => 'chrome-extension://pegavaga/' + caminho,
    lastError: undefined,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(fn) {
        ouvintes.mensagem.push(fn);
      },
    },
  },
  storage: {
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
    onChanged: { addListener() {} },
  },
  alarms: {
    get: async () => null,
    create() {},
    clear: async () => true,
    onAlarm: { addListener() {} },
  },
  tabs: {
    query: async () => [],
    reload: async () => {},
    create() {},
    update() {},
    sendMessage(tabId, mensagem, callback) {
      enviados.push({ tabId, mensagem });
      if (callback) callback(undefined);
    },
  },
  action: {
    setTitle() {},
    setIcon() {},
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setBadgeTextColor() {},
  },
  notifications: {
    create(id, opcoes, callback) {
      avisos.push({ id, opcoes });
      if (callback) callback(id);
    },
    clear(id) {
      limpos.push(id);
      return Promise.resolve(true);
    },
    onButtonClicked: {
      addListener(fn) {
        ouvintes.botao.push(fn);
      },
    },
  },
};

globalThis.chrome = chromeFalso;
globalThis.importScripts = () => {}; // o background carrega edicoes/shared "do navegador"

/** Fala com o service worker como o content script faria (e espera a resposta). */
function falarComOWorker(mensagem, sender) {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (valor) => {
      if (respondido) return;
      respondido = true;
      resolve(valor);
    };

    const assincrono = ouvintes.mensagem.some((fn) => fn(mensagem, sender, responder) === true);
    if (!assincrono) responder(undefined);
  });
}

/** Clique num botão do aviso (como o Chrome entrega em onButtonClicked). */
function clicarNoAviso(indice, avisoId) {
  const id = avisoId || (avisos[avisos.length - 1] || {}).id;
  ouvintes.botao.forEach((fn) => fn(id, indice));
}

/* -------------------------------------------------------------------------- */
/* O contrato do aviso (shared.js)                                             */
/* -------------------------------------------------------------------------- */

async function principal() {
  console.log('== CONTRATO DO AVISO (shared.js) ==');

  ok(
    'as tres mensagens do pedido existem',
    S.MSG.AJUDA_PEDIDO === 'PEGAVAGA_AJUDA_PEDIDO' &&
      S.MSG.AJUDA_RESPOSTA === 'PEGAVAGA_AJUDA_RESPOSTA' &&
      S.MSG.AJUDA_FECHAR === 'PEGAVAGA_AJUDA_FECHAR'
  );
  ok('dois motivos conhecidos', Object.keys(S.AJUDA_MOTIVOS).length === 2, JSON.stringify(S.AJUDA_MOTIVOS));
  ok(
    'dois botoes, na ordem',
    S.AJUDA_BOTOES.length === 2 &&
      S.AJUDA_BOTOES[0] === 'Vou preencher à mão' &&
      S.AJUDA_BOTOES[1] === 'Pular esta vaga',
    JSON.stringify(S.AJUDA_BOTOES)
  );
  ok('botao 0 = preencher a mao', S.acaoDaAjuda(0) === 'manual');
  ok('botao 1 = pular', S.acaoDaAjuda(1) === 'pular');
  ok(
    'indice fora da faixa nao e acao',
    S.acaoDaAjuda(2) === '' && S.acaoDaAjuda(-1) === '' && S.acaoDaAjuda(undefined) === '',
    String(S.acaoDaAjuda(2))
  );

  ok('o id do aviso carrega a aba', S.ajudaId(42, 'p1') === 'pegavaga-ajuda:42:p1', S.ajudaId(42, 'p1'));
  ok(
    'ler o id devolve aba e pedido',
    JSON.stringify(S.lerAjudaId('pegavaga-ajuda:42:p1')) === JSON.stringify({ tabId: 42, pedidoId: 'p1' })
  );
  ok(
    'id que nao e nosso nao vale',
    S.lerAjudaId('outro:42:p1') === null && S.lerAjudaId('pegavaga-ajuda:42') === null && S.lerAjudaId('') === null
  );
  ok('id sem aba nao vale (Number("") seria 0)', S.lerAjudaId('pegavaga-ajuda::p1') === null);

  const demora = S.textoDaAjuda({
    motivo: 'demora',
    titulo: 'Dev React',
    empresa: 'Acme',
    problema: 'Telefone',
  });

  ok('o titulo se marca como temporario', demora.title.includes('temporário'), demora.title);
  ok('a mensagem diz a vaga', demora.message.includes('Dev React — Acme'), demora.message);
  ok('a mensagem diz o motivo da demora', demora.message.includes('não confirmou'), demora.message);
  ok('a mensagem traz o problema lido na tela', demora.message.includes('Telefone'), demora.message);
  ok(
    'a mensagem oferece as duas saidas',
    demora.message.includes('à mão') && demora.message.includes('pular'),
    demora.message
  );

  const campos = S.textoDaAjuda({ motivo: 'campos' });

  ok('o motivo de campo tem o seu texto', campos.message.includes('campo'), campos.message);
  ok('sem vaga a mensagem nao comeca com dois pontos', campos.message[0] !== ':', campos.message);
  ok('motivo desconhecido cai no de campo', S.textoDaAjuda({ motivo: 'x' }).message === campos.message);

  ok(
    'desfecho manual: temporario e definitivo',
    S.APPLY_OUTCOMES.manual.label.includes('(temporário)') &&
      S.APPLY_OUTCOMES.manual.failure === true &&
      S.APPLY_OUTCOMES.manual.label.includes('Preenchida por você'),
    S.APPLY_OUTCOMES.manual.label
  );
  ok(
    'desfecho pulada: temporario e definitivo',
    S.APPLY_OUTCOMES.pulada.label.includes('(temporário)') &&
      S.APPLY_OUTCOMES.pulada.failure === true &&
      S.APPLY_OUTCOMES.pulada.label.includes('Pulada por você'),
    S.APPLY_OUTCOMES.pulada.label
  );
  ok(
    'os dois aparecem no relatorio',
    S.applyOutcomeLabel('manual').includes('temporário') && S.applyOutcomeLabel('pulada').includes('temporário')
  );
  ok(
    'e descrevem o que aconteceu',
    S.describeApplyFailure({ applyStatus: 'manual' }).reason.includes('preencher à mão') &&
      S.describeApplyFailure({ applyStatus: 'pulada' }).reason.includes('pular') &&
      S.describeApplyFailure({ applyStatus: 'manual' }).pending === false
  );
  ok(
    'eles contam como nao candidatadas (vão para o CSV de falhas)',
    S.summarizeApply([{ id: 'a', applyStatus: 'manual' }, { id: 'b', applyStatus: 'pulada' }], {}).failed === 2,
    JSON.stringify(S.summarizeApply([{ id: 'a', applyStatus: 'manual' }], {}))
  );

  /* ------------------------------------------------------------------------ */
  /* O background.js rodando                                                   */
  /* ------------------------------------------------------------------------ */

  console.log('');
  console.log('== O AVISO NA AREA DE TRABALHO (background.js) ==');

  vm.runInThisContext(fs.readFileSync(path.join(raiz, 'background.js'), 'utf8'), {
    filename: 'background.js',
  });

  // O worker se ajusta sozinho ao subir (alarme + luz do icone): deixamos essa
  // primeira rodada terminar antes de falar com ele.
  await respirar(25);

  ok('o worker escuta o pedido de ajuda', ouvintes.mensagem.length === 1, String(ouvintes.mensagem.length));
  ok('e escuta o clique nos botoes do aviso', ouvintes.botao.length === 1, String(ouvintes.botao.length));

  const senderDaAba = { tab: { id: 42 } };
  const pedido = {
    type: S.MSG.AJUDA_PEDIDO,
    pedidoId: 'p1',
    motivo: 'campos',
    titulo: 'Dev React',
    empresa: 'Acme',
    problema: 'Vaga efetiva? (Sim/Não)',
  };

  const resposta = await falarComOWorker(pedido, senderDaAba);

  ok('o pedido foi atendido', Boolean(resposta && resposta.ok), JSON.stringify(resposta));
  ok('o aviso leva a aba de origem no id', resposta.id === 'pegavaga-ajuda:42:p1', String(resposta.id));
  ok('um aviso foi criado', avisos.length === 1, String(avisos.length));

  const opcoes = (avisos[0] || {}).opcoes || {};

  ok(
    'e uma notificacao simples, com o nosso icone',
    opcoes.type === 'basic' && String(opcoes.iconUrl).includes('pg-128.png'),
    String(opcoes.iconUrl)
  );
  ok(
    'com os dois botoes do contrato',
    (opcoes.buttons || []).length === 2 &&
      opcoes.buttons[0].title === S.AJUDA_BOTOES[0] &&
      opcoes.buttons[1].title === S.AJUDA_BOTOES[1],
    JSON.stringify(opcoes.buttons)
  );
  ok('que fica na tela ate voce escolher', opcoes.requireInteraction === true);
  ok(
    'com o texto vindo do contrato (vaga + motivo)',
    opcoes.title === S.textoDaAjuda(pedido).title &&
      opcoes.message === S.textoDaAjuda(pedido).message &&
      opcoes.message.includes('Dev React — Acme'),
    opcoes.message
  );

  clicarNoAviso(1); // "Pular esta vaga"
  await respirar(10);

  ok(
    'clicar em pular responde na aba de origem',
    enviados.length === 1 && enviados[0].tabId === 42,
    JSON.stringify(enviados)
  );
  ok(
    'com a mensagem, o pedido e a decisao certos',
    enviados[0].mensagem.type === S.MSG.AJUDA_RESPOSTA &&
      enviados[0].mensagem.pedidoId === 'p1' &&
      enviados[0].mensagem.acao === 'pular',
    JSON.stringify(enviados[0].mensagem)
  );
  ok('e o aviso sai da tela', limpos.includes('pegavaga-ajuda:42:p1'), JSON.stringify(limpos));

  clicarNoAviso(0); // "Vou preencher à mão"
  await respirar(10);

  ok(
    'clicar em preencher à mão devolve manual',
    enviados.length === 2 && enviados[1].mensagem.acao === 'manual',
    JSON.stringify(enviados[1] && enviados[1].mensagem)
  );

  const antesDosCliquesEstranhos = enviados.length;

  clicarNoAviso(0, 'outro:42:p1'); // id que não é um aviso nosso
  clicarNoAviso(7, 'pegavaga-ajuda:42:p1'); // índice que não é botão nosso
  await respirar(10);

  ok(
    'clique sem destino nao responde nada',
    enviados.length === antesDosCliquesEstranhos,
    JSON.stringify(enviados.slice(antesDosCliquesEstranhos))
  );
  ok('e o aviso alheio sai da tela mesmo assim', limpos.includes('outro:42:p1'));

  const semIdentificacao = await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO }, senderDaAba);

  ok(
    'pedido sem id nao vira aviso',
    semIdentificacao && semIdentificacao.ok === false && semIdentificacao.motivo === 'pedido_sem_id',
    JSON.stringify(semIdentificacao)
  );

  const semAba = await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p2' }, {});

  ok(
    'pedido sem aba de origem nao vira aviso (nao haveria para quem responder)',
    semAba && semAba.ok === false && semAba.motivo === 'sem_aba',
    JSON.stringify(semAba)
  );
  ok('e nenhum dos dois criou aviso na tela', avisos.length === 1, String(avisos.length));

  const fechado = await falarComOWorker(
    { type: S.MSG.AJUDA_FECHAR, avisoId: 'pegavaga-ajuda:42:p1' },
    senderDaAba
  );

  ok('o pedido de fechar e atendido', Boolean(fechado && fechado.ok));
  ok(
    'e o aviso volta a sair da tela',
    limpos.filter((id) => id === 'pegavaga-ajuda:42:p1').length >= 2,
    JSON.stringify(limpos)
  );

  const andamento = await falarComOWorker({ type: S.MSG.PROGRESS, run: null, guard: null }, senderDaAba);

  ok(
    'o aviso de andamento nao cria notificacao',
    andamento === undefined && avisos.length === 1,
    JSON.stringify(andamento)
  );

  // Sem a API de notificacoes (navegador sem ela ou permissao negada), o worker
  // diz que nao conseguiu avisar — assim o content script segue o fluxo de sempre
  // em vez de esperar para sempre por uma resposta que nunca vem.
  const guardada = chromeFalso.notifications;
  chromeFalso.notifications = undefined;

  const semApi = await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p9' }, senderDaAba);

  ok(
    'sem chrome.notifications nao promete aviso',
    semApi && semApi.ok === false && semApi.motivo === 'sem_notificacao',
    JSON.stringify(semApi)
  );

  chromeFalso.notifications = guardada;

  console.log('');
  console.log(
    falhas
      ? '\n' + falhas + '/' + total + ' FALHARAM'
      : '\nTodos os ' + total + ' testes do pedido de ajuda passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

principal().catch((erro) => {
  console.log('FALHA INESPERADA: ' + (erro && erro.stack ? erro.stack : erro));
  process.exit(1);
});

