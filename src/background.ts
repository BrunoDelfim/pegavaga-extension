/* =============================================================================
 * PegaVaga - src/background.ts (service worker)
 *
 * É o agendador da extensão: roda independente do pop-up estar aberto.
 *
 *   - acorda a cada minuto (chrome.alarms) enquanto existir agendador ativo ou
 *     alguma execução pausada por cota;
 *   - dentro da janela de horário configurada, abre a busca do LinkedIn e
 *     deixa o content.js varrer termo por termo;
 *   - fora da janela, encerra a execução que estiver rodando;
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
   * conta própria: de onde ela partiu (`source`) e em que aba está rodando
   * (`tabId`). O `shared.ts` não os conhece de propósito — quem escreve a fila
   * é o pop-up (ou este worker) e o content script só lê a aba.
   */
  interface FilaDoAgendador extends FilaExecucao {
    source?: string;
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
   * O que CHEGA de fora ao worker (content script e pop-up). Cada mensagem usa
   * um pedaço disto:
   *
   *   - `PEGAVAGA_PROGRESS` e o próprio estado da fila são uma `EntradaLuz` — é
   *     o que a luz do ícone lê (`run`, `guard`, `scanning`, `breakUntil`);
   *   - `PEGAVAGA_AJUDA_PEDIDO` traz o `pedidoId` de quem está esperando;
   *   - `PEGAVAGA_AJUDA_FECHAR` traz o `avisoId` da notificação a recolher.
   */
  interface MensagemRecebida extends EntradaLuz {
    type?: string;
    pedidoId?: unknown;
    avisoId?: string;
  }

  /** O que o worker manda para a aba do LinkedIn (o content script escuta). */
  interface MensagemParaOTab {
    type: string;
    pedidoId?: string;
    acao?: string;
  }

  /** A resposta ao pedido de ajuda: o id do aviso criado, ou o motivo de não dar. */
  type RespostaDoAviso = { ok: true; id: string } | { ok: false; motivo: string };

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

    // (TEMPORÁRIO) Pedido de ajuda do content script: mostramos o aviso na área de
    // trabalho e devolvemos se ele foi criado — o script só espera quando foi.
    if (mensagem.type === MSG.AJUDA_PEDIDO) {
      mostrarAjuda(mensagem, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, motivo: 'erro' }));
      return true; // a resposta é assíncrona
    }

    // (TEMPORÁRIO) A espera acabou (decisão tomada ou prazo estourado): some com o
    // aviso, para ele não ficar na tela pedindo algo que não existe mais.
    if (mensagem.type === MSG.AJUDA_FECHAR) {
      limparAviso(mensagem.avisoId);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  /* ------------------------------------------------------------------------ */
  /* (TEMPORÁRIO) Pedido de ajuda ao usuário                                  */
  /* ------------------------------------------------------------------------ */
  //
  // Quando a Candidatura Simplificada trava num campo que a extensão ainda não sabe
  // responder — ou o envio demora a confirmar —, o content script pede ajuda e
  // espera. Mostramos um aviso na área de trabalho com dois botões:
  //
  //   * "Vou preencher à mão" → a aba da vaga vem para a frente (com o foco na
  //     janela dela) e a automação para e espera você terminar;
  //   * "Pular esta vaga"     → a vaga é descartada e a varredura segue adiante.
  //
  // O id do aviso carrega o `tabId` (ver `SHARED.ajudaId`): o clique pode acordar o
  // worker do zero, e é por ele que a decisão acha a aba que está esperando.
  // Sai inteiro quando os campos personalizados forem tratados de verdade.

  /** Cria a notificação. Devolve o id criado, ou '' quando não deu. */
  function criarAviso(
    id: string,
    opcoes: chrome.notifications.NotificationCreateOptions
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      try {
        chrome.notifications.create(id, opcoes, (criado) => {
          resolve(!chrome.runtime.lastError ? criado || id : '');
        });
      } catch (error) {
        resolve('');
      }
    });
  }

  /** Monta e mostra o aviso do pedido de ajuda. */
  async function mostrarAjuda(
    dados: MensagemRecebida,
    sender: chrome.runtime.MessageSender
  ): Promise<RespostaDoAviso> {
    if (!chrome.notifications || typeof chrome.notifications.create !== 'function') {
      return { ok: false, motivo: 'sem_notificacao' };
    }

    const pedidoId = String((dados && dados.pedidoId) || '');
    if (!pedidoId) return { ok: false, motivo: 'pedido_sem_id' };

    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
    if (tabId == null) return { ok: false, motivo: 'sem_aba' }; // sem aba não há para quem responder
    const id = SHARED.ajudaId(tabId, pedidoId);
    const texto = SHARED.textoDaAjuda(dados);

    const criado = await criarAviso(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/pg-128.png'),
      title: texto.title,
      message: texto.message,
      buttons: (SHARED.AJUDA_BOTOES || []).map((title) => ({ title })),
      requireInteraction: true, // o aviso fica na tela até você escolher
      priority: 2,
    });

    return criado ? { ok: true, id: criado } : { ok: false, motivo: 'falha_ao_avisar' };
  }

  /** Some com o aviso (sem erro se ele já saiu). */
  function limparAviso(avisoId?: string): void {
    if (!avisoId || !chrome.notifications || typeof chrome.notifications.clear !== 'function') {
      return;
    }

    try {
      const resultado = chrome.notifications.clear(avisoId);
      if (resultado && typeof resultado.catch === 'function') resultado.catch(() => {});
    } catch (error) {
      /* o aviso já saiu da tela */
    }
  }

  /**
   * Traz a aba da vaga para frente e dá o foco à janela dela. É o que o "Vou
   * preencher à mão" precisa: você acabou de dizer que vai digitar no formulário,
   * então ele tem que estar na sua frente — não atrás de outra aba (ou da janela
   * do LinkedIn minimizada).
   *
   * Nunca rejeita: sem foco, a decisão continua valendo (o content script espera
   * do mesmo jeito).
   */
  async function focarAba(tabId: number | null): Promise<boolean> {
    if (tabId == null || !chrome.tabs || typeof chrome.tabs.update !== 'function') return false;

    try {
      // `active: true` traz a aba para frente dentro da janela dela.
      const aba = await chrome.tabs.update(tabId, { active: true });
      const janelaId = aba && aba.windowId != null ? aba.windowId : null;

      // A janela pode estar atrás de outra (o caso comum: você clicou no aviso com
      // o terminal na frente): é o `windows.update` que põe ela na frente.
      if (janelaId != null && chrome.windows && typeof chrome.windows.update === 'function') {
        await chrome.windows.update(janelaId, { focused: true });
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * O usuário clicou num botão do aviso: leva a decisão de volta para a aba que
   * está esperando e tira o aviso da tela. Fechar o aviso sem clicar não decide
   * nada — a espera do content script tem prazo e segue o caminho de sempre.
   */
  function responderAjuda(avisoId: string, indice: number): Promise<boolean> {
    const alvo = SHARED.lerAjudaId(avisoId);
    const acao = SHARED.acaoDaAjuda(indice);

    limparAviso(avisoId);

    if (!alvo || !acao) return Promise.resolve(false);

    // "Vou preencher à mão": a aba vai para a frente (e a janela ganha o foco)
    // ANTES de a decisão chegar ao content script — você vai digitar nela agora.
    // "Pular esta vaga" não mexe em foco: a varredura segue na aba que já está na
    // sua frente.
    const foco = acao === 'manual' ? focarAba(alvo.tabId) : Promise.resolve(false);

    return foco.then(() =>
      sendToTab(alvo.tabId, {
        type: MSG.AJUDA_RESPOSTA,
        pedidoId: alvo.pedidoId,
        acao: acao,
      })
    );
  }

  if (chrome.notifications && chrome.notifications.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener((avisoId, indice) => {
      responderAjuda(avisoId, indice);
    });
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

    const response = await fetch(chrome.runtime.getURL(ICON_FILES[size]));
    const bitmap = await createImageBitmap(await response.blob());
    iconBitmaps.set(size, bitmap);

    return bitmap;
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

    // 1) Passou do horário: encerra a execução em andamento (a pausada espera).
    if (run && run.running && !run.paused && settings.schedule.enabled && !inWindow) {
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
    //    Fora da janela agendada ela continua parada (volta quando o horário abrir).
    if (run && run.running && run.paused && (!settings.schedule.enabled || inWindow)) {
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
    run.source = 'agendador';

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
