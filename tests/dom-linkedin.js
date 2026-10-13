/* =============================================================================
 * PegaVaga - tests/dom-linkedin.js
 *
 * O roteiro que roda DENTRO da página com o HTML REAL do LinkedIn (as fixtures de
 * `tests/fixtures/`). É genérico de propósito: **cada etapa nova copiada do
 * LinkedIn vira só um arquivo** — nenhuma linha de roteiro muda.
 *
 * O que ele confere em QUALQUER etapa real, e por quê:
 *   - a varredura reconhece campo (senão a etapa trava sem aviso);
 *   - nenhum rótulo é o texto da OPÇÃO ("Yes"/"No") nem arrasta o "Obrigatório"
 *     escondido — foi o que o `<legend>` do LinkedIn provocou;
 *   - o rótulo não se repete (a mesma pergunta 4×, uma por bolinha, era o
 *     `aria-required` em cada `<input type=radio>`);
 *   - todo campo de escolha vem COM as opções (sem elas o cartão cai no campo de
 *     texto — o "select veio como text input");
 *   - a VOLTA: responder cada campo (a 1ª opção, ou um número no texto) tem de
 *     ENTRAR no formulário. O próprio `aplicarRespostaNosCampos` confere a escrita
 *     antes de contar, então "entrou" aqui é "entrou" de verdade.
 * ===========================================================================*/

'use strict';

(async function () {
  const T = window.__pgvTeste;
  const saida = document.getElementById('pgv-saida');
  const etapa = document.title.replace(/^.*- /, '') || 'etapa';
  const terminar = () => {
    saida.textContent += 'FIM\n';
  };

  if (!T) {
    ok(etapa + ': o gancho de teste do content.js existe', false, 'window.__pgvTeste ausente');
    terminar();
    return;
  }

  const modal = document.querySelector('.jobs-easy-apply-modal') || document.body;

  try {
    const campos = T.camposTravados(modal);
    const resumo = campos.map(
      (c) => c.tipo + ' [' + (c.opcoes || []).join('/') + '] ' + String(c.rotulo || '').slice(0, 55)
    );

    ok(etapa + ': a varredura reconheceu campos', campos.length >= 1, JSON.stringify(resumo));

    ok(
      etapa + ': nenhum rotulo e a OPCAO (nem o "Obrigatorio" colado)',
      !campos.some(
        (c) => /^(Yes|No|Sim|Não)$/i.test(String(c.rotulo).trim()) || /obrigat[óo]rio/i.test(c.rotulo)
      ),
      JSON.stringify(resumo)
    );

    ok(
      etapa + ': nenhuma pergunta repetida (uma por bolinha)',
      new Set(campos.map((c) => c.rotulo)).size === campos.length,
      JSON.stringify(resumo)
    );

    ok(
      etapa + ': todo campo de escolha veio com as opcoes',
      !campos.some(
        (c) => ['select', 'radio', 'checkbox'].indexOf(c.tipo) >= 0 && !(c.opcoes || []).length
      ),
      JSON.stringify(resumo)
    );

    for (const campo of campos) {
      const opcoes = campo.opcoes || [];
      const resposta = {};
      resposta[campo.rotulo] = opcoes.length ? opcoes[0] : '7';

      const aplicados = await T.aplicarRespostaNosCampos(modal, resposta);

      ok(
        etapa + ': a resposta entrou em "' + String(campo.rotulo).slice(0, 45) + '"',
        aplicados >= 1,
        'tipo=' + campo.tipo + ' resposta=' + resposta[campo.rotulo] + ' aplicados=' + aplicados
      );
    }
  } catch (erro) {
    ok(etapa + ': o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  terminar();
})();
