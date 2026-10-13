/* =============================================================================
 * PegaVaga - tests/dom-janelinha.js
 *
 * O roteiro que roda DENTRO da janelinha (`ajuda.html`, com o `chrome` falso):
 * confere que o cartão abre PREENCHIDO com o que já está no LinkedIn e que a sua
 * resposta sai montada como o content script espera (`rótulo → valor`).
 * ===========================================================================*/

'use strict';

(async function () {
  const enviadas = [];

  window.__pgvWorker = function (msg, cb) {
    enviadas.push(msg);
    if (typeof cb === 'function') setTimeout(function () { cb({ ok: true }); }, 0);
    return Promise.resolve({ ok: true });
  };

  try {
    const c0 = document.getElementById('campo-0');
    const c1 = document.getElementById('campo-1');
    const c2 = document.getElementById('campo-2');

    ok(
      'a janelinha desenhou os 3 campos',
      Boolean(c0 && c1 && c2),
      [c0, c1, c2].map((c) => (c ? c.tagName : 'null')).join('/')
    );

    ok('o texto ja digitado no LinkedIn veio preenchido', Boolean(c0) && c0.value === '5000', c0 && c0.value);
    ok(
      'a opcao ja escolhida no LinkedIn veio selecionada',
      Boolean(c1) && c1.value === 'Avançado',
      c1 && c1.value
    );
    ok('o campo que FALTA abriu vazio', Boolean(c2) && c2.value === '', c2 && c2.value);

    const rotulos = Array.prototype.slice
      .call(document.querySelectorAll('#campos label'))
      .map((l) => cleanTexto(l.textContent));

    ok(
      'cada campo mostra a PERGUNTA dele',
      rotulos.length === 3 &&
        rotulos[0].indexOf('expectativa salarial') >= 0 &&
        rotulos[1].indexOf('nível de inglês') >= 0 &&
        rotulos[2].indexOf('viagens') >= 0,
      JSON.stringify(rotulos)
    );

    // Você responde o que faltava e clica em "Aplicar e continuar".
    if (c2) {
      c2.value = 'No';
      c2.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const aplicar = document.getElementById('aplicar');
    if (aplicar) aplicar.click();

    await esperar(() => enviadas.length > 0, 5000);

    const msg = enviadas[0] || {};
    const resposta = msg.resposta || {};

    ok(
      'a decisao foi enviada como aplicar',
      msg.type === 'PEGAVAGA_AJUDA_RESPOSTA_JANELA' && msg.acao === 'aplicar' && msg.avisoId === 'teste',
      JSON.stringify(msg).slice(0, 160)
    );

    ok(
      'a resposta leva o que voce respondeu',
      resposta['Você tem disponibilidade para viagens?'] === 'No',
      JSON.stringify(resposta)
    );

    ok(
      'e leve TAMBEM o que ja estava preenchido (nao perde o que estava la)',
      resposta['Qual sua expectativa salarial?'] === '5000' &&
        resposta['Qual é o seu nível de inglês?'] === 'Avançado',
      JSON.stringify(resposta)
    );

    /* ---------------------------------------------------------------------- */
    /* A JANELA: altura do conteúdo, canto inferior direito e posição guardada */
    /* ---------------------------------------------------------------------- */

    /* A moldura da janela é ajustada em passos (a altura casa com o conteúdo e a
     * posição vem depois): esperamos as atualizações antes de conferir. */
    await esperar(() => window.__pgvJanela.atualizacoes.length >= 2, 6000);

    const janela = window.__pgvJanela.janela;
    const cartao = document.getElementById('cartao');
    const guardadaAntes = (window.__pgvDados || {}).pegavaga_ajuda_pos;

    ok(
      'a janela encolheu para o CONTEUDO (nada de altura fixa)',
      janela.height < 470 && janela.height >= 176,
      'altura=' + janela.height
    );

    /* A regra da altura: a janela termina MARGEM (5px) abaixo do último elemento do
     * cartão — não é o tamanho do container interno. */
    const topoDoCartao = cartao.getBoundingClientRect().top;
    const filhosDoCartao = Array.prototype.slice.call(cartao.children).reverse();
    const ultimo = filhosDoCartao.find((f) => f.getBoundingClientRect().height) || cartao;
    const ateOMargem = Math.ceil(ultimo.getBoundingClientRect().bottom - topoDoCartao) + 5;

    ok(
      'a janela termina 5px abaixo do ultimo elemento (a margem)',
      Math.abs(window.innerHeight - ateOMargem) <= 2,
      'espaco da pagina=' +
        window.innerHeight +
        ' esperado=' +
        ateOMargem +
        ' janela=' +
        janela.height
    );

    const MARGEM = 16;

    if (guardadaAntes) {
      ok(
        'abriu na posicao MEMORIZADA',
        janela.left === guardadaAntes.left && janela.top === guardadaAntes.top,
        'em=' + janela.left + ',' + janela.top + ' guardado=' + JSON.stringify(guardadaAntes)
      );
    } else {
      const esperadoLeft = screen.availLeft + screen.availWidth - (janela.width || 372) - MARGEM;
      const esperadoTop = screen.availTop + screen.availHeight - janela.height - MARGEM;

      ok(
        'na primeira abertura vai para o CANTO INFERIOR DIREITO',
        janela.left === esperadoLeft && janela.top === esperadoTop,
        'em=' + janela.left + ',' + janela.top + ' esperado=' + esperadoLeft + ',' + esperadoTop
      );
    }

    /* Arrastar tem de MEMORIZAR: é o que faz a próxima vaga abrir onde você deixou. */
    const antesDoArrasto = { left: janela.left, top: janela.top };
    const cabeca = document.getElementById('cabeca');

    const rato = (tipo, alvo, x, y) => {
      alvo.dispatchEvent(
        new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y })
      );
    };

    const respirar = (ms) => new Promise((r) => setTimeout(r, ms));

    await respirar(60); // o id da janela chega no primeiro tick
    rato('mousedown', cabeca, 100, 100);
    await respirar(60); // a posição base vem do chrome.windows.get
    rato('mousemove', document, 140, 130);
    rato('mouseup', document, 140, 130);

    const chavePos =
      (window.PegaVagaShared &&
        window.PegaVagaShared.STORAGE &&
        window.PegaVagaShared.STORAGE.pos) ||
      'pegavaga_ajuda_pos';

    await esperar(() => Boolean(window.__pgvDados[chavePos]), 3000);

    const guardada = window.__pgvDados[chavePos] || {};

    ok(
      'arrastar MEMORIZA a posicao para a proxima abertura',
      guardada.left === antesDoArrasto.left + 40 && guardada.top === antesDoArrasto.top + 30,
      JSON.stringify(guardada) + ' antes=' + JSON.stringify(antesDoArrasto)
    );
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  document.getElementById('pgv-saida').textContent += 'FIM\n';
})();
