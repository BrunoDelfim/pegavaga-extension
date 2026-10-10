/* =============================================================================
 * PegaVaga - tests/smoke-edicoes.js
 *
 * Teste de fumaca do perfil de edicao. Roda no Node puro (nem o edicoes.js nem
 * o shared.js tocam no DOM), carregando os dois como o navegador faria e
 * conferindo os cortes do free contra o que o premium mantem.
 *
 *   node tests/smoke-edicoes.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
for (const arquivo of ['edicoes.js', 'shared.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), { filename: arquivo });
}

/* Este teste é sobre perfis, não sobre rede: um `fetch` que sempre falha deixa o
 * caminho da sessão determinístico (é o mesmo que acontece no navegador offline)
 * — e impede que o teste fale, sem querer, com a API que estiver rodando. */
globalThis.fetch = () => Promise.reject(new Error('sem rede no teste'));

const S = globalThis.PegaVagaShared;
const E = globalThis.PegaVagaEdicoes;

/* O perfil que o servidor concede para uma assinatura ativa — o mesmo formato do
 * `/plano`. É o ÚNICO caminho para ligar o premium aqui, igual ao navegador:
 * não existe mais `E.definir('premium')`. */
const PERFIL_SERVIDOR_PREMIUM = {
  rotulo: 'Premium',
  features: {
    autoApply: true,
    formFill: true,
    scheduler: true,
    export: true,
    furtividadeConfig: true,
    cotasAvancadas: true,
    scanConfig: true,
    painelAdmin: false,
  },
  limites: {
    maxTermos: 40,
    cotasEditaveis: ['term', 'hour', 'day24', 'day'],
    perTermFixo: 0,
    perHourFixo: 0,
    tetoDiarioFixo: 0,
    scanPerTermFixo: 0,
    per24h: 25,
  },
};

if (!S || !E) {
  console.log('FALHA: os modulos nao carregaram (shared/edicoes).');
  process.exit(1);
}

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

console.log('== FREE (edicao padrao) ==');
ok('edicao ativa = free', E.chaveAtiva() === 'free');
ok('temFeature(export) = false', S.temFeature('export') === false);
ok('rotulo do free = Free (o selo do popup usa)', E.atual().rotulo === 'Free', E.atual().rotulo);

const cfg = S.parseSettings({
  terms: 'a,b,c,d,e',
  baseUrl: 'https://www.linkedin.com/jobs/search/',
  apply: {
    enabled: true,
    // O formulário pode mandar o que quiser: no free o motor impõe as cotas.
    perTerm: 99,
    perHour: 99,
    per24h: 99,
    perDay: 99,
    minDelayMs: 1000,
    maxDelayMs: 2000,
    respectUserActivity: false,
    breaksEnabled: false,
    breakEvery: 3,
    breakMs: 20000,
    readMinMs: 10,
    readMaxMs: 20,
  },
  schedule: { enabled: true },
});

ok('termos cortados em 2', cfg.terms.length === 2 && cfg.terms.join() === 'a,b', JSON.stringify(cfg.terms));
ok('free sem cotas editaveis', E.atual().limites.cotasEditaveis.length === 0, JSON.stringify(E.atual().limites.cotasEditaveis));
ok('perTerm fixo 4', cfg.apply.perTerm === 4, String(cfg.apply.perTerm));
ok('perHour fixo 3', cfg.apply.perHour === 3, String(cfg.apply.perHour));
ok('per24h desligado (Infinity)', cfg.apply.per24h === Infinity, String(cfg.apply.per24h));
ok('teto diario fixo = 9', cfg.apply.perDay === 9, String(cfg.apply.perDay));
ok('scanPerTerm fixo 40', cfg.apply.scanPerTerm === 40, String(cfg.apply.scanPerTerm));
ok('minDelay fixo 4000', cfg.apply.minDelayMs === 4000, String(cfg.apply.minDelayMs));
ok('maxDelay fixo 12000', cfg.apply.maxDelayMs === 12000, String(cfg.apply.maxDelayMs));
ok('readMin fixo 1500', cfg.apply.readMinMs === 1500, String(cfg.apply.readMinMs));
ok('readMax fixo 4500', cfg.apply.readMaxMs === 4500, String(cfg.apply.readMaxMs));
ok('ceder a vez ligado a forca', cfg.apply.respectUserActivity === true, String(cfg.apply.respectUserActivity));
ok('pausas ligadas a forca', cfg.apply.breaksEnabled === true, String(cfg.apply.breaksEnabled));
ok('breakEvery fixo 10', cfg.apply.breakEvery === 10, String(cfg.apply.breakEvery));
ok('breakMs fixo 90000', cfg.apply.breakMs === 90000, String(cfg.apply.breakMs));
ok('agendador desligado a forca', cfg.schedule.enabled === false, String(cfg.schedule.enabled));
ok('autoStart desligado a forca', cfg.schedule.autoStart === false, String(cfg.schedule.autoStart));

