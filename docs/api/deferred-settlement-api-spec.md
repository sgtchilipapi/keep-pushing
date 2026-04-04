# Deferred Settlement API Spec

## Purpose

This document describes the local-first deferred-settlement flow as a frontend-facing API spec.
It starts from anonymous user creation, covers local character creation and local battle simulation,
then walks through atomic first sync and the transition into normal post-sync settlement.

This spec reflects the current implementation.

## Master API Table

| Endpoint | Purpose | Request | Success Response | Key Errors | State Transition |
| --- | --- | --- | --- | --- | --- |
| `POST /api/auth/anon` | Create a backend-only user identity for prototype and local-first flows. | Empty JSON body: `{}` | `201` with `{ "userId": string }` | Standard HTTP validation/runtime errors only | No character yet; frontend stores `userId` for later character creation. |
| `GET /api/character?userId=<userId>` | Load the current frontend read model for a backend user. | Query param `userId` | `200` with `{ "character": null }` or `{ "character": CharacterReadModel }` | `400` when `userId` is missing | Read only. Source of truth for chain status, provisional progress, latest battle, and next settlement batch. |
| `POST /api/character/create` | Create the local-first backend character. | `{ "userId": string, "name"?: string }` | `201` with core gameplay character payload: ids, name, level, stats, skills | Validation errors, duplicate/ownership errors if applicable | Creates `Character` plus `CharacterProvisionalProgress`; chain status starts at `NOT_STARTED`. |
| `POST /api/combat/encounter` | Simulate and persist a real encounter for a stored character. | `{ "characterId": string, "zoneId": number }` | `201` with `{ "battleId", "characterId", "zoneId", "enemyArchetypeId", "seed", "battleNonce", "seasonId", "battleTs", "settlementStatus", "battleResult" }` | `ERR_CHARACTER_NOT_FOUND`, `ERR_ZONE_LOCKED`, `ERR_SEASON_NOT_ACTIVE` | Persists `BattleRecord` plus `BattleOutcomeLedger`; status becomes `AWAITING_FIRST_SYNC` for local-first characters or `PENDING` for chain-confirmed characters. |
| `POST /api/solana/character/first-sync/prepare` | Phase 1 of first sync: derive the first eligible batch and request player authorization. | `{ "characterId": string, "authority": base58, "feePayer"?: base58 }` without player signature | `200` with `{ "phase": "authorize", "payload", "expectedCursor", "permitDomain", "playerAuthorizationMessageBase64" }` | `ERR_NO_FIRST_SYNC_BACKLOG`, `ERR_NO_ELIGIBLE_FIRST_SYNC_BATTLES`, `ERR_CHARACTER_ALREADY_CONFIRMED`, `ERR_PLAYER_MUST_PAY` | Character may move into reserved/pending identity state; eligible backlog is selected and sealed for first sync. |
| `POST /api/solana/character/first-sync/prepare` | Phase 2 of first sync: build the atomic player-signed transaction. | Same request plus `playerAuthorizationSignatureBase64` | `200` with `{ "phase": "sign_transaction", ...authorizeFields, "serverAttestationMessageBase64", "preparedTransaction" }` | Signature validation failures, relay mismatch/build errors | Produces the opaque transaction bundle for `create_character + settlement batch 1`; frontend must sign, not mutate. |
| `POST /api/solana/character/first-sync/submit` | Broadcast the signed atomic first-sync transaction and reconcile local state. | `{ "prepared": PreparedTransaction, "signedMessageBase64": string, "signedTransactionBase64": string }` | `200` with `{ "characterId", "chainCreationStatus": "CONFIRMED", "transactionSignature", "chainCharacterIdHex", "characterRootPubkey", "firstSettlementBatchId", "remainingSettlementBatchIds", "chainCreatedAt", "cursor" }` | `ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH`, `ERR_SIGNED_*`, on-chain simulation/broadcast failures | Character becomes `SUBMITTED` then `CONFIRMED` on success; first batch becomes `CONFIRMED`; local-first ledger rows become `COMMITTED`. |
| `POST /api/solana/settlement/prepare` | Prepare a later post-sync settlement batch for an already confirmed character. | `{ "characterId": string, "authority": base58, "feePayer"?: base58, "relayRequestId"?: string }`, optionally with `playerAuthorizationSignatureBase64` on phase 2 | `200` with either authorize-phase or sign-transaction-phase settlement payload | Normal settlement prepare errors, cursor mismatch errors, signature validation errors | Readies the next pending batch after first sync; only valid once the character is chain-enabled. |
| `POST /api/solana/settlement/submit` | Broadcast a signed post-sync settlement transaction. | `{ "settlementBatchId": string, "prepared": PreparedTransaction, "signedMessageBase64": string, "signedTransactionBase64": string }` | `200` with settlement submission/reconciliation result | Signed payload mismatch, cursor mismatch, on-chain submission failures | Advances an existing `PENDING` or prepared batch to `SUBMITTED` and then `CONFIRMED` after reconciliation. |

