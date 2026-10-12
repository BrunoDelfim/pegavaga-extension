#!/bin/sh
# =============================================================================
# PegaVaga - tools/conferir-gerado.sh
# Confere se o JS versionado na raiz é EXATAMENTE o que o fonte de src/ produz.
#
#   ./tools/conferir-gerado.sh
#
# Por que isto existe: o .js gerado é versionado de propósito (quem baixa o
# repositório instala a extensão sem compilar nada — ver D2 no documento de
# migração), mas artefato versionado só é aceitável se der para PROVAR que ele
# corresponde à fonte. O `tsc` escreve com o mesmo nome e o mesmo conteúdo em
# toda máquina, então a prova é simples: compila-se o fonte para um diretório
# temporário, aplica-se o MESMO cabeçalho e compara-se byte a byte com o que
# está no repositório.
#
#   ok     o .js versionado saiu deste fonte
#   DIFERE o .js versionado está velho (ou foi editado à mão) — rode ./pgv.sh build
#   FALTA  o fonte existe mas o .js não está no repositório
#   órfão  o .js tem o cabeçalho de GERADO, mas não existe fonte em src/
#
# Nada é escrito na raiz: o que sai do tsc aqui morre no diretório temporário.
# Código de saída ≠ 0 se qualquer arquivo divergir — é o que permite usar isto
# como guarda automática (CI, hook de pré-commit) e não só como conferência
# manual. Não substitui `./pgv.sh build`: ele confere, não conserta.
# =============================================================================
set -u

cd "$(dirname "$0")/.."

node tools/baixar-tipos.js

TMP="$(mktemp -d "${TMPDIR:-/tmp}/pegavaga-gerado.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "compilando src/ para $TMP ..."
if ! node tools/typescript/bin/tsc -p . --outDir "$TMP"; then
  echo
  echo "o tsc recusou o fonte — corrija os tipos e rode de novo (./pgv.sh check)."
  exit 1
fi

# O mesmo marcador do build, para o `cmp` comparar o conteúdo e não o cabeçalho.
node tools/cabecalho.js "$TMP" >/dev/null

echo
falhas=0
total=0

for fonte in src/*.ts; do
  [ -f "$fonte" ] || continue
  total=$((total + 1))

  nome="$(basename "$fonte" .ts).js"

  if [ ! -f "$nome" ]; then
    echo "  FALTA  $nome  (fonte: $fonte)"
    echo "         o fonte existe, mas o .js não está versionado — rode ./pgv.sh build"
    falhas=$((falhas + 1))
    continue
  fi

  if cmp -s "$TMP/$nome" "$nome"; then
    echo "  ok     $nome"
    continue
  fi

  echo "  DIFERE $nome  (fonte: $fonte)"
  echo "--------- o que está versionado (à esquerda) x o que o fonte produz ---------"
  diff -u "$nome" "$TMP/$nome" | sed -n '3,12p' | sed 's/^/         /'
  echo "         -> rode ./pgv.sh build e commite o .js junto com o .ts"
  falhas=$((falhas + 1))
done

# Órfão: .js com o cabeçalho de GERADO sem fonte correspondente. Acontece quando
# o src/x.ts é renomeado ou removido e o .js fica para trás — o manifest
# continuaria carregando código sem fonte, que é o pior dos mundos.
for gerado in *.js; do
  [ -f "$gerado" ] || continue
  head -n 6 "$gerado" | grep -q 'GERADO de src/' || continue
  [ -f "src/$(basename "$gerado" .js).ts" ] && continue
  echo "  órfão  $gerado  (tem o cabeçalho de GERADO, mas não há src/$(basename "$gerado" .js).ts)"
  falhas=$((falhas + 1))
done

echo

if [ "$total" -eq 0 ]; then
  echo "nenhum fonte TypeScript em src/ — nada a conferir (caminho errado?)."
  exit 1
fi

if [ "$falhas" -ne 0 ]; then
  echo
  echo "$falhas de $total arquivo(s) fora de sincronia com src/."
  exit 1
fi

echo
echo "$total arquivo(s) gerado(s) em dia: o .js versionado é o que src/ produz."
