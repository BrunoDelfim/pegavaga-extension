/* =============================================================================
 * PegaVaga - tests/dom-linkedin.js
 *
 * O roteiro que roda DENTRO da página com o HTML REAL do LinkedIn
 * (`tests/fixtures/linkedin-etapa-radios.html`, copiado do Easy Apply numa vaga
 * com duas perguntas de rádio Yes/No e a segunda marcada com erro).
 *
 * É o "clone" da etapa: se o LinkedIn mudar o markup, a fixture é trocada e este
 * roteiro diz na hora se a extensão ainda reconhece e preenche.
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

  const modal = document.querySelector('.jobs-easy-apply-modal');

  if (!modal) {
    ok('o HTML real do LinkedIn esta na pagina', false, 'modal nao encontrado');
    terminar();
    return;
  }

  try {
    const campos = T.camposTravados(modal);
    const resumo = campos.map((c) => c.tipo + ' [' + (c.opcoes || []).join('/') + '] ' + c.rotulo);

    ok(
      'reconheceu as DUAS perguntas (uma vez cada, nao uma por bolinha)',
      campos.length === 2,
      JSON.stringify(resumo)
    );
    ok(
      'as duas sao do tipo radio',
      campos.length === 2 && campos.every((c) => c.tipo === 'radio'),
      JSON.stringify(resumo)
    );
    ok(
      'as opcoes sao Yes/No',
      campos.every((c) => (c.opcoes || []).join('/') === 'Yes/No'),
      JSON.stringify(resumo)
    );
    ok(
      'a 1a pergunta vem do <legend> (Bachelor)',
      Boolean(campos[0]) && campos[0].rotulo.indexOf("Bachelor's Degree") >= 0,
      campos[0] && campos[0].rotulo
    );
    ok(
      'a 2a pergunta vem do <legend> (Master)',
      Boolean(campos[1]) && campos[1].rotulo.indexOf("Master's Degree") >= 0,
      campos[1] && campos[1].rotulo
    );
    ok(
      'nenhuma pergunta saiu como "Yes"/"No"',
      !campos.some((c) => /^(Yes|No)$/.test(c.rotulo)),
      JSON.stringify(resumo)
    );
    ok(
      'nenhum rotulo arrastou o "Obrigatorio" escondido',
      !campos.some((c) => /obrigat/i.test(c.rotulo)),
      JSON.stringify(resumo)
    );

    const radios = Array.prototype.slice.call(modal.querySelectorAll('input[type="radio"]'));

    /* A resposta usa a MESMA chave que o cartão mostrou — é o que o pop-up manda. */
    const resposta1 = {};
    resposta1[campos[0].rotulo] = 'Yes';

    const aplicados1 = await T.aplicarRespostaNosCampos(modal, resposta1);

    ok(
      'marcou o "Yes" da 1a pergunta',
      aplicados1 === 1 && radios[0].checked === true && radios[1].checked === false,
      'aplicados=' + aplicados1 + ' yes=' + radios[0].checked + ' no=' + radios[1].checked
    );

    const resposta2 = {};
    resposta2[campos[1].rotulo] = 'No';

    const aplicados2 = await T.aplicarRespostaNosCampos(modal, resposta2);

    ok(
      'marcou o "No" da 2a pergunta (a que estava com erro)',
      aplicados2 === 1 && radios[3].checked === true && radios[2].checked === false,
      'aplicados=' + aplicados2 + ' yes=' + radios[2].checked + ' no=' + radios[3].checked
    );

    ok(
      'a 1a pergunta continuou marcada (nao foi desmarcada pela 2a)',
      radios[0].checked === true,
      'yes1=' + radios[0].checked
    );
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  terminar();
})();
