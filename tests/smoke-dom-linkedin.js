/* =============================================================================
 * PegaVaga - tests/smoke-dom-linkedin.js
 *
 * Teste de fumaça contra o HTML REAL do LinkedIn: pega a cópia de uma etapa do
 * Easy Apply (`tests/fixtures/linkedin-etapa-radios.html`, tirada com "Copy
 * outerHTML") e roda o `content.js` nela num Chromium de verdade — o "clone" da
 * etapa, que faz o markup real virar teste e responder na hora quando o LinkedIn
 * mudar alguma coisa.
 *
 * O que este HTML trouxe de novo (e que virou conserto):
 *   - as perguntas são `<fieldset>` + `<legend>` com o rótulo em
 *     `<span class="fb-dash-form-element__label">` e um `Obrigatório` escondido
 *     dentro do próprio `<legend>`;
 *   - o texto da opção também está num `data-test-text-selectable-option__input`;
 *   - `aria-required="true"` está em CADA bolinha (o grupo entrava uma vez por
 *     opção no cartão);
 *   - a segunda pergunta vem com `artdeco-inline-feedback--error` na tela.
 *
 *   node tests/smoke-dom-linkedin.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');

const C = require('./dom-cromo');

if (!C.acharChromium()) C.pular();

const fixture = path.join(__dirname, 'fixtures', 'linkedin-etapa-radios.html');

C.montarPagina({
  corpo: fs.readFileSync(fixture, 'utf8'),
  scripts: ['shared.js', 'ajuda-campos.js', 'content.js', 'tests/dom-linkedin.js'],
});

const dom = C.rodar(30000);

if (!dom) C.pular();

C.reportar(dom);
C.mostrarLogs(dom);
C.finalizar('Todos os %d testes do HTML real do LinkedIn (DOM real) passaram.');