const linha = S.describeQuota(S.computeQuota(cfg, [], Date.now(), 0));
ok('linha de cotas sem 24 h', !linha.includes('24 h'), linha);
ok('linha de cotas com hora e termo', linha.includes('na hora') && linha.includes('neste termo'), linha);
console.log('  -> ' + linha);

console.log('== PREMIUM (concedido pelo servidor) ==');
E.aplicarDoServidor(PERFIL_SERVIDOR_PREMIUM);
ok('temFeature(export) = true', S.temFeature('export') === true);
ok('rotulo do premium = Premium', E.atual().rotulo === 'Premium', E.atual().rotulo);

const cp = S.parseSettings({
  terms: 'a,b,c,d,e',
  apply: { minDelayMs: 1000, maxDelayMs: 2000, scanPerTerm: 30 },
  schedule: { enabled: true },
});

ok('premium mantem 5 termos', cp.terms.length === 5, String(cp.terms.length));
ok('premium per24h = 25', cp.apply.per24h === 25, String(cp.apply.per24h));
ok('premium scanPerTerm respeita usuario', cp.apply.scanPerTerm === 30, String(cp.apply.scanPerTerm));
ok('premium minDelay respeita usuario', cp.apply.minDelayMs === 1000, String(cp.apply.minDelayMs));
ok('premium perDay 0 (sem teto imposto)', cp.apply.perDay === 0, String(cp.apply.perDay));
ok('premium agendador respeitado', cp.schedule.enabled === true, String(cp.schedule.enabled));

const qp = S.describeQuota(S.computeQuota(cp, [], Date.now(), 0));
ok('premium mostra 24 h', qp.includes('24 h'), qp);
console.log('  -> ' + qp);

console.log('== SERVIDOR (conta + assinatura: a API liga/desliga) ==');
E.aplicarDoServidor(null);

const lib = E.aplicarDoServidor({
  rotulo: 'Premium',
  features: { export: true, scheduler: true },
  limites: {
    maxTermos: 12,
    perTermFixo: 6,
    perHourFixo: 5,
    per24h: 50,
    cotasEditaveis: ['term', 'hour', 'day24', 'day'],
  },
});

ok('servidor: chave ativa = servidor', E.chaveAtiva() === 'servidor', E.chaveAtiva());
ok('servidor: export liberado', S.temFeature('export') === true);
ok('servidor: rotulo do selo', lib.rotulo === 'Premium', lib.rotulo);

const cs = S.parseSettings({
  terms: 'a,b,c,d,e,f,g,h,i,j,k,l,m',
  apply: { perTerm: 99, perHour: 99, minDelayMs: 1000, maxDelayMs: 2000, scanPerTerm: 25, per24h: 99 },
  schedule: { enabled: true },
});

ok('servidor: maxTermos 12 (da API)', cs.terms.length === 12, String(cs.terms.length));
ok('servidor: perTerm fixo da API (6)', cs.apply.perTerm === 6, String(cs.apply.perTerm));
ok('servidor: perHour fixo da API (5)', cs.apply.perHour === 5, String(cs.apply.perHour));
ok('servidor: per24h da API (50)', cs.apply.per24h === 50, String(cs.apply.per24h));
ok('servidor: scanPerTerm respeitado', cs.apply.scanPerTerm === 25, String(cs.apply.scanPerTerm));
ok('servidor: minDelay do usuario', cs.apply.minDelayMs === 1000, String(cs.apply.minDelayMs));
ok('servidor: agendador respeitado', cs.schedule.enabled === true, String(cs.schedule.enabled));

