#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

echo "[app:codespace:clean] stopping solana-faucet if present"
pkill -f solana-faucet >/dev/null 2>&1 || true

echo "[app:codespace:clean] removing .env.docker override if present"
rm -f "$ROOT/.env.docker"

echo "[app:codespace:clean] removing Docker app/postgres containers and Postgres volume"
docker compose down -v --remove-orphans

echo "[app:codespace:clean] removing local validator and Next artifacts"
bash "$ROOT/scripts/cleanupLocalDisk.sh"

echo "[app:codespace:clean] bootstrapping fully fresh Codespaces stack"
bash "$ROOT/scripts/appCodespaceFresh.sh"
