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

const S = globalThis.PegaVagaShared;
const E = globalThis.PegaVagaEdicoes;

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
ok('per24h desligado (Infinity)', cfg.apply.per24h === Infinity, String(cfg.apply.per24h));
ok('teto diario fixo = 20', cfg.apply.perDay === 20, String(cfg.apply.perDay));
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

console.log('== PREMIUM ==');
E.definir('premium');
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
E.definir('free');

const lib = E.aplicarDoServidor({
  rotulo: 'Premium',
  features: { export: true, scheduler: true },
  limites: { maxTermos: 12, per24h: 50, cotasEditaveis: ['term', 'hour', 'day24', 'day'] },
});

ok('servidor: chave ativa = servidor', E.chaveAtiva() === 'servidor', E.chaveAtiva());
ok('servidor: export liberado', S.temFeature('export') === true);
ok('servidor: rotulo do selo', lib.rotulo === 'Premium', lib.rotulo);

const cs = S.parseSettings({
  terms: 'a,b,c,d,e,f,g,h,i,j,k,l,m',
  apply: { minDelayMs: 1000, maxDelayMs: 2000, scanPerTerm: 25, per24h: 99 },
  schedule: { enabled: true },
});

ok('servidor: maxTermos 12 (da API)', cs.terms.length === 12, String(cs.terms.length));
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

E.definir('free');

console.log(falhas ? '\n' + falhas + '/' + total + ' FALHARAM' : '\nTodos os ' + total + ' testes passaram.');
process.exit(falhas ? 1 : 0);
