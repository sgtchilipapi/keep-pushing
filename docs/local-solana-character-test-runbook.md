# Local Solana Character Test Runbook

Status: Reproducible local runbook for Dockerized `keep-pushing` plus host-run Solana validator and a one-shot real character creation test.

This document captures the working manual test environment that was validated against:
- real Postgres
- real `keep-pushing` backend
- real local Solana validator
- real deployed `runana-program`
- real on-chain character creation through backend prepare/sign/submit flow

## Scope

This runbook covers:
- Dockerized `keep-pushing` app + Postgres
- host-run `solana-test-validator`
- fresh `runana-program` deployment and bootstrap seeding
- one-shot character creation via [createCharacter.ts](/home/paps/projects/keep-pushing/scripts/solana/createCharacter.ts)

This runbook does not cover:
- production deployment hardening
- settlement manual testing
- wallet UI/browser integration

## Repos

- Backend: [keep-pushing](/home/paps/projects/keep-pushing)
- Program: `/home/paps/projects/runana-program`

## Prerequisites

Inside WSL or your Linux shell, install:
- Docker
- Docker Compose
- Solana CLI
- Node/npm

The program artifacts must already exist:
- `/home/paps/projects/runana-program/target/deploy/runana_program.so`
- `/home/paps/projects/runana-program/target/deploy/runana_program-keypair.json`

If Docker socket access fails, make sure your user is in the `docker` group:

```bash
sudo usermod -aG docker $USER
newgrp docker
docker ps
```

## 1. Start Dockerized Backend And Postgres

From [keep-pushing](/home/paps/projects/keep-pushing):

```bash
cd /home/paps/projects/keep-pushing
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

This starts:
- `postgres`
- `app`

The app uses:
- [docker-compose.yml](/home/paps/projects/keep-pushing/docker-compose.yml)
- [Dockerfile](/home/paps/projects/keep-pushing/Dockerfile)

The default Solana RPC URL inside the app container is:

```text
http://host.docker.internal:8899
```

That means the validator must run on the host, not inside the Docker stack.

## 2. Verify Backend Health

In a second terminal:

```bash
curl -i -X POST http://127.0.0.1:3000/api/auth/anon
```

Expected:
- HTTP `201`
- JSON body with `userId`

Example:

```json
{"userId":"..."}
```

## 3. Start Fresh Local Validator, Deploy Program, Seed Bootstrap

Use the setup helper from [setupManualCharacterTest.sh](/home/paps/projects/keep-pushing/scripts/solana/setupManualCharacterTest.sh).

Important:
- if you want a truly fresh deployment, stop any old validator first
- do not reuse a persistent validator state unless you also intend to reuse the same admin/bootstrap artifacts

To stop an old validator:

```bash
pkill -f solana-test-validator
```

Then run the setup helper:

```bash
cd /home/paps/projects/keep-pushing
RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup
```

What this does:
- starts `solana-test-validator --reset`
- generates deployer/admin/server/player keypairs
- deploys `runana-program`
- writes a bootstrap config
- seeds:
  - program config
  - season policy
  - zone registry
  - zone enemy set
  - enemy archetype registry
- creates an anon backend user
- writes local test artifacts under `.tmp/manual-character-test/<timestamp>`

`RUNANA_SKIP_SERVER_START=1` is important when the backend is already running in Docker. It prevents the helper from trying to start a second backend process on port `3000`.

Expected end state:
- validator listening on `http://127.0.0.1:8899`
- program deployed
- bootstrap seeding complete
- artifact directory printed

## 4. Use The One-Shot Character Creation Script

The easiest end-to-end test is now:

```bash
cd /home/paps/projects/keep-pushing
npm run solana:character:create -- \
  --player-keypair /home/paps/projects/keep-pushing/.tmp/manual-character-test/<timestamp>/keypairs/player.json \
  --server-url http://127.0.0.1:3000 \
  --season-id 1 \
  --zone-id 1 \
  --name "CLI Manual"
```

Use the actual timestamped artifact directory printed by the setup helper.

This script lives at:
- [createCharacter.ts](/home/paps/projects/keep-pushing/scripts/solana/createCharacter.ts)

