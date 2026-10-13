/* =============================================================================
 * PegaVaga - tests/smoke-ajuda.js
 *
 * Teste de fumaça do pedido de ajuda, nas DUAS pontas dele:
 *
 *   1. o módulo puro `ajuda-campos.js` — o casamento de texto/opções que o
 *      cartão usa para respeitar os <select>/rádio/checkbox do LinkedIn;
 *   2. o `background.js` RODANDO com um `chrome` falso: o pedido de ajuda do
 *      content script vira um aviso NO DESKTOP (notificação do sistema — o
 *      cartão vive na aba e você pode estar em outra aba), o clique no aviso
 *      traz a aba da vaga para a frente (com foco na janela) e o fim do
 *      pedido recolhe o aviso.
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
/* 1. O módulo puro (ajuda-campos.js) — casamento de texto/opções              */
/* -------------------------------------------------------------------------- */

vm.runInThisContext(fs.readFileSync(path.join(raiz, 'ajuda-campos.js'), 'utf8'), {
  filename: 'ajuda-campos.js',
});

const A = globalThis.PegaVagaAjuda;

if (!A || typeof A.normalizar !== 'function' || typeof A.escolherOpcao !== 'function') {
  console.log('FALHA: o módulo ajuda-campos.js nao exportou normalizar/escolherOpcao.');
  process.exit(1);
}

console.log('== normalizar (bate rótulo do cartão com o campo da página) ==');
ok('minúsculas', A.normalizar('Sim, com experiência') === 'sim com experiencia');
ok('tira acento', A.normalizar('função') === 'funcao');
ok('pontuação vira espaço', A.normalizar('React/Node.js') === 'react node js');
ok('colapsa espaços e corta pontas', A.normalizar('  Anos   de  experiência.  ') === 'anos de experiencia');
ok('espaço vazio devolve vazio', A.normalizar('   ') === '');
ok('null/undefined não quebra', A.normalizar(null) === '' && A.normalizar(undefined) === '');
ok('mesmo texto, grafias diferentes, batem', A.normalizar('São Paulo') === A.normalizar('sao paulo.'));

console.log('== escolherOpcao (select/rádio respeitam a opção escolhida) ==');
const dias = ['Segunda', 'Terça', 'Quarta', 'Sexta'];
ok('bate exato', A.escolherOpcao(dias, 'Quarta') === 2);
ok('case/acentos não atrapalham', A.escolherOpcao(dias, 'terça') === 1);
ok('exato vence "contém"', A.escolherOpcao(['Sim', 'Sim, com restrições'], 'Sim') === 0);
ok('cai no "contém" quando não há exato', A.escolherOpcao(['Sim, com restrições'], 'restrições') === 0);
ok('devolve -1 quando nada casa', A.escolherOpcao(dias, 'Domingo') === -1);
ok('alvo vazio devolve -1', A.escolherOpcao(dias, '') === -1);
ok('lista vazia devolve -1', A.escolherOpcao([], 'Segunda') === -1);
ok('lista não-array não quebra', A.escolherOpcao(null, 'x') === -1);



/* -------------------------------------------------------------------------- */
/* 2. O cartão NO DESKTOP (background.js com um chrome falso)                  */
/* -------------------------------------------------------------------------- */
//
// O pedido de ajuda abre o cartão (ajuda.html) como JANELA POPUP do Chrome,
// sem moldura, no desktop. Aqui verificamos: a janela abre com os CAMPOS na
// URL (a janelinha desenha o <select> com as opções originais), a sua decisão
// volta pela aba certa (sendToTab) — e a janela é fechada.

const JANELA_DA_ABA = 7; // a janela onde vive a aba 42 (a da vaga)
const JANELA_DO_CARTAO = 11; // a janelinha do pedido de ajuda

const armazem = new Map();
const ouvintes = { mensagem: [] };
const janelasCriadas = []; // { id, opcoes } windows.create
const janelasFechadas = []; // ids windows.remove
let recusarPopup = false; // quando true, `type: 'popup'` é recusado (como numa plataforma sem ele)
const enviados = []; // { tabId, mensagem } mandados para a aba
const ativadas = []; // { tabId, opcoes } abas trazidas para frente
const janelasFocadas = []; // { janelaId, opcoes } janelas que ganharam foco

