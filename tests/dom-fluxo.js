/* =============================================================================
 * PegaVaga - tests/dom-fluxo.js
 *
 * O roteiro do FLUXO DA CANDIDATURA, rodando dentro da página de teste (ver
 * `tests/smoke-dom-fluxo.js` e o harness `tests/dom-cromo.js`).
 *
 * Aqui não chamamos função nenhuma da extensão: a página monta a LISTA DE VAGAS,
 * o BOTÃO de candidatura e o FORMULÁRIO como o LinkedIn os entrega, o storage
 * chega com a fila e as configurações (como o pop-up deixa), e o próprio
 * `content.js` faz tudo sozinho — inclusive pedir ajuda no "cartão". Quem
 * responde é este roteiro, fazendo o papel do worker + da janelinha: é o mesmo
 * caminho da extensão de verdade (`PEGAVAGA_AJUDA_PEDIDO` → a escolha volta em
 * `PEGAVAGA_AJUDA_RESPOSTA`).
 *
 * O que é conferido é o que o LinkedIn veria: os campos PREENCHIDOS (select, rádio
 * e texto), a etapa que AVANÇOU, o envio CONFIRMADO, a candidatura REGISTRADA e a
 * página que NÃO foi recarregada no meio do fluxo.
 * ===========================================================================*/

'use strict';

(async function () {
  const T = window.__pgvTeste;
  const saida = document.getElementById('pgv-saida');
  const dados = window.__pgvDados || {};
  const terminar = () => {
    saida.textContent += 'FIM\n';
  };

  if (!T) {
    ok('o gancho de teste do content.js existe', false, 'window.__pgvTeste nao foi publicado');
    terminar();
    return;
  }

  let pedidos = 0;
  let camposDoCartao = null;

  /** A sua resposta no cartão: a primeira opção de cada lista, "7" no texto. */
  function respostaPara(campos) {
    const resposta = {};

    (campos || []).forEach((c) => {
      if (!c || !c.rotulo) return;
      const opcoes = Array.isArray(c.opcoes) ? c.opcoes : [];
      resposta[c.rotulo] = opcoes.length ? opcoes[0] : '7';
    });

    return resposta;
  }

  /* O worker + a janelinha: cada pedido de ajuda vira uma resposta sua. */
  window.__pgvWorker = function (msg, cb) {
    if (msg && msg.type === 'PEGAVAGA_AJUDA_PEDIDO') {
      pedidos += 1;
      camposDoCartao = msg.campos || [];

      const resposta = respostaPara(camposDoCartao);

      setTimeout(function () {
        window.__pgvParaAba({
          type: 'PEGAVAGA_AJUDA_RESPOSTA',
          pedidoId: msg.pedidoId,
          acao: 'aplicar',
          resposta: resposta,
        });
      }, 50);

      if (typeof cb === 'function') cb({ ok: true, id: 'aviso-teste' });
      return Promise.resolve({ ok: true, id: 'aviso-teste' });
    }

    if (typeof cb === 'function') setTimeout(function () { cb({}); }, 0);
    return Promise.resolve({});
  };

  /* Os elementos são capturados AGORA: depois do envio o LinkedIn remonta (tira)
   * o formulário, e o nó deixa de estar no documento — mas os valores continuam
   * legíveis na referência que guardamos. */
  const sel = document.getElementById('sel-salario');
  const r1 = document.getElementById('r1');
  const txt = document.getElementById('txt-anos');
  const etapa2 = document.getElementById('etapa-2');
  const posEnvio = document.getElementById('pos-envio');

  try {
    /* O fluxo inteiro roda sozinho: a fila veio no storage e o `init` a retomou.
     * Esperamos a candidatura ser REGISTRADA (é o fim do caminho). */
    const registro = await esperar(() => (dados.pegavaga_apps || []).length > 0, 500000);

    const vaga = Object.keys(dados.pegavaga_jobs || {}).map((chave) => {
      const j = dados.pegavaga_jobs[chave];
      return j.applyStatus + ' | ' + String(j.applyReason || '').slice(0, 80);
    });

    ok(
      'o desfecho da vaga foi ENVIADA',
      vaga.length === 1 && vaga[0].indexOf('enviada') === 0,
      JSON.stringify(vaga)
    );

    ok('a extensao abriu o formulario e pediu ajuda no cartao', pedidos >= 1, 'pedidos=' + pedidos);
    ok(
      'o cartao trouxe os campos da etapa',
      (camposDoCartao || []).length >= 3,
      JSON.stringify(camposDoCartao)
    );
    ok('o SELECT foi preenchido', String(sel.value) === 'yes', 'valor=' + String(sel.value));
    ok('o RADIO foi marcado', r1.checked === true, 'r1=' + r1.checked);
    ok('o TEXTO foi preenchido', txt.value === '7', 'valor=' + txt.value);
    ok('o LinkedIn aceitou a etapa (ela avancou)', !etapa2.hasAttribute('hidden'));
    ok('o envio foi confirmado na tela', !posEnvio.hasAttribute('hidden'));
    ok(
      'a candidatura ficou registrada',
      registro && (dados.pegavaga_apps || []).length === 1,
      JSON.stringify(dados.pegavaga_apps)
    );
    ok(
      'a varredura NAO navegou para outro termo (nem recarregou)',
      !dados.pegavaga_run || dados.pegavaga_run.index === 0,
      JSON.stringify(dados.pegavaga_run && dados.pegavaga_run.index)
    );
  } catch (erro) {
    ok('o fluxo rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  terminar();
})();
