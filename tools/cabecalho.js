#!/usr/bin/env node
/* =============================================================================
 * PegaVaga - tools/cabecalho.js
 * Põe o aviso "GERADO de src/<arquivo>.ts — não edite aqui" no topo de cada JS
 * que o tsc escreveu.
 *
 * Roda depois do `tsc` (ver o `build` no pgv.sh). É Node puro, sem dependência:
 * o tsc não tem opção de banner, e o cabeçalho é o que evita o erro clássico
 * desta migração — abrir o `content.js` da raiz e editar o arquivo GERADO.
 *
 *   node tools/cabecalho.js              marca os JS da raiz (pós-build)
 *   node tools/cabecalho.js /tmp/saida   marca a cópia recém-compilada em outro
 *                                        diretório — é assim que o
 *                                        tools/conferir-gerado.sh monta, lado a
 *                                        lado, o que o fonte PRODUZ e o que
 *                                        está versionado (o aviso sai igualzinho
 *                                        nos dois, então o `cmp` compara só o
 *                                        que importa).
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');

/* A FONTE é sempre a pasta src/ do repositório; só o DESTINO pode mudar. */
const REPO = path.join(__dirname, '..');
const RAIZ = process.argv[2] ? path.resolve(process.argv[2]) : REPO;
const SRC = path.join(REPO, 'src');

if (!fs.existsSync(SRC)) {
  console.error('não achei src/ — rode a partir do repositório da extensão.');
  process.exit(1);
}

const fontes = fs.readdirSync(SRC).filter((arquivo) => arquivo.endsWith('.ts'));

if (!fontes.length) {
  console.log('nenhum fonte TypeScript em src/ ainda — nada a marcar.');
  process.exit(0);
}

let marcados = 0;

for (const fonte of fontes) {
  const nome = fonte.replace(/\.ts$/, '.js');
  const caminho = path.join(RAIZ, nome);

  if (!fs.existsSync(caminho)) {
    console.log(`  --    ${nome} ainda não foi gerado (só existe o .js antigo?)`);
    continue;
  }

  const aviso =
    '/* =============================================================================\n' +
    ` * PegaVaga - ${nome}\n` +
    ` * GERADO de src/${fonte} pelo TypeScript — NÃO edite este arquivo à mão.\n` +
    ' * Edite o fonte em src/ e rode: ./pgv.sh build\n' +
    ' * ===========================================================================*/\n\n';

  const conteudo = fs.readFileSync(caminho, 'utf8');

  if (conteudo.startsWith(aviso)) {
    console.log(`  ok    ${nome} já estava marcado`);
    continue;
  }

  fs.writeFileSync(caminho, aviso + conteudo);
  console.log(`  ok    ${nome} marcado como gerado`);
  marcados += 1;
}

console.log(`\n${marcados} arquivo(s) marcado(s).`);
