/* =============================================================================
 * PegaVaga - src/shared.ts
 * Constantes e utilitários puros compartilhados pelo pop-up, pelo content
 * script e pelo service worker (background.js). O arquivo é carregado nos três
 * contextos, por isso anexa tudo em globalThis.PegaVagaShared em vez de usar
 * módulos ES. Não use APIs de DOM aqui: o service worker não tem `document`.
 *
 * FONTE da verdade: o `shared.js` da raiz é GERADO deste arquivo pelo TypeScript
 * (rode `./pgv.sh build`; o gerado começa com o aviso de "não edite à mão").
 * ===========================================================================*/

'use strict';

/* -----------------------------------------------------------------------------
 * Os tipos do contrato compartilhado.
 *
 * Eles nascem aqui e valem para o programa inteiro: a extensão é feita de
 * scripts clássicos (sem `import`/`export`), então tipo declarado no topo é
 * global. É isso que deixa o `popup.ts`/`content.ts` usarem `Configuracoes`,
 * `Sessao` ou `FilaExecucao` sem importar nada — e é por isso que nenhum nome
 * aqui pode repetir o de outro arquivo, nem o de outro tipo global.
 *
 * A régua usada em todos eles: o que é NOSSO é tipado com precisão; o que vem
 * de fora (storage, servidor) entra como `unknown` e é conferido campo por
 * campo, como o `edicoes.ts` já faz com o payload da API.
 * -------------------------------------------------------------------------- */

/** Respostas específicas do usuário: { "palavra-chave da pergunta": "resposta" }. */
type RespostasConfiguradas = Record<string, string>;

/** Cotas de candidatura e ritmo humano (`settings.apply`). */
interface ConfigCandidatura {
  enabled: boolean;
  perTerm: number;
  perHour: number;
  per24h: number;
  perDay: number;
  scanPerTerm: number;
  minDelayMs: number;
  maxDelayMs: number;
  readMinMs: number;
  readMaxMs: number;
  respectUserActivity: boolean;
  breaksEnabled: boolean;
  breakEvery: number;
  breakMs: number;
  fillRequired: boolean;
  answerYes: boolean;
  answerNumber: number;
  answerText: string;
  answers: RespostasConfiguradas;
}

/** A janela de horário em que a extensão trabalha (`settings.schedule`). */
interface ConfigAgendador {
  enabled: boolean;
  autoStart: boolean;
  startTime: string;
  stopTime: string;
  days: number[];
  focusTab: boolean;
}

/** A configuração já normalizada — a única forma que o motor aceita. */
interface Configuracoes {
  baseUrl: string;
  location: string;
  terms: string[];
  apply: ConfigCandidatura;
  schedule: ConfigAgendador;
}

/** A credencial guardada em `pegavaga_sessao` (os campos vêm crus do servidor). */
interface Sessao {
  token: string | null;
  email?: string | null;
  papel?: string | null;
  expiraEm?: string | null;
}

/** O `pegavaga_perfil`: o último `/plano` recebido e quando ele chegou. */
interface CachePerfil {
  perfil?: PerfilRemoto;
  salvoEm?: number;
}

/** O corpo de login/cadastro, como o servidor o manda (fronteira de confiança). */
interface RespostaConta {
  token?: string;
  expiresAt?: string;
  conta?: { email?: string; papel?: string };
}

/** O que se pode pedir numa chamada à API. */
interface OpcoesRequisicao {
  metodo?: string;
  corpo?: unknown;
  token?: string | null;
}

/**
 * Como uma chamada RECUSADA termina: `status` só existe quando a resposta
 * chegou (erro de rede não tem status), mas `erro`/`mensagem` existem sempre —
 * é o texto que a tela mostra sem precisar saber de onde veio a recusa.
 */
interface FalhaApi {
  ok: false;
  status?: number;
  erro: string;
  mensagem: string;
}

/**
 * As duas únicas formas de uma chamada terminar. Não há exceção nem formato
 * "meio a meio": ou `{ ok: true }` com o que a rota devolve (`T`), ou a falha
 * com o motivo legível. É isso que tira de cada tela o `try/catch` de fetch e
 * o texto de erro repetido.
 */
type RespostaApi<T extends object = object> = ({ ok: true; status?: number } & T) | FalhaApi;

/** A fila de termos em andamento (`pegavaga_run`). */
interface FilaExecucao {
  running: boolean;
  paused: boolean;
  resumeAt: number | null;
  pauseReason: string | null;
  index: number;
  term: string;
  terms: string[];
  urls: string[];
  appliedInTerm: number;
  visitedInTerm: number;
  appliedTotal: number;
  sinceBreak: number;
  startedAt: string;
}

/** Um bloco de cota: quantas já foram, o teto e o que sobra. */
interface NumerosDeCota {
  term: number;
  hour: number;
  day24: number;
  day: number;
}

/** O que ainda cabe dentro das cotas (ver `computeQuota`). */
interface CotaCandidaturas {
  ok: boolean;
  blockedBy: 'hour' | 'day24' | 'day' | null;
  resumeAt: number | null;
  used: NumerosDeCota;
  limits: NumerosDeCota;
  remaining: NumerosDeCota;
}

/** Um desfecho possível de uma tentativa de candidatura (ver `APPLY_OUTCOMES`). */
interface DesfechoCandidatura {
  label: string;
  failure: boolean;
  reason: string;
}

/** Por que esta vaga não foi candidatada (ver `describeApplyFailure`). */
interface MotivoFalha {
  code: string;
  label: string;
  reason: string;
  pending: boolean;
}

/** Uma linha do relatório: quantas vagas caíram no mesmo motivo. */
interface ResumoMotivo {
  code: string;
  label: string;
  pending: boolean;
  count: number;
}

/** Totais do relatório: candidatadas x não candidatadas (definitivas x adiadas). */
interface ResumoCandidaturas {
  total: number;
  applied: number;
  failed: number;
  pending: number;
  reasons: ResumoMotivo[];
}

/** Opções do relatório (`applyEnabled: false` = candidatura automática desligada). */
interface OpcoesResumo {
  applyEnabled?: boolean;
}

/** A fila de quem espera um sinal da página (ver `createSignal`). */
interface Sinal {
  readonly size: number;
  wake(): void;
  subscribe(listener: () => void): () => void;
}

/** A luzinha do ícone, já com o texto pronto (ver `STATUS_LIGHTS`). */
interface LuzStatus {
  key: string;
  color: string;
  label: string;
  detail?: string;
  title?: string;
}

/** Um dos três presets de luz, sem o texto (a cor e o nome curto). */
interface PresetLuz {
  key: string;
  color: string;
  label: string;
}

/** O que a luz precisa saber da varredura em andamento (o `run` do estado). */
interface VarreduraLuz {
  running?: boolean;
  paused?: boolean;
  pauseReason?: string | null; // a fila grava `null` quando não há motivo
  resumeAt?: number | null;
  problem?: string;
  urls?: unknown;
  total?: number;
  index?: number;
  term?: string;
}

/** O bloqueio temporário da proteção da conta (o `guard` do estado). */
interface BloqueioLuz {
  blockedUntil?: number;
  reason?: string;
}

/**
 * O estado que `statusLight` lê — o mesmo objeto serve para o que vem do
 * storage e para o `PEGAVAGA_PROGRESS` do content script (só o que a luz usa:
 * o resto do estado não interessa aqui).
 */
interface EntradaLuz {
  now?: number;
  scanning?: boolean;
  breakUntil?: number;
  run?: VarreduraLuz | null;
  guard?: BloqueioLuz | null;
}

/** Preferências de resposta para `pickChoice` (vêm do formulário). */
interface PreferenciasEscolha {
  question?: unknown;
  answers?: unknown;
  yes?: boolean;
}

/* -----------------------------------------------------------------------------
 * O corpo. O `var` (e não `const`) é de propósito, como no `edicoes.ts`: se este
 * script for injetado duas vezes na mesma página (é o que acontece com content
 * script), um `const` repetido estouraria em "Identifier 'apiShared' has already
 * been declared" — `var` apenas sobrescreve.
 * -------------------------------------------------------------------------- */

