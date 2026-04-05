# Split First-Sync Redesign Without Program Changes

## Summary

Redesign first sync into two sequential transactions without changing `runana-program`:

1. `Tx A`: create the character on chain only
2. wait for confirmation
3. `Tx B`: submit the first settlement batch

This keeps the current on-chain instructions and settlement protocol intact, removes the large atomic `create + settle` bundle from the wallet path, and should reduce Phantom unsafe warnings. The frontend remains a single `Sync` flow, but it drives two wallet approvals under the hood. After `Tx A` confirms and before `Tx B` confirms, new battles are blocked.

## Key Changes

### Backend orchestration

- Reuse the existing create-character prepare/submit routes as the source of truth for `Tx A`.
- Reuse the existing settlement prepare/submit routes for `Tx B`, but extend settlement preparation to support the initial backlog handoff:
  - if the character is chain-confirmed and still has `AWAITING_FIRST_SYNC` battles, run the existing first-sync rebasing logic to assign canonical nonces and seal batch 1
  - then continue through the normal settlement prepare flow using that sealed batch
- Treat the current atomic first-sync routes as legacy:
  - remove them from the normal frontend flow
  - keep them temporarily for compatibility and testing until the split flow is fully verified
- Add a backend gameplay gate so encounters are rejected after `Tx A` confirmation until `Tx B` completes:
  - if `chainCreationStatus = CONFIRMED` and there is unresolved initial backlog or an unconfirmed first batch, `POST /api/combat/encounter` returns a clear “initial settlement required before new battles” error

### Persistence and read-model behavior

- Do not add any new on-chain protocol or program state.
- Prefer derived backend state over new DB enums:
  - “initial settlement pending” is derived from `chainCreationStatus = CONFIRMED` plus either:
    - `AWAITING_FIRST_SYNC` battles still present, or
    - an unconfirmed first settlement batch exists while the reconciled cursor has not advanced through batch 1
- Update the character read model to expose a compact frontend-friendly sync phase instead of forcing the UI to infer it from multiple raw fields. Recommended derived values:
  - `LOCAL_ONLY`
  - `CREATING_ON_CHAIN`
  - `INITIAL_SETTLEMENT_REQUIRED`
  - `SYNCED`
  - `SETTLEMENT_PENDING`
  - `FAILED`
- Keep existing raw fields available, but make the new derived sync phase the primary frontend contract for the `Sync` button and status copy.

### Frontend UX

- Keep one `Sync` button and one flow.
- The flow becomes:
  1. if local-only, prepare/sign/submit `Tx A`
  2. poll until `chainCreationStatus = CONFIRMED`
  3. automatically transition into prepare/sign/submit `Tx B`
  4. refresh until initial settlement reaches `CONFIRMED`
- Show clear intermediate copy during the gap:
  - `Creating character on chain`
  - `Waiting for confirmation`
  - `Settling first battle batch`
- Disable or hide battle actions while the read model reports `INITIAL_SETTLEMENT_REQUIRED` or `CREATING_ON_CHAIN`.
- If `Tx A` succeeds and `Tx B` fails, keep the user on the same screen with a retryable `Sync` action that resumes from settlement rather than restarting creation.

### Public interfaces and route behavior

- Reuse existing APIs instead of adding a new split-first-sync endpoint family:
  - `/api/solana/character/create/prepare`
  - `/api/solana/character/create/submit`
  - `/api/solana/settlement/prepare`
  - `/api/solana/settlement/submit`
- Update settlement prepare semantics so it can handle the initial post-create backlog transition, not only already-`PENDING` canonical battles.
- Update `GET /api/character` to add a derived sync-phase field and a simple battle-eligibility flag so the frontend does not have to reconstruct this state from low-level fields.
- Mark the current atomic first-sync routes and docs as legacy or deprecated for UI use.

## Test Plan

- Backend flow tests:
  - local-only character with backlog -> `Tx A` confirm -> settlement prepare rebases and seals batch 1 -> `Tx B` confirm
  - `Tx A` success + `Tx B` retry path resumes cleanly without re-creating the character
  - settlement prepare for initial backlog works with `AWAITING_FIRST_SYNC` inputs after chain confirmation
  - combat route rejects new battles while initial settlement is pending
- Frontend flow tests:
  - one `Sync` button drives the two-step sequence
  - UI blocks battles between `Tx A` and `Tx B`
  - retry after settlement failure resumes at `Tx B`
  - confirmed + fully settled characters return to normal post-sync settlement behavior
- Regression checks:
  - ordinary post-sync settlement still uses the existing settlement routes unchanged
  - legacy atomic first-sync route can remain available until removed
  - no `runana-program` changes are required for the split flow
- Manual acceptance:
  - create character locally
  - run local battle(s)
  - click `Sync`
  - approve Phantom for create
  - wait for confirmation
  - approve Phantom for first settlement
  - confirm the character is chain-created and batch 1 is committed
  - verify that battles are blocked in the middle state and re-enabled after settlement

## Assumptions

- No `runana-program` changes are made in this redesign.
- Blocking battles between `Tx A` and `Tx B` is acceptable and preferred to preserve simple backlog semantics.
- Existing create-character and settlement route families remain the official APIs; the redesign is orchestration and state-model work, not a new protocol.
- The atomic first-sync route is kept temporarily as legacy or internal compatibility until the split flow is fully proven, then can be removed in a later cleanup.