const chromeFalso = {
  runtime: {
    getManifest: () => ({ version: '0.3.0.0' }),
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
    update(tabId, opcoes) {
      ativadas.push({ tabId, opcoes });
      // O `focarAba` pergunta a janela da aba para focar: o update devolve a aba.
      return Promise.resolve({ id: tabId, windowId: JANELA_DA_ABA });
    },
    sendMessage(tabId, mensagem, callback) {
      enviados.push({ tabId, mensagem });
      if (callback) callback(undefined);
    },
  },
  windows: {
    create(opcoes) {
      if (recusarPopup && opcoes && opcoes.type === 'popup') {
        return Promise.reject(new Error('tipo popup recusado nesta plataforma'));
      }
      janelasCriadas.push({ id: JANELA_DO_CARTAO, opcoes: opcoes });
      return Promise.resolve({ id: JANELA_DO_CARTAO });
    },
    remove(id) {
      janelasFechadas.push(id);
      return Promise.resolve();
    },
    getCurrent() {
      return Promise.resolve({ id: JANELA_DO_CARTAO, left: 1500, top: 500, width: 372, height: 470 });
    },
    update(janelaId, opcoes) {
      janelasFocadas.push({ janelaId, opcoes });
      return Promise.resolve({ id: janelaId });
    },
  },
  action: {
    setTitle() {},
    setIcon() {},
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setBadgeTextColor() {},
  },
};

globalThis.chrome = chromeFalso;
globalThis.importScripts = () => {}; // o background carrega edicoes/shared "do navegador"

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

/** Lê o `?dados=` da janelinha como a própria página faria. */
function lerDadosDaJanela(opcoes) {
  const url = String((opcoes && opcoes.url) || '');
  const bruto = (url.split('?dados=')[1] || '').split('&')[0];
  return JSON.parse(decodeURIComponent(bruto));
}

