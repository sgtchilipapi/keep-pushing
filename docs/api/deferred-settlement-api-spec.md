# Deferred Settlement API Spec

## Purpose

This document describes the reconciled MVP API surface for:

- automatic anonymous account bootstrap
- wallet linking
- local-first character creation
- canonical zone-run execution
- run-scoped result/share surfaces
- atomic first sync
- later deferred settlement

This spec supersedes the older two-phase opaque prepared-transaction flow. The canonical transport direction is now:

- play first, DB persisted first, sync later,
- server computes runs and settlement data,
- server attests settlement payloads,
- player authorizes by signing the Solana transaction itself,
- client builds or finalizes the transaction locally and submits it,
- client acknowledges the `txid` back to the backend for reconciliation.

Companion references:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

## Canonical Lifecycle Summary

1. App first open auto-creates an anonymous server-backed account and session.
2. Player creates a local-first character immediately with `name` and `classId`.
3. Player enters canonical `/api/zone-runs/*` gameplay.
4. Runs close into durable closed-run summaries.
5. First sync creates the on-chain character and settles the earliest eligible closed-run batch.
6. Later sync settles one oldest-contiguous eligible closed-run batch per sync tap.
7. Public share/result pages are layered on top of durable `runId` records.

Important reconciled rules:

- anonymous users are real backend users, not fake local-only placeholders,
- anon users may have exactly 1 character,
- wallet-linked users may have up to 3 characters,
- `name` and `classId` are chosen at local-first creation time,
- `name` and `classId` are mirrored on-chain during first sync character creation,
- grace is sync/closure-only for seasonal progression,
- no run is ever split across two settlement batches.

## Session And Identity Model

### Account Modes

- `anon`
- `wallet-linked`

### Session Model

- anonymous and wallet-linked users both use the same cookie-backed server session model
- `POST /api/auth/anon` is the canonical anonymous bootstrap endpoint
- the client should call it automatically on first open if no valid session exists

### Wallet Linking Model

- wallet linking upgrades the current user account in the normal case
- if the connected wallet belongs to a different known account, the UI may offer:
  - continue with wallet account
  - stay anon

## Master API Table

| Endpoint | Purpose | Request | Success Response | Notes |
| --- | --- | --- | --- | --- |
| `POST /api/auth/anon` | Auto-bootstrap anonymous server-backed user/session. | `{}` | `201` with account/session summary | Called automatically on first open when no session exists. |
| `POST /api/auth/wallet/challenge` | Begin wallet link/sign-in flow. | `{ "walletAddress": string }` | `{ "challengeId": string, "message": string, "expiresAt": string }` | One-time challenge with expiry. |
| `POST /api/auth/wallet/verify` | Verify wallet signature and link/restore session. | `{ "challengeId": string, "walletAddress": string, "signature": string }` | `{ "session": ..., "userSummary": ..., "accountMode": ... }` | Cookie session remains canonical. |
| `GET /api/classes` | Return enabled class catalog for UI. | none | `{ "classes": [...] }` | Backed by on-chain-enabled class registry plus off-chain display metadata. |
| `GET /api/seasons/current` | Return current season presentation + timing. | none | `{ "seasonId", "seasonNumber", "seasonName", "seasonStartTs", "seasonEndTs", "commitGraceEndTs", "phase" }` | Server combines chain timing with presentation metadata. |
| `GET /api/characters` | Return session user's roster. | none | `{ "accountMode", "slotsTotal", "characters": [...] }` | Server owns slot assignment. |
| `POST /api/characters` | Create local-first playable character immediately. | `{ "name": string, "classId": string, "slotIndex"?: number }` | `201` with character summary/read model | On-chain character does not exist yet. |
| `GET /api/characters/:characterId` | Character detail/read model. | none | `{ "character", "progression", "season", "sync" }` | Session-scoped. |
| `GET /api/characters/:characterId/sync` | Per-character sync/read model. | none | `{ "character", "progression", "syncSummary", "pendingBatches" }` | Retry flows anchor here. |
| `POST /api/zone-runs/start` | Start active run. | `{ "characterId": string, "zoneId": number }` | full active-run snapshot | Canonical gameplay write path. |
| `GET /api/zone-runs/active?characterId=...` | Resume/reload active run. | query param | full active-run snapshot or `null` | Reload-safe. |
| `POST /api/zone-runs/choose-branch` | Choose next legal branch at node boundary. | `{ "runId": string, "branchId": string }` | full active-run snapshot | Requires `Idempotency-Key`. |
| `POST /api/zone-runs/advance` | Consume one subnode and resolve no-combat/combat. | `{ "runId": string }` | full active-run snapshot + optional battle payload | Requires `Idempotency-Key`. |
| `POST /api/zone-runs/use-skill` | Use out-of-combat pause skill. | `{ "runId": string, "skillId": string }` | full active-run snapshot | Pause-state only. |
| `POST /api/zone-runs/continue` | Exit post-battle pause. | `{ "runId": string }` | full active-run snapshot | Requires `Idempotency-Key`. |
| `POST /api/zone-runs/abandon` | Abandon current run. | `{ "runId": string }` | closed-run summary + character summary | Requires `Idempotency-Key`. |
| `GET /api/runs/:runId` | Read closed run/result page data. | none | `{ "run", "character", "result", "status" }` | Canonical in-app result route. |
| `POST /api/runs/:runId/share` | Generate share payload and public URL. | none | `{ "shareUrl", "shareText", "status" }` | Share remains valid even if later expired. |
| `POST /api/solana/character/first-sync/prepare` | Prepare atomic first sync for unsynced character. | `{ "characterId": string, "authority": string }` | structured first-sync contract | No separate player authorization phase. |
| `POST /api/solana/character/first-sync/ack` | Acknowledge first-sync transaction submission. | `{ "characterId": string, "settlementBatchId": string, "txid": string }` | `{ "settlementBatchId", "attemptId", "status" }` | Client calls immediately after submit. |
| `POST /api/solana/settlement/prepare` | Prepare next post-sync batch for settled character. | `{ "characterId": string, "authority": string }` | structured settlement contract | One batch per sync tap. |
| `POST /api/solana/settlement/ack` | Acknowledge post-sync batch transaction submission. | `{ "characterId": string, "settlementBatchId": string, "txid": string }` | `{ "settlementBatchId", "attemptId", "status" }` | Retries target the same unresolved batch. |

