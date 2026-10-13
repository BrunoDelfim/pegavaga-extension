/* =============================================================================
 * PegaVaga - ajuda.js
 *
 * O cartão do pedido de ajuda, numa JANELA POPUP do Chrome (sem barra de
 * endereço, sem moldura) no DESKTOP — não dentro da aba do LinkedIn.
 *
 * O background abre esta página com `?dados=<json>` (a vaga, o motivo e os
 * CAMPOS travados com tipo e opções). Aqui a janela se posiciona no canto
 * inferior direito do desktop (ou onde você a arrastou da última vez), cada
 * campo vira o controle certo (um <select> com as opções ORIGINAIS do
 * LinkedIn, ou um <input>), e a sua decisão volta para o worker — que
 * encaminha para a aba certa e fecha esta janela.
 * ===========================================================================*/
'use strict';

(function () {
  const MSG = (globalThis.PegaVagaShared && globalThis.PegaVagaShared.MSG) || {
    AJUDA_RESPOSTA_JANELA: 'PEGAVAGA_AJUDA_RESPOSTA_JANELA',
  };

  const POS_KEY = 'pegavaga_ajuda_pos';
  const MARGEM = 16; // distância do canto do desktop

  /* O contexto que o worker mandou na URL: { avisoId, motivo, titulo, empresa,
   * campos: [{ rotulo, tipo, opcoes }] }. JSON quebrado vira objeto vazio. */
  const dados = (function () {
    try {
      const bruto = new URLSearchParams(location.search).get('dados') || '{}';
      const objeto = JSON.parse(decodeURIComponent(bruto));
      return objeto && typeof objeto === 'object' ? objeto : {};
    } catch (error) {
      return {};
    }
  })();

  const avisoId = String(dados.avisoId || '');
  const campos = Array.isArray(dados.campos) ? dados.campos : [];
  const ehDemora = dados.motivo === 'demora';

  /* O casamento de opção do resto da extensão (o módulo puro `ajuda-campos.js`, o
   * mesmo que o content script usa): é ele que diz QUAL opção do cartão corresponde
   * ao que já está preenchido no LinkedIn — e que opção a sua resposta escolheu. */
  const AJUDA_CAMPOS = window.PegaVagaAjuda || {};
  const escolherOpcaoDaLista = AJUDA_CAMPOS.escolherOpcao;

  /* ------------------------------------------------------------------------ */
  /* Posicionamento: canto inferior direito (ou a posição memorizada)          */
  /* ------------------------------------------------------------------------ */

  /** Lê a posição guardada (ou null: aí vale o canto inferior direito). */
  function lerPosicao() {
    return chrome.storage.local
      .get(POS_KEY)
      .then((data) => (data && data[POS_KEY]) || null)
      .catch(() => null);
  }

  /** Guarda a posição para a próxima abertura (sem atrapalhar se falhar). */
  function guardarPosicao(left, top) {
    chrome.storage.local.set({ [POS_KEY]: { left: left, top: top } }).catch(() => {});
  }

  /** A posição guardada ainda cabe na tela de agora? (monitor pode ter mudado.) */
  function posicaoValida(pos, largura, altura) {
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return false;
    const dir = screen.availLeft + screen.availWidth;
    const baixo = screen.availTop + screen.availHeight;
    return (
      pos.left >= screen.availLeft &&
      pos.top >= screen.availTop &&
      pos.left + largura <= dir + 4 &&
      pos.top + altura <= baixo + 4
    );
  }

  /** Posição de abertura: a memorizada (se ainda servir) ou o canto da tela. */
  async function posicionar() {
    let janela = null;
    try {
      janela = await chrome.windows.getCurrent();
    } catch (error) {
      /* sem janela: não dá para mover (a posição fica a padrão do Chrome) */
      return;
    }
    if (!janela || janela.id == null) return;

    const largura = janela.width || window.outerWidth || 372;
    const altura = janela.height || window.outerHeight || 470;
    const guardada = await lerPosicao();

    let left;
    let top;

    if (posicaoValida(guardada, largura, altura)) {
      left = guardada.left;
      top = guardada.top;
    } else {
      // Canto inferior direito do desktop (multimonitor: relativo à área útil).
      left = screen.availLeft + screen.availWidth - largura - MARGEM;
      top = screen.availTop + screen.availHeight - altura - MARGEM;
    }

    try {
      await chrome.windows.update(janela.id, { left: left, top: top });
    } catch (error) {
      /* o sistema pode recusar mover: segue onde abriu */
    }
  }

  /**
   * Arrasta a janela inteira pelo cabeçalho. Como a janela não tem moldura,
   * o próprio cartão move a janela (chrome.windows.update) — e, ao soltar, a
   * posição fica guardada para a próxima vaga.
   */
  function permitirArrastar() {
    const cabeca = document.getElementById('cabeca');
    if (!cabeca) return;

    /* Sem a API de janelas (ou num contexto que não a expõe), o ARRASTO não existe —
     * mas o cartão continua inteiro: perder os botões por causa do arrasto seria
     * perder a única saída que você tem quando a etapa trava. */
    if (!chrome.windows || typeof chrome.windows.getCurrent !== 'function') return;

    let janelaId = null;
    let baseLeft = 0;
    let baseTop = 0;
    let startX = 0;
    let startY = 0;
    let arrastando = false;

    chrome.windows
      .getCurrent()
      .then((janela) => {
        janelaId = janela && janela.id != null ? janela.id : null;
      })
      .catch(() => {});

    cabeca.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return; // só o botão principal arrasta
      if (janelaId == null) return;

      arrastando = true;
      startX = event.screenX;
      startY = event.screenY;
      baseLeft = null;
      baseTop = null;

      chrome.windows
        .get(janelaId)
        .then((janela) => {
          if (!janela || !arrastando) return;
          baseLeft = janela.left;
          baseTop = janela.top;
        })
        .catch(() => {});

      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!arrastando || baseLeft == null) return;
      const left = baseLeft + (event.screenX - startX);
      const top = baseTop + (event.screenY - startY);
      chrome.windows.update(janelaId, { left: left, top: top }).catch(() => {});
    });

    document.addEventListener('mouseup', () => {
      if (!arrastando) return;
      arrastando = false;

      // Guarda a posição nova (lê a atual da janela para não depender do delta).
      chrome.windows
        .get(janelaId)
        .then((janela) => {
          if (janela && typeof janela.left === 'number') {
            guardarPosicao(janela.left, janela.top);
          }
        })
        .catch(() => {});
    });
  }


  /* ------------------------------------------------------------------------ */
  /* Campos: o controle certo para cada tipo (com as opções originais)        */
  /* ------------------------------------------------------------------------ */

  /** Desenha os campos travados e devolve `{ rotulo, el }` de cada um. */
  function desenharCampos() {
    const raiz = document.getElementById('campos');
    const controles = [];

    campos.forEach((c, i) => {
      const bloco = document.createElement('div');
      bloco.className = 'campo';

      const label = document.createElement('label');
      label.setAttribute('for', 'campo-' + i);
      label.textContent = (c && c.rotulo) || 'Pergunta ' + (i + 1);
      bloco.appendChild(label);

      const opcoes = c && Array.isArray(c.opcoes) ? c.opcoes : [];
      let controle;

      if ((c && c.tipo === 'texto') || !opcoes.length) {
        controle = document.createElement('input');
        controle.type = 'text';
        // Já vem com o que o campo mostra no LinkedIn: você confere e corrige.
        if (c && c.valor) controle.value = String(c.valor);
      } else {
        // Select/rádio/checkbox: um <select> com as opções ORIGINAIS do
        // LinkedIn. O valor é o TEXTO da opção — é o que o content script usa
        // para achar a escolha certa no formulário real.
        controle = document.createElement('select');
        const vazia = document.createElement('option');
        vazia.value = '';
        vazia.textContent = '— escolher —';
        controle.appendChild(vazia);
        opcoes.forEach((op) => {
          const o = document.createElement('option');
          o.value = String(op);
          o.textContent = String(op);
          controle.appendChild(o);
        });

        // A escolha que JÁ ESTÁ no LinkedIn vem pré-selecionada (mesmo casamento
        // de opção do resto da extensão: exato, depois "contém").
        const escolhida =
          typeof escolherOpcaoDaLista === 'function'
            ? escolherOpcaoDaLista(opcoes, (c && c.valor) || '')
            : -1;

        if (escolhida >= 0) controle.value = String(opcoes[escolhida]);
      }

      controle.id = 'campo-' + i;
      bloco.appendChild(controle);
      raiz.appendChild(bloco);
      controles.push({ rotulo: String((c && c.rotulo) || ''), el: controle });
    });

    return controles;
  }

  /* ------------------------------------------------------------------------ */
  /* A decisão: manda de volta para o worker (que leva para a aba certa)      */
  /* ------------------------------------------------------------------------ */

  function responder(acao, resposta) {
    chrome.runtime
      .sendMessage({
        type: MSG.AJUDA_RESPOSTA_JANELA,
        avisoId: avisoId,
        acao: acao,
        resposta: resposta,
      })
      .catch(() => {});
    // O worker fecha esta janela ao processar. Sem resposta (worker dormindo?),
    // fecha sozinha para não ficar uma janela órfã no desktop.
    setTimeout(() => window.close(), 400);
  }

  function iniciar() {
    /* Cabeçalho: a vaga e o recado. */
    const vaga = [dados.titulo, dados.empresa].filter(Boolean).join(' — ');
    const elVaga = document.getElementById('vaga');
    if (vaga) {
      elVaga.textContent = vaga;
      elVaga.hidden = false;
    }

    document.getElementById('msg').textContent = ehDemora
      ? 'O LinkedIn não confirmou o envio no tempo esperado. Você pode assumir a vaga à mão (a automação espera) ou pular.'
      : 'Responda os campos abaixo (com as opções originais do LinkedIn) e a extensão preenche e segue sozinha.';

    if (ehDemora) document.getElementById('aplicar').style.display = 'none';

    /* Campos travados com o controle certo de cada um. */
    const controles = desenharCampos();

    if (!ehDemora && !controles.length) {
      document.getElementById('msg').textContent =
        'Não consegui ler o campo travado. Assuma à mão ou pule esta vaga.';
    }

    /* Posiciona a janela e deixa o cabeçalho arrastável. */
    posicionar();
    permitirArrastar();

    /* Botões. */
    const lerResposta = () => {
      const resposta = {};
      controles.forEach((c) => {
        const valor = String((c.el && c.el.value) || '').trim();
        if (valor && c.rotulo) resposta[c.rotulo] = valor; // rótulo é a chave da reaplicação
      });
      return resposta;
    };

    document.getElementById('aplicar').addEventListener('click', () => {
      responder('aplicar', lerResposta());
    });
    document.getElementById('manual').addEventListener('click', () => responder('manual', null));
    document.getElementById('pular').addEventListener('click', () => responder('pular', null));
    document.getElementById('fechar').addEventListener('click', () => responder('', null));

    // Enter num campo de texto aplica e continua (atalho natural).
    controles.forEach((c) => {
      if (!c.el || c.el.tagName === 'SELECT') return;
      c.el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          responder('aplicar', lerResposta());
        }
      });
    });

    if (controles.length && controles[0].el) controles[0].el.focus();
  }

  iniciar();
})();