### Read Model Shape

`CharacterReadModel` in the table above currently includes:

- core gameplay fields: `characterId`, `userId`, `name`, `level`, `exp`, `stats`, `activeSkills`, `passiveSkills`, `unlockedSkillIds`, `inventory`
- `chain`: authority, reserved/on-chain ids, chain creation status, tx signature, creation timestamps, and reconciled cursor
- `provisionalProgress`: highest unlocked zone, highest cleared zone, and zone-state map
- `latestBattle`: latest persisted ledger-facing battle summary
- `nextSettlementBatch`: next unconfirmed batch summary or `null`

## Terminology

| Term | Meaning |
| --- | --- |
| `userId` | Backend user identity. Not a wallet address. |
| `characterId` | Backend character UUID used by gameplay APIs. |
| `authority` | Player wallet public key in base58. |
| `chainCharacterIdHex` | Reserved/on-chain character identifier, encoded as 16-byte hex. |
| `characterRootPubkey` | PDA of the on-chain character root account. |
| `localSequence` | Monotonic local battle order before or after chain sync. |
| `battleNonce` | Canonical settlement nonce. For local-first encounter responses this currently mirrors the local sequence until first sync rebases the backlog. |
| `first sync` | Atomic transaction that creates the on-chain character and submits settlement batch 1 in the same transaction. |

## Status Enums

### Character Chain Status

| Value | Meaning |
| --- | --- |
| `NOT_STARTED` | Character exists only in backend storage. |
| `PENDING` | First-sync identity has been reserved in the DB, but nothing has been broadcast yet. |
| `SUBMITTED` | Signed on-chain first-sync transaction has been broadcast and is awaiting confirmation. |
| `CONFIRMED` | Character exists on chain and reconciled cursor state is persisted locally. |
| `FAILED` | First-sync submission failed and can be retried. |

### Battle Ledger Status

| Value | Meaning |
| --- | --- |
| `AWAITING_FIRST_SYNC` | Local-first battle is persisted and eligible to be rebased into first sync. |
| `LOCAL_ONLY_ARCHIVED` | Battle remains local history only and will never be sent on chain. |
| `PENDING` | Chain-enabled battle is waiting for the normal settlement pipeline. |
| `SEALED` | Battle has been assigned to a settlement batch. |
| `COMMITTED` | Settlement was confirmed and applied. |

### Settlement Batch Status

| Value | Meaning |
| --- | --- |
| `SEALED` | Batch exists and has a fixed payload, but no signed tx has been prepared yet. |
| `PREPARED` | Backend accepted a prepared transaction for submission. |
| `SUBMITTED` | Signed tx was broadcast and is awaiting reconciliation. |
| `CONFIRMED` | Batch confirmed on chain and local state is reconciled. |
| `FAILED` | Submission failed and may require retry or rebuild. |

## Endpoints

### `POST /api/auth/anon`

Creates a backend-only anonymous user.

Request body:

```json
{}
```

Success `201`:

```json
{
  "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43"
}
```

### `GET /api/character?userId=<userId>`

Returns the current character plus sync/settlement read model.

Query parameters:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | Backend user id returned by `/api/auth/anon`. |

Success when missing `200`:

```json
{
  "character": null
}
```

Success when present `200`:

```json
{
  "character": {
    "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
    "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43",
    "name": "Local First Manual",
    "level": 1,
    "exp": 0,
    "stats": {
      "hp": 1200,
      "hpMax": 1200,
      "atk": 120,
      "def": 70,
      "spd": 100,
      "accuracyBP": 8000,
      "evadeBP": 1200
    },
    "activeSkills": ["1001", "1002"],
    "passiveSkills": ["2001", "2002"],
    "unlockedSkillIds": ["1001", "1002"],
    "inventory": [],
    "chain": {
      "playerAuthorityPubkey": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM",
      "chainCharacterIdHex": "6f3a6c32d673a656a509ca3c586bcba1",
      "characterRootPubkey": "ArC7LLDz3VrQJa5qFAroeVYhQ9AiQLShzVnGZLSrihoK",
      "chainCreationStatus": "CONFIRMED",
      "chainCreationTxSignature": "43NKfpmsUZESAMrMYVVjpKoQyfVcZJ1AQrjUhNz3eKoEq6csoQ48x1WhHWurEFmf5Tys9fiSzZWsW9jTsEEbt7HH",
      "chainCreatedAt": "2026-04-04T16:21:58.733Z",
      "chainCreationTs": 1775288608,
      "chainCreationSeasonId": 1,
      "cursor": {
        "lastReconciledEndNonce": 1,
        "lastReconciledStateHash": "476e7c8b0e5a6b9110bec97a013c2591797efef1c48d7407dee031068f4b8052",
        "lastReconciledBatchId": 1,
        "lastReconciledBattleTs": 1775317466,
        "lastReconciledSeasonId": 1,
        "lastReconciledAt": "2026-04-04T16:21:58.733Z"
      }
    },
    "provisionalProgress": {
      "highestUnlockedZoneId": 3,
      "highestClearedZoneId": 2,
      "zoneStates": {
        "1": 2,
        "2": 2,
        "3": 1
      }
    },
    "latestBattle": {
      "battleId": "e01f1ce1-ecbb-4403-b1be-81f0239bd677",
      "localSequence": 1,
      "battleNonce": 1,
      "battleTs": 1775317466,
      "seasonId": 1,
      "zoneId": 1,
      "enemyArchetypeId": 104,
      "settlementStatus": "COMMITTED",
      "sealedBatchId": "1760fdde-96f7-40b8-8eb5-7f540bedf6c2",
      "committedAt": "2026-04-04T16:21:58.733Z"
    },
    "nextSettlementBatch": null
  }
}
```

### `POST /api/character/create`

Creates the local-first backend character.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | Backend user id. |
| `name` | `string` | no | Character display name. Defaults to `Rookie`. |

Example request:

```json
{
  "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43",
  "name": "Local First Manual"
}
```

Success `201`:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43",
  "name": "Local First Manual",
  "level": 1,
  "stats": {
    "hp": 1200,
    "hpMax": 1200,
    "atk": 120,
    "def": 70,
    "spd": 100,
    "accuracyBP": 8000,
    "evadeBP": 1200
  },
  "activeSkills": ["1001", "1002"],
  "passiveSkills": ["2001", "2002"],
  "unlockedSkillIds": ["1001", "1002"]
}
```

Backend side effects:

- creates `Character`
- creates `CharacterProvisionalProgress`
- leaves chain state at `NOT_STARTED`

### `POST /api/combat/encounter`

Runs a persisted encounter against a zone enemy.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `characterId` | `string` | yes | Backend character UUID. |
| `zoneId` | `number` | yes | Requested zone. |

Important:

- the client no longer provides a seed
- the backend generates the seed internally
- the generated seed is returned in the response for replay/debug use

Example request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "zoneId": 1
}
```

Success `201`:

```json
{
  "battleId": "e01f1ce1-ecbb-4403-b1be-81f0239bd677",
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "zoneId": 1,
  "enemyArchetypeId": 104,
  "seed": 77,
  "battleNonce": 1,
  "seasonId": 1,
  "battleTs": 1775317466,
  "settlementStatus": "AWAITING_FIRST_SYNC",
  "battleResult": {
    "battleId": "e01f1ce1-ecbb-4403-b1be-81f0239bd677",
    "seed": 77,
    "playerInitial": {
      "entityId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
      "side": "PLAYER",
      "name": "Local First Manual",
      "hp": 1200,
      "hpMax": 1200,
      "atk": 120,
      "def": 70,
      "spd": 100,
      "accuracyBP": 8000,
      "evadeBP": 1200,
      "activeSkillIds": ["1001", "1002"],
      "passiveSkillIds": ["2001", "2002"]
    },
    "enemyInitial": {
      "entityId": "104",
      "side": "ENEMY",
      "name": "Nano Leech",
      "hp": 860,
      "hpMax": 860,
      "atk": 102,
      "def": 54,
      "spd": 138,
      "accuracyBP": 8750,
      "evadeBP": 1825,
      "activeSkillIds": ["1003", "1005"],
      "passiveSkillIds": ["2001", "2002"]
    },
    "events": [],
    "winnerEntityId": "104",
    "roundsPlayed": 7
  }
}
```