## Canonical Read Models

### Character Summary

Minimum summary surface:

- `characterId`
- `name`
- `classId`
- `level`
- `syncStatus`

### Character Read Model

Canonical fields:

- core identity:
  - `characterId`
  - `name`
  - `classId`
  - `slotIndex`
- gameplay state:
  - `level`
  - `exp`
  - `stats`
  - `activeSkills`
  - `passiveSkills`
- progression state:
  - highest unlocked zone
  - highest cleared zone
  - active run summary
- chain state:
  - authority pubkey
  - chain creation status
  - chain character id
  - character root pubkey
  - reconciled cursor
- sync state:
  - next unresolved batch summary
  - latest confirmed settlement summary

### Run Read Model

Canonical fields:

- `runId`
- `characterId`
- `zoneId`
- `seasonId`
- `terminalStatus`
- `status`:
  - `Pending`
  - `Synced`
  - `Expired`
- result summary
- share state
- public-share eligibility

## Status Enums

### Character Chain Status

| Value | Meaning |
| --- | --- |
| `NOT_STARTED` | Character exists only in backend storage and has never synced on-chain. |
| `PENDING` | First-sync data is prepared or reserved, but no acknowledged confirmed chain creation exists yet. |
| `SUBMITTED` | First-sync transaction was submitted and is awaiting reconciliation. |
| `CONFIRMED` | Character exists on-chain and reconciled cursor state is persisted. |
| `FAILED` | The latest first-sync attempt failed and may be retried. |

### Closed Run Settlement Status

| Value | Meaning |
| --- | --- |
| `PENDING` | Run is closed and eligible for settlement but not yet confirmed. |
| `SYNCED` | The run's rewarded outcome has been reconciled on-chain. |
| `EXPIRED` | The run missed grace and remains history only. |

### Internal Settlement Batch Status

| Value | Meaning |
| --- | --- |
| `SEALED` | Batch exists with stable closed-run membership and payload surface. |
| `PREPARED` | Backend prepared structured client-build data for the batch. |
| `SUBMITTED` | Client submitted the transaction and acknowledged the `txid`; reconciliation is pending. |
| `CONFIRMED` | Batch confirmed on-chain and local state is reconciled. |
| `FAILED` | Latest attempt failed; same unresolved batch remains retryable. |
| `EXPIRED` | Batch can no longer settle because grace or season rules were crossed. |

## Endpoint Details

### `POST /api/auth/anon`

Creates the anonymous user and establishes the canonical cookie session.

Request:

```json
{}
```

Success `201`:

```json
{
  "session": {
    "accountMode": "anon"
  },
  "userSummary": {
    "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43",
    "accountMode": "anon",
    "characterCount": 0
  }
}
```

