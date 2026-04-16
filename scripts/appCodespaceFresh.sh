#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing}"
export RUNANA_ACTIVE_SEASON_ID="${RUNANA_ACTIVE_SEASON_ID:-1}"

bash "$ROOT/scripts/appLocalFresh.sh"

FORWARD_LOCAL_PORT="${RUNANA_LOCAL_FORWARD_PORT:-3000}"
SERVER_PORT="${PORT:-3000}"
CODESPACE_LABEL="${CODESPACE_NAME:-<codespace-name>}"

echo
echo "From your machine, run:"
echo "gh codespace ssh -c ${CODESPACE_LABEL} -- -L ${FORWARD_LOCAL_PORT}:127.0.0.1:${SERVER_PORT}"
echo
echo "Then open:"
echo "http://127.0.0.1:${FORWARD_LOCAL_PORT}/"
