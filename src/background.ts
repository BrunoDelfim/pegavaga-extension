/* =============================================================================
 * PegaVaga - src/background.ts (service worker)
 *
 * É o agendador da extensão: roda independente do pop-up estar aberto.
 *
 *   - acorda a cada minuto (chrome.alarms) enquanto existir agendador ativo ou
 *     alguma execução pausada por cota;
 *   - dentro da janela de horário configurada, abre a busca do LinkedIn e
 *     deixa o content.js varrer termo por termo;
 *   - fora da janela, encerra a execução AUTOMÁTICA que estiver rodando — a
 *     varredura iniciada à mão é do usuário e roda a qualquer hora (as duas são
 *     independentes; ver `filaAutomatica` no shared.ts);
 *   - respeita o período de descanso (proteção da conta) quando o LinkedIn
 *     sinaliza limite de uso: nem inicia, nem retoma nada enquanto ele durar;
 *   - quando uma cota (hora/24h/dia) libera espaço, cutuca a aba para o
 *     content.js retomar a varredura sozinho.
 *
 * O alarme só existe quando há algo para fazer, para não acordar o worker à
 * toa. O estado real vive em chrome.storage.local (fonte da verdade).
 *
 * FONTE da verdade: o `background.js` da raiz é GERADO deste arquivo pelo
 * TypeScript (rode `./pgv.sh build`; o gerado começa com o aviso de "não edite
 * à mão").
 * ===========================================================================*/

'use strict';

importScripts('edicoes.js');
importScripts('shared.js');

/* -----------------------------------------------------------------------------
 * Por que o arquivo inteiro é um IIFE.
 *
 * O worker não PUBLICA nada: o pop-up e o content script só falam com ele por
 * mensagem, e ninguém carrega o `background.js` esperando achar uma API nele
 * (diferente do `shared.js`/`edicoes.js`, que terminam cravando um contrato em
 * `globalThis`). O que ele tem é uma penca de nomes de topo — `SHARED`, `MSG`,
 * `tick`, `refreshStatus`, `sendToTab`… — que, num script clássico, viram
 * globais: e como o `tsc` compila todos os fontes no MESMO escopo global, eles
 * colidiriam com os do `popup.ts` e do `content.ts` quando esses migrarem (o
 * `popup.js` de hoje já tem `SHARED` e `MSG`; o `sendToTab` existe nos dois).
 *
 * O IIFE resolve na raiz, e é o mesmo truque do `shared.ts`/`edicoes.ts`: nada
 * de dentro escapa para o global. O worker continua sendo o mesmo — os
 * listeners do Chrome são registrados igual e a retomada ao subir segue lá
 * embaixo (é ela que o mantém vivo; não haveria o que expor de qualquer jeito).
 *
 * Os TIPOS deste arquivo seguem a mesma ideia e ficam aqui dentro: nenhum deles
 * é contrato de outra ponta — são só o que o agendador precisa para conversar
 * com o storage e com o `chrome.*`.
 * -------------------------------------------------------------------------- */

