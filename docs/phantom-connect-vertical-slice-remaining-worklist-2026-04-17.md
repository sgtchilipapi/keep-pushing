# Phantom Connect Vertical-Slice Remaining Worklist (2026-04-17)

This document is a companion to:

- [phantom-connect-vertical-slice-implementation-plan-2026-04-13.md](/home/paps/projects/keep-pushing/docs/phantom-connect-vertical-slice-implementation-plan-2026-04-13.md)

It translates the current repo state into a concrete remaining-work list, ordered by critical path rather than by original plan section order.

## 0) Current status summary

Based on the current `keep-pushing` workspace:

- framework upgrade is complete enough to support Phantom React SDK
- Phantom Connect auth/session foundations are implemented
- v1 character-create and settlement route families exist
- anon bootstrap has been removed
- the repo still carries a mixed model:
  - new session-gated v1 flows
  - old first-sync-specific orchestration
  - batch-shaped settlement internals and terminology

Practical status:

- Slices `A0`, `A0.5`, and most of `A` are in place
- Slice `B` is partially complete
- Slice `C` is mostly complete
- Slice `D` is partially complete
- Slice `E` is not started
- Slice `F` is partially complete
- Slice `0` cannot be considered fully complete from this repo alone

## 1) Critical-path remaining work

These items block clean completion of the planned architecture.

### 1. Remove the dedicated first-sync path

Target state from the plan:

- character creation is one transaction
- first playable settlement is a normal per-run settlement
- no dedicated `/v1/characters/first-sync/*` route family remains

Current repo evidence:

- UI still uses `/api/v1/characters/first-sync/prepare` and `/finalize`
- the route family still exists
- first-sync-specific types and tests still exist

Main touchpoints:

- [components/game/GameClient.tsx](/home/paps/projects/keep-pushing/components/game/GameClient.tsx:2073)
- [app/api/v1/characters/first-sync/prepare/route.ts](/home/paps/projects/keep-pushing/app/api/v1/characters/first-sync/prepare/route.ts:1)
- [app/api/v1/characters/first-sync/finalize/route.ts](/home/paps/projects/keep-pushing/app/api/v1/characters/first-sync/finalize/route.ts:1)
- [lib/solana/firstSyncRelay.ts](/home/paps/projects/keep-pushing/lib/solana/firstSyncRelay.ts:1)
- [types/api/characters.ts](/home/paps/projects/keep-pushing/types/api/characters.ts:67)
- `tests/firstSync*.test.ts`

Required changes:

- remove first-sync calls from `GameClient`
- after create finalize succeeds, let the normal settlement queue handle the oldest pending run
- delete or hard-fail the v1 first-sync routes
- remove `firstSyncRelay` from the target runtime path
- replace first-sync-specific tests with create-then-settle coverage

Exit condition:

- no target-path UI or API flow depends on first-sync as a special transaction type

### 2. Finish the run-centric settlement migration under the hood

Target state from the plan:

- one closed run maps to one settlement lifecycle record
- request lifecycle is bound to that one run
- product-facing contract is fully run-centric

Current repo evidence:

- public prepare request already accepts `zoneRunId`
- internal persistence still uses `SettlementBatch` and `SettlementRequest`
- finalize still reconciles batch records and returns `settlementBatchId`

Main touchpoints:

- [prisma/schema.prisma](/home/paps/projects/keep-pushing/prisma/schema.prisma:442)
- [lib/solana/settlementPresign.ts](/home/paps/projects/keep-pushing/lib/solana/settlementPresign.ts:1)
- [lib/solana/settlementRelay.ts](/home/paps/projects/keep-pushing/lib/solana/settlementRelay.ts:1)
- [lib/solana/settlementLifecycle.ts](/home/paps/projects/keep-pushing/lib/solana/settlementLifecycle.ts:1)
- [types/api/settlementV1.ts](/home/paps/projects/keep-pushing/types/api/settlementV1.ts:1)

Required changes:

- add the planned `RunSettlement` table
- add the planned `RunSettlementRequest` table
- migrate pending queue derivation away from batch identity
- move prepare/presign/finalize to a run-owned lifecycle
- stop returning `settlementBatchId` in the product-facing v1 contract

Exit condition:

- settlement state is stored and advanced per run, not per batch-shaped compatibility record

### 3. Remove remaining batch-era product language and contract surface

Target state from the plan:

- no batch terminology in product-facing contract
- no first-sync terminology in sync UX

Current repo evidence:

- `SettlementV1` still returns `settlementBatchId` and `SettlementBatchPayloadV2`
- frontend types still include `AWAITING_FIRST_SYNC`
- sync panel still renders `FIRST BATCH REQUIRED`

Main touchpoints:

