/* =============================================================================
 * PegaVaga - tests/smoke-conta.js
 *
 * Teste de fumaca da conta e do painel do administrador. Roda no Node puro, sem
 * npm install: um DOM falso (um elemento por id do popup.html), um
 * chrome.storage.local em memoria e um "servidor" de mentira no fetch fazem o
 * popup.js rodar de verdade. Assim a tela que o usuario veria e conferida de
 * fato — e nao por leitura de codigo.
 *
 * O que este teste protege:
 *   1. sem conta, NINGUEM faz rede (o free e 100% local);
 *   2. o painel do administrador so aparece quando o SERVIDOR concede
 *      (`features.painelAdmin` na resposta);
 *   3. sessao recusada (401) volta ao free e descarta a credencial;
 *   4. rede fora NAO derruba quem tem assinatura (vale o cache do /plano);
 *   5. a tela da conta segue o caminho do usuario: avatar → menu ou tela de
 *      entrar → criar conta (senha duas vezes) — sem atalho e sem rede antes da
 *      hora.
 *
 *   node tests/smoke-conta.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'popup.html'), 'utf8');

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

/* -------------------------------------------------------------------------- */
/* DOM falso                                                                   */
/* -------------------------------------------------------------------------- */

class Elemento {
  constructor(tag) {
    this.id = tag;
    this.hidden = false;
    this.open = false;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = {};
  }

  addEventListener(tipo, fn) {
    (this.listeners[tipo] = this.listeners[tipo] || []).push(fn);
  }

  appendChild(filho) {
    this.children.push(filho);
    return filho;
  }

  setAttribute(nome, valor) {
    this[nome] = valor;
  }

  remove() {}

  focus() {}

  /** Dispara um evento como o navegador faria (click, change…). */
  disparar(tipo) {
    (this.listeners[tipo] || []).forEach((fn) => fn({ target: this, type: tipo }));
  }

  /** O primeiro filho "de verdade" (um elemento, e não um nó de texto). */
  botao() {
    return (this.children || []).find((filho) => typeof filho.disparar === 'function');
  }

  /** Todo o texto do elemento, incluindo os filhos (como textContent no DOM). */
  texto() {
    return (
      (this.textContent || '') +
      ' ' +
      (this.children || []).map((filho) => filho.textContent || '').join(' ')
    ).trim();
  }
}

const elementosPorId = new Map();
const idsDesconhecidos = [];
const idsNoHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const documentListeners = {};

/* Os elementos que já nascem escondidos no popup.html (atributo `hidden`) — sem
 * isso o fake começaria com tudo visível e o teste veria uma tela que o usuário
 * nunca vê. */
const idsEscondidos = new Set();
for (const tag of [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0])) {
  const id = /id="([^"]+)"/.exec(tag);
  if (id && /\shidden[\s>=]/.test(tag)) idsEscondidos.add(id[1]);
}

const documentFalso = {
  getElementById(id) {
    if (!idsNoHtml.has(id)) idsDesconhecidos.push(id);
    if (!elementosPorId.has(id)) {
      const novo = new Elemento(id);
      novo.hidden = idsEscondidos.has(id);
      elementosPorId.set(id, novo);
    }
    return elementosPorId.get(id);
  },
  createElement(tag) {
    return new Elemento(tag);
  },
  createTextNode(texto) {
    return { nodeType: 3, textContent: texto };
  },
  addEventListener(tipo, fn) {
    (documentListeners[tipo] = documentListeners[tipo] || []).push(fn);
  },
  body: new Elemento('body'),
};

/** Atalho: o elemento daquele id (cria sob demanda, como o fake faz). */
const el = (id) => documentFalso.getElementById(id);

/* -------------------------------------------------------------------------- */
/* chrome.storage.local em memoria                                             */
/* -------------------------------------------------------------------------- */

const armazem = new Map();
const storageListeners = [];

