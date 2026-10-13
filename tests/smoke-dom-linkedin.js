/* =============================================================================
 * PegaVaga - tests/smoke-dom-linkedin.js
 *
 * Teste de fumaça contra o HTML REAL do LinkedIn: cada arquivo de
 * `tests/fixtures/*.html` é uma etapa do Easy Apply copiada da página (Copy
 * outerHTML) e roda no Chromium com o `content.js` de verdade — o "clone" da
 * etapa.
 *
 * Para cada fixture, o roteiro é `tests/dom-<nome-da-fixture>.js` quando ele
 * existe (casos que merecem conferência própria) e, senão, o genérico
 * `tests/dom-linkedin.js` — que já confere a varredura, o rótulo (não a opção),
 * a repetição por bolinha, as opções dos campos de escolha e a VOLTA (a resposta
 * entrando no formulário).
 *
 * Copiar uma etapa nova do LinkedIn = salvar o HTML em `tests/fixtures/`. Nada
 * mais precisa ser escrito.
 *
 *   node tests/smoke-dom-linkedin.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');

const C = require('./dom-cromo');

if (!C.acharChromium()) C.pular();

const dirFixtures = path.join(__dirname, 'fixtures');

const fixtures = fs
  .readdirSync(dirFixtures)
  .filter((nome) => nome.endsWith('.html'))
  .sort();

if (!fixtures.length) {
  console.log('  FALHA nenhuma fixture em tests/fixtures/');
}

for (const nome of fixtures) {
  const etapa = nome.replace(/\.html$/, '');
  const proprio = path.join(__dirname, 'dom-' + etapa + '.js');
  const roteiro = fs.existsSync(proprio) ? 'tests/dom-' + etapa + '.js' : 'tests/dom-linkedin.js';

  C.montarPagina({
    titulo: etapa,
    corpo: fs.readFileSync(path.join(dirFixtures, nome), 'utf8'),
    scripts: ['shared.js', 'ajuda-campos.js', 'content.js', roteiro],
  });

  const dom = C.rodar(30000);

  if (!dom) C.pular();

  console.log('== ' + etapa + ' ==');
  C.reportar(dom);
  C.mostrarLogs(dom);
}

C.finalizar('Todos os %d testes do HTML real do LinkedIn (DOM real) passaram.');

