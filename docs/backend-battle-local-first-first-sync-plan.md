# Backend Battle Plan: Local-First Combat With Atomic First Sync

This document defines the Model 2 plan for allowing a character to battle before on-chain creation and then perform a first on-chain sync that creates the character and settles the first backlog batch atomically.

Current-program-over-doc precedence:
- If this document conflicts with the current `runana-program`, implementation must follow the program interface first and record the mismatch explicitly.
- This document is a companion to [backend-solana-integration-implementation-plan.md](/home/paps/projects/keep-pushing/docs/backend-solana-integration-implementation-plan.md) and [backend-battle-real-character-enemy-integration-plan.md](/home/paps/projects/keep-pushing/docs/backend-battle-real-character-enemy-integration-plan.md).
- This plan extends the existing settlement-backed combat direction instead of replacing the current confirmed-character flow.

## Status

Status: In progress. Steps 1-8 are implemented and committed. Step 9 remains.

## Summary

- A player can create a character in the backend and start battling immediately, before on-chain character creation.
- These pre-chain battles are persisted with real timestamps and real replay history.
- The first sync prepares one player-signed transaction that:
  - creates the character on chain
  - verifies the required ed25519 attestations
  - applies the first settlement batch in the same transaction
- The on-chain `character_creation_ts` is backdated to the local character origin time rather than the first-sync submission time.
- Pre-chain backlog from seasons whose commit grace has already closed is retained as local history only and is not sent on chain.

## Clarification: On-Chain Character Creation Timestamp

The critical rule in this model is:

- `character_creation_ts` stored on chain must equal the local character's original creation time, not the wall-clock time when the first-sync transaction lands.

Example:

- local character row created at `2026-04-01T10:00:00Z`
- local battles happen at `2026-04-01T11:00:00Z` and `2026-04-02T09:00:00Z`
- first sync is submitted at `2026-04-04T18:00:00Z`

Then:

- the `create_character` instruction writes `character_creation_ts = 2026-04-01T10:00:00Z`
- the first settlement batch includes battles from `2026-04-01T11:00:00Z` onward
- settlement validation passes because those battle timestamps are after the stored `character_creation_ts`

This matters because the current program validates against the `character_creation_ts` field stored in the account, not against the transaction execution timestamp.

## Goals

- Allow local-first battle simulation for characters that are not yet confirmed on chain.
- Persist full replay history and settlement-facing battle metadata for pre-chain battles.
- Preserve real battle timestamps rather than restamping battles at sync time.
- Support a first on-chain sync that is atomic at the transaction level.
- Reuse the existing settlement pipeline for all post-first-sync batches.

## Non-Goals

- Do not support settlement of stale backlog after the relevant season commit grace has closed.
- Do not redesign the normal post-confirmation settlement flow.
- Do not require a reserved chain identity before local-first battles begin.
- Do not introduce persistent enemy-instance storage in this slice.

## Locked Decisions

- Pre-chain battles use real timestamps and remain ordered by real occurrence time.
- Pre-chain zone access is governed by provisional DB-backed progression, not on-chain world-progress accounts.
- Wallet authority, `chainCharacterIdHex`, and `characterRootPubkey` are assigned at first sync, not before.
- The on-chain `character_creation_ts` is set from the local character row origin time.
- The first sync is one atomic player-owned transaction.
- Only the first eligible batch is included in the atomic first-sync transaction.
- Remaining eligible backlog batches are processed through the normal settlement pipeline after the first sync confirms.
- Battles from closed-grace seasons remain durable local history but are permanently non-settleable.

## Current Gaps

- [realEncounter.ts](/home/paps/projects/keep-pushing/lib/combat/realEncounter.ts) currently requires `chainCreationStatus = CONFIRMED`, a reconciled cursor, on-chain world progress, and on-chain season policy before a battle can execute.
- [characterCreation.ts](/home/paps/projects/keep-pushing/lib/solana/characterCreation.ts) currently sets `characterCreationTs` from prepare-time `now` instead of from the local character origin timestamp.
- The current persistence model has no explicit state for pre-chain battle backlog that is waiting for first sync.
- The current sealing flow assumes a live on-chain character cursor already exists before batch preparation begins.

## Target Architecture

### Local-first encounter path

- Keep the existing confirmed-character encounter flow as one mode of operation.
- Add a local-first branch for characters whose chain creation has not yet been confirmed.
- In the local-first branch:
  - load the real character from DB
  - resolve the zone encounter using the shared enemy registry and zone encounter tables
  - validate zone access against provisional DB progression
  - resolve the active season from backend-controlled season data
  - execute the battle and persist replay history immediately

### Provisional progression

- Add a DB-backed provisional world progression model for characters that have not yet synced on chain.
- Track enough data to reproduce settlement legality rules later:
  - highest unlocked zone
  - highest cleared zone
  - zone state where needed for progression deltas
