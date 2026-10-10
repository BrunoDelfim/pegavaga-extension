/* =============================================================================
 * PegaVaga - edicoes.js
 * Perfis de edição do produto: o que cada plano (edição) pode fazer.
 *
 * Carregado ANTES do shared.js nos três contextos (pop-up, content script e
 * service worker). É aqui que mora a POLÍTICA de cada edição — o shared.js só
 * aplica o perfil ativo ao normalizar a configuração, e a UI esconde o que a
 * edição não oferece.
 *
 * Hoje a edição ativa é sempre a "free" — que é exatamente a mesma build do
 * portfólio (código aberto). O premium entra depois, por conta/assinatura: quando
 * o backend confirmar o plano, basta chamar PegaVagaEdicoes.definir('premium').
 * ===========================================================================*/

'use strict';

globalThis.PegaVagaEdicoes = (() => {
  /* Valores seguros de furtividade. No free eles NÃO são editáveis: ficam fixos
   * aqui e o motor aplica por cima do que o usuário mandar. São os mesmos
   * padrões históricos (delays longos, pausas de leitura e descansos), escolhidos
   * para proteger a conta. No premium o usuário é quem ajusta. */
  const FURTIVIDADE_SAO = {
    minDelayMs: 4000,
    maxDelayMs: 12000,
    readMinMs: 1500,
    readMaxMs: 4500,
    breakEvery: 10,
    breakMs: 90000,
  };

  const PERFIS = {
    free: {
      chave: 'free',
      rotulo: 'Free',
      /* Recursos ligados/desligados por edição. */
      features: {
        autoApply: true, // candidatar-se sozinho entra no free
        formFill: true, // responder o formulário também
        scheduler: false, // sem agendador
        export: false, // exportação fica pro premium (botão desabilitado, sem função)
        furtividadeConfig: false, // ritmo humano fixo (não editável)
        cotasAvancadas: false, // sem 24 h/dia editáveis
        scanConfig: false, // "Máx. vagas por termo" é trava fixa, não campo
      },
      limites: {
        maxTermos: 2,
        // Nenhuma cota é editável no free: os campos saem da UI e o motor impõe
        // os valores fixos em `aplicarPerfilEdicao` (o usuário não mexe em nada).
        cotasEditaveis: [],
        // Cotas fixas da edição (0 = o usuário ajusta na UI, como no premium).
        perTermFixo: 4, // candidaturas por termo de busca
        perHourFixo: 3, // janela móvel de 60 min
        // Teto diário imposto: não é campo, é regra da edição (0 = sem teto).
        tetoDiarioFixo: 9,
        // Teto de vagas visitadas por termo: trava de segurança fixa no free
        // (o campo "Máx. vagas por termo" não existe nesta edição).
        scanPerTermFixo: 40,
        // Sem janela de 24 h no free — desligada (nunca bloqueia nem aparece).
        per24h: Infinity,
      },
      furtividadeFixa: FURTIVIDADE_SAO,
    },

    premium: {
      chave: 'premium',
      rotulo: 'Premium',
      features: {
        autoApply: true,
        formFill: true,
        scheduler: true,
        export: true,
        furtividadeConfig: true,
        cotasAvancadas: true,
        scanConfig: true,
      },
      limites: {
        maxTermos: 40,
        cotasEditaveis: ['term', 'hour', 'day24', 'day'],
        perTermFixo: 0, // 0 = o usuário ajusta "Por termo"
        perHourFixo: 0, // 0 = o usuário ajusta "Por hora"
        tetoDiarioFixo: 0, // o usuário escolhe a cota por dia
        scanPerTermFixo: 0, // 0 = o usuário ajusta "Máx. vagas por termo"
        per24h: 25,
      },
      furtividadeFixa: null, // no premium o usuário ajusta o ritmo
    },
  };

  /* A edição ativa começa no free: 100% local, sem conta e sem rede. O premium
   * só entra depois de conta + assinatura válida, e quem concede é o servidor —
   * por isso o perfil remoto chega por `aplicarDoServidor`, nunca por um valor que
   * o cliente possa forjar sozinho. */
  let ativa = 'free';
  let perfilServidor = null;

  const CHAVE_SERVIDOR = 'servidor';

  function perfil(chave) {
    if (chave === CHAVE_SERVIDOR) return perfilServidor || PERFIS.free;
    return PERFIS[chave] || PERFIS.free;
  }

  function atual() {
    return perfil(ativa);
  }

  function definir(chave) {
    if (PERFIS[chave]) {
      perfilServidor = null; // voltar ao perfil local descarta a concessão remota
      ativa = chave;
    }
    return atual();
  }

  /**
   * Aplica o perfil concedido pelo servidor (depois de conta + assinatura) — é o
   * que "libera os campos e opções": quais features aparecem e os limites de
   * cada uma vêm da resposta da API, não de um valor fixo no cliente. Só o que é
   * conhecido entra; flag fora de tipo ou número inválido é ignorado, mantendo o
   * padrão do premium. Chamar com `null` (sem sessão/assinatura) volta pro free.
   *
   * O free NUNCA passa por aqui: ele é 100% local e não faz chamada nenhuma.
   */
  function aplicarDoServidor(remoto) {
    const fonte = remoto && typeof remoto === 'object' ? remoto : null;

    if (!fonte) {
      perfilServidor = null;
      ativa = 'free';
      return atual();
    }

    const base = PERFIS.premium;
    const features = Object.assign({}, base.features);
    const limites = Object.assign({}, base.limites);

    const featuresRemotas =
      fonte.features && typeof fonte.features === 'object' ? fonte.features : {};
    Object.keys(base.features).forEach((nome) => {
      if (typeof featuresRemotas[nome] === 'boolean') features[nome] = featuresRemotas[nome];
    });

    const limitesRemotos =
      fonte.limites && typeof fonte.limites === 'object' ? fonte.limites : {};
    ['maxTermos', 'perTermFixo', 'perHourFixo', 'tetoDiarioFixo', 'scanPerTermFixo', 'per24h'].forEach((nome) => {
      if (Number.isFinite(limitesRemotos[nome])) limites[nome] = limitesRemotos[nome];
    });
    if (Array.isArray(limitesRemotos.cotasEditaveis)) {
      limites.cotasEditaveis = limitesRemotos.cotasEditaveis.slice();
    }

    perfilServidor = {
      chave: CHAVE_SERVIDOR,
      rotulo: String(fonte.rotulo || base.rotulo).slice(0, 24),
      features,
      limites,
      furtividadeFixa: null, // com assinatura, o usuário ajusta o ritmo
    };
    ativa = CHAVE_SERVIDOR;

    return atual();
  }

  function temFeature(nome) {
    return Boolean(atual().features[nome]);
  }

  function chaveAtiva() {
    return ativa;
  }

  return {
    PERFIS,
    FURTIVIDADE_SAO,
    perfil,
    atual,
    definir,
    aplicarDoServidor,
    temFeature,
    chaveAtiva,
  };
})();