What it does:
- creates an anon user if `--user-id` is not provided
- calls `POST /api/solana/character/create/prepare`
- signs the returned transaction with the provided player keypair
- calls `POST /api/solana/character/create/submit`
- writes request/response artifacts under `.tmp/manual-character-create/<timestamp>`

Expected successful output:

```text
artifacts=/home/paps/projects/keep-pushing/.tmp/manual-character-create/<timestamp>
userId=<uuid>
characterId=<uuid>
status=CONFIRMED
tx=<signature>
chainCharacterIdHex=<hex>
characterRootPubkey=<pubkey>
```

## 5. Verify Database State

Inspect the latest users:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U postgres -d keep_pushing \
  -c 'SELECT id, "createdAt", "updatedAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 5;'
```

Inspect the latest characters:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U postgres -d keep_pushing \
  -c 'SELECT id, "userId", name, "chainCreationStatus", "chainCharacterIdHex", "characterRootPubkey" FROM "Character" ORDER BY "createdAt" DESC LIMIT 10;'
```

For a successful run, the newest character row should show:
- `chainCreationStatus = CONFIRMED`
- non-null `chainCharacterIdHex`
- non-null `characterRootPubkey`

You may also see older `FAILED` character rows from stale-blockhash attempts. That is expected behavior for the current DB-first flow.

## 6. Verify The Successful Character Example

In the validated manual run, a successful row looked like:
- `Character.id = f7e0c689-e20c-4db1-8def-b1b18b0a5d93`
- `chainCreationStatus = CONFIRMED`
- `chainCharacterIdHex = c06d7a4a0b5387bbe5879b8cf9857b22`
- `characterRootPubkey = 4nk4ceSc4PQ64BPD7Y2q1p5NUZaMpTxerKMANQzZLjDV`

That successful row existed alongside an older failed row from a stale blockhash submission, which confirmed that:
- local character rows are persisted before chain confirmation
- failed chain submission attempts remain visible in Postgres
- successful retries reconcile to a new `CONFIRMED` row

## 7. Common Failure Modes

### Docker permission denied

Symptom:
- `permission denied while trying to connect to the Docker daemon socket`

Fix:

```bash
sudo usermod -aG docker $USER
newgrp docker
docker ps
```

### Backend `POST /api/auth/anon` returns 500

This was fixed by explicit ID generation in [prisma.ts](/home/paps/projects/keep-pushing/lib/prisma.ts). If this reappears, rebuild the app container:

```bash
docker compose --env-file .env.docker up --build -d app
```

### Bootstrap admin mismatch or season mismatch

Symptom:
- `ERR_PROGRAM_CONFIG_ADMIN_MISMATCH`
- `ERR_SEASON_POLICY_EXISTS_WITH_DIFFERENT_VALUES`

Cause:
- reusing an old validator state with a new set of admin/bootstrap keypairs

Fix:
- stop the old validator
- start a fresh `--reset` validator
- rerun the setup helper

### `Blockhash not found`

Cause:
- too much time passed between `prepare` and `submit`

Fix:
- do not manually pause between prepare and submit
- prefer the one-shot CLI script
- if doing the flow manually, re-run `prepare`, sign immediately, then submit immediately

## 8. Minimal Repro Sequence

If you want the shortest reliable path:

```bash
cd /home/paps/projects/keep-pushing
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

In another terminal:

```bash
pkill -f solana-test-validator || true
cd /home/paps/projects/keep-pushing
RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup
```

Then, using the printed manual-test artifact directory:

```bash
cd /home/paps/projects/keep-pushing
npm run solana:character:create -- \
  --player-keypair /home/paps/projects/keep-pushing/.tmp/manual-character-test/<timestamp>/keypairs/player.json \
  --server-url http://127.0.0.1:3000 \
  --season-id 1 \
  --zone-id 1 \
  --name "CLI Manual"
```

If that prints `status=CONFIRMED`, the local environment is functioning end-to-end.

## 9. What This Proves

This environment proves that the current backend can:
- persist character intent in Postgres
- prepare a real Solana `create_character` transaction
- accept player-owned signatures
- submit to the on-chain program
- confirm and reconcile the resulting chain state back into Postgres

In other words, the current stack has a real local end-to-end character creation path from backend to on-chain program.