// A API pode desligar uma feature; valor fora de tipo cai no padrao do premium.
E.aplicarDoServidor({ features: { export: false, scheduler: 'sim' }, limites: { maxTermos: 'x' } });
ok('servidor: API pode desligar uma feature', S.temFeature('export') === false);
ok('servidor: flag invalida cai no default', S.temFeature('scheduler') === true);
ok('servidor: limite invalido cai no default (40)', E.atual().limites.maxTermos === 40, String(E.atual().limites.maxTermos));

E.aplicarDoServidor(null);
ok('servidor->null volta pro free', E.chaveAtiva() === 'free', E.chaveAtiva());
ok('servidor->null: export bloqueado', S.temFeature('export') === false);

console.log('== A EDICAO NAO SE DECIDE NO CLIENTE ==');
ok('edicoes.js nao expoe mais definir()', typeof E.definir === 'undefined');
ok(
  'shared.js nao expoe atalho de edicao',
  typeof S.salvarEdicao === 'undefined' && typeof S.aplicarModoEdicao === 'undefined'
);
ok(
  'shared.js nao expoe o painel de teste',
  typeof S.lerPainelDev === 'undefined' && typeof S.salvarPainelDev === 'undefined'
);
ok(
  'sessao e sincronizacao existem no lugar',
  typeof S.sincronizarPlano === 'function' && typeof S.aplicarPerfilSalvo === 'function'
);

console.log('== O PERFIL SEGUE O PAYLOAD DO SERVIDOR ==');
E.aplicarDoServidor(PERFIL_SERVIDOR_PREMIUM);
ok('premium do payload: 5 termos passam', S.parseSettings({ terms: 'a,b,c,d,e' }).terms.length === 5);
ok('premium do payload: 24 h de volta', S.parseSettings(null).apply.per24h === 25);
ok(
  'premium do payload: a linha de cotas mostra 24 h',
  S.describeQuota(S.computeQuota(S.parseSettings(null), [], Date.now(), 0)).includes('24 h')
);

E.aplicarDoServidor({ features: { export: 'sim' }, limites: { maxTermos: 'x' } });
ok('payload com valor errado cai no padrao do premium', S.temFeature('export') === true);
ok('payload com limite errado cai no padrao (40)', E.atual().limites.maxTermos === 40, String(E.atual().limites.maxTermos));

E.aplicarDoServidor(null);
ok('servidor->null: ninguem exporta', S.temFeature('export') === false);
ok('servidor->null: termos cortados em 2', S.parseSettings({ terms: 'a,b,c' }).terms.length === 2);
ok('servidor->null: cotas fixas de volta', S.parseSettings(null).apply.perHour === 3);

// Sem chrome.storage (Node puro) as funcoes de sessao degradam sem estourar:
// e exatamente o que roda no service worker quando o storage falha.
E.aplicarDoServidor(PERFIL_SERVIDOR_PREMIUM);

S.aplicarPerfilSalvo()
  .then((perfil) => {
    ok(
      'sem chrome: aplicarPerfilSalvo volta ao free',
      Boolean(perfil) && perfil.chave === 'free',
      String(perfil && perfil.chave)
    );
    ok('sem chrome: perfil ativo = free', S.perfilEdicao().chave === 'free', S.perfilEdicao().chave);
    return S.lerSessao();
  })
  .then((sessao) => {
    ok('sem chrome: nenhuma sessao guardada', sessao === null, String(sessao));
    return S.sincronizarPlano();
  })
  .then((resultado) => {
    ok('sem sessao: sincronizarPlano nao chama a rede', resultado.ok === true && resultado.perfil === null);
    return S.entrar('a@b.co', 'senha-boa-1');
  })
  .then((resultado) => {
    ok(
      'sem fetch: entrar devolve erro tratado',
      resultado.ok === false && resultado.erro === 'rede',
      String(resultado.erro)
    );
    return S.sair();
  })
  .then((resultado) => {
    ok('sair devolve ok', resultado.ok === true);
    finalizar();
  })
  .catch((erro) => {
    ok('caminho de sessao assincrono', false, erro && erro.message);
    finalizar();
  });

function finalizar() {
  console.log(falhas ? '\n' + falhas + '/' + total + ' FALHARAM' : '\nTodos os ' + total + ' testes passaram.');
  process.exit(falhas ? 1 : 0);
}
