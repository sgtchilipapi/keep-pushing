# Local Solana Character Test Runbook

Status: Reproducible local runbook for Dockerized `keep-pushing` plus host-run Solana validator, with the reconciled zone-run flow as the canonical manual gameplay path.

Canonical path note:

- the canonical manual gameplay path is the homepage zone-run flow backed by `/api/zone-runs/*`, `/api/runs/:runId`, and the dedicated sync page
- the direct character/encounter helper scripts remain useful low-level troubleshooting tools, but they are not the primary product path anymore

This document captures the working manual test environment that was validated against:
- real Postgres
- real `keep-pushing` backend
- real local Solana validator
- real deployed `runana-program`
- real one-approval on-chain character creation and sync flows
- real zone-run gameplay and result/share pages through the main dashboard
- real settlement acknowledgement and reconciliation

## Scope

This runbook covers:
- Dockerized `keep-pushing` app + Postgres
- host-run `solana-test-validator`
- fresh `runana-program` deployment and bootstrap seeding
- canonical manual gameplay through `/`
- one-shot character creation via [createCharacter.ts](/home/paps/projects/keep-pushing/scripts/solana/createCharacter.ts)
- one-shot encounter plus settlement submission via [runEncounterSettlement.ts](/home/paps/projects/keep-pushing/scripts/solana/runEncounterSettlement.ts)

This runbook does not cover:
- production deployment hardening
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

## Disk Usage Warning

This workflow is not primarily Docker-heavy.

The main WSL growth points are:
- `keep-pushing/.tmp/manual-character-test`
- `runana-program/target`
- `runana-program/test-ledger`
- `runana-program/.tmp/test-ledger`

Use this cleanup command when you need space back quickly:

```bash
cd /home/paps/projects/keep-pushing
npm run app:local:clean-space
```

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
docker compose --env-file .env.docker up -d postgres app
```

Add `--build` only when `Dockerfile`, `package.json`, or app source changes require a fresh image:

```bash
docker compose --env-file .env.docker up -d --build postgres app
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
curl -i http://127.0.0.1:3000/api/v1/settlement/prepare
```

Expected:
- HTTP `405` or `401`
- the route responds, which confirms the app is up

Anonymous bootstrap has been removed. The app now requires a wallet-backed session for live gameplay flows.

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
  - class registry
  - versioned zone registry
  - versioned zone enemy set
  - enemy archetype registry
- writes local test artifacts under `.tmp/manual-character-test/<timestamp>`
- requires `RUNANA_USER_ID` to be set to an existing wallet-backed backend user id

The helper now reuses one validator ledger path instead of creating a new multi-GB ledger inside every timestamped artifact directory:
- `.tmp/manual-character-test/validator-ledger-current`

It also prunes older timestamped artifact bundles automatically.

`RUNANA_SKIP_SERVER_START=1` is important when the backend is already running in Docker. It prevents the helper from trying to start a second backend process on port `3000`.

Expected end state:
- validator listening on `http://127.0.0.1:8899`
- program deployed
- bootstrap seeding complete
- artifact directory printed

## 3A. Canonical Manual Gameplay Verification

Use this as the primary product-level check after bootstrap:

1. Open `http://127.0.0.1:3000/`
2. Sign in through the wallet-backed session flow
3. Create a character with class card + unique name
4. Open the character page and start a run
5. Complete or abandon the run through the zone-run UI
6. Open the result page or public share page
7. Use the dedicated sync page to perform settlement with the connected wallet

Expected product behavior:

- roster and character pages show season + sync context
- active play uses the zone-run map window, not raw encounter endpoints
- character creation and later settlement use wallet-backed sync flows
- the sync page surfaces the oldest unresolved run as the primary action

## 4. Create A Local-Only Character

If you want to exercise the new local-first flow, create a backend character first without sending any transaction on chain.

Use an existing wallet-backed `userId` and create a character directly:

```bash
curl -s -X POST http://127.0.0.1:3000/api/character/create \
  -H 'content-type: application/json' \
  -d '{
    "userId":"<user-id>",
    "name":"Local First Manual"
  }'
```

Expected:
- HTTP `201`
- JSON body with `characterId`

Example response shape:

```json
{
  "characterId": "...",
  "userId": "...",
  "name": "Local First Manual",
  "level": 1
}
```

At this point the newest character row should still be local-only:
- `chainCreationStatus = NOT_STARTED`
- `chainCharacterIdHex = NULL`
- `characterRootPubkey = NULL`

## 5. Simulate A Local-First Battle

With that backend-only `characterId`, execute a real battle simulation against a zone enemy:

```bash
curl -s -X POST http://127.0.0.1:3000/api/combat/encounter \
  -H 'content-type: application/json' \
  -d '{
    "characterId":"<character-id>",
    "zoneId":1,
    "seed":77
  }'
```

Expected:
- HTTP `201`
- JSON body with `battleId`, `enemyArchetypeId`, and `settlementStatus`

For a local-first character, the important expected field is:
- `settlementStatus = AWAITING_FIRST_SYNC`

That means:
- the battle replay was persisted to `BattleRecord`
- the settlement-facing row was persisted to `BattleOutcomeLedger`
- the battle is stored as local backlog waiting for first sync

## 6. Use The One-Shot Character Creation Script

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
- requires `--user-id` for an existing wallet-backed backend user
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

## 7. Verify Database State

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

## 8. Verify The Successful Character Example

