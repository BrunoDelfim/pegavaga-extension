#!/bin/sh
# =============================================================================
# PegaVaga - tools/baixar-chromium.sh
#
# Baixa o Chromium de TESTE (`chrome-headless-shell`, do projeto
# chrome-for-testing do Google) para os testes de DOM (`tests/smoke-dom.js`)
# rodarem o content.js num browser DE VERDADE — sem instalar nada no sistema,
# sem root e sem npm (é o mesmo espírito do `tools/baixar-tipos.js`).
#
#   sh tools/baixar-chromium.sh
#
# Vai para ~/.cache/pegavaga/chromium/ (~120 MB, uma vez só; apague a pasta para
# baixar de novo, ou aponte PGV_CHROMIUM_DIR para outro lugar). Sem ele, o
# `tests/smoke-dom.js` se pula sozinho e a suíte segue verde: o browser é
# opcional, os testes é que ficam mais fortes com ele.
#
# Por que só o headless shell: é o Chromium sem interface gráfica, que é tudo o
# que os testes precisam (DOM com layout real, getClientRects, eventos, timers).
# =============================================================================
set -eu

DESTINO="${PGV_CHROMIUM_DIR:-$HOME/.cache/pegavaga/chromium}"
BIN="$DESTINO/chrome-headless-shell-linux64/chrome-headless-shell"
URL_JSON="https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"

if [ -x "$BIN" ]; then
  echo "chromium de teste já está em: $BIN"
  exit 0
fi

mkdir -p "$DESTINO"

echo "procurando a versão estável do chrome-for-testing…"
URL=$(curl -s "$URL_JSON" | python3 -c '
import json, sys

d = json.load(sys.stdin)
for item in d["channels"]["Stable"]["downloads"].get("chrome-headless-shell", []):
    if item["platform"] == "linux64":
        print(item["url"])
        break
')

if [ -z "${URL:-}" ]; then
  echo "não consegui descobrir a URL do chrome-headless-shell (sem rede?)" >&2
  exit 1
fi

echo "baixando: $URL"
curl -L --fail -o "$DESTINO/chs.zip" "$URL"

python3 -c '
import sys, zipfile

with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(sys.argv[2])
' "$DESTINO/chs.zip" "$DESTINO"

rm -f "$DESTINO/chs.zip"
chmod +x "$BIN"

echo "pronto: $BIN"
echo "agora: sh tools/testar.sh"
