/* =============================================================================
 * PegaVaga - tests/smoke-dom-janelinha.js
 *
 * Teste de fumaça da JANELINHA do desktop (`ajuda.html` + `ajuda.js`), rodando no
 * Chromium com o HTML REAL da extensão e um `chrome` falso: é a tela que você vê
 * quando uma etapa trava.
 *
 * O que é conferido é o que você pediu: **o cartão abre PREENCHIDO com o que já
 * está no LinkedIn** — o texto digitado aparece no input, a opção já escolhida vem
 * selecionada — e a sua resposta sai montada com `rótulo → valor` (o mesmo
 * contrato que o content script usa para reaplicar).
 *
 *   node tests/smoke-dom-janelinha.js
 * ===========================================================================*/

'use strict';

const C = require('./dom-cromo');

if (!C.acharChromium()) C.pular();

const dados = {
  avisoId: 'teste',
  motivo: 'campos',
  titulo: 'Pessoa Desenvolvedora React',
  empresa: 'Empresa de Teste',
  campos: [
    // Um campo de texto JÁ digitado no LinkedIn.
    { rotulo: 'Qual sua expectativa salarial?', tipo: 'texto', opcoes: [], valor: '5000' },
    // Uma pergunta de lista com escolha JÁ feita no LinkedIn.
    {
      rotulo: 'Qual é o seu nível de inglês?',
      tipo: 'select',
      opcoes: ['Básico', 'Intermediário', 'Avançado'],
      valor: 'Avançado',
    },
    // E o que falta de verdade: sem valor nenhum.
    {
      rotulo: 'Você tem disponibilidade para viagens?',
      tipo: 'radio',
      opcoes: ['Yes', 'No'],
      valor: '',
    },
  ],
};

C.montarPagina({
  arquivoHtml: 'ajuda.html',
  query: 'dados=' + encodeURIComponent(JSON.stringify(dados)),
  scripts: ['tests/dom-janelinha.js'],
});

const dom = C.rodar(30000);

if (!dom) C.pular();

C.reportar(dom);
C.mostrarLogs(dom);
C.finalizar('Todos os %d testes da janelinha (DOM real) passaram.');
