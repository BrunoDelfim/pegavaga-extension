/* =============================================================================
 * PegaVaga - tests/smoke-espera.js
 *
 * Teste de fumaca do motor de espera do shared.js (`createSignal`, `waitUntil` e
 * `waitForQuiet`). Sao eles que fazem o content script esperar olhando o que a
 * pagina esta fazendo (mutacao no DOM), e nao o relogio: quando a espera se
 * engana, a varredura ou corre antes da hora ou trava a toa.
 *
 * O caso que trouxe este teste: com o sinal acordando na MESMA volta do
 * `subscribe` — a pagina mexeu antes de a espera comecar —, o `waitForQuiet`
 * estourava `ReferenceError` (o `clearTimeout` usava o `timer` antes de ele ser
 * declarado). Aqui ele e o primeiro da fila.
 *
 *   node tests/smoke-espera.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
for (const arquivo of ['edicoes.js', 'shared.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), { filename: arquivo });
}

// Sem rede: nada aqui fala com a API (o `fetch` do shared so entra em conta).
globalThis.fetch = () => Promise.reject(new Error('sem rede no teste'));

const S = globalThis.PegaVagaShared;

if (!S) {
  console.log('FALHA: os modulos nao carregaram (shared/edicoes).');
  process.exit(1);
}

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

/** Um sinal que acorda o ouvinte na mesma volta do `subscribe`. */
const sinalImediato = {
  subscribe(ouvinte) {
    ouvinte();
    return () => {};
  },
};

async function principal() {
  console.log('== O SINAL (createSignal) ==');

  const sinal = S.createSignal();
  let acordou = 0;

  ok('sem ninguem esperando, size = 0', sinal.size === 0, String(sinal.size));

  const off = sinal.subscribe(() => {
    acordou += 1;
  });

  ok('assinar poe alguem na lista', sinal.size === 1, String(sinal.size));

  sinal.wake();
  ok('acordar avisa quem esta esperando', acordou === 1, String(acordou));

  off();
  ok('cancelar tira da lista', sinal.size === 0, String(sinal.size));

  sinal.wake();
  ok('e quem saiu nao e mais acordado', acordou === 1, String(acordou));

  const doisOuvintes = S.createSignal();
  let depoisDoErro = 0;

  doisOuvintes.subscribe(() => {
    throw new Error('ouvinte ruim');
  });
  doisOuvintes.subscribe(() => {
    depoisDoErro += 1;
  });

  doisOuvintes.wake();
  ok('um ouvinte que estoura nao derruba os outros', depoisDoErro === 1, String(depoisDoErro));

  console.log('');
  console.log('== waitForQuiet (a pagina ficou quieta?) ==');

  // 1) A pagina mexeu antes de a espera comecar: devolve false sem estourar.
  const jaMexendo = await S.waitForQuiet(sinalImediato, 50);

  ok('a pagina que ja estava mexendo devolve false', jaMexendo === false, String(jaMexendo));

  // 2) Pagina quieta: so resolve depois do silencio pedido — e larga a inscricao.
  const quieto = S.createSignal();
  const marcou = Date.now();
  const silencio = await S.waitForQuiet(quieto, 60);

  ok('a pagina quieta devolve true', silencio === true, String(silencio));
  ok('e so depois do silencio pedido', Date.now() - marcou >= 40, Date.now() - marcou + 'ms');
  ok('sem deixar ninguem inscrito', quieto.size === 0, String(quieto.size));

  // 3) A pagina mexe no meio da espera: devolve false na hora (nao espera o
  //    silencio inteiro) e tambem desassina.
  const mexeDepois = S.createSignal();
  const esperando = S.waitForQuiet(mexeDepois, 5000);

  setTimeout(() => mexeDepois.wake(), 20);

  const antesDoPrazo = Date.now();
  const mexeu = await esperando;

  ok('a pagina que mexe devolve false', mexeu === false, String(mexeu));
  ok('sem esperar o silencio inteiro', Date.now() - antesDoPrazo < 1000, Date.now() - antesDoPrazo + 'ms');
  ok('e desassina ao sair', mexeDepois.size === 0, String(mexeDepois.size));

  // 4) Sem sinal nenhum (nao ha observer): cai no silencio e devolve true.
  ok('sem sinal, a espera so conta o tempo', (await S.waitForQuiet(null, 20)) === true);
  ok('e um silencio invalido nao vira espera infinita', (await S.waitForQuiet(null, 'x')) === true);

  console.log('');
  console.log('== waitUntil (o que o check espera) ==');

  ok(
    'check que responde na hora nao espera nada',
    (await S.waitUntil(null, () => 'achou', 500, 20)) === 'achou'
  );

  const chegou = S.createSignal();
  let pronto = false;
  const comSinal = S.waitUntil(chegou, () => (pronto ? 'ok' : null), 5000, 20);

  setTimeout(() => {
    pronto = true;
    chegou.wake();
  }, 20);

  ok('acordar o sinal entrega o valor do check', (await comSinal) === 'ok');
  ok('e o sinal fica limpo depois', chegou.size === 0, String(chegou.size));

  const prazo = Date.now();
  const semResposta = await S.waitUntil(null, () => null, 60, 20);

  ok('check que nunca responde para no prazo', semResposta === null, String(semResposta));
  ok('e respeita o prazo (nao trava a varredura)', Date.now() - prazo >= 40, Date.now() - prazo + 'ms');

  const comErro = S.createSignal();
  let tentativas = 0;
  const resultado = await S.waitUntil(
    comErro,
    () => {
      tentativas += 1;
      throw new Error('check ruim');
    },
    60,
    20
  );

  ok('check que estoura nao derruba a espera', resultado === null && tentativas > 0, String(tentativas));
  ok('e tambem nao deixa inscrito', comErro.size === 0, String(comErro.size));

  console.log('');
  console.log(
    falhas
      ? '\n' + falhas + '/' + total + ' FALHARAM'
      : '\nTodos os ' + total + ' testes do motor de espera passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

principal().catch((erro) => {
  console.log('FALHA INESPERADA: ' + (erro && erro.stack ? erro.stack : erro));
  process.exit(1);
});
