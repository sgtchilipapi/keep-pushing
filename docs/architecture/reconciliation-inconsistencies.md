# Runana Reconciliation Decisions

## Purpose

This document records the final reconciliation decisions made after comparing:

- the current `runana-program` implementation
- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)

This is now a resolved decision log, not an open question list.

## Final Direction

- preserve the run-native zone-run architecture
- preserve play first, DB persisted first, sync later
- preserve first sync as the chain bootstrap point
- replace the old two-phase opaque prepared-transaction settlement UX
- use one-approval target behavior for first sync and later settlement
- move the authoritative planning doc set into `keep-pushing`
- use the zone-run plan checklist as the unified implementation checklist

## Resolved Decisions

### 1. Settlement transport

Decision:

- keep server attestation
- remove separate player settlement-permit signing
- use the player as the real transaction signer
- prefer client-built or client-finalized, client-submitted transactions
- replace submit-style backend settlement completion with `ack` + reconciliation

Why:

- this preserves the SSOT trust model
- this is the clearest path to one Phantom approval

Docs reconciled:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

### 2. Gameplay model and settlement unit

Decision:

- zone-run gameplay remains canonical
- settlement unit is a closed settleable run
- zero-value closed runs stay history-only
- no run may ever be split across two batches

Why:

- this was already the locked direction in the zone-run plan
- it removes the remaining drift between product docs and settlement design

Docs reconciled:

- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)

### 3. Account and roster model

Decision:

- anon users are real server-backed users
- anon users may hold exactly 1 character
- wallet-linked users may hold up to 3 characters
- slot placement stays server-owned
- `name` and `classId` are selected at local-first character creation time
- `name` and `classId` are mirrored on-chain during first sync

Why:

- this preserves instant play while giving the product model clear identity rules

Docs reconciled:

- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

### 4. API family

Decision:

- `/api/zone-runs/*` is the canonical gameplay write surface
- `/api/runs/:runId` remains the canonical read/result/share surface
- `/api/characters` is the canonical local-first character create/read family
- `/api/solana/character/first-sync/*` and `/api/solana/settlement/*` remain the canonical sync transport family

Why:

- this keeps the richer execution model while preserving stable result/share URLs

Docs reconciled:

- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)

### 5. Grace-period semantics

Decision:

- grace is sync/closure-only for seasonal progression
- grace is not continued normal season gameplay
- unresolved prior-season progress expires after grace and becomes read-only history

Why:

- this matches the SSOT and existing seasonal validation model
- this avoids a much larger season-window redesign

Docs reconciled:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)

### 6. Status vocabulary

Decision:

- keep richer internal workflow statuses in backend services
- use simpler player-facing labels in product surfaces

Player-facing labels:

- `Pending`
- `Synced`
- `Expired`

Why:

- this gives operators enough resolution without forcing technical status language into UI copy

### 7. Legacy-document policy

Decision:

- older backend/frontend plans and local runbooks that describe the pre-reconciliation flow remain useful historical or implementation-context docs
- they are no longer authoritative for the reconciled MVP contract
- they should point back to the unified sources of truth instead of silently disagreeing

Canonical current references:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

## Unified Checklist Authority

The implementation checklist is unified in:

- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

That checklist now owns:

- product/player-surface tasks
- backend/API tasks
- settlement transport rewrite tasks
- on-chain redesign tasks
- migration and test tasks

## Runana-Program Doc Move

The planning docs originally drafted in `runana-program` are now moved into `keep-pushing` so that:

- product docs
- API docs
- architecture docs
- implementation checklist docs

all live under the same planning root.
