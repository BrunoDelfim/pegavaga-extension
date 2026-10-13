/* =============================================================================
 * PegaVaga - tests/dom-cromo.js
 *
 * O harness dos testes de DOM: acha o Chromium de teste, monta a PÁGINA (o
 * formulário do LinkedIn + um `chrome` falso + o roteiro em `scripts`) e roda tudo
 * num browser de verdade, lendo de volta as linhas `OK`/`FALHA` que a página
 * escreveu. É o que `tests/smoke-dom.js` (preenchimento) e
 * `tests/smoke-dom-fluxo.js` (fluxo da candidatura) usam.
 *
 * Por que um browser DE VERDADE: quem decide o que é "campo visível" é o
 * `getClientRects`, e ele só responde com layout — no Node puro todo campo
 * pareceria escondido. É essa a classe de bug que assombra este repositório (o
 * `<select>` sem caixa que ninguém achava, o rádio sem `name`).
 *
 * O browser vem de `tools/baixar-chromium.sh` (uma vez, ~120 MB, sem root, sem
 * npm). Sem ele, `acharChromium()` devolve null e quem chamou se pula sozinho.
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');

let falhas = 0;
let total = 0;
let pagina = ''; // nasce no /tmp (dentro de jobs/, ver abaixo) e é apagada no fim
let consultaPagina = ''; // query da página (o `dados=` da janelinha)
const temporarias = []; // cada página montada (o teste de fixtures monta várias)

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

function ok(nome, cond, detalhe) {
  total += 1;
  if (!cond) {
    falhas += 1;
    console.log('  FALHA ' + nome + (detalhe === undefined ? '' : '  -> ' + detalhe));
    return;
  }
  console.log('  ok    ' + nome);
}

/** Diz que o teste se pulou (sem browser) e encerra verde. */
function pular() {
  console.log('  pulado  sem o chromium de teste (rode: sh tools/baixar-chromium.sh)');
  console.log('\nTodos os 0 testes passaram (pulado).');
  process.exit(0);
}

function finalizar(resumo) {
  if (process.env.PGV_DOM_KEEP) {
    console.log('\n  (pagina mantida para inspecao: ' + pagina + ')');
  } else {
    for (const dir of temporarias) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        /* o /tmp se limpa sozinho */
      }
    }
  }

  console.log(falhas ? '\n' + falhas + '/' + total + ' FALHARAM' : '\n' + resumo.replace('%d', total));
  process.exit(falhas ? 1 : 0);
}


