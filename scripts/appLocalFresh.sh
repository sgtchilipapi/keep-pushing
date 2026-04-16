#!/usr/bin/env bash
set -euo pipefail

for candidate_bin in \
  "$HOME/.local/share/solana/install/active_release/bin" \
  "$HOME/.cargo/bin"
do
  if [[ -d "$candidate_bin" && ":$PATH:" != *":$candidate_bin:"* ]]; then
    PATH="$candidate_bin:$PATH"
  fi
done
export PATH

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing}"
export RUNANA_ACTIVE_SEASON_ID="${RUNANA_ACTIVE_SEASON_ID:-1}"
export RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES="${RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES:-1}"

DOCKER_COMPOSE_CMD=(docker compose)
if [[ -f "$ROOT/.env.docker" ]]; then
  DOCKER_COMPOSE_CMD+=(--env-file .env.docker)
fi

echo "[app:local:fresh] stopping old app and validator if present"
pkill -f "next dev" || true
pkill -f solana-test-validator || true
pkill -f solana-faucet || true

echo "[app:local:fresh] stopping dockerized app if present"
"${DOCKER_COMPOSE_CMD[@]}" stop app >/dev/null 2>&1 || true

echo "[app:local:fresh] ensuring postgres is running"
"${DOCKER_COMPOSE_CMD[@]}" up -d postgres

echo "[app:local:fresh] bootstrapping validator, program, backend, and local artifacts"
npm run solana:manual:character:setup

echo
echo "App URL: http://127.0.0.1:3000/"
echo "Auto ALT: RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES=${RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES}"
echo "If first sync still fails, inspect the latest artifact bundle under:"
echo "  $ROOT/.tmp/manual-character-test"
