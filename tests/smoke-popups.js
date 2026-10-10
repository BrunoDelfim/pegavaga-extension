/* =============================================================================
 * PegaVaga - tests/smoke-popups.js
 *
 * Teste de fumaca do guard de popup: quando ele esta de servico, o que ele
 * protege e o que ele pode fechar. Roda no Node puro, sem npm install — a regra
 * (`popupGuardMode`, no shared.js) nao toca no DOM, entao da para exercita-la
 * direto, sinal por sinal.
 *
 * O caso que trouxe este teste: voce preenche um campo a mao, envia a
 * candidatura — e o LinkedIn desmonta o dialog do formulario e monta outro (a
 * confirmacao e, depois, a pesquisa de avaliacao). O content script so conhecia o
 * no antigo: `document.contains(keepDialog)` virava falso, o guard saia de servico
 * e o popup do pos-candidatura ficava na frente da lista — a varredura nao
 * continuava. Ou seja: o observer estava defasado. Aqui a decisao e conferida
 * estado por estado, inclusive naqueles em que o formulario ja saiu da tela:
 *
 *   1. fora da varredura: quieto (a pagina e sua);
 *   2. antes do formulario ser identificado: quieto (dialog carregando nao e
 *      popup);
 *   3. com o formulario na tela: `proteger` (qualquer outro dialog e popup);
 *   4. formulario identificado mas ja fora da tela, ou pos-envio: `limpar` — e
 *      aqui que o popup atrasado do pos-candidatura e pego;
 *   5. e o modo `limpar` nunca vira licenca para fechar um formulario: quem decide
 *      o que e popup de verdade e o `classifyDialog`, que continua no contrato.
 *
 *   node tests/smoke-popups.js
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

if (!S || typeof S.popupGuardMode !== 'function') {
  console.log('FALHA: o shared.js nao carregou (ou perdeu o popupGuardMode).');
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

const G = S.POPUP_GUARD;
const modo = (sinais) => S.popupGuardMode(sinais);

function principal() {
  console.log('== modos do guard ==');

  ok(
    'os tres modos estao no contrato',
    G && G.quieto === 'quieto' && G.proteger === 'proteger' && G.limpar === 'limpar',
    JSON.stringify(G)
  );

  console.log('');
  console.log('== fora da varredura: a pagina e do usuario ==');

  // Nem com formulario na tela, nem no pos-envio: a extensao nao mexe em nada
  // quando nao esta varrendo (a pausa, o descanso de protecao e a sua vez).
  ok('sem varredura: quieto', modo({}) === G.quieto, modo({}));
  ok(
    'sem varredura, mesmo com formulario na tela: quieto',
    modo({ formularioIdentificado: true, formularioNaTela: true }) === G.quieto
  );
  ok('sem varredura, mesmo no pos-envio: quieto', modo({ posEnvio: true }) === G.quieto);

  console.log('');
  console.log('== antes de identificar o formulario: o guard fica quieto ==');

  // O modal acabou de ser pedido no clique de "Candidatura Simplificada" e ainda
  // esta carregando: fecha-lo agora seria descartar a candidatura.
  ok('varrendo, sem formulario identificado: quieto', modo({ varrendo: true }) === G.quieto);

  console.log('');
  console.log('== com o formulario na tela: proteger ==');

  const comFormulario = {
    varrendo: true,
    formularioIdentificado: true,
    formularioNaTela: true,
  };

  ok('varrendo, formulario na tela: proteger', modo(comFormulario) === G.proteger);
  ok(
    'no pos-envio o formulario da proxima vaga tambem e protegido',
    modo(Object.assign({}, comFormulario, { posEnvio: true })) === G.proteger
  );

  console.log('');
  console.log('== o formulario saiu da tela: limpar (era aqui que o guard ficava cego) ==');

  // O LinkedIn trocou o no do dialog no meio da candidatura: o ponteiro guardado
  // morreu, mas a vaga continua sendo trabalho da extensao.
  ok(
    'formulario identificado, no trocado (fora da tela): limpar',
    modo({ varrendo: true, formularioIdentificado: true }) === G.limpar
  );

  // O caso que trouxe o teste: voce assumiu a vaga, enviou a mao, e a pesquisa de
  // avaliacao entra na tela depois do envio.
  ok(
    'pos-envio sem formulario na tela: limpar',
    modo({ varrendo: true, posEnvio: true }) === G.limpar
  );
  ok(
    'e o pos-envio vale mesmo sem nunca ter identificado o formulario',
    modo({ varrendo: true, posEnvio: true, formularioIdentificado: false }) === G.limpar
  );

  console.log('');
  console.log('== o modo limpar nao e licenca para fechar o que nao se conhece ==');

  // O modo so autoriza o content script a procurar popup pelo que a pagina ja
  // classificou (`classifyDialog`): um dialog sem cara (a proxima etapa
  // carregando) nao e popup e nao entra na conta.
  ok(
    'dialog sem cara fica como desconhecido no contrato',
    S.classifyDialog({ text: '', hasForm: false, hasApplyAction: false, hasClose: false }) ===
      S.DIALOG_KINDS.unknown
  );
  ok(
    'e a tela de candidatura enviada e pesquisa, nao formulario',
    S.classifyDialog({
      text: 'Sua candidatura foi enviada. Concluir',
      hasForm: false,
      hasApplyAction: false,
      hasClose: true,
    }) === S.DIALOG_KINDS.survey
  );

  console.log('');
  console.log('== entrada estranha nao liga o guard ==');

  ok('sem sinais (null): quieto', modo(null) === G.quieto);
  ok('sinal de texto no lugar de booleano: quieto', modo({ varrendo: 'sim' }) === G.quieto);
  // A precedencia importa: com o formulario na tela o modo e `proteger` mesmo sem
  // ele ter sido identificado antes (quem diz que ele esta na tela e o proprio
  // content script), e sem varredura nada mexer na pagina acontece.
  ok(
    'formulario na tela manda sobre o resto: proteger',
    modo({ varrendo: true, formularioNaTela: true }) === G.proteger
  );
  ok(
    'sem varredura nem o formulario na tela liga o guard',
    modo({ formularioNaTela: true }) === G.quieto
  );

  console.log('');
  console.log(
    falhas
      ? '\n' + falhas + '/' + total + ' FALHARAM'
      : '\nTodos os ' + total + ' testes do guard de popup passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

try {
  principal();
} catch (erro) {
  console.log('FALHA INESPERADA: ' + (erro && erro.stack ? erro.stack : erro));
  process.exit(1);
}
