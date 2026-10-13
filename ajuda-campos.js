/* =============================================================================
 * PegaVaga - ajuda-campos.js
 *
 * A lógica PURA do overlay de pedido de ajuda — o que dá para testar sem
 * navegador (sem DOM). O content.js consome estas funções para, depois de você
 * responder no cartão, escrever a resposta no campo CERTO: casa o texto que
 * você escolheu com a opção original do LinkedIn (select/rádio) ou com o campo
 * de texto.
 *
 * Duas peças só, de propósito:
 *   - `normalizar`   → o mesmo texto bate mesmo com acento/maiúscula/pontuação;
 *   - `escolherOpcao`→ escolhe a opção cujo rótulo casa com o que você escolheu
 *                      (exato primeiro, depois "contém"), devolvendo o índice.
 * ===========================================================================*/
'use strict';

(function () {
  /**
   * Minúsculas, sem acento, pontuação virando espaço e sem espaços extras: é o
   * que faz "Anos de experiência" bater com "anos de experiencia." — mesma
   * pergunta, escrita de um jeito diferente.
   */
  function normalizar(t) {
    return String(t == null ? '' : t)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Índice da opção, em `rotulos`, que casa com `alvo`. Casa o texto EXATO
   * antes de "contém" (para "Sim" não pegar "Sim, com restrições" por engano).
   * Devolve -1 quando nada casa (ou `alvo` é vazio) — quem chora decide.
   */
  function escolherOpcao(rotulos, alvo) {
    const alvoN = normalizar(alvo);
    if (!alvoN) return -1;

    const lista = Array.isArray(rotulos) ? rotulos : [];

    for (let i = 0; i < lista.length; i++) {
      if (normalizar(lista[i]) === alvoN) return i;
    }
    for (let i = 0; i < lista.length; i++) {
      if (normalizar(lista[i]).indexOf(alvoN) >= 0) return i;
    }
    return -1;
  }

  globalThis.PegaVagaAjuda = { normalizar: normalizar, escolherOpcao: escolherOpcao };
})();