/** O `chrome` falso que todo teste precisa (storage, worker e os ouvintes). */
const CHROME_FALSO = `
  var dados = window.__pgvDados || {};
  var ouvintes = [];

  /* A janela da extensão (uma só): o estado e o histórico de atualizações. É o que
   * permite conferir, no teste, onde a janelinha se posicionou e de que tamanho
   * ficou. O outerHeight/innerHeight da PÁGINA passam a seguir essa janela (com
   * a moldura de 24px): é assim que o teste enxerga o redimensionamento de verdade —
   * no headless a página não muda de tamanho sozinha. */
  window.__pgvJanela = {
    janela: { id: 1, left: 0, top: 0, width: 372, height: 470 },
    moldura: 24,
    atualizacoes: [],
  };

  Object.defineProperty(window, 'outerHeight', {
    configurable: true,
    get: function () {
      return window.__pgvJanela.janela.height;
    },
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    get: function () {
      return Math.max(0, window.__pgvJanela.janela.height - window.__pgvJanela.moldura);
    },
  });

  /* Numa página da extensão que vive numa JANELA (a janelinha), a altura da PÁGINA
   * segue a janela — é o que o Chrome faz de verdade. Sem isto, o CSS do cartão
   * (que preenche a página) mediria a tela inteira do headless e o teste veria
   * botões cortados que na vida real não acontecem. */
  function fixarAlturaDaPagina() {
    if (!window.__pgvJanelaDeVerdade || !document.documentElement || !document.body) return;

    var px = Math.max(0, window.__pgvJanela.janela.height - window.__pgvJanela.moldura);

    document.documentElement.style.height = px + 'px';
    document.body.style.height = px + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixarAlturaDaPagina);
  } else {
    fixarAlturaDaPagina();
  }

  window.chrome = {
    storage: {
      local: {
        get: function (chaves, cb) {
          var lista =
            chaves == null
              ? Object.keys(dados)
              : Array.isArray(chaves)
              ? chaves
              : typeof chaves === 'object'
              ? Object.keys(chaves)
              : [chaves];
          var saida = {};

          lista.forEach(function (k) {
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
        if (typeof window.__pgvWorker === 'function') {
          var resposta = window.__pgvWorker(msg, cb);
          return resposta || Promise.resolve({});
        }
        if (typeof cb === 'function') setTimeout(function () { cb({}); }, 0);
        return Promise.resolve({});
      },
      onMessage: { addListener: function (fn) { ouvintes.push(fn); } }
    },
    windows: {
      // A janelinha usa isto para se posicionar, arrastar e ajustar a ALTURA (o
      // cartão cresce com os campos). Sem a API aqui, o teste perderia o resto do
      // iniciar(). O window.__pgvJanela guarda o estado e o histórico: é assim
      // que o roteiro confere onde e de que tamanho a janela ficou.
      getCurrent: function (cb) {
        var janela = window.__pgvJanela.janela;
        if (typeof cb === 'function') setTimeout(function () { cb(janela); }, 0);
        return Promise.resolve(janela);
      },
      get: function (id, cb) {
        var janela = window.__pgvJanela.janela;
        if (typeof cb === 'function') setTimeout(function () { cb(janela); }, 0);
        return Promise.resolve(janela);
      },
      update: function (id, info, cb) {
        var janela = Object.assign({}, window.__pgvJanela.janela, info || {}, { id: id });
        window.__pgvJanela.janela = janela;
        window.__pgvJanela.atualizacoes.push(info || {});
        fixarAlturaDaPagina();
        if (typeof cb === 'function') setTimeout(function () { cb(janela); }, 0);
        return Promise.resolve(janela);
      }
    }
  };

  // O gancho de teste do content.js (ver o fim do arquivo): só existe se esta
  // variável estiver definida ANTES de o script carregar.
  window.__pgvTeste = true;

  /** Como o worker entrega uma mensagem PARA A ABA (é o caminho da resposta). */
  window.__pgvParaAba = function (mensagem) {
    ouvintes.forEach(function (fn) {
      try {
        fn(mensagem, {}, function () {});
      } catch (e) {
        /* ouvinte quebrado: segue */
      }
    });
  };

  var saida = document.getElementById('pgv-saida');
  var logs = document.getElementById('pgv-logs');

  // O que o content.js escreve no console também entra no teste: é ele que diz
  // POR QUE um campo não foi preenchido.
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
    saida.textContent +=
      (cond ? 'OK ' : 'FALHA ') + nome + (cond || !detalhe ? '' : ' -> ' + detalhe) + '\\n';
  }

  // Erros da página também entram no relatório: quando um script não roda (um
  // seletor quebrado, algo do chrome que não existe no teste), aparece aqui.
  window.addEventListener('error', function (ev) {
    var onde = (ev.filename || '').split('/').pop();
    logs.textContent += 'erro: ' + (ev.message || 'sem mensagem') + ' @ ' + onde + ':' + ev.lineno + '\\n';
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason || {};
    logs.textContent += 'rejeicao: ' + ((r && (r.name + ': ' + r.message)) || String(r)) + '\\n';
  });

  /** Texto de um nó, sem espaços sobrando (só para comparar no teste). */
  function cleanTexto(texto) {
    return String(texto || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  /** Espera uma condição virar verdadeira (dentro do prazo do teste). */
  function esperar(cond, ms) {
    return new Promise(function (resolve) {
      var fim = Date.now() + (ms || 20000);

      (function passo() {
        var pronto = false;
        try {
          pronto = cond();
        } catch (e) {
          pronto = false;
        }
        if (pronto) return resolve(true);
        if (Date.now() > fim) return resolve(false);
        setTimeout(passo, 100);
      })();
    });
  }

  /** O artdeco (é React) reagindo ao clique: rádio custom e combobox custom. */
  document.addEventListener('click', function (ev) {
    var alvo = ev.target || null;
    if (!alvo || !alvo.closest) return;

    var radio = alvo.closest('[role="radio"]');
    if (radio) {
      var grupo = radio.closest('[role="radiogroup"]') || radio.parentElement;
      Array.prototype.forEach.call(grupo.querySelectorAll('[role="radio"]'), function (opcao) {
        opcao.setAttribute('aria-checked', opcao === radio ? 'true' : 'false');
      });
      return;
    }

    var combo = alvo.closest('[role="combobox"]');
    if (combo) {
      var bloco = combo.closest('.fb-dash-form-element');
      var lista = bloco && bloco.querySelector('[role="listbox"]');
      if (lista) {
        lista.removeAttribute('hidden');
        combo.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    var opcaoDaLista = alvo.closest('[role="option"]');
    if (opcaoDaLista) {
      var listaFechar = opcaoDaLista.closest('[role="listbox"]');
      var blocoCombo = opcaoDaLista.closest('.fb-dash-form-element');
      var gatilho = blocoCombo && blocoCombo.querySelector('[role="combobox"]');

      if (gatilho) {
        (gatilho.querySelector('span') || gatilho).textContent = opcaoDaLista.textContent;
        gatilho.setAttribute('aria-expanded', 'false');
      }
      if (listaFechar) listaFechar.setAttribute('hidden', '');
    }
  });
`;

