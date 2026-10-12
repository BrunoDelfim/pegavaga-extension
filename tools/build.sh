#!/bin/sh
# =============================================================================
# PegaVaga - tools/build.sh
# Build da extensão: baixa o toolchain (se faltar), compila o TypeScript e marca
# o JS gerado com o aviso de "não edite à mão".
#
#   ./tools/build.sh              compila e marca  (ou: ./pgv.sh build)
#   ./tools/build.sh --conferir   só confere os tipos, sem escrever arquivo
#                                 (ou: ./pgv.sh check)
#
# Roda igual na máquina de fora e dentro do container — é o mesmo Node e o mesmo
# script. Por isso quem chama é ESTE arquivo: o `pgv.sh` e o `docker compose` só
# apontam para cá, e o "como compilar" mora num lugar só.
# =============================================================================
set -e

cd "$(dirname "$0")/.."

node tools/baixar-tipos.js

if [ "${1:-}" = "--conferir" ]; then
  # Nada de arquivo escrito: é o modo de quem só quer saber se os tipos fecham.
  exec node tools/typescript/bin/tsc -p . --noEmit
fi

node tools/typescript/bin/tsc -p .
node tools/cabecalho.js
