# Local App Dashboard Runbook

Status: Reusable local runbook for starting the full `keep-pushing` app stack needed by the current frontend dashboard at `/`.

This runbook supports two local workflows:

- Option A: production-like runtime
  - Dockerized app
  - Dockerized Postgres
  - fresh app image build
- Option B: fast local iteration
  - Dockerized Postgres
  - host-run Next.js app with hot reload
  - host-run validator and bootstrap helper

Both paths still use a host-run `solana-test-validator`.

## What You Get

After completing this runbook:

- Postgres runs on `127.0.0.1:5432`
- the app runs on `http://127.0.0.1:3000`
- the Solana validator runs on `http://127.0.0.1:8899`
- the homepage `/` serves the current battle/sync dashboard
- the old proof-of-flow page is still available at `/battle%20(old%20pof)`

## Prerequisites

Inside your Linux shell / WSL:

- Docker
- Node/npm
- Solana CLI

Program artifacts must already exist in the sibling repo:

- `/home/paps/projects/runana-program/target/deploy/runana_program.so`
- `/home/paps/projects/runana-program/target/deploy/runana_program-keypair.json`

## One-Time Setup

From [keep-pushing](/home/paps/projects/keep-pushing):

```bash
cd /home/paps/projects/keep-pushing
cp .env.docker.example .env.docker
npm install
```

## Choose A Startup Mode

### Option A: Dockerized App For A Production-Like Fresh Build

Use this when you want to validate the app as a built image instead of a host-run dev server.

Important prerequisite:

- `.docker/secrets/server.json` must exist
- it must contain the same trusted server signer keypair that your local chain bootstrap uses

If you already have a previous local bootstrap artifact directory, the easiest setup is:

```bash
cd /home/paps/projects/keep-pushing
mkdir -p .docker/secrets
cp .tmp/manual-character-test/<timestamp>/keypairs/server.json .docker/secrets/server.json
```

Then start the Docker app and Postgres with a fresh image build:

```bash
cd /home/paps/projects/keep-pushing
docker compose --env-file .env.docker up -d --build postgres app
```

Next, start a fresh validator and bootstrap the chain state while reusing the already-running Docker app:

```bash
cd /home/paps/projects/keep-pushing
export RUNANA_ACTIVE_SEASON_ID=1
RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup
```

Use this path when:

- you want to test the built runtime
- you want to validate what `3000` serves from the Docker image
- you do not need hot reload

### Option B: Host-Run App For Fast Dev Iteration

Use this when you want the quickest frontend/backend iteration loop.

### 1. Start Postgres

```bash
cd /home/paps/projects/keep-pushing
docker compose --env-file .env.docker up -d postgres
```

The app does not run in Docker in this mode. Postgres stays in Docker, and the Next app runs on the host.

### 2. Export Required Local Environment

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing
export RUNANA_ACTIVE_SEASON_ID=1
```

Why this matters:

- `DATABASE_URL` is required for the host-run Next app
- `RUNANA_ACTIVE_SEASON_ID=1` is required for the local-first encounter flow unless you deliberately configure a different active season

### 3. Start The App With Hot Reload

```bash
cd /home/paps/projects/keep-pushing
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Leave that terminal running.

### 4. Start Validator, Deploy Program, Bootstrap Chain State, And Reuse The Running App

```bash
cd /home/paps/projects/keep-pushing
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing
export RUNANA_ACTIVE_SEASON_ID=1
RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup
```

This helper will:

- start `solana-test-validator --reset`
- deploy `runana-program`
- seed program config, season policy, zones, zone enemy sets, and enemy archetypes
- reuse the already-running app on `http://127.0.0.1:3000`
- create an anon backend user for the artifact bundle
- write artifacts under `.tmp/manual-character-test/<timestamp>`

Important:

- `RUNANA_SKIP_SERVER_START=1` is required in this mode because the app is already running
- if another validator is already running and you want a clean chain, stop it before running the helper

To stop an existing validator first:

```bash
pkill -f solana-test-validator
```

## Open The App

Once the helper finishes, open:

```text
http://127.0.0.1:3000/
```

The homepage is now the main dashboard for:

- anonymous user bootstrap
- local-first character creation
- local battle execution
- first-sync preparation/submission
- post-sync settlement preparation/submission

The old proof page is still available at:

```text
http://127.0.0.1:3000/battle%20(old%20pof)
```

## Expected Frontend Flow

### Local-First Path

1. Open `/`
2. Wait for anonymous user bootstrap
3. Create a character
4. Choose a zone and run `Battle`
5. Observe latest battle status become `AWAITING_FIRST_SYNC`

