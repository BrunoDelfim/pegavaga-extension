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

/* Três cenários, porque a janela é a mesma e o que muda é o que está guardado:
 *   1. primeira abertura (sem posição): tem de ir para o canto inferior direito;
 *   2. com posição memorizada: tem de abrir ONDE você a deixou;
 *   3. com MUITOS campos (mais do que cabe na tela): a janela para no teto, o corpo
 *      rola e os botões continuam à vista (o caso do "botão cortado"). */
const muitos = [];
for (let i = 0; i < 12; i += 1) {
  muitos.push({
    rotulo: 'Pergunta ' + (i + 1) + ' da etapa?',
    tipo: 'texto',
    opcoes: [],
    valor: '',
  });
}

const cenarios = [
  { nome: 'primeira abertura', extra: {}, script: 'tests/dom-janelinha.js' },
  {
    nome: 'com posicao guardada',
    extra: { pegavaga_ajuda_pos: { left: 40, top: 60 } },
    script: 'tests/dom-janelinha.js',
  },
  {
    nome: 'com muitos campos (teto)',
    extra: { campos: muitos },
    script: 'tests/dom-janelinha-teto.js',
  },
];

for (const cenario of cenarios) {
  const contexto = Object.assign({}, dados, cenario.extra);

  C.montarPagina({
    arquivoHtml: 'ajuda.html',
    query: 'dados=' + encodeURIComponent(JSON.stringify(contexto)),
    // `dados` é o STORAGE do teste (o harness); o `query` é o contexto que a
    // própria janelinha lê da URL. A posição guardada vive no storage.
    dados: contexto,
    scripts: [cenario.script],
  });

  const dom = C.rodar(30000);

  if (!dom) C.pular();

  console.log('== janelinha ' + cenario.nome + ' ==');
  C.reportar(dom);
  C.mostrarLogs(dom);
}

C.finalizar('Todos os %d testes da janelinha (DOM real) passaram.');
