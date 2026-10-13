/* =============================================================================
 * PegaVaga - tests/smoke-dom.js
 *
 * Teste de fumaça do PREENCHIMENTO num DOM de verdade: monta o formulário do Easy
 * Apply como o LinkedIn o entrega (o `<select>` escondido atrás do UI do artdeco,
 * rádio sem `name` com cada bolinha no seu container, `role="radio"`,
 * `role="combobox"`) e roda o `content.js` num Chromium de verdade, conferindo o
 * que ENTROU no formulário. O roteiro do que é conferido está em
 * `tests/dom-preenchimento.js` (roda DENTRO da página); o harness (browser,
 * página, leitura do resultado) está em `tests/dom-cromo.js`.
 *
 * Precisa do browser de teste, baixado uma vez (sem root, sem npm):
 *
 *   sh tools/baixar-chromium.sh
 *
 * Sem ele, este teste se pula sozinho e a suíte segue verde.
 *
 *   node tests/smoke-dom.js
 * ===========================================================================*/

'use strict';

const C = require('./dom-cromo');

if (!C.acharChromium()) C.pular();

C.montarPagina({
  corpo: `
<div class="jobs-easy-apply-modal" id="modal" role="dialog">

  <div class="fb-dash-form-element" id="bloco-salario">
    <span class="fb-dash-form-element__label">Você aceita uma remuneração de R$ 13.500?</span>
    <select id="sel-salario" class="fb-dash-form-element__select-dropdown" required aria-required="true" style="display:none">
      <option value="">Selecionar opção</option>
      <option value="yes">YES</option>
      <option value="no">NO</option>
    </select>
    <div role="alert" class="artdeco-inline-feedback"></div>
  </div>

  <div class="fb-dash-form-element" id="bloco-radio">
    <span class="fb-dash-form-element__label">Você tem disponibilidade para viagens?</span>
    <div class="artdeco-radio-group">
      <label class="artdeco-radio-button"><input type="radio" id="r1" value="yes"> <span>Yes</span></label>
      <label class="artdeco-radio-button"><input type="radio" id="r2" value="no"> <span>No</span></label>
    </div>
  </div>

  <div class="fb-dash-form-element" id="bloco-texto">
    <span class="fb-dash-form-element__label">Quantos anos de experiência você tem com React?</span>
    <input type="text" id="txt-anos">
  </div>

  <div class="fb-dash-form-element" id="bloco-custom">
    <span class="fb-dash-form-element__label">Você está autorizado a trabalhar no Brasil?</span>
    <div role="radiogroup" aria-label="Você está autorizado a trabalhar no Brasil?">
      <div role="radio" aria-checked="false" tabindex="0"><span>Sim</span></div>
      <div role="radio" aria-checked="false" tabindex="0"><span>Não</span></div>
    </div>
  </div>

  <div class="fb-dash-form-element" id="bloco-combo">
    <span class="fb-dash-form-element__label">Qual é o seu nível de inglês?</span>
    <div role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0" id="combo-ingles">
      <span>Selecionar opção</span>
    </div>
    <div role="listbox" hidden>
      <div role="option" data-value="basico">Básico</div>
      <div role="option" data-value="avancado">Avançado</div>
    </div>
  </div>

  <div class="fb-dash-form-element" id="bloco-radio-respondido">
    <span class="fb-dash-form-element__label">Você já trabalhou com equipes remotas?</span>
    <button type="button" aria-expanded="false" aria-label="Mais informações">?</button>
    <div class="artdeco-radio-group">
      <label class="artdeco-radio-button"><input type="radio" name="remoto" id="rem-y" value="Yes" checked> <span>Yes</span></label>
      <label class="artdeco-radio-button"><input type="radio" name="remoto" id="rem-n" value="No"> <span>No</span></label>
    </div>
  </div>

  <div class="fb-dash-form-element" id="bloco-cnh">
    <span class="fb-dash-form-element__label">Você possui CNH categoria B?</span>
    <div class="artdeco-radio-group">
      <div><input type="radio" name="cnh" id="cnh-y" value="Yes"></div>
      <div><input type="radio" name="cnh" id="cnh-n" value="No"></div>
    </div>
  </div>

  <div class="fb-dash-form-element" id="bloco-nivel">
    <span class="fb-dash-form-element__label">Qual seu nível de proficiência em Inglês?</span>
    <select id="sel-nivel">
      <option value="0" selected>Básico</option>
      <option value="1">Intermediário</option>
      <option value="2">Avançado</option>
    </select>
  </div>

</div>

<div class="jobs-easy-apply-modal" id="modal-sozinho" role="dialog">
  <div class="fb-dash-form-element" id="bloco-sozinho">
    <span class="fb-dash-form-element__label">Pergunta que chegou ao cartao com outro texto</span>
    <select id="sel-sozinho" required>
      <option value="">Selecionar opção</option>
      <option value="a">Opção A</option>
      <option value="b">Opção B</option>
    </select>
  </div>
</div>
`,
  scripts: ['shared.js', 'ajuda-campos.js', 'content.js', 'tests/dom-preenchimento.js'],
});

const dom = C.rodar(30000);

if (!dom) C.pular();

C.reportar(dom);
C.mostrarLogs(dom);
C.finalizar('Todos os %d testes do preenchimento (DOM real) passaram.');
