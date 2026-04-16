# Local App Dashboard Runbook

Status: Reusable local runbook for starting the full `keep-pushing` app stack needed by the reconciled zone-run dashboard at `/`.

Canonical path note:

- this runbook follows the reconciled homepage flow as the primary manual path
- direct helper scripts and the old proof page remain troubleshooting fallbacks, not the canonical player surface

## Summary

Quickest fresh start:

1. Run the one-shot helper

```bash
cd /home/paps/projects/keep-pushing
npm run app:local:fresh
```

2. Open the dashboard

```text
http://127.0.0.1:3000/
```

3. Test from the browser

- create character
- start a zone run
- connect Phantom
- sync the character
- settle later backlog from the sync page

Quickest fresh start in Codespaces terminal-only:

1. Run the one-line helper

```bash
cd /workspaces/keep-pushing
npm run app:codespace:fresh
```

2. On your machine, start the SSH tunnel it prints
3. Open `http://127.0.0.1:3000/`

Full clean Codespaces reset:

```bash
cd /workspaces/keep-pushing
npm run app:codespace:clean
```

This one does a harder reset first:

- stops host-run app processes
- stops validator and faucet
- removes Docker Postgres containers and volume
- removes local `.tmp` and `.next` artifacts
- then boots the fresh stack again

Codespaces helpers rebuild the Solana program when source is newer than the deployed `.so`:

- they use `anchor build` when `anchor` exists
- otherwise they fall back to `cargo-build-sbf`
- you can still force reuse of the existing artifact with `RUNANA_SKIP_PROGRAM_BUILD=1`

Codespaces manual fallback:

1. Run the Codespaces one-shot block in `Codespaces One-Shot Truly Fresh`
2. On your machine, start the SSH tunnel it prints
3. Open `http://127.0.0.1:3000/`

Truly fresh:

cd /home/paps/projects/keep-pushing
pkill -f "next dev" || true
pkill -f solana-test-validator || true
pkill -f solana-faucet || true
docker compose --env-file .env.docker down -v || true
npm run app:local:clean-space
npm run app:local:fresh
solana airdrop 5 D6jgHRYrA3As8ar6uvUixxyrdkb7t8658e2zuCHmMm2w --url http://127.0.0.1:8899

Fresh local:


What the one-shot helper now does:

- starts Dockerized Postgres
- stops stale local app and validator processes
- stops any stale Docker app on `3000`
- bootstraps a fresh validator
- rebuilds `runana-program` when local source is newer than the deployed `.so`
- deploys and seeds the Solana program
- seeds class registry plus versioned zone metadata and enemy-rule accounts
- starts the backend with the fresh trusted server signer wired automatically
- enables backend-side auto-ALT creation for local first-sync and settlement preparation

4. Shutdown

```bash
pkill -f "next dev"
pkill -f solana-test-validator
pkill -f solana-faucet
```

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

The helper rebuilds `runana-program` automatically when needed, but the sibling repo and program keypair must still exist:

- `/home/paps/projects/runana-program`
- `/home/paps/projects/runana-program/target/deploy/runana_program-keypair.json`

## One-Time Setup

From [keep-pushing](/home/paps/projects/keep-pushing):

```bash
cd /home/paps/projects/keep-pushing
cp .env.docker.example .env.docker
npm install
```

If WSL disk usage is already ballooning, reclaim local validator and Rust build space before starting:

```bash
cd /home/paps/projects/keep-pushing
npm run app:local:clean-space
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
docker compose --env-file .env.docker up -d postgres app
```

Use `--build` only when you actually need a new image:

```bash
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

### Option B1: Codespaces Variant For Terminal-Only Local Dev

Use this when the app is running inside a GitHub Codespace and you want:

- Dockerized Postgres inside the same Codespace
- host-run Next.js app with hot reload
- browser access through SSH port forwarding instead of the Codespaces Ports UI

This is the most reliable path when you only have terminal access through `gh`.

### 1. Set local app env in `.env.local`

Make sure `.env.local` contains a local Postgres URL:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing
```

The Phantom redirect vars may remain in the same file.

### 2. Start local Postgres in Docker

```bash
cd /workspaces/keep-pushing
docker compose up -d postgres
```

Expected local DB settings in this repo:

- host: `127.0.0.1`
- port: `5432`
- db: `keep_pushing`
- user: `postgres`
- password: `postgres`

### 3. Apply Prisma migrations

Prisma config reads `DATABASE_URL` from the process environment, so export it explicitly before running migrations:

```bash
cd /workspaces/keep-pushing
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing' npx prisma migrate deploy
```

### 4. Start the app

```bash
cd /workspaces/keep-pushing
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing' npm run dev
```

Wait for:

- `Ready`
- local listener on `http://localhost:3000`

### 5. Reach the app from your machine with SSH port forwarding

From your local machine:

```bash
gh codespace ssh -c <codespace-name> -- -L 3000:127.0.0.1:3000
```

Example:

```bash
gh codespace ssh -c organic-orbit-gw54q4xxw79hwxgj -- -L 3000:127.0.0.1:3000
```

Then open locally on your machine:

```text
http://127.0.0.1:3000/
```

If your local port `3000` is busy, bind another local port:

```bash
gh codespace ssh -c <codespace-name> -- -L 3001:127.0.0.1:3000
```

Then open:

```text
http://127.0.0.1:3001/
```

Important:

- do not expect Vercel to reach this DB
- do not expect Codespaces `app.github.dev` forwarding to be available automatically in terminal-only workflows
- the SSH tunnel is the canonical terminal-only browser path