### First Sync Path

The current frontend exposes a manual first-sync panel.

This means:

- you enter the wallet authority public key manually
- you copy the authorization message out of the UI
- you sign it externally
- you paste the base64 signature back into the UI
- you prepare the transaction
- you sign the transaction externally
- you paste the signed message and signed transaction base64 back into the UI
- you submit through the app

This is expected for now. The repo does not yet include a browser wallet adapter integration.

### Post-Sync Settlement Path

After the character becomes `CONFIRMED`, the dashboard shows the same style of manual prepare/sign/submit flow for later settlement batches.

## Shutdown

### Stop Host-Run App And Validator

If you used Option B, stop the host-run app and validator like this:

```bash
pkill -f "next dev"
pkill -f solana-test-validator
```

If you used the setup helper, it may also have written a stop script into the printed artifact directory.

### Stop Docker App And Postgres

```bash
cd /home/paps/projects/keep-pushing
docker compose --env-file .env.docker down
```

If you used Option A and only want to restart the app image:

```bash
docker compose --env-file .env.docker up -d --build app
```

The named Postgres volume remains unless you explicitly remove volumes.

## Troubleshooting

### App fails because `DATABASE_URL` is missing

Export it before starting the host-run app:

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing
```

### Local-first battle returns active-season errors

Make sure:

```bash
export RUNANA_ACTIVE_SEASON_ID=1
```

### Port `3000` is already in use

Find and stop the existing process:

```bash
lsof -i :3000
pkill -f "next dev"
```

If `3000` is actually being served by the Docker app and you want the host-run dev server instead:

```bash
cd /home/paps/projects/keep-pushing
docker compose --env-file .env.docker stop app
```

If `3000` is being served by an old Docker image and you want the latest built app:

```bash
cd /home/paps/projects/keep-pushing
docker compose --env-file .env.docker up -d --build app
```

### Port `8899` is already in use

Stop the old validator:

```bash
pkill -f solana-test-validator
```

### Docker app starts but first-sync/settlement fails because the server signer is wrong

Make sure:

- `.docker/secrets/server.json` exists
- it matches the same trusted server signer used during local bootstrap

If needed, copy it from the latest artifact bundle:

```bash
cd /home/paps/projects/keep-pushing
mkdir -p .docker/secrets
cp .tmp/manual-character-test/<timestamp>/keypairs/server.json .docker/secrets/server.json
docker compose --env-file .env.docker up -d --build app
```

### You need the deeper end-to-end character and settlement test procedure

Use the longer companion runbook:

- [local-solana-character-test-runbook.md](/home/paps/projects/keep-pushing/docs/runbooks/local-solana-character-test-runbook.md)

ONE-SHOTTER:

Assumption: you already have a local PostgreSQL server running on `127.0.0.1:5432` and a `postgres` superuser with password `postgres`. If your local Postgres uses different credentials, edit the vars at the top first.

```bash
set -euo pipefail

cd /home/paps/projects/keep-pushing

export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=postgres
export APP_DB=keep_pushing

export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${APP_DB}"
export RUNANA_ACTIVE_SEASON_ID=1

echo "==> Installing deps if needed"
npm install

echo "==> Ensuring database exists"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${APP_DB}'" | grep -q 1 || \
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$APP_DB"

echo "==> Applying Prisma migrations"
npx prisma migrate deploy

echo "==> Stopping old local app / validator if present"
pkill -f "next dev --hostname 127.0.0.1 --port 3000" || true
pkill -f "next dev" || true
pkill -f solana-test-validator || true

echo "==> Starting Next app on http://127.0.0.1:3000"
nohup env \
  DATABASE_URL="$DATABASE_URL" \
  RUNANA_ACTIVE_SEASON_ID="$RUNANA_ACTIVE_SEASON_ID" \
  npm run dev -- --hostname 127.0.0.1 --port 3000 \
  > .tmp/local-app-dashboard.log 2>&1 &
APP_PID=$!

echo "==> Waiting for app to respond"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 1
done

echo "==> Starting validator, deploying program, bootstrapping chain state"
RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup

echo
echo "App URL: http://127.0.0.1:3000/"
echo "Old proof page: http://127.0.0.1:3000/battle%20(old%20pof)"
echo "App log: /home/paps/projects/keep-pushing/.tmp/local-app-dashboard.log"
echo "Next dev PID: $APP_PID"
```

To stop it later:

```bash
pkill -f "next dev"
pkill -f solana-test-validator
```

If you want, I can also give you a second pasteable block for the case where your local Postgres username/password are different.