- Advance provisional progression from battle outcomes so pre-chain unlock flow behaves like normal progression.

### Pre-chain battle persistence

- Extend battle persistence so pre-chain battles can exist before chain identity and final nonce assignment exist.
- Persist:
  - battle replay/history in `BattleRecord`
  - settlement-facing backlog in `BattleOutcomeLedger` or a closely related model with explicit pre-chain states
- Add lifecycle states that distinguish:
  - waiting for first sync
  - archived local-only history
  - pending normal sealing
  - sealed
  - settled

### First-sync preparation service

- Add a dedicated first-sync prepare service and route for characters with pre-chain backlog.
- This service must:
  - lock the character and eligible unsettled battles
  - assign `playerAuthorityPubkey`, `chainCharacterIdHex`, and `characterRootPubkey`
  - derive the canonical genesis state hash for the assigned identity
  - compute the creation season from the local character origin timestamp
  - set on-chain `character_creation_ts` from the local character origin timestamp
  - partition the backlog into eligible and archived subsets based on season/grace policy
  - rebase the eligible backlog onto the new genesis cursor by assigning final battle nonces and state-hash continuity
  - build the first settlement payload from the oldest eligible contiguous batch

### Atomic first sync transaction

- Prepare one player-owned transaction containing:
  - `create_character`
  - server ed25519 verification instruction
  - player ed25519 verification instruction
  - `apply_battle_settlement_batch_v1`
- The transaction must fail atomically if either character creation or first batch settlement fails.
- Only batch 1 of the eligible backlog is included in this transaction.

### Post-first-sync flow

- After the first sync confirms:
  - reconcile the on-chain cursor into the local character row
  - transition remaining rebased backlog rows into the standard settlement queue state
  - reuse the existing sealing and relay path for all later batches
- New battles after confirmation follow the normal confirmed-character encounter and settlement path.

## Execution Flow

### Local-first battle execution

1. Validate `characterId`, `zoneId`, and `seed`.
2. Load the local character and equipped skills/passives.
3. If the character is not chain-confirmed, branch into local-first execution.
4. Resolve provisional progression and validate zone access locally.
5. Resolve the active season from backend season configuration.
6. Select the enemy deterministically from the zone table.
7. Assemble player and enemy snapshots.
8. Run `simulateBattle(...)`.
9. Persist `BattleRecord`.
10. Persist a settlement-facing backlog row in a pre-first-sync state with real battle timestamp and no final on-chain nonce yet.
11. Update provisional progression based on the outcome.
12. Return the persisted battle metadata and battle result.

### First sync preparation

1. Validate that the character is not yet confirmed on chain.
2. Lock the character row and the unsettled pre-chain backlog.
3. Resolve the player's authority and assign the final chain identity.
4. Compute `character_creation_ts` from the local character row origin timestamp.
5. Resolve `season_id_at_creation` from that timestamp.
6. Archive any backlog rows whose season commit grace is already closed.
7. Build a virtual genesis cursor:
   - `last_committed_end_nonce = 0`
   - `last_committed_batch_id = 0`
   - `last_committed_battle_ts = character_creation_ts`
   - `last_committed_season_id = season_id_at_creation`
   - `last_committed_state_hash = genesis_state_hash`
8. Rebase the remaining eligible backlog in chronological order:
   - assign contiguous nonces starting at `1`
   - compute deterministic state-hash continuity
   - group rows into canonical settlement batches
9. Build the first batch settlement envelope and transaction.
10. Persist the reserved identity and rebased batch metadata so retries are deterministic.

### First sync submission and reconciliation

1. Player signs and submits the atomic first-sync transaction.
2. On confirmation, read back:
   - `CharacterRootAccount`
   - `CharacterSettlementBatchCursorAccount`
   - world-progress accounts as needed
3. Mark the character as chain-confirmed.
4. Reconcile the committed cursor into the local character row.
5. Mark batch 1 as settled and transition later rebased backlog batches into the normal pipeline.

## Data Model Changes

### Character

- Preserve `createdAt` as the local character origin time and use it as the source for on-chain `character_creation_ts` in the first-sync path.
- Support three practical identity states:
  - no chain identity assigned yet
  - chain identity reserved but not yet confirmed
  - chain-confirmed and cursor-reconciled

### Provisional progression

- Add a DB-backed progression model for unsynced characters.
- Keep the shape close to the current on-chain world-progress semantics so legality and later reconciliation stay aligned.

### Battle backlog

- Extend the settlement-facing battle persistence model to support:
  - pre-chain rows with no final nonce yet
  - rebased rows that now have final nonce and batch assignment
  - archived local-only rows that will never be sent on chain

## API And Service Changes

### Encounter route