### `POST /api/auth/wallet/challenge`

Request:

```json
{
  "walletAddress": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM"
}
```

Success `200`:

```json
{
  "challengeId": "7b3dc1c3-4cb8-46b4-b39e-1198e15fbc85",
  "message": "RUNANA|wallet-link|...",
  "expiresAt": "2026-04-11T12:00:00.000Z"
}
```

### `POST /api/auth/wallet/verify`

Request:

```json
{
  "challengeId": "7b3dc1c3-4cb8-46b4-b39e-1198e15fbc85",
  "walletAddress": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM",
  "signature": "..."
}
```

Success `200`:

```json
{
  "session": {
    "accountMode": "wallet-linked"
  },
  "userSummary": {
    "userId": "18f08d21-4b0b-4f65-b53a-86f0f0479e43",
    "accountMode": "wallet-linked",
    "characterCount": 1
  },
  "accountMode": "wallet-linked"
}
```

### `POST /api/characters`

Creates the immediately playable backend character.

Rules:

- anon users may create exactly 1 character
- wallet-linked users may create up to 3 characters
- names must be globally unique at create time
- names must satisfy `3-16 ASCII alnum/space`
- classes must resolve to enabled canonical class ids
- this does not create the on-chain character yet

Request:

```json
{
  "name": "Local First Manual",
  "classId": "soldier",
  "slotIndex": 0
}
```

Success `201`:

```json
{
  "character": {
    "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
    "name": "Local First Manual",
    "classId": "soldier",
    "slotIndex": 0,
    "level": 1,
    "syncStatus": "NOT_STARTED"
  }
}
```

### `POST /api/zone-runs/start`

Starts the canonical zone-run execution session.

Request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "zoneId": 1
}
```

Success `201`:

```json
{
  "runId": "f7e08c58-c1ef-4f72-8042-7ca0724f8d8d",
  "snapshot": {
    "runId": "f7e08c58-c1ef-4f72-8042-7ca0724f8d8d",
    "zoneId": 1,
    "seasonId": 1,
    "nodeId": "start",
    "subnodeId": "s1",
    "postBattlePause": false
  }
}
```

### `GET /api/runs/:runId`

Returns the canonical in-app run result/read model after closure.

Success `200`:

```json
{
  "run": {
    "runId": "f7e08c58-c1ef-4f72-8042-7ca0724f8d8d",
    "zoneId": 1,
    "terminalStatus": "SUCCESS",
    "status": "Pending"
  },
  "character": {
    "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
    "name": "Local First Manual",
    "classId": "soldier",
    "level": 1
  },
  "result": {
    "rewardedBattleCount": 2,
    "shareReady": true
  }
}
```

### `POST /api/runs/:runId/share`

Generates canonical share payload and public share URL.

Success `200`:

```json
{
  "shareUrl": "https://example.com/runs/f7e08c58-c1ef-4f72-8042-7ca0724f8d8d",
  "shareText": "Local First Manual cleared Zone 1",
  "status": "Pending"
}
```

### `POST /api/solana/character/first-sync/prepare`

Prepares the atomic first sync for a local-first character.

Canonical backend work:

- verify the character still needs first sync
- load the oldest-contiguous eligible closed runs
- derive the first settlement batch
- reserve or confirm on-chain identity fields
- build the `create_character` argument surface using backend `name` + `classId`
- sign the server attestation payload
- return structured data for the client to build the transaction locally

Request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "authority": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM"
}
```

Success `200`:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "settlementBatchId": "1760fdde-96f7-40b8-8eb5-7f540bedf6c2",
  "phase": "sign_transaction",
  "chainCharacterIdHex": "6f3a6c32d673a656a509ca3c586bcba1",
  "characterRootPubkey": "ArC7LLDz3VrQJa5qFAroeVYhQ9AiQLShzVnGZLSrihoK",
  "createCharacterArgs": {
    "name": "Local First Manual",
    "classId": "soldier",
    "initialUnlockedZoneId": 1
  },
  "payload": {
    "batchId": 1
  },
  "serverAttestation": {
    "messageBase64": "...",
    "signatureBase64": "...",
    "signerPubkey": "..."
  },
  "accountMetas": {
    "programAccounts": [],
    "remainingAccounts": []
  }
}
```

Client behavior:

- build the transaction locally,
- include the server ed25519 verification pre-instruction,
- sign once in the wallet,
- submit directly from the client,
- call the ack endpoint immediately with the resulting `txid`.

### `POST /api/solana/character/first-sync/ack`

Request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "settlementBatchId": "1760fdde-96f7-40b8-8eb5-7f540bedf6c2",
  "txid": "43NKfpmsUZESAMrMYVVjpKoQyfVcZJ1AQrjUhNz3eKoEq6csoQ48x1WhHWurEFmf5Tys9fiSzZWsW9jTsEEbt7HH"
}
```

