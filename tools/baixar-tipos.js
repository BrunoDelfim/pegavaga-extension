#!/usr/bin/env node
/* =============================================================================
 * PegaVaga - tools/baixar-tipos.js
 * Baixa o compilador TypeScript e os tipos do Chrome SEM npm, sem curl e sem
 * tar — só Node (`https` + `zlib` + um leitor de tar de poucas linhas).
 *
 *   node tools/baixar-tipos.js            # baixa o que falta
 *   node tools/baixar-tipos.js --forcar   # baixa tudo de novo
 *
 * Por que não npm: nem esta máquina nem o container do build têm npm instalado,
 * e o projeto não quer um `node_modules` de verdade. Por que não `curl` + `tar`:
 * o build precisa rodar igual em Linux, macOS e Windows — quem clonar o
 * repositório só precisa do Node.
 *
 * O que ele deixa em `tools/` (que é ignorado pelo git):
 *   tools/typescript/                    o compilador (tsc)
 *   tools/node_modules/@types/<pkg>/     os tipos (chrome + dependências)
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const TOOLS = __dirname;
const REGISTRY = 'https://registry.npmjs.org';

/* Versões FIXAS de propósito: o build tem de ser o mesmo em qualquer máquina e a
 * qualquer momento.
 *
 * O TypeScript fica na linha 5.x — a implementação em JavaScript puro, que roda
 * em qualquer sistema e arquitetura. A 7.x é o compilador nativo: vem em pacote
 * separado POR PLATAFORMA (`@typescript/typescript-<sistema>-<arquitetura>`), e
 * adotá-la agora amarraria o build ao sistema de quem compila. Quando a 7.x for
 * a padrão e o pacote por plataforma não incomodar, esta linha é a única que
 * muda. */
const PACOTES = [
  { nome: 'typescript', versao: '5.9.3', destino: 'typescript' },
  { nome: '@types/chrome', versao: '0.3.5', destino: 'node_modules/@types/chrome' },
];

/** GET simples que devolve o corpo inteiro (segue redirecionamentos). */
function baixar(url, redirecionamentos) {
  const saltos = redirecionamentos || 0;

  return new Promise((resolver, rejeitar) => {
    const pedido = https.get(
      url,
      { headers: { 'user-agent': 'pegavaga-build (sem npm)' } },
      (resposta) => {
        const codigo = resposta.statusCode || 0;

        if (codigo >= 300 && codigo < 400 && resposta.headers.location && saltos < 5) {
          resposta.resume();
          resolver(baixar(new URL(resposta.headers.location, url).toString(), saltos + 1));
          return;
        }

        if (codigo !== 200) {
          resposta.resume();
          rejeitar(new Error(`HTTP ${codigo} em ${url}`));
          return;
        }

        const pedacos = [];
        resposta.on('data', (pedaco) => pedacos.push(pedaco));
        resposta.on('end', () => resolver(Buffer.concat(pedacos)));
        resposta.on('error', rejeitar);
      }
    );

    pedido.on('error', rejeitar);
    pedido.setTimeout(60000, () => pedido.destroy(new Error(`tempo esgotado em ${url}`)));
  });
}

async function obterJson(url) {
  return JSON.parse((await baixar(url)).toString('utf8'));
}

/** Campo de texto do cabeçalho tar (terminado em NUL e/ou preenchido por espaços). */
function campoTar(bloco, inicio, tamanho) {
  return bloco
    .toString('utf8', inicio, inicio + tamanho)
    .replace(/\0.*$/, '')
    .trim();
}

/**
 * Extrai um pacote npm (tar.gz) numa pasta — o mínimo de tar que um pacote npm
 * usa: blocos de 512 bytes, conteúdo logo depois do cabeçalho, alinhado a 512.
 */
