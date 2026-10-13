/* =============================================================================
 * PegaVaga - src/edicoes.ts
 * Perfis de edição do produto: o que cada plano (edição) pode fazer.
 *
 * FONTE da verdade: o `edicoes.js` da raiz é GERADO deste arquivo pelo TypeScript
 * (rode `./pgv.sh build`; o gerado começa com o aviso de "não edite à mão").
 *
 * Carregado ANTES do shared.js nos três contextos (pop-up, content script e
 * service worker). É aqui que mora a POLÍTICA de cada edição — o shared.js só
 * aplica o perfil ativo ao normalizar a configuração, e a UI esconde o que a
 * edição não oferece.
 *
 * A edição ativa começa no "free" — que é exatamente a mesma build do portfólio
 * (código aberto). O premium só entra por conta/assinatura: o `shared.js` chama o
 * `/plano` e entrega a resposta a `aplicarDoServidor`. Não existe — de propósito —
 * nenhum outro caminho no cliente que ligue o premium: não há `definir()`, e o
 * que resta é obedecer ao perfil que o servidor assinou.
 * ===========================================================================*/

'use strict';

/* -----------------------------------------------------------------------------
 * Os tipos da edição.
 *
 * Eles nascem aqui e valem para o programa inteiro: a extensão é feita de scripts
 * clássicos (sem `import`/`export`, como o `popup.html`, o content script e o
 * `importScripts` do service worker exigem), então tipo declarado no topo é
 * global. É isso que deixa o `shared.ts` usar `PerfilEdicao` sem importar nada.
 * -------------------------------------------------------------------------- */

/**
 * O que a edição liga ou desliga. As duas edições declaram EXATAMENTE esta lista
 * de chaves — o backend confere chave por chave, e é o tipo que garante que
 * ninguém esqueça uma delas.
 */
interface FeaturesEdicao {
  autoApply: boolean;
  formFill: boolean;
  scheduler: boolean;
  export: boolean;
  furtividadeConfig: boolean;
  cotasAvancadas: boolean;
  scanConfig: boolean;
  painelAdmin: boolean;
}

/**
 * Até onde a edição deixa ir. `0` nos campos `…Fixo` significa "o usuário é quem
 * ajusta" (é o que acontece no premium); cota fixa maior que zero é trava da
 * edição, imposta pelo motor — o campo nem aparece na UI.
 */
interface LimitesEdicao {
  maxTermos: number;
  cotasEditaveis: string[];
  perTermFixo: number;
  perHourFixo: number;
  tetoDiarioFixo: number;
  scanPerTermFixo: number;
  per24h: number;
}

/** Ritmo humano da edição: no free é fixo (o usuário não mexe), no premium `null`. */
interface FurtividadeEdicao {
  minDelayMs: number;
  maxDelayMs: number;
  readMinMs: number;
  readMaxMs: number;
  breakEvery: number;
  breakMs: number;
}

/** Um perfil de edição completo: o que libera, até onde deixa ir e o ritmo. */
interface PerfilEdicao {
  chave: string;
  rotulo: string;
  features: FeaturesEdicao;
  limites: LimitesEdicao;
  furtividadeFixa: FurtividadeEdicao | null;
  /**
   * O perfil veio de `?simular=` (o "ver a tela como" do administrador)? É o MESMO
   * perfil do outro plano — a diferença é esta marca, e é por ela que a UI avisa
   * que a tela não é a de produção. Tudo que é real responde `false`.
   */
  simulado: boolean;
}

/** As duas edições que o cliente conhece de fábrica. */
type ChaveEdicao = 'free' | 'premium';

/**
 * A edição ATIVA é `free` (local, sem conta e sem rede) ou `servidor` (o que a
 * assinatura concedeu). `premium` não entra nesta lista de propósito: o cliente
 * nunca liga a premium sozinho — o perfil dela é o PADRÃO da resposta do servidor,
 * e é o servidor quem decide o que chega.
 */
type EdicaoAtiva = 'free' | 'servidor';

/**
 * O que pode chegar num payload da API. A tipagem é larga (`unknown`) porque o
 * servidor é a fronteira de confiança: só campo do tipo certo entra, o resto cai
 * no padrão do premium.
 */
interface PerfilRemoto {
  rotulo?: unknown;
  features?: Record<string, unknown>;
  limites?: Record<string, unknown>;
  simulado?: unknown;
}

/* -----------------------------------------------------------------------------
 * O perfil de cada edição.
 *
 * O corpo abaixo é o mesmo código que já rodava em JavaScript — agora com os
 * tipos declarados. O `var` (e não `const`) é de propósito: se este script for
 * injetado duas vezes na mesma página (é o que acontece com content script), um
 * `const` repetido estouraria em "Identifier 'apiEdicoes' has already been
 * declared" — `var` apenas sobrescreve.
 * -------------------------------------------------------------------------- */