(() => {
  /* ------------------------------------------------------------------------ */
  /* Os tipos deste arquivo                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * A fila em andamento (`pegavaga_run`) com o que o AGENDADOR acrescenta por
   * conta própria: em qual aba ela está rodando (`tabId`). De onde a fila partiu
   * (`source`) é contrato do `shared.ts`, que é quem responde "esta fila é do
   * agendador?" (`filaAutomatica`) — e o pop-up escreve a fila dele sem marcar
   * nada.
   */
  interface FilaDoAgendador extends FilaExecucao {
    tabId?: number | null;
  }

  /** O bloqueio temporário da proteção da conta (`pegavaga_guard`). */
  interface BloqueioDaConta {
    blockedUntil: number;
    reason?: string;
  }

  /** O que uma decisão do agendador precisa saber (lido do storage a cada tick). */
  interface EstadoDoAgendador {
    settings: Configuracoes;
    run: FilaDoAgendador | null;
    apps: unknown[];
    guard: BloqueioDaConta | null;
  }

  /**
   * O que CHEGA de fora ao worker (content script e pop-up).
   *
   *   - `PEGAVAGA_PROGRESS` e o próprio estado da fila são uma `EntradaLuz` — é
   *     o que a luz do ícone lê (`run`, `guard`, `scanning`, `breakUntil`);
   *   - `PEGAVAGA_AJUDA_PEDIDO` traz o `pedidoId`/vaga de quem está esperando;
   *   - `PEGAVAGA_AJUDA_FECHAR` traz o `avisoId` do desktop a recolher.
   */
  interface MensagemRecebida extends EntradaLuz {
    type?: string;
    pedidoId?: unknown;
    avisoId?: unknown;
    motivo?: unknown;
    titulo?: unknown;
    empresa?: unknown;
    campos?: unknown;
    acao?: unknown;
    resposta?: unknown;
  }

  /** O que o worker manda para a aba do LinkedIn (o content script escuta). */
  interface MensagemParaOTab {
    type: string;
    pedidoId?: string;
    acao?: string;
    resposta?: Record<string, string>;
  }

  const SHARED = globalThis.PegaVagaShared;
  const STORAGE = SHARED.STORAGE;
  const MSG = SHARED.MSG;

  const ALARM_NAME = 'pegavaga-tick';
  const TICK_MINUTES = 1;
  const LINKEDIN_TAB_PATTERN = 'https://www.linkedin.com/*';

  /* Luzinha do ícone: o ponto colorido é desenhado por cima do próprio logo. Se o
   * canvas não estiver disponível, o selo colorido no canto assume o recado.
   *
   * As chaves de ICON_FILES são os tamanhos (os mesmos de ICON_SIZES) e são
   * lidas por número — que é como o Chrome lê esse mapa no `setIcon`. */
  const ICON_SIZES = [16, 32];
  const ICON_FILES: Record<string, string> = { 16: 'icons/pg-16.png', 32: 'icons/pg-48.png' };

  /* ------------------------------------------------------------------------ */
  /* Ciclo de vida                                                           */
  /* ------------------------------------------------------------------------ */

  chrome.runtime.onInstalled.addListener(() => {
    syncAlarm()
      .then(() => tick())
      .then(() => refreshStatus());
  });

  chrome.runtime.onStartup.addListener(() => {
    syncAlarm()
      .then(() => tick())
      .then(() => refreshStatus());
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === ALARM_NAME) tick().then(() => refreshStatus());
  });

  /* O pop-up e o content script mudam settings/run direto no storage: aqui só
   * mantemos o alarme (e a luz do ícone) alinhados com o que precisa acontecer. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Sessão/perfil mudaram (login, logout, plano novo): reaplica o perfil aqui e
    // realinha o que o agendador pode fazer (o free não tem agendador).
    if (changes[STORAGE.perfil] || changes[STORAGE.sessao]) {
      SHARED.aplicarPerfilSalvo()
        .then(() => Promise.all([syncAlarm(), refreshStatus()]))
        .catch(() => {});
      return;
    }

    if (changes[STORAGE.settings] || changes[STORAGE.run]) syncAlarm();
    if (changes[STORAGE.settings] || changes[STORAGE.run] || changes[STORAGE.guard]) {
      refreshStatus();
    }
  });

  /* O content script avisa o andamento mesmo com o pop-up fechado: assim a luz do
   * ícone acompanha a varredura em tempo real. */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    /* O que chega é o JS de outra ponta: o `as` declara o que cada mensagem
     * carrega (ver `MensagemRecebida`) e as guardas abaixo fazem o resto — como
     * o `String(...)` do pedido de ajuda e o `!avisoId` do pedido de fechar. */
    const mensagem = message as MensagemRecebida | null;

    if (!mensagem) return false;

    if (mensagem.type === MSG.PROGRESS) {
      refreshStatus(mensagem);
      return false;
    }

    // O cartão de resposta abre como janela NO DESKTOP (ver a seção de ajuda).
    if (mensagem.type === MSG.AJUDA_PEDIDO) {
      mostrarAjuda(mensagem, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false }));
      return true; // a resposta é assíncrona
    }

    // A sua decisão veio do cartão: encaminha para a aba certa e fecha a janela.
    if (mensagem.type === MSG.AJUDA_RESPOSTA_JANELA) {
      const avisoId = typeof mensagem.avisoId === 'string' ? mensagem.avisoId : '';
      const acao = String(mensagem.acao || '');
      const resposta =
        mensagem.resposta && typeof mensagem.resposta === 'object'
          ? (mensagem.resposta as Record<string, string>)
          : undefined;

      responderAjuda(avisoId, acao, resposta)
        .then(() => {
          if (sendResponse) sendResponse({ ok: true });
        })
        .catch(() => {
          if (sendResponse) sendResponse({ ok: false });
        });

      return true; // resposta assíncrona
    }

    // O pedido acabou na aba (prazo/aborto): some com a janela, para ela não
    // ficar na tela pedindo algo que não existe mais. Só se o id for NOSSO
    // (ver `lerAjudaId`): a extensão não mexe no que é de fora.
    if (mensagem.type === MSG.AJUDA_FECHAR) {
      if (typeof mensagem.avisoId === 'string' && SHARED.lerAjudaId(mensagem.avisoId)) {
        fecharJanela(mensagem.avisoId);
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  /* ------------------------------------------------------------------------ */
  /* Pedido de ajuda: o cartão NO DESKTOP                                     */
  /* ------------------------------------------------------------------------ */
  //
  // O cartão de resposta (ajuda.html) abre como JANELA POPUP do Chrome — sem
  // barra de endereço, sem abas, sem moldura: parece uma notificação grande no
  // canto inferior direito do desktop. É o content script que pede (quando a
  // candidatura trava), a janelinha responde com a sua decisão e o worker
  // encaminha de volta para a ABA certa (o id do pedido carrega o `tabId`).
  // Se a janela não abrir (não dá?), o content cai no cartão dentro da aba.

  /* Janelinhas abertas agora: id do pedido → id da janela (do Chrome). É por
   * aqui que o worker sabe qual fechar quando a decisão (ou um "feche-se")
   * chega — e sobrevive ao worker acordar do zero enquanto a janela espera. */
  const ajudasAbertas = new Map<string, number>();

  /**
   * Abre o cartão como JANELA do Chrome no desktop — só a barra de título e a
   * borda do sistema (`type: 'popup'`). Devolve `{ ok, id, motivo }`: o `motivo`
   * é o de-para da recusa, que o content script registra no console quando cai
   * no cartão dentro da aba (é por ele que se descobre POR QUE a janela não
   * abriu — API ausente, sem aba de origem, `create` recusado…).
   */
  async function mostrarAjuda(
    dados: MensagemRecebida,
    sender: chrome.runtime.MessageSender
  ): Promise<{ ok: boolean; id?: string; motivo?: string; recusa?: string }> {
    if (!chrome.windows || typeof chrome.windows.create !== 'function') {
      return { ok: false, motivo: 'sem_api_windows' }; // sem janelas: o content usa o cartão da aba
    }

    const pedidoId = String(dados.pedidoId || '');
    if (!pedidoId) return { ok: false, motivo: 'sem_pedido' };

    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
    if (tabId == null) return { ok: false, motivo: 'sem_aba' }; // sem aba não há para quem responder

    const id = SHARED.ajudaId(tabId, pedidoId);

    /* O contexto (vaga, motivo e os CAMPOS com tipo/opções) viaja na própria
     * URL como `?dados=...` JSON-codificado: a janelinha abre e já sabe o que
     * desenhar — um <select> com as opções originais do LinkedIn, um <input>
     * para texto. */
    const contexto = encodeURIComponent(
      JSON.stringify({
        avisoId: id, // é o que a janelinha manda de volta (o id carrega a aba)
        motivo: dados.motivo,
        titulo: dados.titulo,
        empresa: dados.empresa,
        campos: dados.campos,
      })
    );
    const url = chrome.runtime.getURL('ajuda.html') + '?dados=' + contexto;

    /* A janela PEDIDA é a `popup`: sem barra de endereço, sem abas, sem menu —
     * só a barra de título e a borda do sistema, o mais capado que o Chrome
     * oferece. Tentamos na ordem do mais "capado" para o menos:
     *
     *   1. `type: 'popup'` no formato mínimo (é o que costuma passar);
     *   2. `type: 'popup'` com `setSelfAsOpener` (para a janela se fechar junto);
     *   3. janela NORMAL — só como último recurso, para o pedido não se perder.
     *
     * O que falhou fica em `recusa` e volta na resposta (`{ ok: true, recusa }`):
     * é o que permite ver no console POR QUE a `popup` não saiu, sem adivinhar. */
    const tentativas: chrome.windows.CreateData[] = [
      { url: url, type: 'popup', width: 372, height: 470, focused: true },
      { url: url, type: 'popup', width: 372, height: 470, focused: true, setSelfAsOpener: true },
      { url: url, width: 372, height: 470, focused: true },
    ];

    let janela: chrome.windows.Window | undefined;
    let recusa = '';

    for (const dadosDaJanela of tentativas) {
      try {
        janela = await chrome.windows.create(dadosDaJanela);
        break;
      } catch (error) {
        recusa = String((error && (error as { message?: string }).message) || error);
      }
    }

    const windowId = janela && janela.id != null ? janela.id : null;
    if (windowId == null) return { ok: false, motivo: 'create_falhou:' + (recusa || 'sem_id') };

    /* O `focused` sozinho não tira a janela de trás de outras no Linux: o
     * pisca-pisca na dock/barra fica até você clicar nela (e o ajuda.js ainda
     * a posiciona no canto inferior direito ao abrir). */
    try {
      await chrome.windows.update(windowId, { focused: true, drawAttention: true });
    } catch (error) {
      /* mover/focar é cortesia: a janela já existe e funciona */
    }

    ajudasAbertas.set(id, windowId);
    return { ok: true, id: id, recusa: recusa || undefined };
  }

  /** Fecha a janelinha do cartão (sem erro se ela já saiu). */
  function fecharJanela(ajudaId: string): void {
    const windowId = ajudasAbertas.get(ajudaId);
    if (windowId == null) return;

    try {
      const resultado = chrome.windows.remove(windowId);
      if (resultado && typeof resultado.catch === 'function') resultado.catch(() => {});
    } catch (error) {
      /* a janela já saiu */
    }

    ajudasAbertas.delete(ajudaId);
  }

  /**
   * Traz a aba da vaga para frente e dá o foco à janela dela. É o que o "Vou
   * preencher à mão" precisa: você acabou de dizer que vai digitar no
   * formulário, então ele tem que estar na sua frente.
   *
   * Nunca rejeita: sem foco, a decisão continua valendo.
   */
  async function focarAba(tabId: number | null): Promise<boolean> {
    if (tabId == null || !chrome.tabs || typeof chrome.tabs.update !== 'function') return false;

    try {
      // `active: true` traz a aba para frente dentro da janela dela.
      const aba = await chrome.tabs.update(tabId, { active: true });
      const windowId = aba && aba.windowId != null ? aba.windowId : null;

      // A janela pode estar atrás de outra (o caso comum: o cartão está no
      // desktop com outra coisa na frente): é o `windows.update` que põe a
      // janela do navegador inteira na frente.
      if (windowId != null && chrome.windows && typeof chrome.windows.update === 'function') {
        await chrome.windows.update(windowId, { focused: true });
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * A sua decisão veio do cartão (janelinha): leva de volta para a aba que
   * está esperando e fecha a janela. A `resposta` (o que você escolheu em cada
   * campo) viaja junto — é o content script que a escreve nos campos travados.
   */
  function responderAjuda(
    ajudaId: string,
    acao: string,
    resposta?: Record<string, string>
  ): Promise<boolean> {
    const alvo = SHARED.lerAjudaId(ajudaId);

    fecharJanela(ajudaId);

    if (!alvo || !acao) return Promise.resolve(false);

    // "Vou preencher à mão": a aba vai para a frente ANTES de a decisão chegar
    // ao content script — você vai digitar nela agora. "Pular"/"Aplicar" não
    // mexem em foco: a automação segue sozinha.
    const foco = acao === 'manual' ? focarAba(alvo.tabId) : Promise.resolve(false);

    return foco.then(() =>
      sendToTab(alvo.tabId, {
        type: MSG.AJUDA_RESPOSTA,
        pedidoId: alvo.pedidoId,
        acao: acao,
        resposta: resposta,
      })
    );
  }

  /* Ao subir um service worker novo, garante o alarme e a luz certos. */
  syncAlarm();
  refreshStatus();

  /* ------------------------------------------------------------------------ */
  /* Leitura de estado                                                       */
  /* ------------------------------------------------------------------------ */

  async function readState(): Promise<EstadoDoAgendador> {
    // O perfil concedido pelo servidor vale para o worker também: o service worker
    // acorda do zero, então reaplicamos o cache do /plano antes de normalizar
    // settings (sem rede — o cache é local, e sem ele o perfil é o free).
    if (typeof SHARED.aplicarPerfilSalvo === 'function') await SHARED.aplicarPerfilSalvo();

    const data = await chrome.storage.local.get([
      STORAGE.settings,
      STORAGE.run,
      STORAGE.apps,
      STORAGE.guard,
    ]);

    /* O que sai do storage é JS gravado por outra ponta (pop-up, content script,
     * versão anterior): os `as` abaixo só declaram o que ele guarda — as guardas
     * de sempre continuam no lugar (`Array.isArray` nos apps, o `blockedUntil >
     * Date.now()` no guard). */
    const guard = (data[STORAGE.guard] as BloqueioDaConta | null) || null;
    const apps = data[STORAGE.apps];

    return {
      settings: SHARED.parseSettings(data[STORAGE.settings]),
      run: (data[STORAGE.run] as FilaDoAgendador | null) || null,
      apps: Array.isArray(apps) ? apps : [],
      // Proteção da conta: enquanto durar, não automatizamos nada.
      guard: guard && guard.blockedUntil > Date.now() ? guard : null,
    };
  }

  function writeRun(run: FilaDoAgendador): Promise<void> {
    return chrome.storage.local.set({ [STORAGE.run]: run }).catch(() => {});
  }

  /* ------------------------------------------------------------------------ */
  /* Luz do ícone (verde capturando · amarela pronta · vermelha atenção)      */
  /* ------------------------------------------------------------------------ */

  const iconBitmaps = new Map<number, ImageBitmap>(); // PNGs do logo já decodificados
  const iconeFalhou: Record<number, boolean> = {}; // tamanho → não tenta o fetch de novo
  let paintedLight: string | null = null; // cor que está desenhada no ícone agora

  /**
   * Acende a luz do ícone. Aceita um `PEGAVAGA_PROGRESS` recém-chegado (mais fresco
   * que o storage) ou lê o estado gravado. Nada disso é crítico: se o navegador
   * recusar, a extensão continua funcionando normalmente.
   */
  async function refreshStatus(progress?: MensagemRecebida | null): Promise<void> {
    let source: EntradaLuz | null = progress && progress.type === MSG.PROGRESS ? progress : null;

    if (!source) {
      try {
        const state = await readState();
        source = { run: state.run, guard: state.guard };
      } catch (error) {
        return;
      }
    }

    try {
      await applyLight(SHARED.statusLight(source));
    } catch (error) {
      /* ícone é enfeite: falhar aqui não pode atrapalhar a varredura */
    }
  }

  async function applyLight(light: LuzStatus): Promise<void> {
    /* `title` é opcional no tipo (a luz pode vir de fora um dia) e toda luz que
     * nasce aqui já tem o seu; o `|| ''` evita mandar `undefined` para o Chrome,
     * que recusaria a chamada inteira. */
    setAction('setTitle', { title: light.title || '' });

    if (paintedLight === light.color) return; // luz já está nesta cor

    const painted = await paintIcon(light.color).catch(() => false);

    if (painted) {
      paintedLight = light.color;
      setAction('setBadgeText', { text: '' });
      return;
    }

    // Plano B (sem OffscreenCanvas): logo original + selo colorido no canto.
    paintedLight = null;
    setAction('setIcon', { path: ICON_FILES });
    setAction('setBadgeText', { text: ' ' });
    setAction('setBadgeBackgroundColor', { color: light.color });
    setAction('setBadgeTextColor', { color: '#ffffff' });
  }

  /** Os métodos do ícone que este arquivo usa (o resto do `chrome.action` não interessa). */
  type MetodoDoIcone =
    | 'setTitle'
    | 'setIcon'
    | 'setBadgeText'
    | 'setBadgeBackgroundColor'
    | 'setBadgeTextColor';

  /** O detalhe que cada método espera — vem do próprio `@types/chrome`. */
  interface DetalhesDoIcone {
    setTitle: chrome.action.TitleDetails;
    setIcon: chrome.action.TabIconDetails;
    setBadgeText: chrome.action.BadgeTextDetails;
    setBadgeBackgroundColor: chrome.action.BadgeColorDetails;
    setBadgeTextColor: chrome.action.BadgeColorDetails;
  }

  /**
   * Chama a API do ícone sem deixar promise solta nem derrubar o worker.
   *
   * O método chega por nome porque isto é uma tabela de "aplique e ignore o
   * erro": o genérico mantém cada chamada conferida pelo detalhe do seu próprio
   * método (`{ title }`, `{ path }`, `{ color }`…), e o `as` existe porque o
   * `chrome.action` indexado por nome vira uma união de funções sobrecarregadas,
   * que o TypeScript não consegue chamar.
   */
  function setAction<K extends MetodoDoIcone>(method: K, details: DetalhesDoIcone[K]): void {
    try {
      const chamada = chrome.action[method] as (detalhes: DetalhesDoIcone[K]) => unknown;
      const result = chamada.call(chrome.action, details);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch (error) {
      /* método indisponível nesta versão do Chrome */
    }
  }

  /**
   * Desenha o ponto colorido por cima do logo. Devolve `false` quando o canvas não
   * está disponível, para o selo do canto assumir o recado.
   */
  async function paintIcon(color: string): Promise<boolean> {
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
      return false;
    }

    const imageData: Record<number, ImageData> = {};

    for (const size of ICON_SIZES) imageData[size] = await dotImage(size, color);

    await chrome.action.setIcon({ imageData });
    return true;
  }

  /** O logo do tamanho pedido, com a luz no canto inferior direito. */
  async function dotImage(size: number, color: string): Promise<ImageData> {
    const context = new OffscreenCanvas(size, size).getContext('2d');

    /* Um OffscreenCanvas recém-criado sempre dá contexto; o `throw` é o que o
     * fallback do `paintIcon` já esperava de qualquer jeito — quem o pega é o
     * `paintIcon(...).catch()` do `applyLight`, que cai no selo do canto. */
    if (!context) throw new Error('sem contexto 2d');

    context.drawImage(await baseIcon(size), 0, 0, size, size);

    const radius = Math.max(3, Math.round(size * 0.2));
    const ring = Math.max(1, Math.round(size / 16));
    const center = size - radius - ring;

    // Anel branco: sem ele o ponto se perde no azul do logo.
    context.beginPath();
    context.arc(center, center, radius + ring, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();

    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();

    return context.getImageData(0, 0, size, size);
  }

  async function baseIcon(size: number): Promise<ImageBitmap> {
    const pronta = iconBitmaps.get(size);
    if (pronta) return pronta;

    /* Se o contexto da extensão morreu (p. ex. você recarregou a extensão com
     * a aba aberta), `getURL` devolve `chrome-extension://invalid/...` e o
     * fetch falha. Sem esta guarda, cada tick tentava de novo — era o spam de
     * `net::ERR_FAILED` no console. Com ela, a falha é memorizada e a luz do
     * ícone cai no selo do canto (plano B), sem erro novo. */
    if (!chrome.runtime || !chrome.runtime.id) throw new Error('contexto morto');
    if (iconeFalhou[size]) throw new Error('ícone indisponível');

    try {
      const response = await fetch(chrome.runtime.getURL(ICON_FILES[size]));
      const bitmap = await createImageBitmap(await response.blob());
      iconBitmaps.set(size, bitmap);

      return bitmap;
    } catch (error) {
      iconeFalhou[size] = true; // não tenta de novo neste ciclo de vida do worker
      throw error;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Alarme                                                                  */
  /* ------------------------------------------------------------------------ */

  /** Só mantém o alarme ligado quando há agendador ativo ou execução pausada. */
  async function syncAlarm(): Promise<void> {
    let state: EstadoDoAgendador;

    try {
      state = await readState();
    } catch (error) {
      return;
    }

    const needed =
      state.settings.schedule.enabled || Boolean(state.run && state.run.paused) || Boolean(state.guard);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);

    if (needed && !existing) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: TICK_MINUTES,
        periodInMinutes: TICK_MINUTES,
      });
      return;
    }

    if (!needed && existing) {
      await chrome.alarms.clear(ALARM_NAME).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Tick: o cérebro do agendador                                            */
  /* ------------------------------------------------------------------------ */

  async function tick(): Promise<void> {
    let state: EstadoDoAgendador;

    try {
      state = await readState();
    } catch (error) {
      return;
    }

    const { settings, run, guard } = state;
    const now = Date.now();
    const inWindow = SHARED.isWithinSchedule(new Date(now), settings.schedule);

    // 0) Proteção da conta ligada (o LinkedIn sinalizou limite de uso): nada de
    //    automação enquanto durar o descanso, nem retomada por cota.
    if (guard) {
      if (run && run.running && !run.paused) {
        await pauseRun(run, guard.blockedUntil, 'guard');
      }

      await syncAlarm();
      return;
    }

    // 1) Passou do horário: encerra a execução AUTOMÁTICA em andamento. Uma fila
    //    iniciada à mão é do usuário: ela segue até o fim (ou até ele clicar em
    //    Parar), a qualquer hora — a janela governa só o que o agendador montou.
    if (
      run &&
      run.running &&
      !run.paused &&
      settings.schedule.enabled &&
      !inWindow &&
      SHARED.filaAutomatica(run)
    ) {
      await stopRun(run);
      await syncAlarm();
      return;
    }

    // 2) Chegou o horário: começa sozinho.
    if (!run && canAutoStart(settings, now)) {
      await startRun(settings);
      await syncAlarm();
      return;
    }

    // 3) Execução pausada por cota: retoma quando a próxima vaga liberar.
    //    A fila automática só volta dentro da janela agendada (volta quando o
    //    horário abrir); a do usuário retoma a qualquer hora.
    if (
      run &&
      run.running &&
      run.paused &&
      (!SHARED.filaAutomatica(run) || !settings.schedule.enabled || inWindow)
    ) {
      const quota = SHARED.computeQuota(settings, state.apps, now, run.appliedInTerm || 0);

      if (quota.ok) {
        await nudge(run);
      } else if (quota.resumeAt && quota.resumeAt !== run.resumeAt) {
        await writeRun(Object.assign({}, run, { resumeAt: quota.resumeAt, pauseReason: 'cota' }));
      }
    }

    await syncAlarm();
  }

  /** Guarda a fila pausada até `resumeAt`, explicando o motivo. */
  function pauseRun(
    run: FilaDoAgendador,
    resumeAt: unknown,
    reason?: string | null
  ): Promise<void> {
    return writeRun(
      Object.assign({}, run, {
        paused: true,
        resumeAt: Number.isFinite(resumeAt) ? (resumeAt as number) : Date.now() + 60000,
        pauseReason: reason || 'cota',
      })
    );
  }

  function canAutoStart(settings: Configuracoes, now: number): boolean {
    if (!settings.schedule.enabled || !settings.schedule.autoStart) return false;
    if (!settings.terms.length) return false; // sem termos não há o que buscar
    return SHARED.isWithinSchedule(new Date(now), settings.schedule);
  }

  /* ------------------------------------------------------------------------ */
  /* Ações                                                                   */
  /* ------------------------------------------------------------------------ */

  /** Monta a fila e manda a aba do LinkedIn carregar o primeiro termo. */
  async function startRun(settings: Configuracoes): Promise<void> {
    const run: FilaDoAgendador = SHARED.buildRunQueue(settings);
    run.source = SHARED.ORIGEM_AGENDADOR;

    const firstUrl = run.urls[0] || SHARED.LINKEDIN_SEARCH_URL;
    const focus = settings.schedule.focusTab !== false;

    // A fila é gravada ANTES de navegar: o content.js retoma ao carregar.
    await writeRun(run);

    const tab = await findLinkedInTab();
    let tabId: number | null = null;

    try {
      if (tab && tab.id != null) {
        tabId = tab.id;
        if (tab.url === firstUrl) {
          await chrome.tabs.reload(tabId);
        } else {
          await chrome.tabs.update(tabId, { url: firstUrl, active: focus });
        }
      } else {
        const created = await chrome.tabs.create({ url: firstUrl, active: focus });
        tabId = created && created.id != null ? created.id : null;
      }
    } catch (error) {
      // Sem a aba, a fila fica gravada e o usuário pode clicar em Iniciar.
      return;
    }

    if (tabId != null) {
      run.tabId = tabId;
      await writeRun(run);
    }
  }

  /** Encerra a execução: apaga a fila (fonte da verdade) e avisa a aba. */
  async function stopRun(run: FilaDoAgendador): Promise<void> {
    await chrome.storage.local.remove(STORAGE.run).catch(() => {});
    await sendToTab(run.tabId ?? null, { type: MSG.STOP });
  }

  /** Cutuca a aba pausada; se ninguém responder, recarrega (o load retoma). */
  async function nudge(run: FilaDoAgendador): Promise<void> {
    const delivered = await sendToTab(run.tabId ?? null, { type: MSG.RESUME });
    if (delivered) return;

    if (run.tabId != null) {
      await chrome.tabs.reload(run.tabId).catch(() => {});
    }
  }

  /**
   * Procura uma aba do LinkedIn já aberta. O filtro por URL exige permissão de
   * host para o padrão (temos host_permissions para o LinkedIn); se o navegador
   * recusar, simplesmente abrimos uma aba nova.
   */
  async function findLinkedInTab(): Promise<chrome.tabs.Tab | null> {
    try {
      const tabs = await chrome.tabs.query({ url: LINKEDIN_TAB_PATTERN });
      const usable = (tabs || []).filter((tab) => tab && tab.id != null);
      return usable[0] || null;
    } catch (error) {
      return null;
    }
  }

  function sendToTab(tabId: number | null, message: MensagemParaOTab): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (tabId == null) {
        resolve(false);
        return;
      }

      try {
        chrome.tabs.sendMessage(tabId, message, () => resolve(!chrome.runtime.lastError));
      } catch (error) {
        resolve(false);
      }
    });
  }
})();