function extrairTar(comprimido, destino) {
  const dados = zlib.gunzipSync(comprimido);
  let offset = 0;
  let nomeLongo = null; // o GNU guarda nome comprido num bloco anterior (tipo 'L')
  let arquivos = 0;

  while (offset + 512 <= dados.length) {
    const cabecalho = dados.subarray(offset, offset + 512);
    offset += 512;

    const nome = campoTar(cabecalho, 0, 100);
    if (!nome) break; // fim do arquivo: vem um bloco só de zeros

    const modo = parseInt(campoTar(cabecalho, 100, 8) || '0', 8) || 0;
    const tamanho = parseInt(campoTar(cabecalho, 124, 12) || '0', 8) || 0;
    const tipo = String.fromCharCode(cabecalho[156] || 48);
    const prefixo = campoTar(cabecalho, 345, 155);
    const conteudo = dados.subarray(offset, offset + tamanho);
    offset += Math.ceil(tamanho / 512) * 512;

    if (tipo === 'L') {
      nomeLongo = conteudo.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const completo = nomeLongo || (prefixo ? `${prefixo}/${nome}` : nome);
    nomeLongo = null;

    /* O tar traz a pasta do pacote na frente e ela MUDA de pacote para pacote: a
     * maioria usa `package/…`, mas os `@types` publicados pelo DefinitelyTyped
     * vêm com o próprio nome (`chrome/…`, `filesystem/…`). Por isso o que sai é o
     * PRIMEIRO nível, seja ele qual for — e um arquivo solto na raiz não entra. */
    const corte = completo.indexOf('/');
    const relativo = corte === -1 ? '' : completo.slice(corte + 1);
    if (!relativo) continue;

    const caminho = path.join(destino, relativo);

    if (tipo === '5') {
      fs.mkdirSync(caminho, { recursive: true });
      continue;
    }

    // Arquivo comum ('0' ou NUL); cabeçalho estendido (x/g) e link ficam de fora.
    if (tipo !== '0' && tipo !== '\0') continue;

    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.writeFileSync(caminho, conteudo);

    if (modo & 0o111) {
      try {
        fs.chmodSync(caminho, modo & 0o777); // o bin/tsc precisa ser executável
      } catch (erro) {
        /* Windows não tem bit de execução — e não precisa. */
      }
    }

    arquivos += 1;
  }

  return arquivos;
}

/** Baixa e extrai um pacote (e, se for um `@types`, também as dependências dele). */
async function instalar(nome, versaoPedida, destino, vistos, forcar) {
  const pasta = path.join(TOOLS, destino);

  if (!forcar && fs.existsSync(path.join(pasta, 'package.json'))) {
    console.log(`  ok    ${nome} já está em tools/${destino}`);
    return;
  }

  const alvo = versaoPedida === '*' || versaoPedida === 'latest' ? 'latest' : versaoPedida;
  const meta = await obterJson(`${REGISTRY}/${nome}/${alvo}`);
  const semEscopo = nome.includes('/') ? nome.slice(nome.indexOf('/') + 1) : nome;
  const url =
    meta.dist && meta.dist.tarball
      ? meta.dist.tarball
      : `${REGISTRY}/${nome}/-/${semEscopo}-${meta.version}.tgz`;

  const tgz = await baixar(url);

  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(pasta, { recursive: true });

  const arquivos = extrairTar(tgz, pasta);
  console.log(`  ok    ${nome}@${meta.version} → tools/${destino} (${arquivos} arquivos)`);

  /* Só os tipos puxam outros tipos (o `typescript` não tem dependência nenhuma):
   * é assim que `@types/filesystem` e `@types/har-format` entram junto com o
   * `@types/chrome`. Qualquer coisa fora de `@types/` não é problema nosso. */
  for (const [dependencia, faixa] of Object.entries(meta.dependencies || {})) {
    if (!dependencia.startsWith('@types/') || vistos.has(dependencia)) continue;
    vistos.add(dependencia);
    await instalar(
      dependencia,
      faixa,
      `node_modules/@types/${dependencia.slice(dependencia.indexOf('/') + 1)}`,
      vistos,
      forcar
    );
  }
}

async function main() {
  const forcar = process.argv.includes('--forcar');

  console.log('PegaVaga — toolchain do TypeScript (sem npm, sem curl, sem tar)');

  const vistos = new Set(PACOTES.map((pacote) => pacote.nome));
  let falhou = false;

  for (const pacote of PACOTES) {
    try {
      await instalar(pacote.nome, pacote.versao, pacote.destino, vistos, forcar);
    } catch (erro) {
      falhou = true;
      console.error(`  FALHA ${pacote.nome}: ${erro.message}`);
    }
  }

  if (falhou) {
    console.error('\nnão deu para baixar tudo (sem rede?). O build precisa disto uma vez.');
    process.exit(1);
  }

  console.log('\npronto. compilar: node tools/typescript/bin/tsc -p .');
}

main();


