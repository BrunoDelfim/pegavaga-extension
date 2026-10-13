/* =============================================================================
 * PegaVaga - tests/smoke-dom-fluxo.js
 *
 * Teste de fumaça do FLUXO DA CANDIDATURA num DOM de verdade: a página monta a
 * lista de vagas, o botão de Candidatura Simplificada e o formulário do Easy
 * Apply como o LinkedIn os entrega; o storage chega com a fila e as configurações
 * (como o pop-up deixa); e o `content.js` faz o trabalho sozinho — clicar na vaga,
 * abrir o formulário, pedir ajuda no cartão, PREENCHER (select, rádio e texto),
 * AVANÇAR a etapa e ENVIAR —, tudo dentro de um Chromium de verdade.
 *
 * Quem responde o cartão é o roteiro (`tests/dom-fluxo.js`), fazendo o papel do
 * worker + da janelinha: o mesmo caminho da extensão de verdade.
 *
 * Precisa do browser de teste: `sh tools/baixar-chromium.sh` (sem ele, este teste
 * se pula sozinho e a suíte segue verde).
 *
 *   node tests/smoke-dom-fluxo.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const C = require('./dom-cromo');

if (!C.acharChromium()) C.pular();

const raiz = path.join(__dirname, '..');

/* As configurações e a fila saem do PRÓPRIO `shared.js` (o mesmo caminho do
 * pop-up): o teste não inventa um formato que a extensão não entende. */
vm.runInThisContext(fs.readFileSync(path.join(raiz, 'shared.js'), 'utf8'), {
  filename: 'shared.js',
});

const S = globalThis.PegaVagaShared;

const settings = S.parseSettings({
  // Host morto: se algum dia o fluxo NAVEGAR, ele não sai da máquina.
  baseUrl: 'http://127.0.0.1:9/jobs/search/',
  terms: ['react'],
  apply: {
    enabled: true,
    perTerm: 5,
    scanPerTerm: 10,
    fillRequired: false, // sem o preenchimento automático: quem responde é o cartão
    breaksEnabled: false,
    respectUserActivity: false,
  },
  schedule: { enabled: false },
});

C.montarPagina({
  dados: {
    pegavaga_settings: settings,
    pegavaga_run: S.buildRunQueue(settings),
    pegavaga_apps: [],
  },
  corpo: `
<div class="scaffold-layout__list">
  <ul class="scaffold-layout__list-container">
    <li class="scaffold-layout__list-item selected" data-occludable-job-id="4001">
      <div class="job-card-container">
        <a class="job-card-container__link" href="/jobs/view/4001/">
          <strong>Pessoa Desenvolvedora React</strong>
        </a>
        <span class="artdeco-entity-lockup__subtitle">Empresa de Teste</span>
      </div>
    </li>
  </ul>
</div>

<div class="scaffold-layout__detail" id="job-details">
  <h1 class="job-details-jobs-unified-top-card__job-title">Pessoa Desenvolvedora React</h1>
  <span class="job-details-jobs-unified-top-card__company-name">Empresa de Teste</span>
  <div class="job-details-jobs-unified-top-card__job-insight">Candidatura simplificada</div>
  <div class="jobs-description__content"><article>Vaga de teste: React, Node e um time pequeno.</article></div>
  <button id="jobs-apply-button-id" class="jobs-apply-button" aria-label="Candidatura simplificada para Pessoa Desenvolvedora React">Candidatura simplificada</button>
</div>

<div class="jobs-easy-apply-modal" id="formulario" role="dialog" hidden>
  <div id="etapa-1">
    <div class="fb-dash-form-element" id="bloco-salario">
      <span class="fb-dash-form-element__label">Você aceita uma remuneração de R$ 13.500?</span>
      <select id="sel-salario" class="fb-dash-form-element__select-dropdown" required aria-required="true" style="display:none">
        <option value="">Selecionar opção</option>
        <option value="yes">YES</option>
        <option value="no">NO</option>
      </select>
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
      <input type="text" id="txt-anos" required>
    </div>
  </div>

  <div id="etapa-2" hidden>
    <p>Revise sua candidatura</p>
  </div>

  <footer>
    <button type="button" id="btn-avancar" aria-label="Avançar para próxima etapa">Avançar</button>
    <button type="button" id="btn-enviar" aria-label="Enviar candidatura" hidden>Enviar candidatura</button>
  </footer>
</div>

<div id="pos-envio" hidden>Candidatura enviada!</div>

<script>
  /* O LinkedIn, do jeito que a extensão o encontra: o botão abre o formulário, o
   * "Avançar" NÃO anda com campo obrigatório em branco (é o que faz a extensão
   * pedir ajuda em vez de fingir que preencheu) e o "Enviar" troca o dialog pela
   * confirmação. */
  var form = document.getElementById('formulario');
  var etapa1 = document.getElementById('etapa-1');
  var etapa2 = document.getElementById('etapa-2');
  var btnAvancar = document.getElementById('btn-avancar');
  var btnEnviar = document.getElementById('btn-enviar');

  document.getElementById('jobs-apply-button-id').addEventListener('click', function () {
    form.removeAttribute('hidden');
  });

  function etapaOk() {
    return (
      String(document.getElementById('sel-salario').value) !== '' &&
      String(document.getElementById('txt-anos').value).trim() !== '' &&
      (document.getElementById('r1').checked || document.getElementById('r2').checked)
    );
  }

  btnAvancar.addEventListener('click', function () {
    if (!etapaOk()) return;

    etapa1.setAttribute('hidden', '');
    etapa2.removeAttribute('hidden');
    btnAvancar.setAttribute('hidden', '');
    btnEnviar.removeAttribute('hidden');
  });

  btnEnviar.addEventListener('click', function () {
    // O LinkedIn REMONTA o dialog depois do envio: o formulário sai da tela e a
    // confirmação entra (é assim que a extensão lê "enviada").
    if (form.parentNode) form.parentNode.removeChild(form);
    document.getElementById('pos-envio').removeAttribute('hidden');
  });
</script>
`,
  scripts: ['shared.js', 'ajuda-campos.js', 'content.js', 'tests/dom-fluxo.js'],
});

const dom = C.rodar(600000);

if (!dom) C.pular();

C.reportar(dom);
C.mostrarLogs(dom);
C.finalizar('Todos os %d testes do fluxo da candidatura (DOM real) passaram.');
