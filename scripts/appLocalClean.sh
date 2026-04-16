#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

DOCKER_COMPOSE_CMD=(docker compose)
if [[ -f "$ROOT/.env.docker" ]]; then
  DOCKER_COMPOSE_CMD+=(--env-file .env.docker)
fi

echo "[app:local:clean] stopping solana-faucet if present"
pkill -f solana-faucet >/dev/null 2>&1 || true

echo "[app:local:clean] removing .env.docker override if present"
rm -f "$ROOT/.env.docker"

echo "[app:local:clean] removing Docker app/postgres containers and Postgres volume"
"${DOCKER_COMPOSE_CMD[@]}" down -v --remove-orphans

echo "[app:local:clean] removing local validator and Next artifacts"
bash "$ROOT/scripts/cleanupLocalDisk.sh"

echo "[app:local:clean] bootstrapping fully fresh local stack"
bash "$ROOT/scripts/appLocalFresh.sh"
