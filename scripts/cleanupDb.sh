#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

DOCKER_COMPOSE_CMD=(docker compose)
if [[ -f "$ROOT/.env.docker" ]]; then
  DOCKER_COMPOSE_CMD+=(--env-file .env.docker)
fi

POSTGRES_VOLUME_NAME="keep-pushing-postgres-data"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-keep_pushing}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

export DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}}"

function wait_for_postgres() {
  local attempts=0
  while (( attempts < 60 )); do
    if "${DOCKER_COMPOSE_CMD[@]}" exec -T postgres \
      pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      return
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  echo "[clean:db] ERROR: postgres did not become ready in time" >&2
  exit 1
}

echo "[clean:db] stopping postgres container if present"
"${DOCKER_COMPOSE_CMD[@]}" stop postgres >/dev/null 2>&1 || true

echo "[clean:db] removing postgres container if present"
"${DOCKER_COMPOSE_CMD[@]}" rm -sf postgres >/dev/null 2>&1 || true

echo "[clean:db] removing postgres volume ${POSTGRES_VOLUME_NAME} if present"
docker volume rm "${POSTGRES_VOLUME_NAME}" >/dev/null 2>&1 || true

echo "[clean:db] starting fresh postgres"
"${DOCKER_COMPOSE_CMD[@]}" up -d postgres

echo "[clean:db] waiting for postgres readiness"
wait_for_postgres

echo "[clean:db] applying prisma migrations"
npx prisma migrate deploy