const chromeFalso = {
  storage: {
    local: {
      async get(keys) {
        const lista = Array.isArray(keys) ? keys : [keys];
        const saida = {};
        lista.forEach((chave) => {
          if (armazem.has(chave)) saida[chave] = armazem.get(chave);
        });
        return saida;
      },
      async set(objeto) {
        Object.entries(objeto).forEach(([chave, valor]) => armazem.set(chave, valor));
      },
      async remove(keys) {
        (Array.isArray(keys) ? keys : [keys]).forEach((chave) => armazem.delete(chave));
      },
    },
    onChanged: {
      addListener(fn) {
        storageListeners.push(fn);
      },
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.3.0.0' }),
    onMessage: { addListener() {} },
    lastError: null,
  },
  tabs: {
    async query() {
      return []; // sem aba ativa: o PING da varredura nem chega a acontecer
    },
    sendMessage(tabId, mensagem, callback) {
      if (callback) callback(undefined);
    },
    create() {},
    update() {},
  },
};

/* -------------------------------------------------------------------------- */
/* Servidor de mentira (fetch)                                                 */
/* -------------------------------------------------------------------------- */
//
// Cada rota responde o que o backend real responderia — inclusive o formato de
// erro (`{ erro, mensagem }`) e o `Authorization`. `chamadas` guarda o que o
// pop-up pediu, para o teste conferir que o free anônimo não chama nada.

const API = 'http://127.0.0.1:8787';
const chamadas = [];
const respostas = new Map();

let redeFora = false;

/** Registra a resposta de uma rota.
 *
 * `corpo` pode ser um objeto OU uma função do pedido (`({ corpo })`) — o servidor
 * de verdade decide pelo pedido (o login, por exemplo, olha o e-mail), e o teste
 * precisa poder imitar isso.
 */
function responder(rota, corpo, status) {
  respostas.set(rota, { corpo: corpo, status: status || 200 });
}

function semResposta(rota) {
  respostas.delete(rota);
}

function limparChamadas() {
  chamadas.length = 0;
}

function chamou(metodo, rota) {
  return chamadas.some((chamada) => chamada.metodo === metodo && chamada.caminho === rota);
}

function ultima() {
  return chamadas[chamadas.length - 1] || {};
}

/** O último pedido daquela rota — depois dele pode vir outro (a lista, por ex.). */
function pedido(metodo, rota) {
  const achados = chamadas.filter(
    (chamada) => chamada.metodo === metodo && chamada.caminho === rota
  );
  return achados[achados.length - 1] || {};
}

globalThis.fetch = async (url, opcoes) => {
  const caminho = String(url).replace(API, '');
  const cabecalhos = (opcoes && opcoes.headers) || {};
  const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : null;

  chamadas.push({
    caminho: caminho,
    metodo: (opcoes && opcoes.method) || 'GET',
    corpo: corpo,
    autorizacao: cabecalhos.Authorization || '',
  });

  if (redeFora) throw new Error('sem rede');

  const config = respostas.get(caminho);
  if (!config) {
    return { ok: false, status: 404, json: async () => ({ erro: 'rota_nao_encontrada' }) };
  }

  const dados =
    typeof config.corpo === 'function'
      ? config.corpo({ caminho: caminho, corpo: corpo, metodo: (opcoes && opcoes.method) || 'GET' })
      : config.corpo;

  return {
    ok: config.status < 400,
    status: config.status,
    json: async () => dados,
  };
};

/* -------------------------------------------------------------------------- */
/* Perfis como o servidor devolve                                              */
/* -------------------------------------------------------------------------- */

const FEATURES_PREMIUM = {
  autoApply: true,
  formFill: true,
  scheduler: true,
  export: true,
  furtividadeConfig: true,
  cotasAvancadas: true,
  scanConfig: true,
  painelAdmin: false,
};

const FEATURES_FREE = {
  autoApply: true,
  formFill: true,
  scheduler: false,
  export: false,
  furtividadeConfig: false,
  cotasAvancadas: false,
  scanConfig: false,
  painelAdmin: false,
};

const LIMITES_PREMIUM = {
  maxTermos: 40,
  cotasEditaveis: ['term', 'hour', 'day24', 'day'],
  perTermFixo: 0,
  perHourFixo: 0,
  tetoDiarioFixo: 0,
  scanPerTermFixo: 0,
  per24h: 25,
};

const LIMITES_FREE = {
  maxTermos: 2,
  cotasEditaveis: [],
  perTermFixo: 4,
  perHourFixo: 3,
  tetoDiarioFixo: 9,
  scanPerTermFixo: 40,
  per24h: null,
};

function respostaPremium(email) {
  return {
    plano: 'premium',
    rotulo: 'Premium',
    estado: 'active',
    expiresAt: '2027-01-15T08:00:00Z',
    features: Object.assign({}, FEATURES_PREMIUM),
    limites: Object.assign({}, LIMITES_PREMIUM),
    conta: { email: email, papel: 'usuario' },
    token: 'token-de-mentira',
  };
}

function respostaAdmin(email) {
  return {
    plano: 'free',
    rotulo: 'Free',
    estado: 'sem_assinatura',
    expiresAt: null,
    features: Object.assign({}, FEATURES_FREE, { painelAdmin: true }),
    limites: Object.assign({}, LIMITES_FREE),
    conta: { email: email, papel: 'admin' },
    token: 'token-de-admin',
  };
}

/* -------------------------------------------------------------------------- */
/* Carrega os scripts como o navegador faria (edicoes -> shared -> popup)      */
/* -------------------------------------------------------------------------- */

globalThis.window = globalThis;
globalThis.document = documentFalso;
globalThis.chrome = chromeFalso;

for (const arquivo of ['edicoes.js', 'shared.js', 'popup.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), { filename: arquivo });
}

const S = globalThis.PegaVagaShared;
const E = globalThis.PegaVagaEdicoes;

/** Deixa as promessas do pop-up (init e as ações) terminarem. */
async function respirar(voltas) {
  const n = voltas || 10;
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Abre o pop-up do zero, como o DOMContentLoaded faria. */
async function abrirPopup() {
  (documentListeners.DOMContentLoaded || []).forEach((fn) => fn());
  await respirar(25);
}

/**
 * Faz o caminho do usuário: o avatar abre a tela de conta, a aba escolhe entre
 * entrar e criar conta, e o botão confirma. É o mesmo trajeto de quem usa o
 * pop-up — nada é preenchido por baixo dos panos.
 */
async function entrarComo(email, senha, criar) {
  // A tela de conta só é clicada se estiver fechada — é o que o usuário faria.
  if (el('conta').hidden === true) {
    el('btn-conta').disparar('click');
    await respirar(5);
  }

  if (criar) {
    el('conta-aba-criar').disparar('click');
    await respirar(5);
  }

  el('conta-email').value = email;
  el('conta-senha').value = senha;
  if (criar) el('conta-senha2').value = senha;

  el(criar ? 'btn-cadastrar' : 'btn-entrar').disparar('click');
  await respirar(25);
}

/** Dispara o onChanged do storage, como outro contexto faria. */
async function mudarPorFora(chaves) {
  const changes = {};
  Object.keys(chaves).forEach((chave) => {
    changes[chave] = { newValue: chaves[chave] };
    armazem.set(chave, chaves[chave]);
  });
  storageListeners.forEach((fn) => fn(changes, 'local'));
  await respirar(25);
}

/** O texto de cada <li> da lista de licenças (o fake não tem textContent real). */
function itensDaLicenca() {
  return (el('adm-lista').children || []).map((item) => item.texto());
}

/* -------------------------------------------------------------------------- */
/* Roteiro                                                                     */
/* -------------------------------------------------------------------------- */

async function principal() {
  ok('edicoes.js e shared.js carregaram', Boolean(S && E));
  ok(
    'todo id buscado pelo popup.js existe no popup.html',
    idsDesconhecidos.length === 0,
    idsDesconhecidos.join(', ')
  );

  // O "servidor": o login decide pelo e-mail (admin ou cliente), como o real.
  responder('/conta/login', ({ corpo: pedido }) =>
    String((pedido && pedido.email) || '').indexOf('admin') === 0
      ? respostaAdmin(pedido.email)
      : respostaPremium((pedido && pedido.email) || 'cliente@exemplo.com')
  );
  responder('/conta/cadastro', ({ corpo: pedido }) =>
    respostaPremium((pedido && pedido.email) || 'novo@exemplo.com')
  );
  responder('/plano', respostaPremium('cliente@exemplo.com'));

  // Uma vaga capturada: sem ela o botão de exportar fica desabilitado por não ter
  // o que exportar, e o teste não conseguiria ver a diferença entre as edições.
  armazem.set('pegavaga_jobs', {
    '1': { id: '1', title: 'Vaga de teste', company: 'Acme', link: 'https://exemplo/1' },
  });

  await abrirPopup();

  console.log('== SEM CONTA: NADA DE REDE ==');
  ok(
    'nenhuma chamada a API na abertura',
    chamadas.length === 0,
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok('perfil ativo = free', E.chaveAtiva() === 'free', E.chaveAtiva());
  ok('formulario de conta visivel', el('conta-form').hidden === false);
  ok('bloco "logado" escondido', el('conta-logado').hidden === true);
  ok('painel do administrador escondido', el('admin-panel').hidden === true);
  ok(
    'selo mostra a edicao Free',
    el('build-info').textContent.includes('edição Free'),
    el('build-info').textContent
  );
  ok('free: export desabilitado', el('btn-export').disabled === true);
  ok('free: campo "por termo" escondido', el('field-apply-per-term').hidden === true);
  ok(
    'conta-estado diz que esta no Free',
    el('conta-estado').textContent.includes('Free'),
    el('conta-estado').textContent
  );
  ok('a tela de conta comeca fechada', el('conta').hidden === true);
  ok('sem conta: avatar sem iniciais', el('avatar-letras').textContent === '');
  ok('sem conta: avatar mostra o icone de pessoa', el('avatar-ico').hidden === false);
  ok('sem conta: menu do avatar fechado', el('conta-menu').hidden === true);

  console.log('== SEM CONTA: O AVATAR LEVA A TELA DE ENTRAR ==');
  el('btn-conta').disparar('click');
  await respirar(10);

  ok('a tela de conta abriu', el('conta').hidden === false);
  ok(
    'abriu no modo Entrar',
    el('btn-entrar').hidden === false && el('btn-cadastrar').hidden === true
  );
  ok('entrar nao pede confirmacao de senha', el('conta-confirma').hidden === true);
  ok('o titulo convida a entrar', el('conta-titulo').textContent === 'Entrar', el('conta-titulo').textContent);
  ok(
    'abrir a tela de conta nao chama a rede',
    chamadas.length === 0,
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );

  el('btn-conta').disparar('click');
  await respirar(5);
  ok('clicar de novo no avatar fecha a tela', el('conta').hidden === true);

  el('btn-conta').disparar('click');
  await respirar(5);
  ok('e clicar mais uma vez abre de novo', el('conta').hidden === false);

  console.log('== SEM CONTA: "CRIAR CONTA" PEDE A SENHA DUAS VEZES ==');
  el('conta-aba-criar').disparar('click');
  await respirar(5);

  ok('a aba Criar conta mostra a confirmacao', el('conta-confirma').hidden === false);
  ok(
    'e o botao de cadastro aparece',
    el('btn-cadastrar').hidden === false && el('btn-entrar').hidden === true
  );
  ok(
    'a aba escolhida fica marcada',
    el('conta-aba-criar')['aria-selected'] === 'true',
    String(el('conta-aba-criar')['aria-selected'])
  );

  el('conta-email').value = 'novo@exemplo.com';
  el('conta-senha').value = 'senha-boa-1';
  el('conta-senha2').value = 'outra-senha';
  el('btn-cadastrar').disparar('click');
  await respirar(10);

  ok(
    'senhas diferentes: nem chega a pedir a rede',
    chamadas.length === 0,
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok(
    'e o aviso explica o motivo',
    el('conta-aviso').textContent.includes('iguais'),
    el('conta-aviso').textContent
  );

  console.log('== LOGIN DE CLIENTE PREMIUM ==');
  limparChamadas();
  await entrarComo('cliente@exemplo.com', 'senha-boa-1');

  ok(
    'pediu /conta/login por POST',
    chamou('POST', '/conta/login'),
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok(
    'mandou e-mail e senha',
    Boolean(ultima().corpo) && ultima().corpo.email === 'cliente@exemplo.com',
    JSON.stringify(ultima().corpo)
  );
  ok(
    'a sessao foi para o storage',
    Boolean(armazem.get('pegavaga_sessao') && armazem.get('pegavaga_sessao').token)
  );
  ok(
    'o perfil foi para o cache',
    Boolean(armazem.get('pegavaga_perfil') && armazem.get('pegavaga_perfil').perfil)
  );
  ok('perfil ativo = servidor', E.chaveAtiva() === 'servidor', E.chaveAtiva());
  ok('temFeature(export) = true', S.temFeature('export') === true);
  ok(
    'selo virou Premium',
    el('build-info').textContent.includes('edição Premium'),
    el('build-info').textContent
  );
  ok(
    'selo marcado (nao e a edicao de producao)',
    el('build-info').className === 'build premium',
    el('build-info').className
  );
  ok('premium: export habilitado', el('btn-export').disabled === false);
  ok('premium: campo "por termo" visivel', el('field-apply-per-term').hidden === false);
  ok('bloco "logado" visivel', el('conta-logado').hidden === false);
  ok('formulario escondido depois de entrar', el('conta-form').hidden === true);
  ok(
    'quem esta logado aparece',
    el('conta-quem').textContent.includes('cliente@exemplo.com'),
    el('conta-quem').textContent
  );
  ok('a senha foi limpa do formulario', el('conta-senha').value === '');
  ok('a confirmacao de senha tambem foi limpa', el('conta-senha2').value === '');
  ok('cliente premium NAO ve o painel do admin', el('admin-panel').hidden === true);
  ok(
    'o avatar mostra as iniciais da conta',
    el('avatar-letras').textContent === 'CE',
    el('avatar-letras').textContent
  );
  ok('o avatar troca o icone pelas iniciais', el('avatar-ico').hidden === true);
  ok(
    'o avatar ganha o anel do premium',
    el('btn-conta').className.includes('pro'),
    el('btn-conta').className
  );

  console.log('== AVATAR COM SESSAO: O MENU DE OPCOES ==');
  el('btn-conta').disparar('click');
  await respirar(10);

  ok('logado: o avatar abre o menu', el('conta-menu').hidden === false);
  ok(
    'logado: o menu mostra o e-mail da conta',
    el('menu-nome').textContent === 'cliente@exemplo.com',
    el('menu-nome').textContent
  );
  ok(
    'logado: o menu diz o plano',
    el('menu-plano').textContent.includes('Premium'),
    el('menu-plano').textContent
  );
  ok('logado: o menu oferece Sair', el('btn-menu-sair').hidden === false);
  ok('logado: o menu nao oferece Entrar', el('btn-menu-entrar').hidden === true);
  ok('cliente premium nao tem a opcao de administrador', el('btn-menu-admin').hidden === true);

  console.log('== O MENU FECHA COM CLIQUE FORA ==');
  const cliquesNoDocumento = documentFalso.body.listeners.click || [];

  // Clicar no ícone de um item (o alvo é o SVG, não o botão) não fecha o menu.
  cliquesNoDocumento.forEach((fn) => fn({ target: el('btn-menu-conta') }));
  ok('clique em um item do menu nao fecha por fora', el('conta-menu').hidden === false);

  // Clicar no avatar também não: quem abre/fecha ali é o próprio botão.
  cliquesNoDocumento.forEach((fn) => fn({ target: el('avatar-letras') }));
  ok('clique no avatar nao fecha o menu por fora', el('conta-menu').hidden === false);

  // Clicar no resto da tela fecha.
  cliquesNoDocumento.forEach((fn) => fn({ target: el('status') }));
  ok('clique fora fecha o menu', el('conta-menu').hidden === true);

  el('btn-conta').disparar('click');
  await respirar(5);
  ok('o menu reabre no avatar', el('conta-menu').hidden === false);

  limparChamadas();
  el('btn-menu-sair').disparar('click');
  await respirar(25);

  ok('sair pelo menu fecha o menu', el('conta-menu').hidden === true);
  ok(
    'sair pelo menu volta a tela de entrar',
    el('conta').hidden === false && el('conta-logado').hidden === true
  );
  ok(
    'sair pelo menu nao chama a rede',
    chamadas.length === 0,
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );

  console.log('== LOGIN DE ADMINISTRADOR (o painel vem do servidor) ==');
  responder('/admin/licencas', {
    licencas: [
      {
        chave: 'PGV-CLIENTE-0001',
        plano: 'premium',
        estado: 'active',
        expiresAt: '2027-01-02T00:00:00Z',
        email: 'cliente@exemplo.com',
        dispositivos: ['nav-1'],
      },
    ],
  });

  limparChamadas();
  await entrarComo('admin@exemplo.com', 'senha-de-admin');

  ok('admin entrou', el('conta-logado').hidden === false);
  ok('admin: painel do administrador aparece', el('admin-panel').hidden === false);
  ok(
    'admin: o pop-up avisa o papel',
    el('conta-quem').textContent.includes('administrador'),
    el('conta-quem').textContent
  );
  ok(
    'admin: o avatar fica dourado',
    el('btn-conta').className.includes('admin'),
    el('btn-conta').className
  );
  ok('admin: o menu oferece o painel de administracao', el('btn-menu-admin').hidden === false);

  // O caminho do usuário: avatar → "Painel de administração".
  limparChamadas();
  el('btn-conta').disparar('click');
  await respirar(5);
  ok('admin: o avatar com sessao abre o menu', el('conta-menu').hidden === false);

  el('btn-menu-admin').disparar('click');
  await respirar(25);

  ok('o menu abre o painel do administrador', el('admin-panel').open === true);
  ok(
    'e o painel recarrega a lista do servidor',
    chamou('GET', '/admin/licencas'),
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok(
    'admin: a lista foi pedida ao servidor',
    chamou('GET', '/admin/licencas'),
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok(
    'admin: o token foi no cabecalho',
    chamadas.some((chamada) => chamada.autorizacao === 'Bearer token-de-admin'),
    JSON.stringify(chamadas.map((chamada) => chamada.autorizacao))
  );
  ok(
    'admin: a lista mostra a licenca',
    itensDaLicenca().join(' | ').includes('PGV-CLIENTE-0001'),
    itensDaLicenca().join(' | ')
  );

  console.log('== EMITIR LICENCA ==');
  responder('/admin/licenca', {
    chave: 'PGV-NOVA-0001',
    plano: 'premium',
    estado: 'active',
    expiresAt: '2027-02-01T00:00:00Z',
    email: 'novo@exemplo.com',
    dispositivos: [],
  });

  limparChamadas();
  el('adm-chave').value = 'PGV-NOVA-0001';
  el('adm-email').value = 'novo@exemplo.com';
  el('adm-dias').value = '30';
  el('btn-emitir').disparar('click');
  await respirar(25);

  ok('pediu /admin/licenca por POST', chamou('POST', '/admin/licenca'));
  ok(
    'mandou a acao e a chave',
    Boolean(pedido('POST', '/admin/licenca').corpo) &&
      pedido('POST', '/admin/licenca').corpo.acao === 'emitir' &&
      pedido('POST', '/admin/licenca').corpo.chave === 'PGV-NOVA-0001',
    JSON.stringify(pedido('POST', '/admin/licenca').corpo)
  );
  ok('o campo da chave foi limpo', el('adm-chave').value === '');
  ok(
    'o status conta o que foi emitido',
    el('adm-status').textContent.includes('PGV-NOVA-0001'),
    el('adm-status').textContent
  );

  console.log('== REVOGAR (direto na lista) ==');
  limparChamadas();
  el('adm-lista').children[0].botao().disparar('click');
  await respirar(25);

  ok(
    'pediu revogar com a chave certa',
    Boolean(pedido('POST', '/admin/licenca').corpo) &&
      pedido('POST', '/admin/licenca').corpo.acao === 'revogar' &&
      pedido('POST', '/admin/licenca').corpo.chave === 'PGV-CLIENTE-0001',
    JSON.stringify(pedido('POST', '/admin/licenca').corpo)
  );
  ok(
    'o status confirma a revogacao',
    el('adm-status').textContent.includes('revogada'),
    el('adm-status').textContent
  );

  console.log('== "VER A TELA COMO" (simulacao vinda do servidor) ==');
  responder('/plano?simular=free', {
    plano: 'free',
    rotulo: 'Free',
    estado: 'simulado',
    simulado: true,
    expiresAt: null,
    features: Object.assign({}, FEATURES_FREE),
    limites: Object.assign({}, LIMITES_FREE),
  });

  limparChamadas();
  el('btn-simular-free').disparar('click');
  await respirar(25);

  ok(
    'pediu a simulacao ao servidor',
    chamou('GET', '/plano?simular=free'),
    JSON.stringify(chamadas.map((chamada) => chamada.caminho))
  );
  ok(
    'a tela ficou Free',
    el('build-info').textContent.includes('edição Free'),
    el('build-info').textContent
  );
  ok(
    'a simulacao NAO sobrescreveu o cache',
    armazem.get('pegavaga_perfil').perfil.features.painelAdmin === true,
    JSON.stringify(armazem.get('pegavaga_perfil').perfil.features)
  );

  console.log('== O PLANO DE VERDADE VOLTA ==');
  responder('/plano', respostaAdmin('admin@exemplo.com'));
  await globalThis.sincronizarPerfil();
  await respirar(25);

  ok('o painel do admin continua ali', el('admin-panel').hidden === false);
  ok(
    'e o selo volta ao perfil real (admin nao tem assinatura)',
    el('build-info').textContent.includes('edição Free'),
    el('build-info').textContent
  );

  console.log('== SESSAO RECUSADA (401) VOLTA AO FREE ==');
  responder('/plano', { erro: 'token_expirado', mensagem: 'Sessão expirada.' }, 401);
  await globalThis.sincronizarPerfil();
  await respirar(25);

  ok('a credencial foi descartada', armazem.has('pegavaga_sessao') === false);
  ok('o cache foi descartado', armazem.has('pegavaga_perfil') === false);
  ok('o painel do administrador sumiu', el('admin-panel').hidden === true);
  ok('o formulario de conta voltou', el('conta-form').hidden === false);
  ok('ninguem exporta mais', S.temFeature('export') === false);

  console.log('== REDE FORA NAO DERRUBA QUEM TEM ASSINATURA ==');
  responder('/plano', respostaPremium('cliente@exemplo.com'));
  await entrarComo('cliente@exemplo.com', 'senha-boa-1');
  ok('cliente premium entrou de novo', S.temFeature('export') === true);

  redeFora = true;
  const rotuloAntes = E.atual().rotulo;
  const semRede = await globalThis.sincronizarPerfil();
  await respirar(25);
  redeFora = false;

  ok(
    'a sincronizacao falhou por rede',
    semRede.ok === false && semRede.erro === 'rede',
    String(semRede.erro)
  );
  ok('o premium continua valendo (cache local)', S.temFeature('export') === true);
  ok('o rotulo nao mudou', E.atual().rotulo === rotuloAntes, E.atual().rotulo);

  console.log('== SAIR DA CONTA ==');
  limparChamadas();
  el('btn-sair').disparar('click');
  await respirar(25);

  ok(
    'saiu: sessao e cache fora do storage',
    armazem.has('pegavaga_sessao') === false && armazem.has('pegavaga_perfil') === false
  );
  ok('saiu: ninguem exporta', S.temFeature('export') === false);
  ok(
    'saiu: selo voltou para Free',
    el('build-info').textContent.includes('edição Free'),
    el('build-info').textContent
  );
  ok('saiu: formulario de conta de volta', el('conta-form').hidden === false);
  ok('sair nao chama a rede', chamadas.length === 0, JSON.stringify(chamadas.map((c) => c.caminho)));

  console.log('== CRIAR CONTA ==');
  limparChamadas();
  await entrarComo('novo@exemplo.com', 'senha-boa-1', true);

  ok('pediu /conta/cadastro por POST', chamou('POST', '/conta/cadastro'));
  ok('o cadastro ja entra com o perfil que o servidor mandou', S.temFeature('export') === true);

  console.log('== ENTER NO CAMPO DE SENHA ==');
  await S.sair();
  await respirar(10);

  limparChamadas();
  el('conta-email').value = 'cliente@exemplo.com';
  el('conta-senha').value = 'senha-boa-1';
  el('conta-senha').disparar('keydown');
  await respirar(25);

  ok('outra tecla nao entra', chamadas.length === 0, JSON.stringify(chamadas.map((c) => c.caminho)));

  el('conta-senha').listeners.keydown.forEach((fn) => fn({ key: 'Enter' }));
  await respirar(25);

  ok(
    'enter na senha entra',
    chamou('POST', '/conta/login'),
    JSON.stringify(chamadas.map((c) => c.caminho))
  );

  console.log('== OUTRO CONTEXTO GRAVA O PERFIL ==');
  await mudarPorFora({
    [S.STORAGE.perfil]: { perfil: respostaPremium('outro@exemplo.com'), salvoEm: Date.now() },
  });

  ok('o pop-up segue a mudanca de fora', S.temFeature('export') === true);
  ok(
    'e o selo acompanha',
    el('build-info').textContent.includes('edição Premium'),
    el('build-info').textContent
  );

  await mudarPorFora({
    [S.STORAGE.perfil]: { perfil: respostaAdmin('admin@exemplo.com'), salvoEm: Date.now() },
  });

  ok('perfil de admin gravado por fora mostra o painel', el('admin-panel').hidden === false);

  await mudarPorFora({
    [S.STORAGE.perfil]: { perfil: respostaPremium('velho@exemplo.com'), salvoEm: Date.now() - 7 * 3600000 },
  });

  ok('cache velho (7 h) cai no free', S.temFeature('export') === false);
  ok('e o painel do admin fica escondido', el('admin-panel').hidden === true);

  console.log(
    falhas
      ? '\n' + falhas + '/' + total + ' FALHARAM'
      : '\nTodos os ' + total + ' testes da conta passaram.'
  );
  process.exit(falhas ? 1 : 0);
}

principal().catch((erro) => {
  console.log('FALHA INESPERADA: ' + (erro && erro.stack ? erro.stack : erro));
  process.exit(1);
});