/**
 * Monta a página de teste e a deixa em disco.
 *
 * O arquivo fica em `<tmp>/jobs/search/pagina.html` DE PROPÓSITO: o content.js
 * aceita a página como "página de vagas" quando o caminho tem `/jobs` (ver
 * `isUsablePage`), e é assim que a fila é retomada em vez de descartada.
 *
 * Com `arquivoHtml`, a página é uma PÁGINA DE VERDADE da extensão (a janelinha
 * `ajuda.html`): os `src` relativos viram absolutos, o `chrome` falso e o roteiro
 * entram nela e o teste roda no HTML REAL — do mesmo jeito que as fixtures.
 */
function montarPagina(opcoes) {
  const raizTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-dom-'));
  const dir = path.join(raizTmp, 'jobs', 'search');

  temporarias.push(raizTmp);

  fs.mkdirSync(dir, { recursive: true });
  pagina = path.join(dir, 'pagina.html');
  consultaPagina = opcoes.query || '';

  const scripts = (opcoes.scripts || [])
    .map((arquivo) => `<script src="file://${raiz}/${arquivo}"></script>`)
    .join('\n');

  const dados = `<script>${
    opcoes.dados ? 'window.__pgvDados = ' + JSON.stringify(opcoes.dados) + ';' : ''
  }${opcoes.arquivoHtml ? 'window.__pgvJanelaDeVerdade = true;' : ''}</script>`;

  const html = opcoes.arquivoHtml
    ? fs
        .readFileSync(path.join(raiz, opcoes.arquivoHtml), 'utf8')
        .replace(/src="([^"/:]+\.js)"/g, 'src="file://' + raiz + '/$1"')
        .replace(
          /<script/,
          `<pre id="pgv-saida"></pre><pre id="pgv-logs"></pre>${dados}<script>${CHROME_FALSO}</script>\n<script`
        )
        .replace('</body>', scripts + '\n</body>')
    : `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>PegaVaga - ${opcoes.titulo || 'etapa'}</title></head>
<body>
${opcoes.corpo}
<pre id="pgv-saida"></pre>
<pre id="pgv-logs"></pre>
${dados}
<script>${CHROME_FALSO}</script>
${scripts}
</body></html>`;

  fs.writeFileSync(pagina, html);

  return pagina;
}

/** Roda o browser na página e devolve o DOM final (com o que a página escreveu). */
function rodar(orcamentoMs, consulta) {
  const chromium = acharChromium();
  if (!chromium) return null;

  const busca = consulta === undefined ? consultaPagina : consulta;

  return execFileSync(
    chromium,
    [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      // Tela fixa: a janelinha calcula o canto inferior direito pelo `screen`, e o
      // teste precisa do MESMO número que ela.
      '--window-size=1024,768',
      // Sem isto, cada `file://` é origem própria e o Chrome esconde o erro dos
      // scripts carregados (só "Script error."): com a permissão, o teste enxerga a
      // exceção de verdade.
      '--allow-file-access-from-files',
      '--virtual-time-budget=' + (orcamentoMs || 30000),
      '--dump-dom',
      'file://' + pagina + (busca ? '?' + busca : ''),
    ],
    { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
}

/** Lê as linhas `OK`/`FALHA` da página e as reporta no teste do Node. */
function reportar(dom) {
  const trecho = /<pre id="pgv-saida">([\s\S]*?)<\/pre>/.exec(dom);

  if (!trecho) {
    console.log('  FALHA a pagina nao devolveu a saida do teste');
    return;
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
}

/** Com alguma falha, mostra o que o content.js disse no console. */
function mostrarLogs(dom) {
  if (!falhas) return;

  const comLogs = /<pre id="pgv-logs">([\s\S]*?)<\/pre>/.exec(dom);
  if (!comLogs) return;

  const doPegaVaga = comLogs[1]
    .split('\n')
    .map((linha) => linha.trim())
    .filter(
      (linha) =>
        linha.indexOf('[PegaVaga]') >= 0 ||
        linha.indexOf('erro:') === 0 ||
        linha.indexOf('rejeicao:') === 0
    );

  if (!doPegaVaga.length) return;

  console.log('\n  -- o que a pagina disse (console) --');
  for (const linha of doPegaVaga) console.log('  ' + linha);
}

module.exports = {
  acharChromium: acharChromium,
  montarPagina: montarPagina,
  rodar: rodar,
  reportar: reportar,
  mostrarLogs: mostrarLogs,
  ok: ok,
  pular: pular,
  finalizar: finalizar,
};