Response fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `battleId` | `string` | Battle replay id. |
| `enemyArchetypeId` | `number` | Canonical enemy definition id. |
| `seed` | `number` | Generated server-side RNG seed for deterministic replay. |
| `battleNonce` | `number` | Current battle order identifier. In local-first flow this initially mirrors local sequence until rebasing. |
| `settlementStatus` | `PENDING \| AWAITING_FIRST_SYNC` | Whether the battle is ready for normal settlement or deferred first sync. |
| `battleResult` | `BattleResult` | Full deterministic replay payload. |

Local-first behavior:

- writes replay/history into `BattleRecord`
- writes settlement-facing row into `BattleOutcomeLedger`
- updates provisional world progress
- returns `settlementStatus = "AWAITING_FIRST_SYNC"`

Confirmed-character behavior:

- validates unlocked zone against on-chain world progress
- allocates the canonical next nonce
- returns `settlementStatus = "PENDING"`

## Deferred Settlement Narrative

### Step 1: User Exists, Character Does Not

The player first gets a backend `userId` from `POST /api/auth/anon`.
The frontend can then call `GET /api/character?userId=<userId>` to see whether a character already exists.

### Step 2: Create the Local Character

The frontend calls `POST /api/character/create`.
This creates a playable backend character immediately, with starter stats, starter skills, and provisional zone progress.
No on-chain character exists yet.

At this point:

- `chain.chainCreationStatus = NOT_STARTED`
- `provisionalProgress` exists
- `latestBattle = null`
- `nextSettlementBatch = null`

### Step 3: Play Local Battles Immediately

The frontend calls `POST /api/combat/encounter` with `characterId` and `zoneId`.
The backend generates the seed internally, selects a zone enemy deterministically from that seed, simulates the fight, persists the replay, and persists the ledger row.

For local-first battles:

- `latestBattle.settlementStatus = AWAITING_FIRST_SYNC`
- `nextSettlementBatch` is still `null` until the first-sync preparation path seals a batch

The frontend should treat these battles as real, persisted history, even though they are not on chain yet.

### Step 4: Prepare First Sync, Authorize Phase

When the player chooses to sync, the frontend calls:

```json
POST /api/solana/character/first-sync/prepare
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "authority": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM",
  "feePayer": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM"
}
```

The backend does all of the following:

- loads the earliest relevant local battle
- derives `characterCreationTs` from the local character `createdAt`
- derives `seasonIdAtCreation`
- reserves `chainCharacterIdHex`
- derives `characterRootPubkey`
- loads all `AWAITING_FIRST_SYNC` backlog
- archives stale closed-grace battles as `LOCAL_ONLY_ARCHIVED`
- rebases eligible battles onto canonical nonces starting at `1`
- computes the genesis cursor and the first settlement payload

The response is `phase = "authorize"` and contains:

- `payload`
- `expectedCursor`
- `permitDomain`
- `playerAuthorizationMessageBase64`

The frontend must ask the wallet to sign only the returned message bytes.

### Step 5: Prepare First Sync, Sign-Transaction Phase

