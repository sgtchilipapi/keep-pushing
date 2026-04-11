# Local-First Sequential Sync Refactor Plan

Status:

- exploratory historical refactor plan
- not the authoritative reconciled MVP contract

Canonical current references:

- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

## Summary

Refactor sync back to the intended local-first model:

1. create character locally
2. battle locally
3. create the character on chain later as genesis state only
4. settle local battles afterward so on-chain logic applies exp/progress

Core policy decisions:

- keep create and settlement as separate transactions
- restore local-first battles before on-chain creation
- treat `character_creation_ts` as metadata only
- validate initial settlement against `season_start_ts`, not `character_creation_ts`
- allow on-chain character creation anytime a valid current season policy exists

## Key Changes

### On-chain contract

- Keep `create_character` as a pure genesis initializer:
  - create root/stats/world-progress/cursor
  - do not use `character_creation_ts` as a settlement guard anymore
- Change settlement validation from:
  - `payload.first_battle_ts >= character_root.character_creation_ts`
    to:
  - `payload.first_battle_ts >= season_policy.season_start_ts`
  - plus existing nonce/state/cursor continuity checks
- Keep `character_creation_ts` on the account as metadata only.
- Set `character_creation_ts` cheaply on chain from the current clock, clamped so it is never earlier than `season_start_ts`.
- Remove create-time active-window enforcement.
- Keep only basic create-time checks:
  - season policy exists
  - season policy is internally valid
  - payer must equal authority

### Backend and sync lifecycle

- Restore local-first encounter execution:
  - `LOCAL_ONLY` characters remain battle-eligible
  - encounters for unsynced characters persist `AWAITING_FIRST_SYNC` backlog and provisional progress
- Keep character creation and settlement as separate backend flows:
  - `/api/solana/character/create/*`
  - `/api/solana/settlement/*`
- After character creation confirms:
  - materialize the `AWAITING_FIRST_SYNC` backlog into the normal settlement pipeline
  - rebase only nonces and state-hash continuity
  - preserve original local battle timestamps
- Do not block battles merely because the character is still local-only.
- Block battles only in the narrow middle state where that is still required by the chosen backlog model:
  - after chain creation is confirmed
  - while initial backlog settlement is unresolved

### Transaction signing and submit validation

- Replace strict byte-for-byte character-create message matching with semantic validation of the signed v0 transaction.
- Treat the wallet-signed transaction as the source of truth if its deserialized instruction still matches the prepared create domain:
  - authority
  - fee payer
  - character root PDA
  - chain character id
  - season policy account
  - initial unlocked zone
  - transaction kind = character create
- Continue rejecting clearly mutated or replay-invalid submissions.
- Keep structured diagnostics, but downgrade exact message mismatch from a hard requirement to a debug signal for create flow.
- Settlement flow can stay stricter if it continues to round-trip cleanly.

### Frontend and read model

- Restore UI semantics for local-first play:
  - `LOCAL_ONLY` shows that battles are allowed before chain creation
  - create-on-chain is presented as saving the genesis character, not freezing local play
- Update derived sync state so:
  - `LOCAL_ONLY` => `battleEligible: true`
  - `CREATING_ON_CHAIN` => still allow battles only if the backend model can safely absorb them; otherwise keep this state short-lived and explicit
  - `INITIAL_SETTLEMENT_REQUIRED` => battles blocked until first backlog settlement completes
- Keep one sync button if desired, but the behavior must be sequential:
  - local-only => create on chain
  - confirmed with unresolved backlog => settle next batch
- Reintroduce local-first wording in the dashboard and test runbooks.

## Public Interfaces

- `GET /api/character`
  - `battleEligible` must be true for local-only characters
  - `latestBattle.settlementStatus` continues to support `AWAITING_FIRST_SYNC`
  - `syncPhase` remains derived, but its semantics change back to local-first
- `POST /api/combat/encounter`
  - must accept unsynced characters again
  - returns `settlementStatus = AWAITING_FIRST_SYNC` for local-first battles
- `POST /api/solana/character/create/prepare`
  - remains separate from settlement
  - does not need client-authored creation timestamp
- On-chain/public program behavior
  - `character_creation_ts` remains in account layout for compatibility, but is metadata only
  - settlement validity depends on season start and cursor continuity instead

## Test Plan

- Program tests:
  - create succeeds whenever a valid current season policy exists, even outside active window
  - stored `character_creation_ts` is metadata-only and not used for settlement gating
  - settlement rejects `first_battle_ts < season_start_ts`
  - settlement still rejects nonce/state/season continuity regressions
- Backend tests:
  - local-only encounters persist `AWAITING_FIRST_SYNC`
  - confirmed character creation triggers backlog rebasing without rewriting battle timestamps
  - first initial settlement batch seals correctly from rebased backlog
  - character-create submit accepts wallet-safe signed transaction mutations but rejects semantic instruction drift
- Frontend/API tests:
  - local-only characters remain battle-eligible
  - sync copy reflects local-first behavior
  - after create confirmation and before first settlement confirmation, sync resumes from settlement
  - initial backlog completion transitions back to normal settlement behavior
- Manual scenario:
  - create local character
  - run several local battles
  - create on chain
  - settle first backlog batch
  - verify exp/progress are derived on chain from settlements, not from create

## Assumptions and Defaults

- Canonical plan file is a new backend plan document, not an overwrite of the older atomic first-sync plan.
- Atomic first sync is not part of the normal product path.
- `character_creation_ts` remains in storage only to avoid unnecessary account/schema churn.
- The backend still chooses the current season policy account for creation and settlement preparation.
- If create occurs before the chosen season start, on-chain metadata timestamp is clamped to `season_start_ts` so it never predates the season floor.
