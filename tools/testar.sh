#!/bin/sh
# =============================================================================
# PegaVaga - tools/testar.sh
# Roda os testes de fumaça (tests/smoke-*.js) no Node puro.
#
#   ./tools/testar.sh       (ou, da pasta de cima: ./pgv.sh test)
#
# Sem lista fixa de nomes: o glob acha os testes — um teste novo entra na suíte
# sozinho e nunca fica "esquecido fora do pgv.sh".
# =============================================================================
set -u

cd "$(dirname "$0")/.."

falhas=0
total=0

for teste in tests/smoke-*.js; do
  [ -f "$teste" ] || continue
  total=$((total + 1))

  echo "== $teste =="
  saida=$(node "$teste" 2>&1)
  codigo=$?

  if [ "$codigo" -ne 0 ]; then
    # Na falha, a saída inteira: a linha do FALHA fica no meio dela.
    echo "$saida"
    falhas=$((falhas + 1))
    echo ">>> FALHOU ($codigo)"
  else
    # No sucesso, só o fim: é onde o smoke imprime o resumo.
    echo "$saida" | tail -3
  fi
  echo
done

if [ "$total" -eq 0 ]; then
  echo "nenhum teste em tests/ — caminho errado?"
  exit 1
fi

if [ "$falhas" -ne 0 ]; then
  echo "$falhas de $total testes FALHARAM."
  exit 1
fi

echo "extensão: $total testes passaram."