- `POST /api/combat/encounter`
- Must accept both:
  - chain-confirmed characters
  - unsynced local-first characters

### New first-sync prepare route

- Add a dedicated route for preparing atomic first sync.
- Input should be minimal:
  - `characterId`
  - `authority`
  - optional `feePayer`
- The backend derives:
  - `character_creation_ts`
  - `season_id_at_creation`
  - first eligible batch
  - archived stale backlog

### Character creation service

- Keep the existing create-only prepare flow for simple or legacy usage.
- Add a first-sync-specific prepare path that does not set `characterCreationTs` from prepare-time `now`.

## Program And Validation Considerations

- The preferred implementation does not begin with a program account-schema redesign.
- The first step is to prove that the current program accepts:
  - a historical `character_creation_ts`
  - `create_character` followed by settlement in the same transaction
- If tests reveal instruction-order or validator issues, fix those specific issues instead of redesigning the entire settlement contract.
- The current `PreCharacterTimestamp` rule remains valid as long as first-sync batches are later than the backdated `character_creation_ts`.

## Step-by-Step Implementation Plan

1. Completed. Start by proving the on-chain assumption before changing backend flow. Add focused `runana-program` tests that create a character with a historical `character_creation_ts` and then apply the first settlement batch in the same transaction. Lock this behavior down first so the rest of the backend work can rely on it.

2. Completed. Add the local-first persistence foundations next. Extend the Prisma schema so a character can exist with no reserved chain identity, add explicit pre-first-sync battle lifecycle states, and introduce DB-backed provisional progression for unsynced characters. Keep this schema work separate from route behavior changes.

3. Completed. Split encounter execution into two modes inside the backend combat orchestration layer. Keep the current confirmed-character path intact, then add a local-first branch that loads the DB character, validates zone access against provisional progression, resolves the active backend season, runs `simulateBattle(...)`, persists `BattleRecord`, persists a pre-first-sync settlement backlog row, and updates provisional progression atomically.

4. Completed. Change character creation preparation so Model 2 can anchor to the local character origin time. Add a first-sync-specific preparation path that derives `character_creation_ts` from `Character.createdAt`, derives `season_id_at_creation` from that same timestamp, and stops relying on prepare-time `now` for this path.

5. Completed. Implement first-sync identity reservation and rebasing as a dedicated service. This service should lock the character plus eligible backlog rows, assign `playerAuthorityPubkey`, `chainCharacterIdHex`, and `characterRootPubkey`, archive stale closed-grace backlog, construct the genesis cursor, then rebase the remaining backlog into contiguous nonces and deterministic batch/state-hash continuity.

6. Completed. Add first-batch transaction assembly only after rebasing exists. Build a new atomic first-sync prepare route that returns one player-owned transaction containing `create_character`, the two required ed25519 verification instructions, and the first `apply_battle_settlement_batch_v1` instruction in the required order.

7. Completed. Reuse the existing settlement lifecycle after the first sync instead of inventing a parallel pipeline. Once batch 1 confirms, reconcile the on-chain cursor back into the local character row, mark the character chain-confirmed, and transition any remaining rebased backlog batches into the normal sealing and relay flow.

8. Completed. Tighten retry and idempotency behavior before calling the feature done. Repeated first-sync prepare calls must reuse the same reserved identity and rebased batch metadata where appropriate, failed submissions must not duplicate nonce assignment or batch creation, and archived stale backlog must remain excluded consistently.

9. Finish with end-to-end verification in the same order the feature is meant to operate. Cover local-first encounter execution, provisional progression updates, first-sync preparation, atomic create-plus-settle submission, cursor reconciliation, and continued settlement of later rebased backlog through the existing pipeline.

## Testing Plan

- Local-first encounter tests:
  - unsynced characters can battle and persist replay/history
  - provisional zone unlocking works before first sync
- First-sync preparation tests:
  - `character_creation_ts` derives from local `createdAt`
  - `season_id_at_creation` resolves from the same timestamp
  - stale backlog is archived correctly
  - eligible backlog rebases deterministically into nonces and batches
- Transaction assembly tests:
  - first-sync transaction includes `create_character`, both ed25519 instructions, and settlement in the required order
- Program integration tests:
  - create-plus-settle succeeds in one transaction
  - first batch cursor continuity matches the rebased genesis chain
- Reconciliation tests:
  - first confirmed sync updates local cursor fields correctly
  - remaining rebased backlog can continue through the normal settlement pipeline

## Acceptance Criteria

- A newly created backend character can battle before on-chain creation.
- Those battles are persisted immediately with real timestamps.
- First sync prepares a single atomic transaction for create-plus-settle.
- The on-chain character stores the local origin timestamp as `character_creation_ts`.
- The first eligible pre-chain batch settles successfully after on-chain creation.
- Later batches and later battles continue through the existing settlement lifecycle.
