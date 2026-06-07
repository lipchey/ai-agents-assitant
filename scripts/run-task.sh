#!/usr/bin/env bash
set -euo pipefail

# Безпечна обгортка для першого тестування ai-agents-assitant.
# Виставляє консервативні ліміти споживання, щоб агент із циклами
# (debate / ReAct / verify / refetch) не спалив бюджет провайдерів.
#
# Usage:            scripts/run-task.sh "<task>"
# Override caps:    BUDGET=0.25 APPLY=1 HITL=0 scripts/run-task.sh "<task>"
#
#   BUDGET  -> AGENT_COST_BUDGET_USD  (м'яка USD-стеля; дефолт 0.05)
#   APPLY   -> AGENT_APPLY_PATCHES    (порожньо = патчі ВИМКНЕНО, без запису в репо)
#   HITL    -> AGENT_HITL             (1 = інтерактивний human-in-the-loop на TTY)

BUDGET="${BUDGET:-0.05}"
APPLY="${APPLY:-}"
HITL="${HITL:-1}"

if [ "$#" -lt 1 ]; then
    echo 'Usage: scripts/run-task.sh "<task description>"' >&2
    exit 1
fi

echo "[run-task] budget=\$$BUDGET apply=${APPLY:-off} hitl=$HITL"

AGENT_COST_BUDGET_USD="$BUDGET" \
AGENT_APPLY_PATCHES="$APPLY" \
AGENT_HITL="$HITL" \
    npm start -- "$@"
