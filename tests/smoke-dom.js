/* =============================================================================
 * PegaVaga - tests/smoke-dom.js
 *
 * Teste de fumaça do PREENCHIMENTO num DOM de verdade.
 *
 * Por que ele existe: os bugs que mais doeram aqui (o `<select>` escondido que
 * nunca era achado, o rádio sem `name` virando uma pergunta por bolinha, a
 * pergunta saindo com o rótulo da opção "YES") só aparecem quando existe LAYOUT:
 * quem decide o que é "campo visível" é o `getClientRects`, e ele só responde de
 * verdade dentro de um browser. Os outros smokes rodam no Node puro e não veem
 * isso.
 *
 * Então aqui a página monta o formulário do Easy Apply como o LinkedIn entrega
 * (o `<select>` sem caixa atrás do UI do artdeco, rádio sem `name`, `role="radio"`)
 * e roda o `content.js` num Chromium de verdade (`chrome-headless-shell`),
 * conferindo o que entrou no formulário. O roteiro do que é conferido está em
 * `tests/dom-preenchimento.js` (roda DENTRO da página).
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');

let falhas = 0;
let total = 0;

function ok(nome, cond, detalhe) {
  total += 1;
  if (!cond) {
    falhas += 1;
    console.log('  FALHA ' + nome + (detalhe === undefined ? '' : '  -> ' + detalhe));
    return;
  }
  console.log('  ok    ' + nome);
}

function finalizar() {
  console.log(
    falhas
      ? '\n' + falhas + '/' + total + ' FALHARAM'
      : '\nTodos os ' + total + ' testes do preenchimento (DOM real) passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

/** O Chrome de teste: `PGV_CHROME`, ou o que o `baixar-chromium.sh` deixou. */
function acharChromium() {
  const candidatos = [
    process.env.PGV_CHROME,
    process.env.PGV_CHROMIUM_DIR &&
      path.join(
        process.env.PGV_CHROMIUM_DIR,
        'chrome-headless-shell-linux64',
        'chrome-headless-shell'
      ),
    path.join(
      os.homedir(),
      '.cache/pegavaga/chromium/chrome-headless-shell-linux64/chrome-headless-shell'
    ),
  ].filter(Boolean);

  return candidatos.find((caminho) => {
    try {
      fs.accessSync(caminho, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  });
}

const chromium = acharChromium();

if (!chromium) {
  console.log('  pulado  sem o chromium de teste (rode: sh tools/baixar-chromium.sh)');
  console.log('\nTodos os 0 testes do preenchimento (DOM real) passaram.');
  process.exit(0);
}
/* -------------------------------------------------------------------------- */
/* A página de teste: o formulário do LinkedIn + o chrome falso + o roteiro    */
/* -------------------------------------------------------------------------- */

const pagina = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-dom-')), 'pagina.html');

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>PegaVaga - teste de DOM</title></head>
<body>
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

<pre id="pgv-saida"></pre>
<pre id="pgv-logs"></pre>

<script>
  // Chrome falso: o content.js fala com o storage e com o worker, e aqui não há
  // rede nem aba de verdade — os testes só querem o formulário.
  var dados = {};
  var ouvintes = [];

  window.chrome = {
    storage: {
      local: {
        get: function (chaves, cb) {
          var saida = {};
          (Array.isArray(chaves) ? chaves : Object.keys(chaves || {})).forEach(function (k) {
            if (k in dados) saida[k] = dados[k];
          });
          if (typeof cb === 'function') setTimeout(function () { cb(saida); }, 0);
          return Promise.resolve(saida);
        },
        set: function (obj, cb) {
          Object.keys(obj || {}).forEach(function (k) { dados[k] = obj[k]; });
          if (typeof cb === 'function') setTimeout(function () { cb(); }, 0);
          return Promise.resolve();
        },
        remove: function (chaves, cb) {
          (Array.isArray(chaves) ? chaves : [chaves]).forEach(function (k) { delete dados[k]; });
          if (typeof cb === 'function') setTimeout(function () { cb(); }, 0);
          return Promise.resolve();
        }
      }
    },
    runtime: {
      lastError: undefined,
      sendMessage: function (msg, cb) {
        if (typeof cb === 'function') setTimeout(function () { cb({}); }, 0);
        return Promise.resolve({});
      },
      onMessage: { addListener: function (fn) { ouvintes.push(fn); } }
    }
  };

  // O gancho de teste do content.js (ver o fim do arquivo): só existe se esta
  // variável estiver definida ANTES de o script carregar.
  window.__pgvTeste = true;

  // O artdeco (React) marca o rádio CUSTOM no clique: a página faz o mesmo, que é
  // o comportamento que o content.js encontra no LinkedIn.
  document.addEventListener('click', function (ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('[role="radio"]') : null;
    if (!alvo) return;

    var grupo = alvo.closest('[role="radiogroup"]') || alvo.parentElement;
    Array.prototype.forEach.call(grupo.querySelectorAll('[role="radio"]'), function (opcao) {
      opcao.setAttribute('aria-checked', opcao === alvo ? 'true' : 'false');
    });
  });

  // E o combobox custom: clicar no gatilho ABRE a lista, clicar na opção fecha e
  // mostra a escolha no gatilho (é o que o artdeco faz).
  document.addEventListener('click', function (ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('[role="combobox"], [role="option"]') : null;
    if (!alvo) return;

    if (alvo.getAttribute('role') === 'combobox') {
      var bloco = alvo.closest('.fb-dash-form-element');
      var lista = bloco && bloco.querySelector('[role="listbox"]');
      if (lista) {
        lista.removeAttribute('hidden');
        alvo.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    var listaFechar = alvo.closest('[role="listbox"]');
    var blocoCombo = alvo.closest('.fb-dash-form-element');
    var gatilho = blocoCombo && blocoCombo.querySelector('[role="combobox"]');

    if (gatilho) {
      var texto = gatilho.querySelector('span') || gatilho;
      texto.textContent = alvo.textContent;
      gatilho.setAttribute('aria-expanded', 'false');
    }
    if (listaFechar) listaFechar.setAttribute('hidden', '');
  });

  var saida = document.getElementById('pgv-saida');
  var logs = document.getElementById('pgv-logs');

  // O que o content.js escreve no console também entra no teste: é ele que diz
  // POR QUE um campo não foi preenchido ("nao achei o campo da pergunta…").
  ['log', 'warn', 'error'].forEach(function (nivel) {
    var original = console[nivel];
    console[nivel] = function () {
      var texto = Array.prototype.slice
        .call(arguments)
        .map(function (a) {
          if (typeof a === 'string') return a;
          if (a && a.name) return a.name + ': ' + a.message;
          return Object.prototype.toString.call(a);
        })
        .join(' ');
      logs.textContent += nivel + ': ' + texto + '\\n';
      if (original) original.apply(console, arguments);
    };
  });

  function ok(nome, cond, detalhe) {
    saida.textContent += (cond ? 'OK ' : 'FALHA ') + nome + (cond || !detalhe ? '' : ' -> ' + detalhe) + '\\n';
  }
</script>

<script src="file://__RAIZ__/shared.js"></script>
<script src="file://__RAIZ__/ajuda-campos.js"></script>
<script src="file://__RAIZ__/content.js"></script>
<script src="file://__RAIZ__/tests/dom-preenchimento.js"></script>
</body></html>`;

fs.writeFileSync(pagina, html.split('__RAIZ__').join(raiz));

/* -------------------------------------------------------------------------- */
/* Roda o browser e lê o que a página respondeu                                */
/* -------------------------------------------------------------------------- */

let dom = '';

try {
  dom = execFileSync(
    chromium,
    [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--virtual-time-budget=30000',
      '--dump-dom',
      'file://' + pagina,
    ],
    { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
} catch (error) {
  console.log('  FALHA o chromium de teste nao rodou  -> ' + ((error && error.message) || error));
  finalizar();
}

const trecho = /<pre id="pgv-saida">([\s\S]*?)<\/pre>/.exec(dom);

if (!trecho) {
  console.log('  FALHA a pagina nao devolveu a saida do teste');
  finalizar();
}

const linhas = trecho[1]
  .split('\n')
  .map((linha) => linha.trim())
  .filter(Boolean);

for (const linha of linhas) {
  const achado = /^(OK|FALHA)\s+(.+)$/.exec(linha);
  if (!achado) continue;

  if (achado[1] === 'OK') {
    ok(achado[2], true);
    continue;
  }

  const partes = achado[2].split(' -> ');
  ok(partes[0], false, partes[1]);
}

if (!linhas.some((linha) => linha.indexOf('FIM') === 0)) {
  console.log('  FALHA o roteiro da pagina nao terminou (travou ou deu erro no meio)');
}

/* Com alguma falha, o que o content.js escreveu no console vai junto: é ele que
 * diz POR QUE o campo não foi preenchido. Assim o teste se explica sozinho. */
if (falhas) {
  const comLogs = /<pre id="pgv-logs">([\s\S]*?)<\/pre>/.exec(dom);

  if (comLogs) {
    const doPegaVaga = comLogs[1]
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha.indexOf('[PegaVaga]') >= 0);

    if (doPegaVaga.length) {
      console.log('\n  -- o que o content.js disse (console) --');
      for (const linha of doPegaVaga) console.log('  ' + linha);
    }
  }
}

finalizar();

