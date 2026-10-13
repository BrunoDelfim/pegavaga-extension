/* =============================================================================
 * PegaVaga - tests/dom-preenchimento.js
 *
 * O roteiro que roda DENTRO da página de teste (ver `tests/smoke-dom.js`): usa o
 * gancho `window.__pgvTeste` e confere o que o preenchimento fez no formulário.
 * Escreve uma linha por verificação ("OK nome" / "FALHA nome -> detalhe") e
 * termina com "FIM" — é isso que o teste no Node lê.
 *
 * Os casos aqui são os que já quebraram de verdade no LinkedIn:
 *   1. o RÁDIO: a pergunta é o rótulo do GRUPO (não o "Yes" da bolinha) e o grupo
 *      tem TODAS as opções, mesmo com cada bolinha no seu container e sem `name`;
 *   2. o `<select>` ESCONDIDO (sem caixa) — o artdeco esconde o nativo atrás do UI;
 *      ele tem de ser achado, preenchido e AVISADO (input/change/blur);
 *   3. o rádio CUSTOM (`role="radio"`), que marca por `aria-checked`;
 *   4. o campo de texto comum.
 * ===========================================================================*/

'use strict';

(async function () {
  const T = window.__pgvTeste;
  const saida = document.getElementById('pgv-saida');
  const terminar = () => {
    saida.textContent += 'FIM\n';
  };

  if (!T) {
    ok('o gancho de teste do content.js existe', false, 'window.__pgvTeste nao foi publicado');
    terminar();
    return;
  }

  const modal = document.getElementById('modal');

  try {
    /* ---------------------------------------------------------------------- */
    /* 1) O que a varredura ENXERGA (antes de responder qualquer coisa)        */
    /* ---------------------------------------------------------------------- */

    const campos = T.camposTravados(modal);
    const resumo = campos.map((c) => c.tipo + ' [' + (c.opcoes || []).join('/') + '] ' + c.rotulo);

    ok(
      'achou o select escondido com as opcoes do LinkedIn',
      resumo.some((r) => r.indexOf('select [YES/NO]') === 0),
      resumo.join(' || ')
    );

    ok(
      'achou o radio como UMA pergunta com as duas opcoes',
      resumo.some((r) => r.indexOf('radio [Yes/No]') === 0),
      resumo.join(' || ')
    );

    ok(
      'cada rotulo e a PERGUNTA (nenhum campo comecou com "Yes"/"No")',
      !resumo.some((r) => /^(select|radio|texto) \[[^\]]*\] (Yes|No)\b/.test(r)),
      resumo.join(' || ')
    );

    /* ---------------------------------------------------------------------- */
    /* 2) O rádio nativo, sem `name`, com cada bolinha no seu container        */
    /* ---------------------------------------------------------------------- */

    const r1 = document.getElementById('r1');
    const r2 = document.getElementById('r2');
    const perguntaRadio = 'Você tem disponibilidade para viagens?';

    ok(
      'a pergunta do radio vem do GRUPO',
      T.fieldLabel(r1).indexOf('disponibilidade para viagens') >= 0,
      T.fieldLabel(r1)
    );

    ok('o grupo tem as DUAS opcoes', T.opcoesDoGrupo(r1).length === 2, T.opcoesDoGrupo(r1).length);
    ok('a opcao lida e o texto da bolinha', T.rotuloDaOpcao(r2) === 'No', T.rotuloDaOpcao(r2));

    const respostaRadio = {};
    respostaRadio[perguntaRadio] = 'No';

    const aplicadosRadio = await T.aplicarRespostaNosCampos(modal, respostaRadio);

    ok(
      'marcou a opcao escolhida do radio',
      aplicadosRadio === 1 && r2.checked === true && r1.checked === false,
      'aplicados=' + aplicadosRadio + ' r2=' + r2.checked + ' r1=' + r1.checked
    );

    /* ---------------------------------------------------------------------- */
    /* 3) O `<select>` ESCONDIDO (o caso do LinkedIn de hoje)                  */
    /* ---------------------------------------------------------------------- */

    const sel = document.getElementById('sel-salario');
    let mudancas = 0;
    let blurs = 0;

    sel.addEventListener('change', () => {
      mudancas += 1;
    });
    sel.addEventListener('blur', () => {
      blurs += 1;
    });

    ok('o select sem caixa conta como escondido', T.isVisible(sel) === false);

    const perguntaSelect = 'Você aceita uma remuneração de R$ 13.500?';
    const respostaSelect = {};
    respostaSelect[perguntaSelect] = 'YES';

    const aplicadosSelect = await T.aplicarRespostaNosCampos(modal, respostaSelect);

    ok(
      'o select escondido recebeu a resposta',
      aplicadosSelect === 1 && String(sel.value) === 'yes',
      'aplicados=' + aplicadosSelect + ' valor=' + String(sel.value)
    );

    ok('avisou o React com change', mudancas >= 1, 'change=' + mudancas);
    ok('avisou com blur (e o LinkedIn que valida ao sair)', blurs >= 1, 'blur=' + blurs);

    /* ---------------------------------------------------------------------- */
    /* 4) O rádio CUSTOM (`role="radio"`)                                      */
    /* ---------------------------------------------------------------------- */

    const customs = Array.prototype.slice.call(document.querySelectorAll('[role="radio"]'));
    const custom1 = customs[0];
    const custom2 = customs[1];
    const perguntaCustom = 'Você está autorizado a trabalhar no Brasil?';

    ok(
      'a pergunta do radio custom vem do radiogroup',
      T.fieldLabel(custom1).indexOf('autorizado a trabalhar') >= 0,
      T.fieldLabel(custom1)
    );

    ok(
      'o grupo custom tem as DUAS opcoes',
      T.opcoesDoGrupo(custom1).length === 2,
      T.opcoesDoGrupo(custom1).length
    );

    ok(
      'a opcao custom lida e o texto de dentro',
      T.rotuloDaOpcao(custom2) === 'Não',
      T.rotuloDaOpcao(custom2)
    );

    const respostaCustom = {};
    respostaCustom[perguntaCustom] = 'Sim';

    const aplicadosCustom = await T.aplicarRespostaNosCampos(modal, respostaCustom);

    ok(
      'marcou a opcao custom (aria-checked)',
      aplicadosCustom === 1 && custom1.getAttribute('aria-checked') === 'true',
      'aplicados=' + aplicadosCustom + ' aria=' + custom1.getAttribute('aria-checked')
    );

    /* ---------------------------------------------------------------------- */
    /* 5) O campo de texto                                                     */
    /* ---------------------------------------------------------------------- */

    const txt = document.getElementById('txt-anos');
    const perguntaTexto = 'Quantos anos de experiência você tem com React?';
    const respostaTexto = {};
    respostaTexto[perguntaTexto] = '7';

    const aplicadosTexto = await T.aplicarRespostaNosCampos(modal, respostaTexto);

    ok(
      'o campo de texto recebeu o valor',
      aplicadosTexto === 1 && txt.value === '7',
      'aplicados=' + aplicadosTexto + ' valor=' + txt.value
    );

    /* ---------------------------------------------------------------------- */
    /* 6) O RELOAD: com formulário aberto, a troca de termo espera             */
    /* ---------------------------------------------------------------------- */

    ok('nao recarrega com o formulario de candidatura aberto', T.podeRecarregar() === false);

    modal.style.display = 'none';
    ok('recarrega quando nao ha formulario na tela', T.podeRecarregar() === true);
    modal.style.display = '';
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  terminar();
})();