var apiEdicoes = (() => {
  /* Valores seguros de furtividade. No free eles NÃO são editáveis: ficam fixos
   * aqui e o motor aplica por cima do que o usuário mandar. São os mesmos
   * padrões históricos (delays longos, pausas de leitura e descansos), escolhidos
   * para proteger a conta. No premium o usuário é quem ajusta. */
  const FURTIVIDADE_SAO: FurtividadeEdicao = {
    minDelayMs: 4000,
    maxDelayMs: 12000,
    readMinMs: 1500,
    readMaxMs: 4500,
    breakEvery: 10,
    breakMs: 90000,
  };

  /* As cotas numéricas que o payload da API pode sobrescrever (as outras são
   * lista ou constante). O `as const` faz destas strings chaves de verdade de
   * `LimitesEdicao`: nome escrito errado aqui não compila. */
  const CAMPOS_NUMERICOS = [
    'maxTermos',
    'perTermFixo',
    'perHourFixo',
    'tetoDiarioFixo',
    'scanPerTermFixo',
    'per24h',
  ] as const;

  const PERFIS: Record<ChaveEdicao, PerfilEdicao> = {
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
        // Não é da edição, é do PAPEL da conta: o servidor liga isto para quem
        // é administrador. Aqui fica sempre false — e as duas edições precisam
        // declarar a mesma lista de chaves (o backend confere chave por chave).
        painelAdmin: false,
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
      simulado: false,
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
        painelAdmin: false, // do papel, não da edição — ver o comentário no free
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
      simulado: false,
    },
  };

  /* A edição ativa começa no free: 100% local, sem conta e sem rede. O premium
   * só entra depois de conta + assinatura válida, e quem concede é o servidor —
   * por isso o perfil remoto chega por `aplicarDoServidor` e não existe (nem
   * existirá) uma função que o ligue localmente. */
  let ativa: EdicaoAtiva = 'free';
  let perfilServidor: PerfilEdicao | null = null;

  const CHAVE_SERVIDOR = 'servidor';

  /**
   * O perfil de uma chave. `servidor` é o que a API concedeu (ou o free, quando
   * não há nenhum) e qualquer outra chave é o que `PERFIS` tiver — o mesmo
   * `PERFIS[chave] || PERFIS.free` de antes, agora com o tsc conferindo os nomes.
   */
  function perfil(chave: string): PerfilEdicao {
    if (chave === CHAVE_SERVIDOR) return perfilServidor || PERFIS.free;
    return chave === 'premium' ? PERFIS.premium : PERFIS.free;
  }

  function atual(): PerfilEdicao {
    return perfil(ativa);
  }

  /**
   * Aplica o perfil concedido pelo servidor (depois de conta + assinatura) — é o
   * que "libera os campos e opções": quais features aparecem e os limites de
   * cada uma vêm da resposta da API, não de um valor fixo no cliente. Só o que é
   * conhecido entra; flag fora de tipo ou número inválido é ignorado, mantendo o
   * padrão do premium. Chamar com `null` (sem sessão/assinatura) volta pro free.
   *
   * O free NUNCA passa por aqui: ele é 100% local e não faz chamada nenhuma.
   *
   * O parâmetro é `unknown` de propósito: o servidor é a fronteira de confiança, e
   * é aqui dentro que o payload é conferido campo por campo.
   */
  function aplicarDoServidor(remoto: unknown): PerfilEdicao {
    const fonte: PerfilRemoto | null =
      remoto && typeof remoto === 'object' ? (remoto as PerfilRemoto) : null;

    if (!fonte) {
      perfilServidor = null;
      ativa = 'free';
      return atual();
    }

    const base = PERFIS.premium;
    const features: FeaturesEdicao = Object.assign({}, base.features);
    const limites: LimitesEdicao = Object.assign({}, base.limites);

    const featuresRemotas: Record<string, unknown> =
      fonte.features && typeof fonte.features === 'object' ? fonte.features : {};
    const nomes = Object.keys(base.features) as Array<keyof FeaturesEdicao>;
    nomes.forEach((nome) => {
      const valor = featuresRemotas[nome];
      if (typeof valor === 'boolean') features[nome] = valor;
    });

    const limitesRemotos: Record<string, unknown> =
      fonte.limites && typeof fonte.limites === 'object' ? fonte.limites : {};
    CAMPOS_NUMERICOS.forEach((nome) => {
      const valor = limitesRemotos[nome];
      if (Number.isFinite(valor)) limites[nome] = Number(valor);
    });
    if (Array.isArray(limitesRemotos.cotasEditaveis)) {
      /* Só nome de cota (string) entra: um número nunca casaria com as chaves que
       * a UI procura em `cotasEditaveis`, então cai fora — igual ao resto do
       * payload, que é conferido campo por campo. */
      limites.cotasEditaveis = limitesRemotos.cotasEditaveis.filter(
        (item) => typeof item === 'string'
      );
    }

    perfilServidor = {
      chave: CHAVE_SERVIDOR,
      rotulo: String(fonte.rotulo || base.rotulo).slice(0, 24),
      features,
      limites,
      furtividadeFixa: null, // com assinatura, o usuário ajusta o ritmo
      // O único rastro do `?simular=`: o perfil é o mesmo, mas a tela precisa
      // avisar que não é a de produção (ver `simulado` no tipo).
      simulado: fonte.simulado === true,
    };
    ativa = CHAVE_SERVIDOR;

    return atual();
  }

  /* O nome da feature chega de fora (a UI chama por string) e o tsc não tem como
   * saber qual é; por isso a leitura passa pelo `in`, que confere em tempo de
   * execução — o cast só declara ao compilador o que o `in` já garantiu. O que
   * não existir responde `false`, como antes da migração. */
  function temFeature(nome: string): boolean {
    const features = atual().features;
    return nome in features && Boolean(features[nome as keyof FeaturesEdicao]);
  }

  function chaveAtiva(): EdicaoAtiva {
    return ativa;
  }

  return {
    PERFIS,
    FURTIVIDADE_SAO,
    perfil,
    atual,
    aplicarDoServidor,
    temFeature,
    chaveAtiva,
  };
})();

/* O tipo público deste arquivo, DERIVADO do próprio código: é ele que o
 * `src/tipos/globais.d.ts` usa para declarar `globalThis.PegaVagaEdicoes` — se a
 * API daqui mudar, o tsc acusa lá também. */
type PegaVagaEdicoesApi = typeof apiEdicoes;

globalThis.PegaVagaEdicoes = apiEdicoes;