Success `200`:

```json
{
  "settlementBatchId": "1760fdde-96f7-40b8-8eb5-7f540bedf6c2",
  "attemptId": "b5165cc0-d9d8-4b69-b773-8cfb57af6f88",
  "status": "SUBMITTED"
}
```

### `POST /api/solana/settlement/prepare`

Prepares the next post-sync settlement batch for a chain-confirmed character.

Rules:

- exactly one oldest-contiguous eligible batch per sync tap,
- no run splitting,
- unresolved failed batch remains the same retry target until resolved or expired.

Request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "authority": "2JLY94AmCGnZFV3pJJoMwrtaQ4gMGdm7qmK7zMSVuoRM"
}
```

Success `200` with work:

```json
{
  "settlementBatchId": "6bba6a34-f177-4f92-9448-57d91b5c48c7",
  "phase": "sign_transaction",
  "payload": {
    "batchId": 7
  },
  "runIds": [
    "f7e08c58-c1ef-4f72-8042-7ca0724f8d8d"
  ],
  "serverAttestation": {
    "messageBase64": "...",
    "signatureBase64": "...",
    "signerPubkey": "..."
  },
  "accountMetas": {
    "programAccounts": [],
    "remainingAccounts": []
  }
}
```

Success `200` with no work:

```json
{
  "settlementBatchId": null,
  "status": "NOOP",
  "runIds": []
}
```

### `POST /api/solana/settlement/ack`

Request:

```json
{
  "characterId": "b05bb2e8-c01d-42b3-8d7e-fc03982a22b8",
  "settlementBatchId": "6bba6a34-f177-4f92-9448-57d91b5c48c7",
  "txid": "5T4x..."
}
```

Success `200`:

```json
{
  "settlementBatchId": "6bba6a34-f177-4f92-9448-57d91b5c48c7",
  "attemptId": "8e244296-3478-4c0b-9650-9472df2c1d97",
  "status": "SUBMITTED"
}
```

## Error Model

Important error families:

| Endpoint | Error | Meaning |
| --- | --- | --- |
| `POST /api/characters` | `ERR_NAME_INVALID` | Name failed format validation. |
| `POST /api/characters` | `ERR_NAME_TAKEN` | Name already belongs to another character. |
| `POST /api/characters` | `ERR_CLASS_DISABLED` | Class id is not enabled. |
| `POST /api/characters` | `ERR_SLOT_UNAVAILABLE` | Requested slot cannot be used in the current account mode. |
| `POST /api/zone-runs/start` | `ERR_ZONE_LOCKED` | Zone is not available to the character. |
| `POST /api/zone-runs/start` | `ERR_RUN_ALREADY_ACTIVE` | Character already has an active run. |
| `POST /api/solana/character/first-sync/prepare` | `ERR_CHARACTER_ALREADY_CONFIRMED` | First sync is not needed anymore. |
| `POST /api/solana/character/first-sync/prepare` | `ERR_NO_ELIGIBLE_FIRST_SYNC_RUNS` | No closed runs are eligible for first sync. |
| `POST /api/solana/settlement/prepare` | `ERR_NO_PENDING_SETTLEMENT` | No eligible unresolved settlement batch exists. |
| `POST /api/solana/*/ack` | `ERR_BATCH_MISMATCH` | The acknowledged tx does not match the unresolved batch state. |
| `POST /api/solana/*/ack` | `ERR_SIGNED_TX_MISMATCH` | Submitted transaction does not match expected client-build contract. |

## Player-Facing Sync Guidance

- normal season:
  - gameplay and sharing remain emotionally primary,
  - sync remains a dedicated per-character surface,
  - one sync action attempts one batch.
- grace period:
  - no new season gameplay should count,
  - at-risk unsynced progress must surface clearly,
  - expired runs remain viewable and shareable but cannot settle.

## Notes For Implementation

- the current direct encounter route may remain only as a non-canonical sandbox/testing path,
- canonical gameplay and canonical settlement generation must come from closed zone runs,
- internal backend statuses may remain richer than player-facing labels,
- player-facing statuses should continue to map to:
  - `Pending`
  - `Synced`
  - `Expired`
