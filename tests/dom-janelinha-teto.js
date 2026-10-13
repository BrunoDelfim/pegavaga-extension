/* =============================================================================
 * PegaVaga - tests/dom-janelinha-teto.js
 *
 * O roteiro que roda DENTRO da janelinha quando a etapa tem MUITOS campos (mais
 * do que cabe na tela): a janela para no teto, quem rola é o corpo do cartão e —
 * o que importa — os BOTÕES continuam à vista. É o caso do "botão cortado": a
 * altura nunca pode engolir a fileira de botões.
 * ===========================================================================*/

'use strict';

(async function () {
  try {
    /* A moldura é ajustada em passos: esperamos ela parar antes de medir. */
    await esperar(
      () => window.__pgvJanela.atualizacoes.some((u) => u && (u.left != null || u.top != null)),
      6000
    );

    const janela = window.__pgvJanela.janela;
    const corpo = document.querySelector('.corpo');
    const acoes = document.querySelector('.acoes');
    const cabeca = document.querySelector('.cabeca');
    const TETO = 470;

    ok('com muitos campos a janela para no TETO', janela.height === TETO, 'altura=' + janela.height);

    ok(
      'quem rola e o CORPO (o cartao nao estoura a janela)',
      corpo.scrollHeight > corpo.clientHeight,
      'conteudo=' + corpo.scrollHeight + ' visivel=' + corpo.clientHeight
    );

    /* Rolagem só na vertical: a barra LATERAL significa campo mais largo que a
     * largura fixa da janela (é o `width: 100%` + padding sem `border-box`). */
    const pagina = document.body;

    ok(
      'nem com muitos campos aparece barra de rolagem LATERAL',
      corpo.scrollWidth <= corpo.clientWidth + 1 && pagina.scrollWidth <= pagina.clientWidth + 1,
      'corpo=' +
        corpo.scrollWidth +
        '/' +
        corpo.clientWidth +
        ' pagina=' +
        pagina.scrollWidth +
        '/' +
        pagina.clientWidth
    );

    const caixa = acoes.getBoundingClientRect();

    /* O pedido: nada de "botao cortado" — a fileira inteira dentro da janela. */
    ok(
      'os BOTOES ficam a vista (nada cortado embaixo)',
      caixa.height > 0 && caixa.bottom <= window.innerHeight + 1,
      'botoes ate=' + Math.round(caixa.bottom) + ' janela=' + window.innerHeight
    );

    ok(
      'e a margem de baixo continua sendo a da janela (5px)',
      Math.abs(window.innerHeight - caixa.bottom - 5) <= 2,
      'folga=' + Math.round(window.innerHeight - caixa.bottom)
    );

    ok(
      'o cabecalho continua colado no topo',
      Math.abs(cabeca.getBoundingClientRect().top) <= 1,
      String(Math.round(cabeca.getBoundingClientRect().top))
    );
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  document.getElementById('pgv-saida').textContent += 'FIM\n';
})();
