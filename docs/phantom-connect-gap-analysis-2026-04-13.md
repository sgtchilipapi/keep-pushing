# Phantom Connect Integration Gap Analysis (2026-04-13)

## Scope and inputs

This gap analysis compares the **desired-state Phantom Connect integration spec** against the **current `keep-pushing` implementation** in this workspace.

It focuses on:

- user auth
- app sessions
- wallet connection and identity management
- transaction preparation/signing/broadcasting
- character creation flow
- batch settlement flow
- token transfer flow
- security and operational controls around the above

### Evidence sources used

- `keep-pushing` API routes and frontend flow (`app/api/**`, `components/game/**`, `lib/solana/**`, `types/api/solana.ts`, `prisma/schema.prisma`)
- existing architecture docs in this repo that describe current Solana integration assumptions.

### Constraint encountered

Attempting to clone `https://github.com/sgtchilipapi/runana-program/tree/validation` from this environment failed with HTTP 403, so direct branch inspection was not possible from this runtime. The analysis below therefore treats the current on-chain surface as represented by this repo's existing integration code and docs.

---

## Executive summary

Note:
- This document captures repo state on 2026-04-13.
- Some auth/session gaps listed below are now partially resolved in the current repo, including removal of the anonymous bootstrap route and introduction of wallet-backed session flows.

Overall status against the target spec: **major gaps remain**.

- Wallet integration exists, but it is **Phantom extension/provider style**, not **Phantom Connect modal + embedded wallet flow**.
- Auth/session were, at the time of analysis, **anonymous user-id based** with localStorage query-param propagation rather than backend wallet-proof login with nonce verification and secure app sessions.
- Settlement and first-sync are implemented as **player-paid/player-signed transactions** with backend preparation/ack logic; they do **not** use Phantom Connect `presignTransaction` co-sign sponsorship flow.
- Character creation exists, but it is a Solana-prepare/submit path tied to raw wallet pubkey and local user id, not the target `/v1/characters/create/prepare|finalize` contract and backend-session-gated policy model.
- Token transfer flow (check/finalize + restrictions) is **absent**.
- Required auth/session/security/audit/rate-limit tables from the spec are largely **absent** from the database schema.

---

## Current-state snapshot (relevant to spec)

## 1) Auth + app session

### Implemented now

- Historical note from 2026-04-13:
  - `POST /api/auth/anon` existed and created a user with no wallet proof.
  - the frontend persisted `userId` in localStorage and sent it on subsequent API calls.
  - middleware-based session guards were not yet in place for game APIs.

### Gap vs target

- Missing wallet nonce challenge + signature verification auth.
- Missing backend-issued session cookie/JWT strategy and revocation model.
- Missing requirement that privileged APIs require backend session rather than client-supplied `userId`.

## 2) Wallet connection + identity model

### Implemented now

- Phantom provider integration exists via browser `window.phantom`/`window.solana` provider resolution.
- Client can connect/disconnect and read wallet pubkey.
- Character rows include optional `playerAuthorityPubkey`.

### Gap vs target

- No Phantom Connect modal flow with Google/Apple + embedded wallets.
- No canonical `users.primary_wallet_address` uniqueness anchor.
- No explicit provider metadata fields (`provider`, `wallet_mode`, `auth_provider`) as required.
- No wallet-proof-driven user bootstrap or wallet-based account lookup.

## 3) Character creation transaction flow

### Implemented now

- Backend prepare + submit routes exist under `/api/solana/character/create/*`.
- Backend validates transaction domain semantics before accepting signed tx submission.
- Flow uses player-owned transaction where authority must equal fee payer.

### Gap vs target

- API contracts do not match required `/v1/characters/create/prepare|finalize` format.
- Not tied to backend wallet-auth session model.
- No explicit finalize endpoint that confirms and indexes tx under the target contract.
- Current flow appears deeply coupled to local character record + chain bootstrap mechanics, not strictly spec-minimal client-only flow.

## 4) Batch settlement flow

### Implemented now

- Settlement prepare/submit/ack routes exist under `/api/solana/settlement/*`.
- Backend builds canonical settlement payloads and enforces cursor continuity/order checks.
- Client currently uses direct `signAndSendTransaction` on prepared player-owned tx and then acks backend.

### Gap vs target

- Settlement is not using Phantom Connect embedded-wallet-compatible `presignTransaction` callback flow.
- Explicit server co-sign sponsorship model (server fee payer/app signer in callback) is not implemented.
- Current policy enforces `authority == feePayer` for settlement, opposite of sponsored target.
- Target idempotent `/v1/settlement/prepare|presign|finalize` contract is missing.

## 5) Token transfer flow

### Implemented now

- No transfer policy-check/finalize API discovered.

### Gap vs target

- Entire transfer flow is missing:
  - `/v1/transfers/check`
  - client transfer path alignment
  - restricted-transfer escalation to sponsored flow
  - `/v1/transfers/finalize`

## 6) Security + operations

### Implemented now

- Many API routes return prefixed error strings that can be machine-readable.
- Transaction preparation/submission routes include domain checks.

### Gap vs target

- No auth nonces table / single-use nonce consumption flow.
- No sessions table + revocation semantics.
- No explicit tx audit log table with action/request/status/error dimensions as required.
- No clear global/API rate-limiting layer for auth/prepare/presign endpoints.
- No standardized error code envelope across all relevant APIs.
- No explicit monitoring/metrics/alerting instrumentation for these flows.