var apiShared = (() => {
  /* Chaves usadas em chrome.storage.local. */
  const STORAGE = {
    jobs: 'pegavaga_jobs', // { [jobId]: { id, title, company, link, description } }
    meta: 'pegavaga_meta', // { lastRun, count, pageUrl }
    settings: 'pegavaga_settings', // busca + cotas de candidatura + agendador
    run: 'pegavaga_run', // fila de termos em andamento
    apps: 'pegavaga_apps', // timestamps (ms) das candidaturas enviadas
    guard: 'pegavaga_guard', // bloqueio temporário detectado (proteção da conta)
    sessao: 'pegavaga_sessao', // { token, email, papel, expiraEm } — a credencial
    perfil: 'pegavaga_perfil', // { perfil, salvoEm } — cache do último /plano
    api: 'pegavaga_api', // endereço do backend (vazio = o padrão de desenvolvimento)
  };

  /* Tipos de mensagem trocadas entre pop-up, content script e agendador. */
  const MSG = {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
    /* (TEMPORÁRIO) Pedido de ajuda ao usuário — ver a seção abaixo. */
    AJUDA_PEDIDO: 'PEGAVAGA_AJUDA_PEDIDO', // content → worker: mostre o aviso
    AJUDA_RESPOSTA: 'PEGAVAGA_AJUDA_RESPOSTA', // worker → content: a sua decisão
    AJUDA_FECHAR: 'PEGAVAGA_AJUDA_FECHAR', // content → worker: some com o aviso
  };

  const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';

  const MAX_TERMS = 40; // trava de segurança por execução
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const HISTORY_LIMIT = 500; // candidaturas guardadas (base das cotas móveis)
  const MIN_DELAY_MS = 1000;
  const MAX_DELAY_MS = 600000;

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  /* Os padrões do produto. O tipo é `Configuracoes` de propósito: o objeto
   * abaixo é o CONTRATO da configuração — se um campo novo nascer só aqui e não
   * no tipo (ou o contrário), o tsc acusa na hora. */
  const DEFAULT_SETTINGS: Configuracoes = {
    baseUrl: LINKEDIN_SEARCH_URL,
    location: '',
    terms: [],
    apply: {
      enabled: false, // candidatar-se sozinho só se o usuário ligar
      perTerm: 8, // candidaturas por termo de busca
      perHour: 6, // janela móvel de 60 min
      per24h: 25, // janela móvel de 24 h
      perDay: 0, // dia corrido (00:00-23:59); 0 = sem limite
      scanPerTerm: 40, // teto de vagas visitadas por termo (trava de segurança)
      minDelayMs: 4000, // intervalo entre candidaturas (imita digitação humana)
      maxDelayMs: 12000,
      readMinMs: 1500, // pausa de "leitura" da vaga antes de se candidatar
      readMaxMs: 4500,
      respectUserActivity: true, // espera quando o usuário está mexendo na página
      breaksEnabled: true, // pausas longas periódicas entre candidaturas
      breakEvery: 10, // candidaturas entre uma pausa longa e outra
      breakMs: 90000, // duração base da pausa longa
      fillRequired: true, // responde sozinho perguntas obrigatórias do formulário
      answerYes: true, // resposta padrão em perguntas de Sim/Não
      answerNumber: 1, // resposta padrão em campo numérico (anos, quantidade…)
      answerText: '', // resposta padrão em texto livre (vazio = não inventa)
      answers: {}, // respostas específicas: { "palavra-chave da pergunta": "resposta" }
    },
    schedule: {
      enabled: false,
      autoStart: true, // liga sozinho quando a janela de horário abre
      startTime: '08:00',
      stopTime: '18:00',
      days: [1, 2, 3, 4, 5], // 0 = domingo
      focusTab: true, // trazer a aba para frente (o Chrome pausa abas ocultas)
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Edição (perfil free/premium)                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * O perfil da edição ativa (free/premium) vive no `edicoes.js`, carregado
   * antes deste arquivo nos três contextos. O perfil reserva abaixo só entra em
   * cena se o `edicoes.js` não estiver presente — e aí o comportamento é o
   * histórico, sem cortes, para nunca restringir por acidente.
   *
   * Todo `false`/`0` aqui é "sem corte": nenhuma cota fixa (`…Fixo: 0`), 24 h
   * desligada, ritmo livre (`furtividadeFixa: null`) e todas as features ligadas.
   *
   * `painelAdmin` fica de fora de propósito: ele não é da edição, é do PAPEL da
   * conta (quem liga é o servidor) — sem `edicoes.js` não há painel, que é
   * exatamente o que já acontecia antes da migração. O `as` só diz ao tsc que o
   * resto do código pode ler o perfil como um `PerfilEdicao` completo; em
   * runtime o objeto continua com as sete features de sempre (chave ausente
   * responde `false`, e é o `temFeature` que confere isso).
   */
  const PERFIL_RESERVA = {
    chave: 'livre',
    rotulo: 'Livre',
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
      maxTermos: MAX_TERMS,
      cotasEditaveis: ['term', 'hour', 'day24', 'day'],
      perTermFixo: 0,
      perHourFixo: 0,
      tetoDiarioFixo: 0,
      scanPerTermFixo: 0,
      per24h: DEFAULT_SETTINGS.apply.per24h,
    },
    furtividadeFixa: null,
  } as PerfilEdicao;

  function perfilEdicao(): PerfilEdicao {
    const edicoes = globalThis.PegaVagaEdicoes;
    if (edicoes && typeof edicoes.atual === 'function') return edicoes.atual();
    return PERFIL_RESERVA;
  }

  /* O nome da feature chega de fora (a UI chama por string) e o tsc não tem como
   * saber qual é; por isso a leitura passa pelo `in`, que confere em tempo de
   * execução — o cast só declara ao compilador o que o `in` já garantiu. O que
   * não existir responde `false`, como antes da migração (o `edicoes.ts` faz
   * igual no `temFeature` dele). */
  function temFeature(nome: string): boolean {
    const features = perfilEdicao().features;
    return nome in features && Boolean(features[nome as keyof FeaturesEdicao]);
  }

  /* ------------------------------------------------------------------------ */
  /* Sessão e perfil — o servidor concede, o cliente pergunta                  */
  /* ------------------------------------------------------------------------ */
  //
  // Não existe caminho no cliente que ligue o premium: o perfil só muda por
  // `aplicarDoServidor(payload)`, e o único payload aceito vem de `/plano`
  // assinado pelo servidor. Sem sessão — ou com a sessão recusada — o perfil é o
  // free local, que não faz chamada de rede nenhuma.
  //
  // O que fica no storage:
  //   * `pegavaga_sessao` — { token, email, papel }        (credencial)
  //   * `pegavaga_perfil` — { perfil, salvoEm }            (cache do /plano)
  // O cache existe para o pop-up e o content script abrirem com o estado certo
  // sem esperar rede; depois de CACHE_PERFIL_MS ele deixa de valer.

  const API_PADRAO = 'http://127.0.0.1:8787';
  const CACHE_PERFIL_MS = 6 * 3600000; // 6 h

  /**
   * O storage desta extensão, se estiver disponível (no Node puro não existe).
   *
   * O tipo é derivado do próprio `@types/chrome` (`typeof` do que a API declara):
   * se a forma do `storage.local` mudar, o tsc acusa aqui em vez de deixar passar.
   */
  function extensaoApi(): typeof chrome.storage.local | null {
    return typeof chrome !== 'undefined' && chrome && chrome.storage ? chrome.storage.local : null;
  }

  /** Endereço do backend (o do storage, ou o padrão de desenvolvimento). */
  async function apiUrl(): Promise<string> {
    const storage = extensaoApi();
    if (!storage) return API_PADRAO;

    try {
      const dados = await storage.get(STORAGE.api);
      const escolhido = String(dados[STORAGE.api] || '').trim().replace(/\/+$/, '');
      return escolhido || API_PADRAO;
    } catch (erro) {
      return API_PADRAO;
    }
  }

  /** Endereço configurado ('' quando ninguém mexeu — vale o padrão). */
  async function lerApi(): Promise<string> {
    const storage = extensaoApi();
    if (!storage) return '';
    try {
      const dados = await storage.get(STORAGE.api);
      return String(dados[STORAGE.api] || '');
    } catch (erro) {
      return '';
    }
  }

  /** Troca o endereço do backend (apontar para o servidor de produção, por ex.). */
  async function salvarApi(url: unknown): Promise<string> {
    const storage = extensaoApi();
    const limpo = String(url || '').trim();
    if (storage) {
      try {
        await storage.set({ [STORAGE.api]: limpo });
      } catch (erro) {
        /* sem storage a troca vale só nesta janela */
      }
    }
    return limpo;
  }

  /** A sessão guardada, ou null — sem token não há sessão. */
  async function lerSessao(): Promise<Sessao | null> {
    const storage = extensaoApi();
    if (!storage) return null;

    try {
      const dados = await storage.get(STORAGE.sessao);
      const sessao = dados[STORAGE.sessao] as Sessao | null | undefined;
      return sessao && sessao.token ? sessao : null;
    } catch (erro) {
      return null;
    }
  }

  /** Guarda a sessão E o perfil que veio na mesma resposta (login/cadastro). */
  async function guardarSessao(corpo: unknown): Promise<Sessao> {
    const fonte = corpo && typeof corpo === 'object' ? (corpo as RespostaConta) : null;
    const conta = fonte && fonte.conta ? fonte.conta : null;

    const sessao: Sessao = {
      token: fonte && fonte.token ? fonte.token : null,
      email: conta ? conta.email : null,
      papel: conta ? conta.papel : null,
      expiraEm: (fonte && fonte.expiresAt) || null,
    };

    const storage = extensaoApi();
    if (storage) {
      try {
        await storage.set({
          [STORAGE.sessao]: sessao,
          [STORAGE.perfil]: { perfil: corpo, salvoEm: Date.now() },
        });
      } catch (erro) {
        /* sem storage: a sessão vale só nesta janela */
      }
    }
    return sessao;
  }

  /** Esquece a sessão e o cache, e volta ao free local. */
  async function limparSessao(): Promise<PerfilEdicao> {
    const storage = extensaoApi();
    if (storage) {
      try {
        await storage.remove([STORAGE.sessao, STORAGE.perfil]);
      } catch (erro) {
        /* nada a fazer: o perfil em memória volta ao free logo abaixo */
      }
    }
    return aplicarDoServidor(null);
  }

  /** Aplica o perfil concedido — o ÚNICO caminho que tira o cliente do free. */
  function aplicarDoServidor(payload: unknown): PerfilEdicao {
    const edicoes = globalThis.PegaVagaEdicoes;
    if (edicoes && typeof edicoes.aplicarDoServidor === 'function') {
      return edicoes.aplicarDoServidor(payload);
    }
    return perfilEdicao();
  }

  /**
   * Aplica o último perfil concedido que está no cache — SEM rede.
   *
   * É o que os três contextos chamam antes de qualquer `parseSettings`: o content
   * script e o service worker acordam do zero e não podem depender de um fetch
   * para montar a tela. Cache velho (mais que CACHE_PERFIL_MS) não vale — melhor
   * voltar ao free local do que obedecer a uma concessão que o servidor pode já
   * ter cancelado.
   */
  async function aplicarPerfilSalvo(): Promise<PerfilEdicao | PerfilRemoto> {
    const storage = extensaoApi();
    if (!storage) return aplicarDoServidor(null);

    let cache: CachePerfil | null = null;
    try {
      const dados = await storage.get(STORAGE.perfil);
      cache = (dados[STORAGE.perfil] as CachePerfil | null) || null;
    } catch (erro) {
      cache = null;
    }

    // A mesma checagem de antes, na mesma ordem e com o mesmo curto-circuito
    // (cache → perfil → salvoEm numérico → dentro do prazo), agora como saída
    // antecipada para o tsc saber que `cache.perfil` existe daqui para baixo. O
    // `as number` só declara o que o `Number.isFinite` já garantiu.
    if (
      !cache ||
      !cache.perfil ||
      !Number.isFinite(cache.salvoEm) ||
      Date.now() - (cache.salvoEm as number) > CACHE_PERFIL_MS
    ) {
      return aplicarDoServidor(null);
    }

    aplicarDoServidor(cache.perfil);
    return cache.perfil;
  }

  /**
   * Chama a API. Devolve sempre um resultado no mesmo formato — nunca lança:
   * `{ ok: true, corpo }` ou `{ ok: false, status, erro, mensagem }`. Sem isso,
   * cada tela teria o próprio `try/catch` de fetch e o próprio texto de erro.
   */
  async function requisitar(
    caminho: string,
    opcoes?: OpcoesRequisicao
  ): Promise<RespostaApi<{ corpo: unknown }>> {
    const config = opcoes || {};
    const sessao = config.token ? null : await lerSessao();
    const token = config.token || (sessao && sessao.token);

    const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) cabecalhos.Authorization = 'Bearer ' + token;

    const endereco = await apiUrl();
    let resposta: Response;

    try {
      resposta = await fetch(endereco + caminho, {
        method: config.metodo || 'GET',
        headers: cabecalhos,
        body: config.corpo ? JSON.stringify(config.corpo) : undefined,
      });
    } catch (erro) {
      return {
        ok: false,
        erro: 'rede',
        mensagem: 'Não foi possível falar com o servidor (' + endereco + ').',
      };
    }

    // O corpo do servidor é a fronteira de confiança: entra como `unknown` e os
    // dois campos que usamos saem por cast (o backend manda string nos dois).
    let dados: Record<string, unknown> | null = null;
    try {
      dados = await resposta.json();
    } catch (erro) {
      dados = null;
    }

    if (!resposta.ok) {
      return {
        ok: false,
        status: resposta.status,
        erro: (dados && (dados.erro as string)) || 'falha',
        mensagem: (dados && (dados.mensagem as string)) || 'O servidor recusou o pedido.',
      };
    }

    return { ok: true, status: resposta.status, corpo: dados };
  }

  /** Guarda o perfil recebido no cache (para os contextos aplicarem sem rede). */
  async function guardarCachePerfil(corpo: unknown): Promise<unknown> {
    const storage = extensaoApi();
    if (!storage) return corpo;

    try {
      await storage.set({ [STORAGE.perfil]: { perfil: corpo, salvoEm: Date.now() } });
    } catch (erro) {
      /* sem cache o próximo contexto cai no free até sincronizar de novo */
    }
    return corpo;
  }

  /**
   * Entra com e-mail e senha. Sucesso = sessão guardada + perfil aplicado, sem
   * nenhum caminho alternativo: é a mesma função que o cadastro usa.
   */
  async function entrar(email: string, senha: string): Promise<RespostaApi<{ corpo: unknown }>> {
    const resposta = await requisitar('/conta/login', {
      metodo: 'POST',
      corpo: { email: email, senha: senha },
    });

    if (!resposta.ok) return resposta;

    await guardarSessao(resposta.corpo);
    aplicarDoServidor(resposta.corpo);
    return { ok: true, corpo: resposta.corpo };
  }

  /** Cria a conta (nasce `usuario` — o papel é do servidor) e já entra. */
  async function cadastrar(email: string, senha: string): Promise<RespostaApi<{ corpo: unknown }>> {
    const resposta = await requisitar('/conta/cadastro', {
      metodo: 'POST',
      corpo: { email: email, senha: senha },
    });

    if (!resposta.ok) return resposta;

    await guardarSessao(resposta.corpo);
    aplicarDoServidor(resposta.corpo);
    return { ok: true, corpo: resposta.corpo };
  }

  /** Sai: apaga a credencial e o cache, e a tela volta ao free. */
  async function sair(): Promise<{ ok: true }> {
    await limparSessao();
    return { ok: true };
  }

  /**
   * Pergunta o plano de novo (o único jeito de ganhar/perder premium na tela).
   *
   * Sem sessão, nem chama a rede: free é local. Com sessão recusada (401/403), a
   * credencial é descartada e o free volta. Sem rede, mantém o cache — derrubar o
   * usuário para o free por causa de um Wi-Fi ruim seria pior do que esperar.
   */
  async function sincronizarPlano(): Promise<RespostaApi<{ perfil: unknown }>> {
    const sessao = await lerSessao();
    if (!sessao || !sessao.token) {
      aplicarDoServidor(null);
      return { ok: true, perfil: null };
    }

    const resposta = await requisitar('/plano', { token: sessao.token });

    if (resposta.ok) {
      await guardarCachePerfil(resposta.corpo);
      aplicarDoServidor(resposta.corpo);
      return { ok: true, perfil: resposta.corpo };
    }

    if (resposta.status === 401 || resposta.status === 403) {
      await limparSessao();
      return resposta;
    }

    await aplicarPerfilSalvo();
    return resposta;
  }

  /* ------------------------------------------------------------------------ */
  /* Administração (só o que o servidor permitir)                              */
  /* ------------------------------------------------------------------------ */
  //
  // Estas funções não decidem nada: elas chamam as rotas `/admin/*` e devolvem a
  // resposta. Quem é administrador é o cadastro do servidor — aqui só existe a
  // tela, e um 403 é a resposta correta (e esperada) para um usuário comum.

  /** Lista as licenças: chave, plano, estado, validade, e-mail e navegadores. */
  async function listarLicencas(): Promise<RespostaApi<{ licencas: unknown[] }>> {
    const resposta = await requisitar('/admin/licencas');
    if (!resposta.ok) return resposta;

    /* O corpo é o do servidor: `licencas` sai por cast, como o resto do payload. */
    const corpo = (resposta.corpo || {}) as { licencas?: unknown };
    return { ok: true, licencas: (corpo.licencas || []) as unknown[] };
  }

  /** Emite (`acao: 'emitir'`) ou revoga (`acao: 'revogar'`) uma licença. */
  async function emitirLicenca(dados: unknown): Promise<RespostaApi<{ licenca: unknown }>> {
    const resposta = await requisitar('/admin/licenca', { metodo: 'POST', corpo: dados });
    if (!resposta.ok) return resposta;

    return { ok: true, licenca: resposta.corpo };
  }

  /**
   * "Ver como" o outro plano: pede ao servidor o perfil de free/premium e aplica.
   *
   * Quem monta o perfil é o servidor — o cliente não decide nada nem aqui. O
   * direito real não muda: `sincronizarPlano` devolve o perfil de verdade na
   * próxima sincronização. De propósito, NÃO grava no cache: simulação não pode
   * virar o perfil que o content script aplica.
   */
  async function simularPlano(chave: string): Promise<RespostaApi<{ perfil: unknown }>> {
    const resposta = await requisitar('/plano?simular=' + encodeURIComponent(chave));
    if (!resposta.ok) return resposta;

    aplicarDoServidor(resposta.corpo);
    return { ok: true, perfil: resposta.corpo };
  }

  /* ------------------------------------------------------------------------ */
  /* Utilidades numéricas                                                      */
  /* ------------------------------------------------------------------------ */

  /** Converte para inteiro dentro de [min, max]; usa o padrão se não der. */
  function num(value: unknown, min: number, max: number, fallback: number): number {
    if (value === '' || value == null) return fallback;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  /** Transforma texto (uma linha por termo) em lista limpa e sem repetições. */
  /**
   * O que separa um termo do outro: quebra de linha, vírgula, ponto e vírgula,
   * barra vertical ou tabulação. Assim "react, node.js" e "react\nnode.js"
   * viram dois termos (um por busca) — do jeito que a fila em loop espera.
   */
  const TERM_SPLIT_RE = /\r?\n|[;|,\t]+/;

  /**
   * Lista limpa de termos: aceita texto (uma linha ou separado por vírgula) ou
   * array, tira espaços/aspas, descarta vazios e repetidos e respeita o teto de
   * termos da edição ativa (o free corta em poucos), mantendo a ordem digitada
   * (é a ordem da fila de busca).
   */
  function normalizeTerms(raw: unknown, max?: number): string[] {
    // Sem teto explícito, vale o da edição ativa. O `typeof` só existe para o
    // tsc: quem chama é JS (a UI) e pode mandar qualquer coisa — `Number.isFinite`
    // continua sendo quem decide, como antes.
    const limite =
      typeof max === 'number' && Number.isFinite(max) && max > 0
        ? Math.floor(max)
        : perfilEdicao().limites.maxTermos;
    const list = Array.isArray(raw) ? raw : [raw];
    const seen = new Set<string>();
    const out: string[] = [];

    for (const item of list) {
      const pieces = String(item == null ? '' : item).split(TERM_SPLIT_RE);

      for (const piece of pieces) {
        const term = piece
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/^["']+|["']+$/g, '')
          .trim();
        if (!term) continue;

        const key = term.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(term);
        if (out.length >= limite) return out;
      }
    }

    return out;
  }

  function isLinkedInUrl(url: unknown): boolean {
    return /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(String(url || ''));
  }

  function isLinkedInJobsUrl(url: unknown): boolean {
    return isLinkedInUrl(url) && /\/jobs(\/|$|\?)/i.test(String(url));
  }

  /** Monta a URL de busca de um termo, reaproveitando a URL base informada. */
  function buildSearchUrl(
    baseUrl: string | null | undefined,
    term: string | null | undefined,
    location: string | null | undefined
  ): string {
    let url: URL;
    try {
      url = new URL(baseUrl || LINKEDIN_SEARCH_URL);
    } catch (error) {
      return baseUrl || LINKEDIN_SEARCH_URL;
    }

    if (term) url.searchParams.set('keywords', term);
    if (location) url.searchParams.set('location', location);

    return url.toString();
  }

  /* ------------------------------------------------------------------------ */
  /* Horário e dias da semana                                                  */
  /* ------------------------------------------------------------------------ */

  /** "HH:MM" -> minutos desde a meia-noite (ou null se não for um horário). */
  function timeToMinutes(raw: unknown): number | null {
    const match = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(raw == null ? '' : raw));
    if (!match) return null;

    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;

    return hours * 60 + mins;
  }

  function minutesToTime(minutes: unknown): string {
    const safe = Math.max(0, Math.min(1440 - 1, Math.round(Number(minutes) || 0)));
    const hh = String(Math.floor(safe / 60)).padStart(2, '0');
    const mm = String(safe % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  /** Aceita "8:5", "08:05" etc. e devolve sempre "HH:MM". */
  function normalizeTime(raw: unknown, fallback: string): string {
    const minutes = timeToMinutes(raw);
    return minutes == null ? fallback : minutesToTime(minutes);
  }

  /** Lista de dias válidos (0=domingo … 6=sábado), sem repetições. */
  function normalizeDays(raw: unknown): number[] {
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw == null
        ? DEFAULT_SETTINGS.schedule.days
        : [raw];

    const out: number[] = [];
    for (const item of list) {
      if (item === '' || item == null) continue;

      const day = Math.round(Number(item));
      if (!Number.isFinite(day) || day < 0 || day > 6 || out.includes(day)) continue;

      out.push(day);
    }

    return out.sort((a, b) => a - b);
  }

  function formatDays(days: unknown): string {
    const list = normalizeDays(days);
    if (list.length === 7) return 'todos os dias';
    if (!list.length) return 'nenhum dia';
    return list.map((day) => WEEKDAYS[day]).join(', ');
  }

  function startOfDayMs(ts: number): number {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /** O instante está dentro da janela agendada? (sem agendador = sempre sim) */
  function isWithinSchedule(date: Date, schedule?: Partial<ConfigAgendador> | null): boolean {
    const cfg: Partial<ConfigAgendador> = schedule || {};
    if (!cfg.enabled) return true;

    const days = normalizeDays(cfg.days);
    if (!days.length) return false;

    const start = timeToMinutes(cfg.startTime);
    const stop = timeToMinutes(cfg.stopTime);
    if (start == null || stop == null || start === stop) return true;

    const current = date.getHours() * 60 + date.getMinutes();
    const weekday = date.getDay();

    if (start < stop) {
      return days.includes(weekday) && current >= start && current < stop;
    }

    // Janela que cruza a meia-noite (ex.: 22:00 -> 06:00).
    if (current >= start) return days.includes(weekday);
    if (current < stop) return days.includes((weekday + 6) % 7);
    return false;
  }

  /** Próximo instante em que a janela agendada abre (Date ou null). */
  function nextScheduleStart(date: Date, schedule?: Partial<ConfigAgendador> | null): Date | null {
    const cfg: Partial<ConfigAgendador> = schedule || {};
    const start = timeToMinutes(cfg.startTime);
    const days = normalizeDays(cfg.days);
    if (start == null || !days.length) return null;

    const candidate = new Date(date);
    for (let i = 0; i < 8; i += 1) {
      if (i) candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(Math.floor(start / 60), start % 60, 0, 0);
      if (candidate.getTime() > date.getTime() && days.includes(candidate.getDay())) {
        return candidate;
      }
    }

    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* Configuração                                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Respostas específicas do usuário (opcional): { "pergunta": "resposta" }.
   * Só o que é texto útil sobrevive — chave vazia ou valor vazio não serve.
   */
  function normalizeAnswers(raw: unknown): RespostasConfiguradas {
    const value: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out: RespostasConfiguradas = {};

    Object.keys(value).forEach((key) => {
      const name = String(key || '').trim().slice(0, 80);
      const answer = value[key];

      if (!name || answer == null || answer === '') return;
      out[name] = String(answer).trim().slice(0, 120);
    });

    return out;
  }

  /** Normaliza o que veio do storage/formulário para uma configuração válida. */
  function parseSettings(raw: unknown): Configuracoes {
    /* O que chega aqui é JS (formulário, storage de versões antigas): entra como
     * `unknown` e cada campo passa por `num`/`normalizeTime`/… — ninguém confia
     * no formato de fora. */
    const value: Record<string, unknown> =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const apply: Record<string, unknown> =
      value.apply && typeof value.apply === 'object' ? (value.apply as Record<string, unknown>) : {};
    const schedule: Record<string, unknown> =
      value.schedule && typeof value.schedule === 'object'
        ? (value.schedule as Record<string, unknown>)
        : {};
    const defApply = DEFAULT_SETTINGS.apply;
    const defSchedule = DEFAULT_SETTINGS.schedule;

    const minDelayMs = num(apply.minDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.minDelayMs);
    const maxDelayMs = num(apply.maxDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.maxDelayMs);
    const readMinMs = num(apply.readMinMs, 0, 60000, defApply.readMinMs);
    const readMaxMs = num(apply.readMaxMs, 0, 60000, defApply.readMaxMs);

    const cfg: Configuracoes = {
      baseUrl: String(value.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
      location: String(value.location || '').trim(),
      terms: normalizeTerms(value.terms),
      apply: {
        enabled: apply.enabled === true,
        perTerm: num(apply.perTerm, 1, 500, defApply.perTerm),
        perHour: num(apply.perHour, 1, 1000, defApply.perHour),
        per24h: num(apply.per24h, 1, 2000, defApply.per24h),
        perDay: num(apply.perDay, 0, 5000, defApply.perDay),
        scanPerTerm: num(apply.scanPerTerm, 1, 500, defApply.scanPerTerm),
        minDelayMs: Math.min(minDelayMs, maxDelayMs),
        maxDelayMs: Math.max(minDelayMs, maxDelayMs),
        readMinMs: Math.min(readMinMs, readMaxMs),
        readMaxMs: Math.max(readMinMs, readMaxMs),
        respectUserActivity: apply.respectUserActivity !== false,
        breaksEnabled: apply.breaksEnabled !== false,
        breakEvery: num(apply.breakEvery, 1, 100, defApply.breakEvery),
        breakMs: num(apply.breakMs, 10000, 600000, defApply.breakMs),
        fillRequired: apply.fillRequired !== false,
        answerYes: apply.answerYes !== false,
        answerNumber: num(apply.answerNumber, 0, 200, defApply.answerNumber),
        answerText: String(apply.answerText == null ? '' : apply.answerText)
          .trim()
          .slice(0, 120),
        answers: normalizeAnswers(apply.answers),
      },
      schedule: {
        enabled: schedule.enabled === true,
        autoStart: schedule.autoStart !== false,
        startTime: normalizeTime(schedule.startTime, defSchedule.startTime),
        stopTime: normalizeTime(schedule.stopTime, defSchedule.stopTime),
        days: normalizeDays(schedule.days),
        focusTab: schedule.focusTab !== false,
      },
    };

    return aplicarPerfilEdicao(cfg, perfilEdicao());
  }

  /**
   * Aplica o perfil da edição à configuração já normalizada: corta o que a edição
   * não oferece e impõe os valores fixos (furtividade segura, teto diário, a
   * ausência de agendador). É o funil por onde TODA a configuração passa —
   * pop-up, content script e agendador leem daqui, então a regra vale nos três.
   */
  function aplicarPerfilEdicao(cfg: Configuracoes, perfil: PerfilEdicao): Configuracoes {
    /* `perfil` chega tipado (a edição garante o formato), mas o valor vem de fora
     * — o `|| {}` mantém a tolerância de antes (perfil sem `limites` não impõe
     * nada) e o cast só declara a forma cheia ao tsc, sem mudar execução. */
    const limites = (perfil && perfil.limites) || ({} as LimitesEdicao);

    // Termos: cada edição tem o seu teto.
    cfg.terms = normalizeTerms(cfg.terms, limites.maxTermos);

    // Cotas que a edição não expõe ficam impostas — e não voltam pela UI.
    if (limites.per24h != null) cfg.apply.per24h = limites.per24h;
    if (limites.tetoDiarioFixo > 0) cfg.apply.perDay = limites.tetoDiarioFixo;

    // Cotas por termo e por hora: quando a edição não tem campo (> 0), o motor
    // impõe o valor fixo por cima do que vier do formulário (no free o usuário
    // não ajusta nada; no premium os dois são 0 e o usuário manda).
    if (limites.perTermFixo > 0) cfg.apply.perTerm = limites.perTermFixo;
    if (limites.perHourFixo > 0) cfg.apply.perHour = limites.perHourFixo;

    // Teto de vagas visitadas por termo: no free é trava fixa do motor (o campo
    // "Máx. vagas por termo" não existe na edição); no premium (0) o usuário manda.
    if (limites.scanPerTermFixo > 0) cfg.apply.scanPerTerm = limites.scanPerTermFixo;

    // Furtividade fixa (no free o usuário não ajusta; o motor impõe o seguro).
    const fixa = perfil && perfil.furtividadeFixa;
    if (fixa) {
      cfg.apply.respectUserActivity = true;
      cfg.apply.breaksEnabled = true;
      cfg.apply.minDelayMs = fixa.minDelayMs;
      cfg.apply.maxDelayMs = fixa.maxDelayMs;
      cfg.apply.readMinMs = fixa.readMinMs;
      cfg.apply.readMaxMs = fixa.readMaxMs;
      cfg.apply.breakEvery = fixa.breakEvery;
      cfg.apply.breakMs = fixa.breakMs;
    }

    // Sem agendador: desliga de vez (nem janela, nem auto-start).
    if (perfil && !perfil.features.scheduler) {
      cfg.schedule.enabled = false;
      cfg.schedule.autoStart = false;
    }

    return cfg;
  }

  /* ------------------------------------------------------------------------ */
  /* Fila de execução                                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * Monta a fila de termos: um item por termo, varrido em sequência. Sem termos
   * cadastrados, cai no modo antigo (varre a página de vagas aberta).
   */
  function buildRunQueue(settings?: Configuracoes | null): FilaExecucao {
    const cfg = settings || DEFAULT_SETTINGS;
    const terms: string[] = Array.isArray(cfg.terms) ? cfg.terms : [];

    let urls: string[];
    let runTerms: string[];

    if (terms.length) {
      urls = terms.map((term) => buildSearchUrl(cfg.baseUrl, term, cfg.location));
      runTerms = terms.slice();
    } else {
      urls = [buildSearchUrl(cfg.baseUrl, '', cfg.location)];
      runTerms = [''];
    }

    return {
      running: true,
      paused: false,
      resumeAt: null,
      pauseReason: null,
      index: 0,
      term: runTerms[0],
      terms: runTerms,
      urls,
      appliedInTerm: 0,
      visitedInTerm: 0,
      appliedTotal: 0,
      sinceBreak: 0, // candidaturas desde a última pausa longa (ritmo humano)
      startedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Cotas de candidatura (dinâmicas)                                          */
  /* ------------------------------------------------------------------------ */

  function countBetween(timestamps: number[], from: number, to: number): number {
    let total = 0;
    for (const ts of timestamps) {
      if (ts >= from && ts < to) total += 1;
    }
    return total;
  }

  /** A candidatura mais antiga ainda dentro da janela (lista ordenada). */
  function firstBetween(timestamps: number[], from: number, to: number): number | null {
    for (const ts of timestamps) {
      if (ts >= from && ts < to) return ts;
    }
    return null;
  }

  /**
   * Calcula o que ainda cabe dentro das cotas.
   *
   * - `perHour`: janela móvel de 60 min;
   * - `per24h`: janela móvel de 24 h;
   * - `perDay`: dia corrido (zera à meia-noite local); 0 = sem limite;
   * - `perTerm`: reiniciado a cada termo pelo próprio content script.
   *
   * Quando uma cota estoura, devolvemos `resumeAt` (quando ela volta a ter
   * espaço) para o agendador retomar a execução sozinho.
   */
  function computeQuota(
    settings: Configuracoes | null,
    appTimestamps: unknown,
    now?: number,
    appliedInTerm?: unknown
  ): CotaCandidaturas {
    const cfg = (settings && settings.apply) || DEFAULT_SETTINGS.apply;
    /* `appTimestamps` é o histórico lido do storage: entra como `unknown` e cada
     * item é conferido (`typeof`/`Date.parse`) antes de virar número. O `as
     * string` do `Date.parse` só declara o que o ramo anterior já garantiu. */
    const when = Number.isFinite(now) ? (now as number) : Date.now();

    const timestamps: number[] = (Array.isArray(appTimestamps) ? appTimestamps : [])
      .map((value: unknown) => (typeof value === 'number' ? value : Date.parse(value as string)))
      .filter((value: number) => Number.isFinite(value))
      .sort((a: number, b: number) => a - b);

    const hourStart = when - HOUR_MS;
    const day24Start = when - DAY_MS;
    const dayStart = startOfDayMs(when);

    const used: NumerosDeCota = {
      term: Math.max(0, Number(appliedInTerm) || 0),
      hour: countBetween(timestamps, hourStart, Infinity),
      day24: countBetween(timestamps, day24Start, Infinity),
      day: countBetween(timestamps, dayStart, Infinity),
    };

    const limits: NumerosDeCota = {
      term: cfg.perTerm,
      hour: cfg.perHour,
      day24: cfg.per24h,
      day: cfg.perDay > 0 ? cfg.perDay : Infinity,
    };

    const remaining: NumerosDeCota = {
      term: limits.term - used.term,
      hour: limits.hour - used.hour,
      day24: limits.day24 - used.day24,
      day: limits.day === Infinity ? Infinity : limits.day - used.day,
    };

    // Instante em que cada cota estourada volta a liberar uma vaga: a
    // candidatura mais antiga da janela é que precisa "sair" dela.
    const waits: number[] = [];
    const blocks: Array<'hour' | 'day24' | 'day'> = [];

    if (remaining.hour <= 0) {
      const oldest = firstBetween(timestamps, hourStart, Infinity);
      waits.push((oldest == null ? when : oldest) + HOUR_MS + 1000);
      blocks.push('hour');
    }
    if (remaining.day24 <= 0) {
      const oldest = firstBetween(timestamps, day24Start, Infinity);
      waits.push((oldest == null ? when : oldest) + DAY_MS + 1000);
      blocks.push('day24');
    }
    if (remaining.day <= 0) {
      waits.push(dayStart + DAY_MS + 1000); // o dia corrido zera à meia-noite
      blocks.push('day');
    }

    const blockedBy: CotaCandidaturas['blockedBy'] = waits.length
      ? blocks[waits.indexOf(Math.min(...waits))]
      : null;
    const ok = remaining.term > 0 && !waits.length;

    return {
      ok,
      blockedBy,
      resumeAt: waits.length ? Math.min(...waits) : null,
      used,
      limits,
      remaining,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: desfechos, motivos e resumo                       */
  /* ------------------------------------------------------------------------ */

  /**
   * Desfechos possíveis de uma tentativa de candidatura. `failure: false` é só
   * o sucesso; todo o resto entra no relatório de "não foi possível candidatar"
   * com o motivo legível em `reason`.
   *
   * O índice vem de fora (o content script escreve o desfecho lido da página), e
   * por isso o mapa é `Record<string, …>`: quem não estiver aqui cai no texto de
   * "não tentada", como antes.
   */
  const APPLY_OUTCOMES: Record<string, DesfechoCandidatura> = {
    enviada: {
      label: 'Enviada',
      failure: false,
      reason: '',
    },
    externa: {
      label: 'Externa (site da empresa)',
      failure: true,
      reason:
        'A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então ela é pulada.',
    },
    desconhecida: {
      label: 'Botão de candidatura não reconhecido',
      failure: true,
      reason:
        'Não identifiquei a Candidatura Simplificada nesta vaga; para não sair do LinkedIn, não cliquei.',
    },
    sem_botao: {
      label: 'Sem botão de candidatura',
      failure: true,
      reason: 'A página da vaga não oferece botão de candidatura.',
    },
    sem_modal: {
      label: 'Formulário não abriu',
      failure: true,
      reason: 'O botão foi clicado, mas o formulário de candidatura não abriu.',
    },
    travada: {
      label: 'Travada em campo obrigatório',
      failure: true,
      reason:
        'O formulário parou numa pergunta obrigatória que a extensão não conseguiu responder (mesmo preenchendo as anteriores).',
    },
    incompleta: {
      label: 'Formulário incompleto',
      failure: true,
      reason:
        'O formulário não foi concluído dentro do tempo e do número de etapas permitidos.',
    },
    /* (TEMPORÁRIO) Desfechos do pedido de ajuda — ver "Pedido de ajuda ao
     * usuário" abaixo. Saem junto com ele. */
    manual: {
      label: 'Preenchida por você (temporário)',
      failure: true,
      reason:
        'A vaga demorou para confirmar (ou o LinkedIn recusou um campo personalizado) e você escolheu preencher à mão; o PegaVaga não mexeu mais na página.',
    },
    pulada: {
      label: 'Pulada por você (temporário)',
      failure: true,
      reason:
        'A vaga demorou para confirmar (ou o LinkedIn recusou um campo personalizado) e você escolheu pular; a varredura seguiu para a próxima.',
    },
    cancelada: {
      label: 'Interrompida (Parar)',
      failure: true,
      reason: 'A candidatura foi abandonada porque você pediu para parar.',
    },
    bloqueio: {
      label: 'Parada por proteção do LinkedIn',
      failure: true,
      reason:
        'O LinkedIn pediu verificação ou limite de uso: a automação parou para proteger a sua conta.',
    },
    erro: {
      label: 'Erro na automação',
      failure: true,
      reason: 'Houve um erro inesperado durante a automação da candidatura.',
    },
  };

  /** Código de quem ainda não foi candidatado por falta de cota/horário. */
  const APPLY_PENDING = 'adiada';

  const APPLY_PENDING_LABEL = 'Adiada (sem cota ou fora do horário)';
  const APPLY_UNTOUCHED_LABEL = 'Não tentada';

  /* ------------------------------------------------------------------------ */
  /* (TEMPORÁRIO) Pedido de ajuda ao usuário                                   */
  /* ------------------------------------------------------------------------ */
  //
  // Algumas vagas param num campo personalizado que a extensão ainda não sabe
  // responder — ou demoram para confirmar o envio. Nesses casos o PegaVaga avisa
  // na área de trabalho e pergunta o que fazer: esperar enquanto você preenche à
  // mão, ou pular esta vaga e seguir para a próxima. Este bloco é o contrato do
  // aviso (mensagens, textos, id e botões); o dia em que os campos personalizados
  // forem tratados de verdade, tudo aqui — e quem usa — sai junto.

  /** Motivos que disparam o aviso, com o texto que o usuário lê. */
  const AJUDA_MOTIVOS: Record<string, string> = {
    campos: 'O formulário parou num campo que a extensão não sabe responder.',
    demora: 'O LinkedIn não confirmou a candidatura no tempo esperado.',
  };

  /** Botões do aviso, na ordem em que o Chrome os mostra. */
  const AJUDA_BOTOES = ['Vou preencher à mão', 'Pular esta vaga'];

  /** O que cada botão significa: `manual` espera você; `pular` segue adiante. */
  const AJUDA_ACOES = ['manual', 'pular'];

  /** Ação do botão pelo índice clicado ('' quando o índice não é nosso). */
  function acaoDaAjuda(indice: unknown): string {
    const i = Number(indice);
    return Number.isInteger(i) && i >= 0 && i < AJUDA_ACOES.length ? AJUDA_ACOES[i] : '';
  }

  /**
   * Id do aviso na área de trabalho. Carrega a **aba de origem** de propósito: o
   * clique pode acordar o service worker do zero, e é o id que diz para quem a
   * decisão deve voltar (o `sender` da notificação original já não existe).
   */
  function ajudaId(tabId: unknown, pedidoId: unknown): string {
    return 'pegavaga-ajuda:' + String(tabId == null ? '' : tabId) + ':' + String(pedidoId || '');
  }

  /** Lê o id do aviso: { tabId, pedidoId } — ou null se não for um aviso nosso. */
  function lerAjudaId(id: unknown): { tabId: number; pedidoId: string } | null {
    const partes = String(id || '').split(':');
    if (partes.length !== 3 || partes[0] !== 'pegavaga-ajuda') return null;
    if (!partes[1] || !partes[2]) return null; // sem aba ou sem pedido não há resposta

    const tabId = Number(partes[1]);
    if (!Number.isInteger(tabId)) return null;

    return { tabId, pedidoId: partes[2] };
  }

  /**
   * Texto do aviso (título + corpo) que o worker mostra na notificação. Sem
   * "detalhe técnico" aqui: o que o usuário precisa saber é qual vaga travou e
   * quais são as duas escolhas.
   */
  function textoDaAjuda(dados: unknown): { title: string; message: string } {
    /* O aviso é montado a partir de uma mensagem do content script (JS): o que
     * chega entra como `unknown` — o `as string` nos índices só declara o que o
     * `String(...)` ao redor já garante. */
    const info: Record<string, unknown> =
      dados && typeof dados === 'object' ? (dados as Record<string, unknown>) : {};
    const vaga = [info.titulo, info.empresa].filter(Boolean).join(' — ');
    const motivo = AJUDA_MOTIVOS[info.motivo as string] || AJUDA_MOTIVOS.campos;
    const problema = info.problema ? ' Problema: ' + String(info.problema).slice(0, 120) + '.' : '';

    return {
      title: 'PegaVaga precisa de você (temporário)',
      message:
        (vaga ? vaga + ': ' : '') +
        motivo +
        problema +
        ' Você pode preencher esta vaga à mão (a automação espera) ou pular para a próxima.',
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: motivos e resumo do relatório                     */
  /* ------------------------------------------------------------------------ */

  /** Variação aleatória em torno de um valor, para um ritmo menos robótico. */
  function jitter(baseMs: unknown, ratio?: unknown, random?: unknown): number {
    const base = Math.max(0, Number(baseMs) || 0);
    const spread = Math.max(0, Math.min(1, Number.isFinite(ratio) ? (ratio as number) : 0.3));
    const raw = typeof random === 'function' ? Number(random()) : Math.random();
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    return Math.max(0, Math.round(base * (1 - spread + value * spread * 2)));
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura dentro ou fora do LinkedIn                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Rótulos (pt/en) de botão que manda para fora do LinkedIn: é assim que o
   * LinkedIn anuncia as vagas que terminam no site da empresa.
   */
  const EXTERNAL_APPLY_LABEL =
    /site da empresa|site da companhia|site externo|no site da|no site do|fora do linkedin|company (web ?)?site|external (site|link|apply)|apply (externally|on)( the)? company/i;

  /**
   * Rótulos (pt/en) de botão de Candidatura Simplificada (formulário do próprio
   * LinkedIn).
   */
  const EASY_APPLY_LABEL =
    /candidatura simplificada|simplificada|easy apply|(no|pelo|com o|with) linkedin|linkedin (application|bug)/i;

  /** Resultado da leitura do botão de candidatura. */
  const APPLY_KINDS = {
    easy: 'simplificada', // Candidatura Simplificada: o formulário abre aqui dentro
    external: 'externa', // o botão leva para o site da empresa
    unknown: 'desconhecida', // não deu para saber (botão ainda sem rótulo/ícone)
  };

  /**
   * Domínio de um endereço (para o motivo do relatório). Entende o
   * redirecionador do LinkedIn e devolve o domínio de destino. '' se ilegível.
   */
  function hostOf(href: unknown, depth?: unknown): string {
    const level = Number(depth) || 0;

    try {
      const url = new URL(String(href), 'https://www.linkedin.com/');
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

      if (level < 3 && onLinkedIn && /\/redir\/redirect/i.test(url.pathname)) {
        const target = url.searchParams.get('url');
        if (target && isOffsiteUrl(target)) return hostOf(target, level + 1);
      }

      return host;
    } catch (error) {
      return '';
    }
  }

  /**
   * O endereço leva para fora do LinkedIn? Também entende o redirecionador do
   * LinkedIn (`/redir/redirect?url=<destino>`), que é como ele embrulha os links
   * externos.
   */
  function isOffsiteUrl(href: unknown, depth?: unknown): boolean {
    const level = Number(depth) || 0;
    if (!href || level > 3) return false;

    let url: URL;
    try {
      url = new URL(String(href), 'https://www.linkedin.com/');
    } catch (error) {
      return false;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

    if (!onLinkedIn) return true;

    if (/\/redir\/redirect/i.test(url.pathname)) {
      const target = url.searchParams.get('url');
      return target ? isOffsiteUrl(target, level + 1) : false;
    }

    return false;
  }

  /**
   * Que tipo de candidatura é esta, a partir dos sinais lidos na página do
   * LinkedIn: { href, label, externalIcon, easyIcon, insight }.
   *
   * A ordem é do sinal mais forte para o mais fraco: link de fora → ícone/rótulo
   * de fora → ícone/rótulo do LinkedIn → aviso de "Candidatura simplificada" na
   * vaga. Sem nenhum sinal, devolvemos `unknown` e quem chama decide — na
   * extensão a regra é: na dúvida, não clica, para nunca te levar para fora.
   */
  function classifyApply(signals: unknown): string {
    /* Os sinais são lidos da página (content script → JS): entram como `unknown`
     * e cada campo é conferido onde é usado. */
    const data: Record<string, unknown> =
      signals && typeof signals === 'object' ? (signals as Record<string, unknown>) : {};
    const label = String(data.label || '').trim();
    const insight = String(data.insight || '');

    if (data.href && isOffsiteUrl(data.href)) return APPLY_KINDS.external;
    if (data.externalIcon) return APPLY_KINDS.external;
    if (label && EXTERNAL_APPLY_LABEL.test(label)) return APPLY_KINDS.external;

    if (data.easyIcon) return APPLY_KINDS.easy;
    if (label && EASY_APPLY_LABEL.test(label)) return APPLY_KINDS.easy;
    if (insight && EASY_APPLY_LABEL.test(insight)) return APPLY_KINDS.easy;

    return APPLY_KINDS.unknown;
  }

  /* ------------------------------------------------------------------------ */
  /* Popups do LinkedIn: formulário x avisos/pesquisas                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Texto em minúsculas, sem acento e com espaços colapsados. É o formato usado
   * para comparar rótulos de botão e perguntas (o LinkedIn varia em caixa e
   * acentuação entre as versões pt/en).
   */
  function plainText(value: unknown): string {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * O que cada dialog do LinkedIn é. Só um deles é o formulário da Candidatura
   * Simplificada — o resto (pesquisa de avaliação, "salvar vaga", "seguir
   * empresa"…) pode aparecer por cima e precisa ser fechado, não preenchido.
   */
  const DIALOG_KINDS = {
    form: 'formulario', // formulário da Candidatura Simplificada
    survey: 'pesquisa', // popup de avaliação/pesquisa que aparece depois de enviar
    notice: 'aviso', // recado/confirmação (ex.: vaga salva, seguir empresa)
    unknown: 'desconhecido',
  };

  /** Sinais de que o dialog é o formulário da Candidatura Simplificada. */
  const APPLY_FORM_RE =
    /candidatura simplificada|easy apply|enviar candidatura|submit application|revisar|review|avancar|avançar|proxima etapa|proximo|next|curr[íi]culo|resume|anexar|upload|termos/i;

  /** Sinais de popup pós-candidatura (avaliação, pesquisa ou recado). */
  const POST_APPLY_RE =
    /avalie|avaliacao|avaliação|avaliar|como foi sua experiencia|experiencia de candidatura|pesquisa|survey|feedback|nos ajude a melhorar|help us improve|rate your|give feedback|obrigado por se candidatar|thanks for applying|salvar (esta )?vaga|save (this )?job|seguir|follow|compartilhar|share|recomendar|recommend|candidatura (foi )?enviad|application (was )?sent|voce se candidatou/i;

  /**
   * Rótulos que fecham/recusam um popup (pt + en), do mais específico ao mais
   * genérico. A ordem importa: "agora nao" é melhor que "nao".
   */
  const DISMISS_PATTERNS = [
    { key: 'fechar', re: /^(fechar|close|dismiss|sair)\b/ },
    { key: 'concluir', re: /^(concluir|done|entendi|got it|certo|ok)\b/ },
    { key: 'agora_nao', re: /(agora nao|not now|mais tarde|maybe later|later|depois)/ },
    { key: 'nao_obrigado', re: /(nao,\s?obrigad|no,\s?thanks|nao,\s?grato)/ },
    { key: 'dispensar', re: /(dispensar|dispens|ignorar|skip|pular)/ },
    { key: 'cancelar', re: /^(cancelar|cancel)\b/ },
    { key: 'nao', re: /^(nao|no)$/ },
  ];

  /** Botões que nunca clicamos para fechar: descartar apaga a candidatura. */
  const NEVER_DISMISS_RE = /descartar|discard|excluir|deletar|delete|remover|apagar/;

  /**
   * Classifica um dialog a partir dos sinais lidos na página:
   * { text, hasForm, hasApplyAction, hasClose }.
   *
   * Regras (na ordem):
   *   1. rodapé com "Avançar/Enviar candidatura"   -> formulário;
   *   2. texto de pós-candidatura sem cara de form -> pesquisa;
   *   3. tem campos de formulário com cara de candidatura -> formulário;
   *   4. tem rótulo de candidatura -> formulário;
   *   5. tem texto de pós-candidatura -> pesquisa;
   *   6. tem botão de fechar -> aviso;
   *   7. nada disso -> desconhecido (quem chama decide com cautela).
   */
  function classifyDialog(signals: unknown): string {
    /* Sinais lidos da página: entram como `unknown`, como no `classifyApply`. */
    const data: Record<string, unknown> =
      signals && typeof signals === 'object' ? (signals as Record<string, unknown>) : {};
    const text = plainText(data.text);
    const looksForm = APPLY_FORM_RE.test(text);
    const looksPost = POST_APPLY_RE.test(text);

    if (data.hasApplyAction) return DIALOG_KINDS.form;
    if (looksPost && !looksForm) return DIALOG_KINDS.survey;
    if (data.hasForm && looksForm) return DIALOG_KINDS.form;
    if (looksForm) return DIALOG_KINDS.form;
    if (looksPost) return DIALOG_KINDS.survey;
    if (data.hasClose) return DIALOG_KINDS.notice;

    return DIALOG_KINDS.unknown;
  }

  /**
   * Devolve o tipo de ação de fechar/recusar que o rótulo representa ('' se
   * nenhum). É o que autoriza clicar num botão de popup sem risco de descartar
   * uma candidatura.
   */
  function matchDismissLabel(label: unknown): string {
    const text = plainText(label);
    if (!text || NEVER_DISMISS_RE.test(text)) return '';

    for (const pattern of DISMISS_PATTERNS) {
      if (pattern.re.test(text)) return pattern.key;
    }

    return '';
  }

  /* ------------------------------------------------------------------------ */
  /* Avisos de limite/abuso: o que faz a extensão parar                        */
  /* ------------------------------------------------------------------------ */

  /**
   * Redações com que o LinkedIn avisa que desconfiou de automação ou que a conta
   * passou do limite de candidaturas (pt e en), já sem acento e em minúsculas.
   *
   * Elas são procuradas em dois lugares — no texto da página e no texto dos
   * dialogs —, porque a extensão **não** fecha esse aviso: fechá-lo esconderia
   * justamente o recado que a proteção precisa ler. Se a busca não o achasse, a
   * varredura ficava presa com o aviso na frente da lista, sem parar nem seguir.
   */
  const RATE_LIMIT_PATTERNS = [
    'checkpoint',
    'verificacao de seguranca',
    'security verification',
    'unusual activity',
    'atividade suspeita',
    'atividade incomum',
    'muitas solicitacoes',
    'too many requests',
    'rate limit',
    'limite de uso',
    'atingiu o limite',
    'limite de candidaturas',
    'numero maximo de candidaturas',
    'reached the limit',
    'application limit',
    'maximum number of applications',
    'temporarily restricted',
    'restricao temporaria',
    'tente novamente mais tarde',
    'prove que voce',
  ];

  /**
   * Alguma dessas redações aparece neste texto? (a decisão de parar — e por
   * quanto tempo — não é daqui: quem manda é o `tripGuard` do content script)
   */
  function looksRateLimited(value: unknown): boolean {
    const text = plainText(value);
    if (!text) return false;

    return RATE_LIMIT_PATTERNS.some((pattern) => text.includes(pattern));
  }

  /**
   * Modos do guard de popup (ver `popupGuardMode`). Quem lê é o content script:
   *   `quieto`   — não mexe em nada;
   *   `proteger` — há um formulário na tela: qualquer outro dialog é popup;
   *   `limpar`   — sem formulário na tela: só o que a página já disse que é popup.
   */
  const POPUP_GUARD = {
    quieto: 'quieto',
    proteger: 'proteger',
    limpar: 'limpar',
  };

  /**
   * O guard de popup deve agir agora — e como?
   *
   * O guard é quem fecha, no instante em que entram na tela, os popups que o
   * LinkedIn joga por cima da candidatura (pesquisa de avaliação, "salvar vaga",
   * "seguir empresa"): sem ele a varredura empaca com um overlay na frente da
   * lista. Recebe o que o content script sabe da página:
   *
   *   varrendo               — a varredura está trabalhando agora?
   *   abrindoFormulario      — acabamos de clicar em "Candidatura Simplificada" e o
   *                            formulário ainda pode estar carregando?
   *   formularioIdentificado — já sabemos qual dialog é o formulário desta vaga?
   *   formularioNaTela       — esse formulário está na tela neste instante?
   *   posEnvio               — a candidatura acabou de sair (ou a vaga passou para
   *                            você) e a tela ainda não foi limpa para a próxima?
   *   usuarioOcioso          — a página está livre (você não mexe nela há alguns
   *                            segundos)?
   *
   * Regras, na ordem:
   *   1. fora da varredura: `quieto` — a página é do usuário, não mexemos nela;
   *   2. com o formulário na tela: `proteger` — ele é o único dialog que não pode
   *      ser tocado; todo o resto é popup;
   *   3. abrindo o formulário (o clique saiu e ele ainda não está na tela):
   *      `quieto` — o dialog que está entrando pode ser a nossa própria
   *      candidatura carregando;
   *   4. formulário já identificado (mesmo que o LinkedIn tenha trocado o nó dele
   *      no meio do caminho) ou pós-envio: `limpar` — é justamente aí que chega o
   *      popup atrasado do pós-candidatura, e é o guard que tem de pegá-lo;
   *   5. entre uma vaga e outra, com a página livre: `limpar` — um popup parado na
   *      frente da lista empaca a varredura inteira (o clique no card não abre a
   *      vaga, o detalhe não carrega e a vaga é dada por perdida), e não há
   *      candidatura nossa na tela para descartar;
   *   6. fora disso: `quieto`.
   *
   * O `limpar` é conservador de propósito: sem formulário na tela, fechar um
   * dialog ainda sem cara (a próxima etapa carregando) descartaria uma candidatura
   * de verdade — então lá só entra o que a página já classificou. E ele não briga
   * com você: fora do formulário, a página só é tocada quando está livre.
   */
  function popupGuardMode(sinais: unknown): string {
    /* Sinais lidos da página (JS): entram como `unknown`, como no `classifyApply`. */
    const s: Record<string, unknown> =
      sinais && typeof sinais === 'object' ? (sinais as Record<string, unknown>) : {};

    if (s.varrendo !== true) return POPUP_GUARD.quieto;
    if (s.formularioNaTela === true) return POPUP_GUARD.proteger;
    if (s.abrindoFormulario === true) return POPUP_GUARD.quieto;
    if (s.posEnvio === true || s.formularioIdentificado === true) return POPUP_GUARD.limpar;
    if (s.usuarioOcioso === true) return POPUP_GUARD.limpar;

    return POPUP_GUARD.quieto;
  }

  /** Resposta específica configurada para a pergunta ('' se não houver). */
  function answerForQuestion(question: unknown, answers: unknown): string {
    const hint = plainText(question);
    const map: Record<string, unknown> =
      answers && typeof answers === 'object' ? (answers as Record<string, unknown>) : {};

    if (!hint) return '';

    for (const key of Object.keys(map)) {
      const name = plainText(key);
      const value = map[key];

      if (name && value != null && value !== '' && hint.includes(name)) {
        return String(value);
      }
    }

    return '';
  }

  /**
   * Escolhe uma resposta entre as opções de uma pergunta (rádio/lista) que veio
   * em branco, na ordem:
   *   1. resposta específica do usuário (`answers`) que case com a pergunta;
   *   2. "Sim" (ou "Não", se `prefs.yes === false`) — é o que o LinkedIn mais
   *      pergunta ("tem autorização?", "tem experiência com…?");
   *   3. a primeira opção que não seja um aviso de "Selecione…".
   * Devolve o rótulo escolhido ('' quando não há opção utilizável).
   */
  function pickChoice(options: unknown, prefs?: PreferenciasEscolha | null): string {
    const list = (Array.isArray(options) ? options : []).map((label) =>
      String(label == null ? '' : label).trim()
    );
    const cfg: PreferenciasEscolha = prefs || {};

    if (!list.length) return '';

    const wanted = answerForQuestion(cfg.question, cfg.answers);

    if (wanted) {
      const needle = plainText(wanted);
      const match = list.find((label) => plainText(label).includes(needle));
      if (match) return match;
    }

    const plain = list.map(plainText);
    const wantsNo = cfg.yes === false;
    const preferred = wantsNo ? /^(nao|no)\b/ : /^(sim|yes)\b/;
    const index = plain.findIndex((label) => preferred.test(label));

    if (index >= 0) return list[index];

    return (
      list.find((label) => !/^(selecione|escolha|select|choose|--)/.test(plainText(label))) || ''
    );
  }

  function applyOutcomeLabel(code: unknown): string {
    if (!code) return '';
    if (code === APPLY_PENDING) return APPLY_PENDING_LABEL;
    /* O código vem da página (JS): o `as string` só declara o que o mapa já
     * tolera — o que não estiver em `APPLY_OUTCOMES` cai no `String(code)`. */
    const outcome = APPLY_OUTCOMES[code as string];
    return outcome ? outcome.label : String(code);
  }

  /**
   * Por que esta vaga não foi candidatada? Devolve null quando a candidatura foi
   * enviada. Com `options.applyEnabled = false`, as vagas intocadas aparecem
   * como "candidatura automática desligada".
   */
  function describeApplyFailure(job: unknown, options?: OpcoesResumo | null): MotivoFalha | null {
    /* A vaga vem do storage/página (JS): entra como `unknown`. Os dois `as
     * string` só declaram o formato do que a extensão mesma escreveu. */
    const value: Record<string, unknown> =
      job && typeof job === 'object' ? (job as Record<string, unknown>) : {};
    const code = value.applyStatus;

    if (code === 'enviada') return null;

    if (code === APPLY_PENDING) {
      return {
        code: APPLY_PENDING,
        label: APPLY_PENDING_LABEL,
        reason: (value.applyReason as string) || 'Aguardando a cota de candidaturas liberar.',
        pending: true,
      };
    }

    const outcome = APPLY_OUTCOMES[code as string];

    if (outcome) {
      return {
        code: code as string,
        label: outcome.label,
        reason: (value.applyReason as string) || outcome.reason,
        pending: false,
      };
    }

    const enabled = !options || options.applyEnabled !== false;

    return {
      code: 'nao_tentada',
      label: APPLY_UNTOUCHED_LABEL,
      reason: enabled
        ? value.description
          ? 'Ainda não chegou a vez desta vaga (teto de vagas por varredura).'
          : 'Vaga capturada sem a descrição completa.'
        : 'Candidatura automática desligada.',
      pending: true,
    };
  }

  /**
   * Totais do relatório: candidatadas x não candidatadas — que se divide em
   * definitivas (precisam de você) e adiadas (a extensão tenta depois).
   */
  function summarizeApply(jobs: unknown, options?: OpcoesResumo | null): ResumoCandidaturas {
    /* Aceita a lista ou o mapa de vagas (`{ id: vaga }`, como está no storage). */
    const list: unknown[] = Array.isArray(jobs)
      ? jobs
      : Object.values((jobs || {}) as Record<string, unknown>);
    const summary: ResumoCandidaturas = {
      total: list.length,
      applied: 0,
      failed: 0,
      pending: 0,
      reasons: [],
    };
    const byLabel = new Map<string, ResumoMotivo>();

    for (const job of list) {
      const failure = describeApplyFailure(job, options);

      if (!failure) {
        summary.applied += 1;
        continue;
      }

      if (failure.pending) summary.pending += 1;
      else summary.failed += 1;

      const entry = byLabel.get(failure.label) || {
        code: failure.code,
        label: failure.label,
        pending: failure.pending,
        count: 0,
      };

      entry.count += 1;
      byLabel.set(failure.label, entry);
    }

    summary.reasons = Array.from(byLabel.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')
    );

    return summary;
  }

  /** Ex.: "12 candidatada(s) · 8 não candidatada(s): 4 travada em campo…". */
  function describeApplySummary(summary?: ResumoCandidaturas | null): string {
    if (!summary || !summary.total) return 'Nenhuma vaga capturada ainda.';

    let text = summary.applied + ' candidatada(s)';
    if (summary.failed) text += ' · ' + summary.failed + ' não candidatada(s)';
    if (summary.pending) text += ' · ' + summary.pending + ' na fila';

    const top = (summary.reasons || [])
      .filter((entry) => !entry.pending)
      .slice(0, 3)
      .map((entry) => entry.count + ' ' + entry.label.toLowerCase());

    return text + (top.length ? ': ' + top.join(' · ') : '');
  }

  /* ------------------------------------------------------------------------ */
  /* Textos de apoio para a interface                                          */
  /* ------------------------------------------------------------------------ */

  /** Como cada janela de cota aparece no relatório (ver `describeQuota`). */
  const LIMIT_LABELS: Record<string, string> = {
    term: 'por termo',
    hour: 'por hora',
    day24: 'em 24 h',
    day: 'no dia',
  };

  /** "3/10" — e "3/∞" quando a edição não limita aquela janela. */
  function formatCount(used: number, limit: number): string {
    return used + '/' + (limit === Infinity ? '∞' : limit);
  }

  /** "14:32" no relógio local; "--:--" quando o instante não é válido. */
  function formatClock(ts: unknown): string {
    if (!Number.isFinite(ts)) return '--:--';

    const date = new Date(ts as number);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    return hh + ':' + mm;
  }

  /** Ex.: "Candidaturas — 2/10 na hora · 5/40 em 24 h · 8 hoje". */
  function describeQuota(quota: CotaCandidaturas): string {
    const used = quota.used;
    const limits = quota.limits;
    const parts = [formatCount(used.hour, limits.hour) + ' na hora'];

    // A janela que a edição não usa (∞) fica de fora — no free, por exemplo, não
    // existe a cota de 24 h.
    if (limits.day24 !== Infinity) parts.push(formatCount(used.day24, limits.day24) + ' em 24 h');
    if (limits.day !== Infinity) parts.push(formatCount(used.day, limits.day) + ' hoje');
    parts.push(formatCount(used.term, limits.term) + ' neste termo');

    return 'Candidaturas — ' + parts.join(' · ');
  }

  /** Ex.: "Janela: Seg, Ter, 09:00 → 18:00 · próxima: seg., 09:00". */
  function describeSchedule(
    schedule?: Partial<ConfigAgendador> | null,
    now?: Date | null
  ): string {
    const cfg: Partial<ConfigAgendador> = schedule || {};
    if (!cfg.enabled) return 'Agendador desativado.';

    const window = formatDays(cfg.days) + ', ' + cfg.startTime + ' → ' + cfg.stopTime;

    if (isWithinSchedule(now || new Date(), cfg)) return 'Janela ativa: ' + window + '.';

    const next = nextScheduleStart(now || new Date(), cfg);
    if (!next) return 'Janela: ' + window + '.';

    const stamp = next.toLocaleString('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return 'Janela: ' + window + ' · próxima: ' + stamp + '.';
  }

  /* ------------------------------------------------------------------------ */
  /* Luz de status (ícone da extensão e cabeçalho do pop-up)                   */
  /* ------------------------------------------------------------------------ */

  /** Como cada motivo de pausa aparece para o usuário. */
  const PAUSE_REASON_LABELS: Record<string, string> = {
    cota: 'cota de candidaturas',
    guard: 'proteção da conta (limite do LinkedIn)',
    usuario: 'você estava usando o navegador',
    schedule: 'janela do agendador',
  };

  /** As três luzinhas: verde capturando, amarela pronta, vermelha atenção. */
  const STATUS_LIGHTS: Record<string, PresetLuz> = {
    capturing: { key: 'capturing', color: '#1f9d55', label: 'Capturando' },
    ready: { key: 'ready', color: '#f0a500', label: 'Pronta' },
    attention: { key: 'attention', color: '#d93025', label: 'Precisa de atenção' },
  };

  /**
   * Traduz o estado da extensão na luzinha do ícone:
   *   capturing (verde)    - está capturando vagas agora;
   *   ready (amarela)      - pronta ou esperando algo normal (cota, janela do
   *                          agendador, descanso, você no navegador): volta só;
   *   attention (vermelha) - proteção da conta ligada (o LinkedIn avisou limite)
   *                          ou varredura que parou com problema.
   * Aceita tanto o estado lido do storage quanto o `PEGAVAGA_PROGRESS` que o
   * content script envia (que traz `scanning`, `run`, `guard` e `breakUntil`).
   */
  function statusLight(input?: EntradaLuz | null): LuzStatus {
    const state: EntradaLuz = input || {};
    const now = Number.isFinite(state.now) ? (state.now as number) : Date.now();
    const run = state.run && state.run.running === true ? state.run : null;
    const guard = state.guard && Number(state.guard.blockedUntil) > now ? state.guard : null;
    const paused = Boolean(run && run.paused);
    const reason = (run && run.pauseReason) || 'cota';
    const why = PAUSE_REASON_LABELS[reason] || 'cota de candidaturas';
    /* Pausa só existe com fila em andamento: o `as` só declara isso ao
     * compilador (em runtime continua sendo o próprio `run`, nulo ou não). */
    const fila = run as VarreduraLuz;

    // 1) Proteção da conta: a extensão parou sozinha para o LinkedIn não
    //    bloquear você — precisa da sua atenção (e de paciência).
    if (guard || (paused && reason === 'guard')) {
      const until = guard ? guard.blockedUntil : fila.resumeAt;
      const reasonText = guard && guard.reason ? ' (' + guard.reason + ')' : '';

      return light(
        'attention',
        'LinkedIn sinalizou limite de uso' +
          reasonText +
          '. Descanso até ' +
          formatClock(until) +
          '.'
      );
    }

    // 2) A varredura bateu em algo (ex.: página sem a lista de vagas).
    if (run && run.problem) return light('attention', String(run.problem));

    // 3) Pausa normal: cota, janela do agendador, descanso ou vez do usuário.
    if (paused) {
      return light('ready', 'Pausada por ' + why + ' até ' + formatClock(fila.resumeAt) + '.');
    }

    if (Number(state.breakUntil) > now) {
      return light('ready', 'Descansando até ' + formatClock(state.breakUntil) + '.');
    }

    // 4) Fila ativa (ou varredura em andamento): capturando agora.
    if (run || state.scanning === true) {
      if (!run) return light('capturing', 'Capturando a página de vagas aberta.');

      const total = Array.isArray(run.urls) ? run.urls.length : Number(run.total) || 1;
      const position =
        'termo ' + ((Number(run.index) || 0) + 1) + (total > 1 ? ' de ' + total : '');
      const label = run.term ? '"' + run.term + '"' : 'página atual';

      return light('capturing', 'Capturando vagas — ' + position + ': ' + label + '.');
    }

    // 5) Nada rodando.
    return light('ready', 'Pronta: nenhuma varredura em andamento.');
  }

  /* ------------------------------------------------------------------------ */
  /* Espera por evento: o DOM avisa, ninguém fica perguntando de 250 em 250 ms  */
  /* ------------------------------------------------------------------------ */

  /**
   * Fila de quem está esperando um sinal da página. O `content.js` chama
   * `wake()` a cada mutação do MutationObserver; então quem espera reage no
   * mesmo instante em que o LinkedIn mexe na tela — em vez de descobrir depois,
   * numa checagem por tempo, que a internet demorou.
   *
   * Não usa DOM: é só uma lista de ouvintes, o que a torna testável de verdade.
   */
  function createSignal(): Sinal {
    const listeners = new Set<() => void>();

    return {
      /** Quantos estão esperando agora (0 = não há por que acordar ninguém). */
      get size() {
        return listeners.size;
      },

      /** A página mexeu: avisa todo mundo. Um erro não derruba os outros. */
      wake() {
        if (!listeners.size) return;

        Array.from(listeners).forEach((listener) => {
          try {
            listener();
          } catch (error) {
            /* segue avisando os demais */
          }
        });
      },

      /** Espera o próximo sinal. Devolve a função que cancela a inscrição. */
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  /**
   * Espera `check()` devolver algo. É acordada pelo sinal (mutação na página),
   * com `pollMs` apenas como rede de segurança — para o que muda sem gerar
   * mutação, como digitar num campo — e `timeoutMs` como prazo final.
   * Devolve o valor de `check()` ou `null`.
   */
  function waitUntil(
    signal: Sinal | null | undefined,
    check: () => unknown,
    timeoutMs?: unknown,
    pollMs?: unknown
  ): Promise<unknown> {
    const attempt = (): unknown => {
      try {
        return check() || null;
      } catch (error) {
        return null;
      }
    };

    const immediate = attempt();
    if (immediate) return Promise.resolve(immediate);

    const step = Number(pollMs) || 0;
    const budget = Number(timeoutMs) || 0;

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let poll: ReturnType<typeof setInterval> | null = null;
      let off: (() => void) | null = null;

      const finish = (value: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        if (off) off();
        resolve(value || null);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => {
        const value = attempt();
        if (value) finish(value);
      }) : null;

      if (step > 0) {
        poll = setInterval(() => {
          const value = attempt();
          if (value) finish(value);
        }, step);
      }

      if (budget > 0) timer = setTimeout(() => finish(null), budget);
    });
  }

  /**
   * Espera a página ficar quieta: nenhuma mutação dentro de `ms`. É assim que o
   * content script sabe que a etapa terminou de carregar — olhando o que a
   * página está fazendo, não quanto tempo a internet levou. Devolve `true` se
   * houve silêncio (e `false` se algo mexeu antes).
   */
  function waitForQuiet(signal: Sinal | null | undefined, ms?: unknown): Promise<boolean> {
    const silence = Math.max(16, Number(ms) || 0);

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let off: (() => void) | null = null;

      const finish = (quiet: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (off) off();
        resolve(quiet);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => finish(false)) : null;
      timer = setTimeout(() => finish(true), silence);
    });
  }

  /** Monta a luzinha com a cor do nível e o texto (tooltip) já pronto. */
  function light(key: string, detail: string): LuzStatus {
    const preset = STATUS_LIGHTS[key] || STATUS_LIGHTS.ready;

    return {
      key: preset.key,
      color: preset.color,
      label: preset.label,
      detail: detail,
      title: 'PegaVaga — ' + detail,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* A API pública do arquivo — é isto que `globalThis.PegaVagaShared` recebe  */
  /* ------------------------------------------------------------------------ */

  return {
    STORAGE,
    MSG,
    DEFAULT_SETTINGS,
    PAUSE_REASON_LABELS,
    STATUS_LIGHTS,
    statusLight,
    LINKEDIN_SEARCH_URL,
    MAX_TERMS,
    HOUR_MS,
    DAY_MS,
    HISTORY_LIMIT,
    WEEKDAYS,
    LIMIT_LABELS,
    APPLY_OUTCOMES,
    APPLY_PENDING,
    APPLY_KINDS,
    DIALOG_KINDS,
    RATE_LIMIT_PATTERNS,
    looksRateLimited,
    POPUP_GUARD,
    AJUDA_MOTIVOS,
    AJUDA_BOTOES,
    AJUDA_ACOES,
    acaoDaAjuda,
    ajudaId,
    lerAjudaId,
    textoDaAjuda,
    num,
    normalizeTerms,
    isLinkedInUrl,
    isLinkedInJobsUrl,
    buildSearchUrl,
    normalizeTime,
    timeToMinutes,
    minutesToTime,
    normalizeDays,
    formatDays,
    startOfDayMs,
    isWithinSchedule,
    nextScheduleStart,
    parseSettings,
    buildRunQueue,
    computeQuota,
    jitter,
    applyOutcomeLabel,
    hostOf,
    isOffsiteUrl,
    classifyApply,
    plainText,
    classifyDialog,
    matchDismissLabel,
    popupGuardMode,
    answerForQuestion,
    pickChoice,
    createSignal,
    waitUntil,
    waitForQuiet,
    describeApplyFailure,
    summarizeApply,
    describeApplySummary,
    describeQuota,
    describeSchedule,
    formatClock,
    perfilEdicao,
    temFeature,
    aplicarDoServidor,
    aplicarPerfilSalvo,
    sincronizarPlano,
    lerSessao,
    entrar,
    cadastrar,
    sair,
    lerApi,
    salvarApi,
    listarLicencas,
    emitirLicenca,
    simularPlano,
  };
})();

/* O tipo público deste arquivo, DERIVADO do próprio código: é ele que o
 * `src/tipos/globais.d.ts` usa para declarar `globalThis.PegaVagaShared` — se a
 * API daqui mudar, o tsc acusa lá também. */
type PegaVagaSharedApi = typeof apiShared;

globalThis.PegaVagaShared = apiShared;
