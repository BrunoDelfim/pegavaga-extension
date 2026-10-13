/* =============================================================================
 * PegaVaga - tests/dom-linkedin-etapa-contato.js
 *
 * O roteiro da fixture `linkedin-etapa-contato.html` (a PRIMEIRA etapa do Easy
 * Apply, a que abriu o cartão em branco).
 *
 * A página monta o formulário e só DEPOIS escreve os valores de perfil (nome,
 * sobrenome, telefone, país, e-mail) — exatamente como o React do LinkedIn faz.
 * O cartão tem de ser montado depois disso: se ele listar esses campos, você acaba
 * preenchendo à mão o que já estava lá.
 * ===========================================================================*/

'use strict';

(async function () {
  const T = window.__pgvTeste;
  const saida = document.getElementById('pgv-saida');
  const terminar = () => {
    saida.textContent += 'FIM\n';
  };

  if (!T) {
    ok('o gancho de teste do content.js existe', false, 'window.__pgvTeste ausente');
    terminar();
    return;
  }

  const modal = document.querySelector('.jobs-easy-apply-modal');

  try {
    /* É assim que o fluxo pergunta: `camposTravadosCompletos` (que agora espera a
     * etapa ficar quieta e relê), e não `camposTravados` direto. */
    const campos = await T.camposTravadosCompletos(modal);
    const rotulos = campos.map((c) => c.rotulo);

    ok(
      'o cartao pede SO o que falta (Location), nao o que o LinkedIn ja preencheu',
      campos.length === 1 && rotulos[0].indexOf('Location') >= 0,
      JSON.stringify(rotulos)
    );

    ok(
      'e o campo que falta esta vazio no cartao',
      campos.length === 1 && campos[0].valor === '',
      JSON.stringify(campos.map((c) => c.tipo + ':' + JSON.stringify(c.valor)))
    );

    /* Os valores de perfil estão na descrição do campo (é disso que o cartão
     * pré-preenche) — mesmo com o campo fora do cartão, por já estar respondido. */
    ok(
      'o nome que o LinkedIn preencheu e lido como valor',
      T.descreverCampo(document.getElementById('form-element-nome'), modal).valor === 'Bruno',
      JSON.stringify(T.descreverCampo(document.getElementById('form-element-nome'), modal).valor)
    );
    ok(
      'o pais escolhido e lido como valor',
      T.descreverCampo(document.getElementById('form-element-pais'), modal).valor === 'Brazil (+55)',
      JSON.stringify(T.descreverCampo(document.getElementById('form-element-pais'), modal).valor)
    );

    /* O typeahead: escrever no campo é o que o LinkedIn aceita (a lista de
     * sugestões só aparece com texto). */
    const resposta = {};
    resposta['Location (city)'] = 'São Paulo';

    const aplicados = await T.aplicarRespostaNosCampos(modal, resposta);
    const cidade = document.getElementById('form-element-cidade');

    ok(
      'a resposta entra no TYPEAHEAD (Location)',
      aplicados === 1 && String(cidade.value) === 'São Paulo',
      'aplicados=' + aplicados + ' valor=' + String(cidade.value)
    );
  } catch (erro) {
    ok('o roteiro rodou ate o fim', false, (erro && erro.message) || String(erro));
  }

  terminar();
})();