In the validated manual run, a successful row looked like:
- `Character.id = f7e0c689-e20c-4db1-8def-b1b18b0a5d93`
- `chainCreationStatus = CONFIRMED`
- `chainCharacterIdHex = c06d7a4a0b5387bbe5879b8cf9857b22`
- `characterRootPubkey = 4nk4ceSc4PQ64BPD7Y2q1p5NUZaMpTxerKMANQzZLjDV`

That successful row existed alongside an older failed row from a stale blockhash submission, which confirmed that:
- local character rows are persisted before chain confirmation
- failed chain submission attempts remain visible in Postgres
- successful retries reconcile to a new `CONFIRMED` row

## 9. Execute Real Encounter And Submit Settlement

After you have a confirmed character id, run the one-shot encounter-plus-settlement helper:

```bash
cd /home/paps/projects/keep-pushing
npm run solana:encounter:settle -- \
  --player-keypair /home/paps/projects/keep-pushing/.tmp/manual-character-test/<timestamp>/keypairs/player.json \
  --server-url http://127.0.0.1:3000 \
  --character-id <character-id> \
  --zone-id 1 \
  --seed 77
```

This script lives at:
- [runEncounterSettlement.ts](/home/paps/projects/keep-pushing/scripts/solana/runEncounterSettlement.ts)

What it does:
- calls `POST /api/combat/encounter`
- calls `POST /api/solana/settlement/prepare` to fetch the player authorization message
- signs that message with the player keypair
- calls `POST /api/solana/settlement/prepare` again to fetch the prepared transaction
- signs the prepared transaction with the same player keypair
- calls `POST /api/solana/settlement/submit`
- writes request/response artifacts under `.tmp/manual-encounter-settlement/<timestamp>`

Expected successful output:

```text
artifacts=/home/paps/projects/keep-pushing/.tmp/manual-encounter-settlement/<timestamp>
battleId=<uuid>
battleNonce=<n>
enemyArchetypeId=<id>
settlementBatchId=<uuid>
settlementState=CONFIRMED
batchStatus=CONFIRMED
tx=<signature>
```

## 10. Verify Battle And Settlement State

Inspect recent battle records:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U postgres -d keep_pushing \
  -c 'SELECT id, "battleId", "characterId", "zoneId", "enemyArchetypeId", seed, "winnerEntityId", "roundsPlayed" FROM "BattleRecord" ORDER BY "createdAt" DESC LIMIT 10;'
```

Inspect recent battle outcome ledger rows:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U postgres -d keep_pushing \
  -c 'SELECT id, "battleId", "characterId", "battleNonce", "seasonId", "zoneId", "enemyArchetypeId", "settlementStatus", "sealedBatchId" FROM "BattleOutcomeLedger" ORDER BY "createdAt" DESC LIMIT 10;'
```

Inspect recent settlement batches:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U postgres -d keep_pushing \
  -c 'SELECT id, "characterId", "batchId", status, "startNonce", "endNonce", "latestTransactionSignature" FROM "SettlementBatch" ORDER BY "createdAt" DESC LIMIT 10;'
```

For a successful full run, the newest rows should show:
- one `BattleRecord` row for the encounter
- one matching `BattleOutcomeLedger` row
- one `SettlementBatch` row with `status = CONFIRMED`

For the local-first path from steps 4-5, before any on-chain sync, the newest rows should instead show:
- one `Character` row with `chainCreationStatus = NOT_STARTED`
- one `BattleRecord` row for the encounter
- one `BattleOutcomeLedger` row with `settlementStatus = AWAITING_FIRST_SYNC`
- no `SettlementBatch` row yet for that local-only battle

## 11. Common Failure Modes

### Docker permission denied

Symptom:
- `permission denied while trying to connect to the Docker daemon socket`

Fix:

```bash
sudo usermod -aG docker $USER
newgrp docker
docker ps
```

### Manual setup fails immediately asking for `RUNANA_USER_ID`

Cause:
- anonymous bootstrap has been removed from the app and setup scripts

Fix:
- create or locate an existing wallet-backed backend user id
- rerun the helper with `RUNANA_USER_ID=<user-id>`

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

## 12. Minimal Repro Sequence

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
RUNANA_USER_ID=<user-id> RUNANA_SKIP_SERVER_START=1 npm run solana:manual:character:setup
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

Then, after you have the printed `characterId`:

```bash
cd /home/paps/projects/keep-pushing
npm run solana:encounter:settle -- \
  --player-keypair /home/paps/projects/keep-pushing/.tmp/manual-character-test/<timestamp>/keypairs/player.json \
  --server-url http://127.0.0.1:3000 \
  --character-id <character-id> \
  --zone-id 1 \
  --seed 77
```

If that prints `settlementState=CONFIRMED`, the local environment is functioning end-to-end for character creation, real encounters, and settlement submission.

If you want the shortest local-first simulation path before on-chain sync, use an existing wallet-backed `userId`, then create a character and run the encounter routes directly.

## 13. What This Proves

This environment proves that the current backend can:
- persist character intent in Postgres
- create a backend-only character with no on-chain identity yet
- execute a real local-first encounter and persist it as `AWAITING_FIRST_SYNC`
- prepare a real Solana `create_character` transaction
- accept player-owned signatures
- submit to the on-chain program
- confirm and reconcile the resulting chain state back into Postgres
- execute a real settlement-backed encounter against a confirmed character
- persist replay and settlement ledger rows for that encounter
- seal, prepare, sign, submit, confirm, and reconcile a real settlement batch back into Postgres

In other words, the current stack now has a real local end-to-end path from character creation through encounter execution and settlement confirmation.