- [types/api/settlementV1.ts](/home/paps/projects/keep-pushing/types/api/settlementV1.ts:10)
- [types/api/frontend.ts](/home/paps/projects/keep-pushing/types/api/frontend.ts:20)
- [components/game/uiModel.ts](/home/paps/projects/keep-pushing/components/game/uiModel.ts:54)
- [lib/characterAppService.ts](/home/paps/projects/keep-pushing/lib/characterAppService.ts:66)

Required changes:

- rename product-facing types and fields to run-centric equivalents
- remove `AWAITING_FIRST_SYNC` from the frontend contract if no longer needed
- replace batch-oriented labels and notices in the game shell
- ensure the read model exposes only queue/run semantics

Exit condition:

- product-facing UI and API language match the target run-centric architecture

### 4. Confirm and complete app/program alignment for Slice 0

Target state from the plan:

- sponsored create is supported by the program
- player-only settlement authorization is the target mode
- compatibility handling is explicit and temporary

Current repo evidence:

- app-side sponsored create exists
- app still carries dual-mode or server-attestation-aware compatibility logic
- no visible `RUNANA_PROGRAM_VERSION` gate was found in this repo

Main touchpoints:

- [lib/solana/characterCreation.ts](/home/paps/projects/keep-pushing/lib/solana/characterCreation.ts:665)
- [lib/solana/firstSyncRelay.ts](/home/paps/projects/keep-pushing/lib/solana/firstSyncRelay.ts:420)
- `../runana-program` repo

Required changes:

- verify the actual `runana-program` state against the planned Slice 0 deltas
- remove temporary dual-mode assumptions once the program cutover is confirmed
- add explicit compatibility gating if the app still needs to support multiple program versions during rollout

Exit condition:

- the app no longer carries unclear compatibility assumptions about settlement authorization mode

## 2) Secondary implementation work

These items are important, but should follow the critical-path architecture cleanup above.

### 5. Bring character create onto the final planned contract

Current repo evidence:

- create is session-gated and sponsor-paid
- current request shape is still repo-centric, not the exact final planned shape

Main touchpoints:

- [types/api/characters.ts](/home/paps/projects/keep-pushing/types/api/characters.ts:5)
- [app/api/v1/characters/create/prepare/route.ts](/home/paps/projects/keep-pushing/app/api/v1/characters/create/prepare/route.ts:1)
- [app/api/v1/characters/create/finalize/route.ts](/home/paps/projects/keep-pushing/app/api/v1/characters/create/finalize/route.ts:1)

Required changes:

- decide whether the plan’s `characterDraft + walletAddress + idempotencyKey` contract is still authoritative
- if yes, refactor create prepare/finalize to match it
- if no, update the original plan document to reflect the actual accepted target contract

Exit condition:

- no unresolved mismatch remains between the plan and the intended create API

### 6. Normalize v1 response envelopes

Target state from the plan:

- all v1 responses include `{ ok, data|error, requestId }`

Current repo evidence:

- routes use envelope-style `ok/data` responses
- `requestId` is logged internally but not returned consistently in the contract

Main touchpoints:

- [types/api/characters.ts](/home/paps/projects/keep-pushing/types/api/characters.ts:138)
- [types/api/settlementV1.ts](/home/paps/projects/keep-pushing/types/api/settlementV1.ts:43)
- `app/api/v1/**`

Required changes:

- add `requestId` to success and error envelopes
- update all v1 route handlers to emit it consistently
- update frontend request helpers and tests

Exit condition:

- all v1 routes conform to the documented response envelope

### 7. Implement feature-flag boundaries that the plan assumes

Target state from the plan:

- staged rollout behind explicit feature flags

Current repo evidence:

- planned flag names are documented
- flag enforcement was not found in implementation

Required changes:

- add real flag checks for:
  - `FF_PHANTOM_CONNECT_AUTH`
  - `FF_V1_SESSION_ENFORCEMENT`
  - `FF_V1_CHARACTER_CREATE`
  - `FF_V1_SETTLEMENT_PRESIGN`
  - `FF_V1_TRANSFERS`
- define fallback behavior for disabled states
- add tests for enabled/disabled behavior where relevant

Exit condition:

- rollout can be staged intentionally instead of relying on code-merge timing alone

## 3) Security and production-hardening work

### 8. Add CSRF or origin enforcement for cookie-authenticated POST routes

Target state from the plan:

- cookie-authenticated POSTs are protected against cross-origin misuse

Current repo evidence:

- secure session cookies are set
- no explicit CSRF or origin-enforcement layer was found

Main touchpoints:

- [lib/auth/session.ts](/home/paps/projects/keep-pushing/lib/auth/session.ts:102)
- `app/api/v1/**`

Required changes:

- add origin enforcement or a double-submit token strategy
- apply it consistently across v1 POST routes except the explicitly allowed auth surfaces
- add regression tests for cross-origin rejection

