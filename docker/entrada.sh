#!/bin/sh
# =============================================================================
# PegaVaga - docker/entrada.sh
# Ponto de entrada da imagem de build da extensão.
#
# O toolchain (tsc + @types) vem pronto da imagem, em /opt/tools. Só que o
# `tools/` que o tsconfig aponta é o do repositório — e o repositório entra por
# bind mount, que ESCONDE o que está na imagem naquele caminho. Então, se o
# volume ainda não tiver o compilador (máquina nova, sem Node instalado), copia o
# da imagem para lá antes de rodar o comando: o container funciona offline.
# =============================================================================
set -e

if [ ! -x tools/typescript/bin/tsc ]; then
  echo "entrada: tools/ sem toolchain — copiando o da imagem (sem rede)"
  mkdir -p tools
  cp -R /opt/tools/. tools/
fi

exec "$@"