### Codespaces One-Shot Truly Fresh

Use this when you want one pasteable block that does all local setup inside the Codespace:

- starts Dockerized Postgres
- applies Prisma migrations
- starts the Next dev server on `127.0.0.1:3000`
- runs the Solana validator bootstrap helper
- prints the exact `gh codespace ssh -L ...` command to use from your machine

If you do not need the raw block, use the one-line helper instead:

```bash
cd /workspaces/keep-pushing
npm run app:codespace:fresh
```

If you want the same flow but with a wiped DB and cleaned local artifacts first:

```bash
cd /workspaces/keep-pushing
npm run app:codespace:clean
```

If you really want to skip the rebuild and reuse the current artifact:

```bash
RUNANA_SKIP_PROGRAM_BUILD=1 npm run app:codespace:fresh
```

Paste this inside the Codespace shell:

```bash
set -euo pipefail

cd /workspaces/keep-pushing

export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/keep_pushing'
export RUNANA_ACTIVE_SEASON_ID=1

echo "==> Starting Docker Postgres"
docker compose up -d postgres

echo "==> Applying Prisma migrations"
npx prisma migrate deploy

echo "==> Stopping old local app / validator if present"
pkill -f "next dev -- --hostname 127.0.0.1 --port 3000" || true
pkill -f "next dev" || true
pkill -f solana-test-validator || true
pkill -f solana-faucet || true

mkdir -p .tmp

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
echo "App URL inside codespace: http://127.0.0.1:3000/"
echo "Old proof page inside codespace: http://127.0.0.1:3000/battle%20(old%20pof)"
echo "App log: /workspaces/keep-pushing/.tmp/local-app-dashboard.log"
echo "Next dev PID: $APP_PID"
echo
echo "From your machine, run:"
echo "gh codespace ssh -c ${CODESPACE_NAME:-<codespace-name>} -- -L 3000:127.0.0.1:3000"
echo
echo "Then open:"
echo "http://127.0.0.1:3000/"
```

This path is for local dev only:

- the DB stays inside the Codespace
- Vercel cannot reach this DB
- the browser path is the SSH tunnel, not `app.github.dev`

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
- reuse `.tmp/manual-character-test/validator-ledger-current` so validator state does not accumulate into a new multi-GB ledger on every run
- prune older timestamped artifact bundles automatically

Important:

- `RUNANA_SKIP_SERVER_START=1` is required in this mode because the app is already running
- if another validator is already running and you want a clean chain, stop it before running the helper
- after this helper finishes, restart the app with the generated `RUNANA_SERVER_SIGNER_KEYPAIR_PATH`

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
- roster and character management
- zone-run setup, active run, result, and share
- first sync and later settlement from the dedicated sync page

The old proof page is still available at:

```text
http://127.0.0.1:3000/battle%20(old%20pof)
```

## Expected Frontend Flow

### Local-First Path

1. Open `/`
2. Wait for anonymous user bootstrap
3. Create a character from the roster
4. Open the character page and press `Start Run`
5. Complete or abandon a run
6. Observe the result page and the sync summary move into a pending state

### Create And Initial Settlement Path

The current frontend uses Phantom directly for both first sync and later settlement.

This means:

- you connect Phantom in the browser
- the app prepares a client-signed transaction
- Phantom signs and sends that transaction once
- the client acknowledges the resulting txid back to the backend

The sync flow is sequential:

- first sync creates the on-chain character
- that same first sync transaction settles the oldest contiguous eligible backlog

When the app is started through `npm run app:local:fresh`, backend-side auto-ALT creation is already enabled, so you should not need a manual lookup-table step for normal browser testing.

If you need a developer fallback without using the browser UI for character creation, use:

```bash
npm run solana:character:create -- --player-keypair <path> --character-id <id>
```

### Post-Sync Settlement Path

After the character becomes `CONFIRMED`, the dashboard uses the same one-approval Phantom flow for later settlement batches.

When the app is started through `npm run app:local:fresh`, backend-side auto-ALT creation is also enabled for later settlement preparation.

For CLI-driven fallback on a confirmed character:

```bash
npm run solana:encounter:settle -- --player-keypair <path> --character-id <id>
```

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

### First-sync or settlement fails because the trusted server signer path is missing

Restart the host-run app with the generated signer path:

```bash
cd /home/paps/projects/keep-pushing
export RUNANA_SERVER_SIGNER_KEYPAIR_PATH="$(find .tmp/manual-character-test -path '*/keypairs/server.json' | sort | tail -n 1)"
```

### First-sync or settlement fails with `ERR_SETTLEMENT_LOOKUP_TABLE_REQUIRED`

If you started the app manually instead of through `npm run app:local:fresh`, either:

- restart with `RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES=1`, or
- create or extend the ALT explicitly for the current character

Manual fallback:

```bash
cd /home/paps/projects/keep-pushing
npm run solana:lookup-table:create -- \
  --mode first-sync \
  --character-id <character-id> \
  --authority <phantom-wallet-pubkey> \
  --payer-keypair "$(find .tmp/manual-character-test -path '*/keypairs/player.json' | sort | tail -n 1)"

export RUNANA_SETTLEMENT_LOOKUP_TABLES=<lookup-table-address>
```

The helper supports both:

- `--mode first-sync` for local-first characters
- `--mode settlement` for already-confirmed characters

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

Host-local variant. Assumption: you already have a local PostgreSQL server running on `127.0.0.1:5432` and a `postgres` superuser with password `postgres`. If your local Postgres uses different credentials, edit the vars at the top first.

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