Exit condition:

- session-authenticated POST routes are not relying on cookie settings alone

### 9. Replace in-memory rate limiting with a shared backend implementation

Current repo evidence:

- rate limiting exists but is process-local `Map` state

Main touchpoints:

- [lib/security/rateLimit.ts](/home/paps/projects/keep-pushing/lib/security/rateLimit.ts:1)

Required changes:

- move rate limiting to a shared store suitable for multi-instance deployment
- preserve the existing route-specific policy values where still desired
- emit retry metadata consistently

Exit condition:

- rate limiting is effective across processes and deploy replicas

### 10. Finish Slice F observability beyond audit rows

Current repo evidence:

- audit rows exist
- Phantom Connect debug logging exists
- metrics and alerts modules from the plan are absent

Main touchpoints:

- [lib/observability/audit.ts](/home/paps/projects/keep-pushing/lib/observability/audit.ts:1)
- [lib/observability/phantomConnectClient.ts](/home/paps/projects/keep-pushing/lib/observability/phantomConnectClient.ts:1)
- [lib/observability/phantomConnectDebug.ts](/home/paps/projects/keep-pushing/lib/observability/phantomConnectDebug.ts:1)

Required changes:

- add route-level metrics and error counters
- add settlement mismatch and finalize-timeout signals
- add auth verify success/failure metrics
- define alert thresholds and their implementation target

Exit condition:

- the v1 flows emit enough telemetry to support rollout and incident response

### 11. Fix Phantom debug gating to match the documented intent

Target state from the plan:

- debug is enabled only when the server and client env vars are explicitly `1`

Current repo evidence:

- current code enables debug unless env is explicitly `0`

Main touchpoints:

- [lib/observability/phantomConnectDebug.ts](/home/paps/projects/keep-pushing/lib/observability/phantomConnectDebug.ts:30)
- [lib/observability/phantomConnectClient.ts](/home/paps/projects/keep-pushing/lib/observability/phantomConnectClient.ts:8)

Required changes:

- switch gating from permissive default-on to explicit opt-in
- verify disabled environments emit nothing and return `404` from the debug route

Exit condition:

- debug behavior matches the plan and is safe for public deployment defaults

## 4) Policy and product decisions that should be resolved explicitly

### 12. Decide whether auth is intentionally embedded-only or supports injected wallets too

Current repo evidence:

- provider config includes `google`, `apple`, and `injected`

Main touchpoints:

- [components/providers/PhantomSdkProvider.tsx](/home/paps/projects/keep-pushing/components/providers/PhantomSdkProvider.tsx:79)

Required decision:

- if embedded-only remains the target, remove `injected`
- if mixed embedded + injected support is desired, update the plan to reflect the actual product stance

Exit condition:

- provider support policy is explicit and consistent between code and docs

### 13. Reconcile plan-vs-implementation drift where the code is already intentionally different

Examples:

- create contract shape
- whether injected wallet mode is supported
- exact settlement persistence model during compatibility transition

Required changes:

- either finish the refactor to match the plan exactly
- or revise the original plan doc so the repo has one authoritative target

Exit condition:

- the plan stops describing behaviors the team no longer intends to ship

## 5) Deferred work

### 14. Implement the transfers slice

Status:

- not started
- still intentionally deferred by the original plan

Main touchpoints to add:

- `app/api/v1/transfers/check/route.ts`
- `app/api/v1/transfers/finalize/route.ts`
- `lib/solana/transferPolicy.ts`
- `lib/solana/transferFinalize.ts`
- `types/api/transfers.ts`

Exit condition:

- sponsor-paid transfer policy flow exists and is covered by route tests

## 6) Recommended execution order

1. Remove first-sync special handling from UI, routes, types, and tests.
2. Complete the run-centric settlement persistence and lifecycle migration.
3. Remove leftover batch and first-sync product terminology.
4. Confirm the app/program authorization model and clean up compatibility code.
5. Normalize v1 response envelopes and finalize any create-contract decision.
6. Add feature flags for controlled rollout.
7. Add CSRF/origin enforcement.
8. Replace in-memory rate limiting.
9. Complete metrics/alerts and fix Phantom debug gating.
10. Implement transfers after the create/settlement migration is stable.

## 7) Suggested definition of done for this initiative

The Phantom Connect vertical-slice initiative should be considered complete when all of the following are true:

- Phantom Connect is the only intended auth entry path
- no anon path remains usable
- no target-path first-sync special flow remains
- create is sponsor-paid and session-gated
- settlement is oldest-pending-first and run-centric end to end
- product-facing APIs no longer expose batch-era terminology
- rollout is flaggable and observable
- cookie-authenticated POST routes have explicit CSRF/origin protection
- rate limiting works across deployed instances
- transfers are either intentionally deferred and documented as such, or implemented behind their planned flag
