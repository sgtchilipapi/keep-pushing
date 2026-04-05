#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing}"
export RUNANA_ACTIVE_SEASON_ID="${RUNANA_ACTIVE_SEASON_ID:-1}"
export RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES="${RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES:-1}"

echo "[app:local:fresh] stopping old app and validator if present"
pkill -f "next dev" || true
pkill -f solana-test-validator || true

echo "[app:local:fresh] stopping dockerized app if present"
docker compose --env-file .env.docker stop app >/dev/null 2>&1 || true

echo "[app:local:fresh] ensuring postgres is running"
docker compose --env-file .env.docker up -d postgres

echo "[app:local:fresh] bootstrapping validator, program, backend, and local artifacts"
npm run solana:manual:character:setup

echo
echo "App URL: http://127.0.0.1:3000/"
echo "Auto ALT: RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES=${RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES}"
echo "If first sync still fails, inspect the latest artifact bundle under:"
echo "  $ROOT/.tmp/manual-character-test"