async function principal() {
  console.log('== o cartão NO DESKTOP (background.js rodando) ==');
  vm.runInThisContext(fs.readFileSync(path.join(raiz, 'background.js'), 'utf8'), {
    filename: 'background.js',
  });
  await respirar(20); // o worker faz syncAlarm/refresh assíncronos no load

  /* O pedido de ajuda do content script abre o cartão como JANELA POPUP —
   * no desktop, não dentro da aba. Os campos (com tipo e opções) viajam na
   * URL: é o que a janelinha desenha. */
  const campos = [
    { rotulo: 'Pretensão salarial', tipo: 'texto', opcoes: [] },
    { rotulo: 'Dias presenciais', tipo: 'select', opcoes: ['Seg a Sex', 'Seg, Qua e Sex'] },
  ];
  const aberta = await falarComOWorker(
    {
      type: S.MSG.AJUDA_PEDIDO,
      pedidoId: 'p1',
      motivo: 'campos',
      titulo: 'Dev React',
      empresa: 'ACME',
      campos: campos,
    },
    { tab: { id: 42 } }
  );

  ok('pedido devolve ok', aberta && aberta.ok === true, JSON.stringify(aberta));
  ok('id do pedido carrega a aba', aberta && aberta.id === 'pegavaga-ajuda:42:p1', aberta && aberta.id);
  ok('uma janelinha criada', janelasCriadas.length === 1, janelasCriadas.length);
  ok(
    'é uma janela popup (sem moldura de navegador)',
    janelasCriadas[0] && janelasCriadas[0].opcoes.type === 'popup'
  );
  ok(
    'abre o ajuda.html',
    janelasCriadas[0] && /ajuda\.html\?dados=/.test(janelasCriadas[0].opcoes.url),
    janelasCriadas[0] && janelasCriadas[0].opcoes.url
  );

  const dados = janelasCriadas[0] ? lerDadosDaJanela(janelasCriadas[0].opcoes) : {};
  ok('a URL carrega o id do pedido', dados.avisoId === 'pegavaga-ajuda:42:p1', dados.avisoId);
  ok('a URL carrega a vaga', dados.titulo === 'Dev React' && dados.empresa === 'ACME');
  ok(
    'a URL carrega os campos com tipo e opções',
    Array.isArray(dados.campos) &&
      dados.campos.length === 2 &&
      dados.campos[1].tipo === 'select' &&
      dados.campos[1].opcoes.join(' | ') === 'Seg a Sex | Seg, Qua e Sex',
    JSON.stringify(dados.campos)
  );

  /* Recusas: sem pedido não há o que abrir; sem aba não há para quem responder. */
  const semPedido = await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO }, { tab: { id: 42 } });
  ok('sem pedidoId não abre', semPedido && semPedido.ok === false);
  ok('e diz o motivo (sem_pedido)', semPedido && semPedido.motivo === 'sem_pedido', semPedido && semPedido.motivo);
  const semAba = await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p2' }, {});
  ok('sem aba não abre', semAba && semAba.ok === false);
  ok('e diz o motivo (sem_aba)', semAba && semAba.motivo === 'sem_aba', semAba && semAba.motivo);

  ok('nenhuma janela extra nas recusas', janelasCriadas.length === 1, janelasCriadas.length);

  /* O TAMANHO vem do shared (o mesmo número que o ajuda.js usa para a altura) e a
   * POSIÇÃO de abertura tem ordem de preferência: a guardada (onde você deixou a
   * janelinha da última vez) ganha da que a aba mandou; sem guardada, vale a da aba
   * (ela enxerga o `screen`, o worker não). */
  ok(
    'nasce com o tamanho da janelinha (o mesmo número do ajuda.js)',
    janelasCriadas[0] &&
      janelasCriadas[0].opcoes.width === S.JANELINHA.largura &&
      janelasCriadas[0].opcoes.height === S.JANELINHA.altura,
    janelasCriadas[0] && janelasCriadas[0].opcoes.width + 'x' + janelasCriadas[0].opcoes.height
  );

  armazem.set(S.STORAGE.pos, { left: 40, top: 60 });

  const comPosicaoGuardada = await falarComOWorker(
    { type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p5', posicao: { left: 900, top: 700 } },
    { tab: { id: 45 } }
  );

  ok(
    'a posicao GUARDADA ganha da que a aba mandou',
    comPosicaoGuardada &&
      comPosicaoGuardada.ok === true &&
      janelasCriadas[1] &&
      janelasCriadas[1].opcoes.left === 40 &&
      janelasCriadas[1].opcoes.top === 60,
    JSON.stringify(janelasCriadas[1] && janelasCriadas[1].opcoes)
  );

  armazem.delete(S.STORAGE.pos);

  const comPosicaoDaAba = await falarComOWorker(
    { type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p6', posicao: { left: 900, top: 700 } },
    { tab: { id: 46 } }
  );

  ok(
    'sem posicao guardada, nasce onde a aba disse (a janela ja nasce no canto)',
    comPosicaoDaAba &&
      comPosicaoDaAba.ok === true &&
      janelasCriadas[2] &&
      janelasCriadas[2].opcoes.left === 900 &&
      janelasCriadas[2].opcoes.top === 700,
    JSON.stringify(janelasCriadas[2] && janelasCriadas[2].opcoes)
  );

  /* A janela é pedida como `popup` (só barra de título + borda do sistema). Se a
   * plataforma recusar o tipo, o worker tenta de novo — e CONTA a recusa, para a
   * moldura errada não passar em silêncio. */
  recusarPopup = true;
  const comRecusa = await falarComOWorker(
    { type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p4' },
    { tab: { id: 44 } }
  );
  recusarPopup = false;
  ok('popup recusado: ainda abre (noutro formato)', comRecusa && comRecusa.ok === true, JSON.stringify(comRecusa));
  ok(
    'e conta a recusa do tipo popup',
    comRecusa && /popup recusado/.test(String(comRecusa.recusa)),
    comRecusa && comRecusa.recusa
  );

  /* A sua decisão veio da janelinha: o worker encaminha para a ABA certa e
   * fecha a janela (a janelinha espera o "feche-se" do worker). */
  const resposta = await falarComOWorker({
    type: S.MSG.AJUDA_RESPOSTA_JANELA,
    avisoId: 'pegavaga-ajuda:42:p1',
    acao: 'aplicar',
    resposta: { 'Pretensão salarial': '12000' },
  });
  ok('decisão processada', resposta && resposta.ok === true);
  ok(
    'decisão vai para a aba certa',
    enviados.some(
      (e) =>
        e.tabId === 42 &&
        e.mensagem.type === S.MSG.AJUDA_RESPOSTA &&
        e.mensagem.pedidoId === 'p1' &&
        e.mensagem.acao === 'aplicar' &&
        e.mensagem.resposta &&
        e.mensagem.resposta['Pretensão salarial'] === '12000'
    ),
    JSON.stringify(enviados)
  );
  ok('janela é fechada após a decisão', janelasFechadas.indexOf(JANELA_DO_CARTAO) >= 0);

  /* Fechar a janelinha SEM decidir também avisa a aba: senão o content script
   * continuava esperando o prazo cheio (5 min) e a varredura ficava parada —
   * parecendo que a extensão travou. */
  await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p5' }, { tab: { id: 42 } });
  enviados.length = 0;

  const fechou = await falarComOWorker({
    type: S.MSG.AJUDA_RESPOSTA_JANELA,
    avisoId: 'pegavaga-ajuda:42:p5',
    acao: '',
  });

  ok('fechar a janelinha devolve ok', fechou && fechou.ok === true, JSON.stringify(fechou));
  ok(
    'e a decisão vazia chega na aba (a espera termina na hora)',
    enviados.some(
      (e) =>
        e.tabId === 42 &&
        e.mensagem.type === S.MSG.AJUDA_RESPOSTA &&
        e.mensagem.pedidoId === 'p5' &&
        e.mensagem.acao === ''
    ),
    JSON.stringify(enviados)
  );

  /* "Vou preencher à mão": a aba da vaga vem para a frente ANTES da decisão. */
  await falarComOWorker(
    { type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p2', motivo: 'campos' },
    { tab: { id: 42 } }
  );
  ativadas.length = 0;
  janelasFocadas.length = 0;
  await falarComOWorker({
    type: S.MSG.AJUDA_RESPOSTA_JANELA,
    avisoId: 'pegavaga-ajuda:42:p2',
    acao: 'manual',
  });
  ok('"à mão" traz a aba para frente', ativadas.some((a) => a.tabId === 42 && a.opcoes.active === true));
  ok('"à mão" foca a janela da aba', janelasFocadas.some((j) => j.janelaId === JANELA_DA_ABA));

  /* O fim do pedido na aba (prazo/aborto) some com a janelinha. */
  await falarComOWorker({ type: S.MSG.AJUDA_PEDIDO, pedidoId: 'p3' }, { tab: { id: 43 } });
  const antes = janelasFechadas.length;
  const fechar = await falarComOWorker({ type: S.MSG.AJUDA_FECHAR, avisoId: 'pegavaga-ajuda:43:p3' });
  ok('fechar devolve ok', fechar && fechar.ok === true);
  ok('fechar recolhe a janela', janelasFechadas.length === antes + 1);

  /* Id que não é nosso: o worker não mexe no que é de fora. */
  const deFora = await falarComOWorker({ type: S.MSG.AJUDA_FECHAR, avisoId: 'algo:de:fora' });
  ok('id de fora não fecha nada', deFora && deFora.ok === true && janelasFechadas.length === antes + 1);

  /* O contrato dos ids (shared.js) — é o id que liga a janelinha à aba. */
  console.log('== o id que liga a janelinha à aba (shared.js) ==');
  ok(
    'id carrega a aba',
    JSON.stringify(S.lerAjudaId('pegavaga-ajuda:42:p1')) === '{"tabId":42,"pedidoId":"p1"}'
  );
  ok('id de fora devolve null', S.lerAjudaId('x:y') === null && S.lerAjudaId(null) === null);

  /* O MANIFESTO: sem a permissão `windows` o Chrome IGNORA o `type: 'popup'`, o
   * posicionamento e o redimensionamento da janelinha — e o sintoma é o que o
   * usuário viu: janela normal (com barra de endereço e extensões), no lugar que o
   * sistema quer e no tamanho de criação. O código pede tudo certo; quem autoriza é
   * o manifesto. */
  console.log('== o manifesto dá o que a janelinha precisa ==');
  const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.json'), 'utf8'));
  const permissoes = Array.isArray(manifesto.permissions) ? manifesto.permissions : [];

  ok(
    'a permissao `windows` esta no manifesto (popup, posicao e tamanho)',
    permissoes.indexOf('windows') >= 0,
    JSON.stringify(permissoes)
  );

  finalizar();
}

function finalizar() {
  console.log(
    falhas ? '\n' + falhas + '/' + total + ' FALHARAM' : '\nTodos os ' + total + ' testes do pedido de ajuda passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

principal().catch((erro) => {
  ok('fluxo principal', false, erro && erro.message);
  finalizar();
});

