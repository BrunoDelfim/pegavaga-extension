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
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  document.getElementById('pgv-saida').textContent += 'FIM\n';
})();