---

## Gap matrix against the provided checklist

Legend: ✅ implemented, ⚠️ partial/misaligned, ❌ missing

## Auth / App Session

- ⚠️ Phantom Connect integrated: partial Phantom wallet provider integration exists, but not Phantom Connect embedded-wallet flow.
- Historical note: at analysis time, wallet connect coexisted with anonymous auth bootstrap and login was not yet unified under Phantom-backed auth.
- ❌ Backend nonce issuance exists.
- ❌ Wallet signature verification exists for app login.
- ❌ Backend session issuance exists (cookie/JWT with refresh/revocation model).
- ❌ Session middleware protects game APIs.
- ❌ Wallet-to-user mapping canonical and unique.

## Character Creation

- ⚠️ Prepare endpoint exists, but under different contract and auth assumptions.
- ⚠️ Policy validation exists partially (character constraints), but not tied to session/wallet entitlement model in spec.
- ⚠️ Client-only tx path exists, but within different endpoint contract and user-id model.
- ⚠️ Finalization exists conceptually via submit/confirm logic, but not target finalize contract.
- ✅ Character indexing logic exists in current app services.

## Settlement

- ⚠️ Prepare endpoint exists (different contract).
- ✅ Canonical tx build exists on backend.
- ❌ Phantom `presignTransaction` flow integrated on client.
- ❌ Presign endpoint decodes and verifies tx for co-sign callback use.
- ❌ Backend co-sign logic exists for sponsored settlement.
- ⚠️ Finalization/ack exists but not the exact target finalize + sponsored semantics.
- ⚠️ Double-settlement prevention exists partially via ordering checks and persistence model, but must be validated against new request-id/idempotency contract.

## Token Transfers

- ❌ Policy-check endpoint exists.
- ❌ Client-only transfer tx path exists.
- ❌ Restricted-transfer detection exists.
- ❌ Finalization/indexing exists where needed.

## Security and Ops

- ⚠️ Treasury key isolated to backend only: no frontend treasury key seen, but sponsored treasury flow is not implemented yet.
- ❌ Nonce replay prevention exists for login.
- ❌ Rate limiting exists.
- ⚠️ Structured error codes exist partially (prefixed strings) but not uniform contract-wide codes.
- ❌ Audit log exists (per required schema).
- ❌ Monitoring exists.

---

## API contract deltas (target vs current)

## Current route families (observed)

- Historical route at analysis time: `POST /api/auth/anon`
- `GET/POST /api/characters` (+ `userId` in query/body)
- `POST /api/solana/character/create/prepare`
- `POST /api/solana/character/create/submit`
- `POST /api/solana/character/first-sync/prepare`
- `POST /api/solana/character/first-sync/ack`
- `POST /api/solana/settlement/prepare`
- `POST /api/solana/settlement/submit`
- `POST /api/solana/settlement/ack`

## Required target route families (missing/misaligned)

- `POST /v1/auth/nonce`
- `POST /v1/auth/verify`
- `POST /v1/characters/create/prepare`
- `POST /v1/characters/create/finalize`
- `POST /v1/settlement/prepare`
- `POST /v1/settlement/presign`
- `POST /v1/settlement/finalize`
- `POST /v1/transfers/check`
- `POST /v1/transfers/finalize`

---

## Data model deltas (target vs current)

## Present in current schema

- `User` and `Character` models exist.
- Settlement-related persistence exists (`BattleOutcomeLedger`, `SettlementBatch`, `SettlementSubmissionAttempt`, etc.).

## Missing or mismatched for target auth/session model

- `users.primary_wallet_address` unique anchor and wallet auth metadata fields.
- `sessions` table.
- `auth_nonces` table.
- `settlement_requests` table in the target shape.
- `tx_audit_log` table in the target shape.

---

## Recommended phased remediation (aligned to your spec order)

1. Add Phantom Connect SDK path (embedded-wallet capable) as the only visible login entry.
2. Implement nonce challenge + wallet proof verify backend endpoints.
3. Add backend app session model (cookie/JWT + revocation).
4. Refactor character-create APIs to target prepare/finalize contract and session enforcement.
5. Implement settlement sponsored path using Phantom `signAndSendTransaction(..., { presignTransaction })` + backend presign verify/co-sign endpoint.
6. Introduce transfer check/finalize flow with restricted-case routing to sponsored path.
7. Add tx audit log for all prepare/presign/finalize and failure outcomes.
8. Add route-level rate limiting.
9. Add metrics/alerts (auth failures, presign rejects, chain confirmation timeouts, rejection categories).
10. Add integration tests covering auth nonce replay protection, presign mismatch rejection, and idempotent finalize behavior.

---

## Blockers and risks to track explicitly

- **Runtime environment blocker**: unable to directly inspect `runana-program` validation branch from this environment due outbound GitHub access restrictions.
- **Signer model transition risk**: current implementation enforces player-paid settlement; migrating to sponsored co-sign flow affects transaction assembly, Phantom client integration, and security policy checks.
- **Session migration risk**: many existing endpoints trust caller-provided `userId`; moving to backend sessions requires broad API contract changes and compatibility handling.