The frontend sends the player signature back to the same prepare endpoint:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "authority": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM",
  "feePayer": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM",
  "playerAuthorizationSignatureBase64": "..."
}
```

The backend then:

- builds `create_character`
- builds server attestation ed25519 verification
- builds player authorization ed25519 verification
- builds `apply_battle_settlement_batch_v1`
- assembles a versioned transaction with lookup tables
- returns `preparedTransaction`

At this point the frontend should treat `preparedTransaction` as opaque.
Do not edit any relay metadata inside it.

### Step 6: Submit First Sync

The wallet signs `preparedTransaction.serializedTransactionBase64`.
The frontend then submits:

```json
POST /api/solana/character/first-sync/submit
{
  "prepared": { "...exact preparedTransaction..." },
  "signedMessageBase64": "...",
  "signedTransactionBase64": "..."
}
```

On success, the backend:

- broadcasts the atomic transaction
- waits for confirmation
- fetches the live on-chain character cursor
- updates the character row to `CONFIRMED`
- marks the sealed ledger rows as `COMMITTED`
- marks the first settlement batch as `CONFIRMED`

The response returns:

- `transactionSignature`
- `chainCharacterIdHex`
- `characterRootPubkey`
- `firstSettlementBatchId`
- `remainingSettlementBatchIds`
- reconciled `cursor`

### Step 7: Read Model After Successful First Sync

After success, `GET /api/character?userId=<userId>` becomes the main source of truth for the frontend.
Typical changes:

- `chain.chainCreationStatus` becomes `CONFIRMED`
- `chain.characterRootPubkey` is populated
- `chain.cursor` is populated
- `latestBattle.settlementStatus` becomes `COMMITTED`
- `nextSettlementBatch` becomes `null` unless additional unconfirmed batches remain

## First Sync Error Model

The most important error families the frontend should handle:

| Endpoint | Error Prefix | Meaning |
| --- | --- | --- |
| `GET /api/character` | normal HTTP 400 | missing `userId` query parameter |
| `POST /api/combat/encounter` | `ERR_CHARACTER_NOT_FOUND` | unknown backend character |
| `POST /api/combat/encounter` | `ERR_ZONE_LOCKED` | zone is not yet available |
| `POST /api/combat/encounter` | `ERR_SEASON_NOT_ACTIVE` | current configured season cannot accept encounters |
| `POST /api/solana/character/first-sync/prepare` | `ERR_NO_FIRST_SYNC_BACKLOG` | no deferred local battles exist |
| `POST /api/solana/character/first-sync/prepare` | `ERR_NO_ELIGIBLE_FIRST_SYNC_BATTLES` | backlog exists, but all of it was archived as stale local-only history |
| `POST /api/solana/character/first-sync/prepare` | `ERR_CHARACTER_ALREADY_CONFIRMED` | first sync is no longer needed |
| `POST /api/solana/character/first-sync/submit` | `ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH` | prepared transaction and persisted batch no longer agree |
| `POST /api/solana/character/first-sync/submit` | `ERR_SIGNED_*` | wallet submitted bytes that do not match the prepared transaction |

## Post-Sync Normal Settlement

Once `chain.chainCreationStatus = CONFIRMED`, later battles no longer use deferred settlement.

The encounter flow still begins with:

```json
POST /api/combat/encounter
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "zoneId": 1
}
```

But now the response has:

- `settlementStatus = "PENDING"`
- canonical progression is enforced against on-chain state

Later settlement uses:

- `POST /api/solana/settlement/prepare`
- `POST /api/solana/settlement/submit`

That path mirrors the same authorize -> sign_transaction -> submit pattern, but it no longer creates the character.

## Frontend Modeling Guidance

Recommended frontend top-level state buckets:

| Bucket | Source | Notes |
| --- | --- | --- |
| User | `/api/auth/anon` | Holds backend `userId`. |
| Character | `GET /api/character` | Main page-level read model. |
| Encounter Result | `/api/combat/encounter` | Immediate battle replay + latest ledger state. |
| First Sync Prepare | `/api/solana/character/first-sync/prepare` | Two-phase payload. |
| First Sync Submit | `/api/solana/character/first-sync/submit` | Broadcast result + final reconciled cursor. |
| Normal Settlement | `/api/solana/settlement/*` | Used only after chain confirmation. |

Recommended UI decisions:

- show a `Sync to chain` CTA when:
  - `chain.chainCreationStatus` is `NOT_STARTED`, `PENDING`, or `FAILED`
  - and `latestBattle.settlementStatus` is `AWAITING_FIRST_SYNC` or `SEALED`
- show a `Retry sync` CTA when:
  - `chain.chainCreationStatus = FAILED`
  - or `nextSettlementBatch.status = FAILED`
- show `On-chain ready` when:
  - `chain.chainCreationStatus = CONFIRMED`

## Future Work

### SSO Identity And Session-Bound Character Ownership

The current implementation still pivots on caller-supplied `userId` for user-bound reads and writes such as
`GET /api/character` and `POST /api/character/create`.

Future work should replace that with a proper authenticated user model:

- add SSO-backed identity creation and account linking
- issue and verify backend sessions
- derive the acting backend user from authenticated server context instead of request body or query string `userId`
- bind character creation and character reads to that authenticated user
- keep anonymous bootstrap only if it can later upgrade safely into a linked SSO account

This should be treated as a distinct deliverable:

- `SSO identity + session auth + user-bound character APIs`

That work is separate from deferred settlement itself, but it is the right follow-up if the frontend is moving from prototype flows toward production account ownership.
