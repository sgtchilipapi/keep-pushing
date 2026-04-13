# Phantom Connect Integration Vertical-Slice Implementation Plan (2026-04-13)

## 0) Purpose and baseline

This document is the execution plan to move `keep-pushing` from the current extension-style wallet + anonymous user model to a Phantom Connect + backend-authenticated + session-gated architecture, while preserving required gameplay behavior and aligning with `runana-program-validation` signer constraints.

Baseline reviewed:
- `docs/phantom-connect-gap-analysis-2026-04-13.md`
- existing API/UI/Solana codepaths in `app/api/**`, `components/game/**`, `lib/solana/**`, `types/api/solana.ts`, `prisma/schema.prisma`
- program artifact `docs/runana-program-validation.zip` (inspected from `programs/runana-program/src/lib.rs` + tests)

---

## 1) Program-constraint findings from `runana-program-validation` (must drive design)

## 1.1 Character creation signer/funding model (hard constraint)
- `CreateCharacter` requires `payer == authority` (`PlayerMustSelfFund`).
- Implication: character creation **must remain client-paid/client-signed**; do not design sponsored fee payer for this instruction.

## 1.2 Settlement signer model
- `ApplyBattleSettlementBatchV1` requires `player_authority: Signer`, but does **not** include payer account in instruction context.
- The program validates server attestation via ed25519 verification instruction(s) found in prior instructions sysvar scan.
- Implication: settlement can be **sponsored on tx fee payer** (backend fee payer possible), while still requiring player signature on the transaction and canonical server attestation preinstruction.

## 1.3 Canonical-message/signature scheme constraints
- `ProgramConfigAccount` stores `trusted_server_signer`; settlement verifies attestation against this key.
- Canonical player authorization message supports both raw and wallet-text schemes; wallet-text is compatible with Phantom message UX.
- Implication: presign flow must strictly bind payload/domain/signer scheme to prevent cross-request replay.

## 1.4 Embedded-wallet compatibility callout
- Current app logic enforces `authority == feePayer` for settlement in backend route/service.
- This is incompatible with sponsored settlement objective and unnecessary per on-chain settlement instruction requirements.

---

## 2) Current vs target architecture

## 2.1 Current architecture (summarized)
- Identity: `POST /api/auth/anon` creates user; frontend persists `userId` in localStorage.
- Authorization: most routes trust caller-provided `userId` query/body.
- Wallet: browser-injected Phantom provider integration (`window.phantom` extension style).
- Settlement: player-owned transaction path (`authority == feePayer`) with prepare/submit/ack endpoints.

## 2.2 Target architecture
- Identity source of truth: verified wallet ownership (nonce challenge + signature verify).
- App auth: backend session (httpOnly cookie + sessions table + revocation + expiry).
- Wallet UX: Phantom Connect login flow (embedded or injected) with one visible login path.
- Character creation: client-only signing/sending allowed; backend prepare/finalize under session.
- Settlement: prepare -> client calls Phantom `signAndSendTransaction` with `presignTransaction` callback -> backend presign verifies canonical tx and co-signs/sponsors -> finalize.
- Transfers: check/finalize with policy gate; client-only where allowed, sponsored/escalated path where required.

## 2.3 Auth/session boundaries
- Frontend trusted for UX orchestration only.
- Backend trusted for:
  - wallet proof verification
  - session issuance/revocation
  - settlement policy decision and presign co-signing
  - transfer policy checks
  - audit logging and idempotency
- On-chain trusted for settlement application invariants and signer checks.

## 2.4 Trust model
- Wallet signature over nonce proves wallet control at login.
- Session cookie proves app user continuity, not custody.
- Any tx-affecting backend action must bind: `session.user_id + session.wallet + action_type + request_id + canonical_payload_hash`.
- Server signing key is backend-only; never exposed client-side.

## 2.5 Transaction policy matrix

| Action | Client signs | Backend signs | Fee payer | Allowed with embedded wallet | Notes |
|---|---|---|---|---|---|
| Character create | Yes (required) | No | Player wallet | Yes | Enforced by program `payer==authority` |
| Settlement | Yes (`player_authority`) | Yes (attestation + tx co-sign when sponsoring) | Backend sponsor (target) | Yes (via `presignTransaction`) | Must pass canonical tx verification |
| Transfer (unrestricted) | Yes | No | Player wallet | Yes | direct client path |
| Transfer (restricted/policy-required) | Yes | Optional/Yes | Backend sponsor or policy-defined | Yes | routed through check->finalize policy |

---

## 3) Vertical slices (execution order)

## Slice A — Auth foundation: nonce + verify + sessions

### Scope
Implement wallet-proof login and backend session infrastructure; keep existing gameplay endpoints temporarily dual-mode behind feature flag.

### Touchpoints
- Backend API: new `/app/api/v1/auth/nonce/route.ts`, `/app/api/v1/auth/verify/route.ts`, `/app/api/v1/auth/logout/route.ts`
- Middleware/util: `lib/auth/session.ts`, `lib/auth/nonce.ts`, `lib/auth/cookies.ts`, `lib/auth/requireSession.ts`
- DB: `User` wallet fields + new `AuthNonce`, `Session` models
- Frontend: replace anonymous bootstrap in `components/game/GameClient.tsx`; add Phantom Connect auth adapter module

### API contracts
- `POST /v1/auth/nonce` request `{ walletAddress, chain:"solana" }` -> `{ nonceId, nonce, expiresAt, messageToSign }`
- `POST /v1/auth/verify` request `{ nonceId, walletAddress, signatureBase64, signedMessage }` -> `{ session, user }`
- `POST /v1/auth/logout` invalidates current session.

### Data migrations
- `User.primaryWalletAddress` unique nullable then backfilled/required for wallet users.
- `User.walletProvider`, `User.walletMode`, `User.authProvider`, `User.lastLoginAt`, `User.walletVerifiedAt`.
- Add `AuthNonce` with single-use + expiry + consumed metadata.
- Add `Session` with hashed token id, expiry, revokedAt, ip/user-agent fields.

### Security controls
- nonce TTL 5 min; one-time consume in serializable transaction.
- signature domain separator includes app origin + chain + nonce + issuedAt.
- session cookie: httpOnly, secure, sameSite=lax, rotation on verify.
- per-wallet and per-IP rate limit (nonce + verify).

### Observability
- metrics: nonce_issued, nonce_verified, nonce_replay_rejected, auth_failed_by_code.
- logs: structured auth events with request_id/session_id/user_id/wallet.

### Tests
- unit: message canonicalization + signature verification.
- integration: nonce replay rejection; expired nonce; session cookie set/cleared.

### Rollout / flags
- `FF_PHANTOM_CONNECT_AUTH` (off by default).
- Dual-path compatibility for one release window (`/api/auth/anon` retained but hidden from UI).

### Acceptance criteria
- No gameplay route accepts caller-controlled `userId` when flag enabled.
- Login succeeds with Phantom Connect signature and creates/links user by wallet.
- Nonce replay always fails deterministically.

---

## Slice B — Session enforcement and API contract migration scaffolding

### Scope
Move core routes from `userId` query/body to session-resolved identity and introduce v1 route namespace.

### Touchpoints
- New route tree under `app/api/v1/**` for auth/characters/settlement/transfers.
- Shared session guard in `lib/auth/requireSession.ts`.
- Existing `app/api/characters/**`, `app/api/character/**`, `app/api/zone-runs/**` updated to resolve actor from session (or wrapped adapter).
- Type updates in `types/api/solana.ts` and new `types/api/auth.ts`, `types/api/transfers.ts`.

### API contract changes
- Remove `userId` inputs from client-callable APIs.
- Add standard response envelope:
  - success: `{ ok:true, data, requestId }`
  - error: `{ ok:false, error:{ code, message, retryable, details? }, requestId }`

### Data model migrations
- none beyond slice A; add optional `api_request_id` capture column(s) where useful.

### Security controls
- every v1 route guarded except `/v1/auth/*`.
- CSRF mitigation for cookie-authenticated POSTs (double-submit token or origin enforcement for API).

### Observability
- route-level latency/error metrics with `route`, `code`, `status` labels.

### Tests
- API tests ensure unauthorized when session absent/expired.
- regression tests for existing flows under session context.

### Rollout / flags
- `FF_V1_SESSION_ENFORCEMENT` incremental by route family.

### Acceptance criteria
- `GameClient` no longer stores or sends `userId`.
- Protected v1 routes reject anonymous access consistently.

---

## Slice C — Character create prepare/finalize (client-only submit path)

### Scope
Refactor to `/v1/characters/create/prepare|finalize` using session identity and wallet binding; keep player-funded model.

### Touchpoints
- New routes: `app/api/v1/characters/create/prepare/route.ts`, `.../finalize/route.ts`
- Reuse/adapt service: `lib/solana/characterCreation.ts`
- Frontend hooks in `components/game/GameClient.tsx` and new `components/game/wallet/phantomConnectClient.ts`
- Type additions: `types/api/characters.ts`

### API changes
- prepare request: `{ characterDraft, walletAddress, idempotencyKey }`
- prepare response: `{ preparedTx, relayMeta, expiresAt }`
- finalize request: `{ prepareRequestId, txSignature, signedMessageHash }`

### Data migrations
- extend `Character` with `createdViaWalletAddress` (or reuse `playerAuthorityPubkey`) + lifecycle metadata for idempotent finalize mapping.

### Security controls
- verify session wallet == request wallet.
- verify finalize signature/message hash matches prepared record.
- idempotency key unique per session + action.

### Observability
- metrics: character_prepare_total, character_finalize_confirmed_total, character_finalize_conflict_total.

### Tests
- integration: prepare->wallet sign/send->finalize success.
- negative: authority mismatch, duplicate finalize, stale prepare token.

### Rollout / flags
- `FF_V1_CHARACTER_CREATE`.

### Acceptance criteria
- Character creation remains fully compatible with on-chain `payer==authority`.
- finalize is idempotent and returns prior result on retry.

---

## Slice D — Settlement prepare/presign/finalize with Phantom presign callback

### Scope
Implement sponsored settlement pipeline aligned with Phantom embedded wallet flow.

### Touchpoints
- New routes:
  - `app/api/v1/settlement/prepare/route.ts`
  - `app/api/v1/settlement/presign/route.ts`
  - `app/api/v1/settlement/finalize/route.ts`
- Services:
  - evolve `lib/solana/settlementRelay.ts` (remove `authority==feePayer` coupling)
  - add `lib/solana/settlementPresign.ts` (canonical decode/verify/co-sign)
  - add `lib/solana/settlementPolicy.ts`
- Frontend:
  - `components/game/GameClient.tsx` settlement execution updated to `signAndSendTransaction(..., { presignTransaction })`
- Types:
  - add `types/api/settlementV1.ts` with explicit `prepareRequestId`, `presignToken`, `error.code`

### API contracts
1. `POST /v1/settlement/prepare` -> returns canonical unsigned tx payload + `prepareRequestId` + expected invariants + presign challenge token.
2. Phantom invokes presign callback with tx bytes -> client sends to `POST /v1/settlement/presign`.
3. `/presign` verifies canonical tx checklist (below), co-signs/sponsors if valid, returns updated tx bytes.
4. Client sends tx; then `POST /v1/settlement/finalize` with `{ prepareRequestId, txSignature }`.

### Canonical transaction verification checklist (/presign)
Reject unless all pass:
- request/session binding: active session, wallet matches `player_authority`.
- one active settlement request in `PREPARED` state for `prepareRequestId`.
- transaction message hash exactly matches prepared canonical hash.
- instruction set:
  - includes expected Runana settlement instruction only (plus allowed compute budget + ed25519 preinstruction pattern)
  - program id equals configured Runana program id
- account metas/order match expected envelope derived server-side.
- payload invariants match sealed batch: `batch_id/hash/nonce range/state hashes/season`.
- signature scheme and permit domain unchanged.
- blockhash freshness within configured window.
- replay guards: not already presigned/finalized/expired.

### Mismatch rejection + invalidation rules
- hard mismatch => mark request `INVALIDATED` with code (`SETTLEMENT_TX_MISMATCH_*`), require new prepare.
- transient infra issue => keep `PREPARED`, return retryable error.
- repeated suspicious mismatches threshold => temporary wallet/session cooldown.

### Idempotency behavior
- `prepare`: idempotent on `(character_id, continuity_key)` returns existing open request.
- `presign`: idempotent on `(prepare_request_id, tx_message_hash)` returns same signed bytes if already presigned.
- `finalize`: idempotent on `(prepare_request_id, tx_signature)`; replay returns stored terminal result.

### Data migrations
- new `SettlementRequest` table (status machine + hashes + presign timestamps + invalidation reason).
- optional add columns on `SettlementBatch` to link latest `settlementRequestId`.

### Security controls
- backend-held sponsor key only.
- strict canonical verification before signing.
- route-specific aggressive rate limits (`prepare`, `presign`, `finalize`).

### Observability
- counters by rejection reason code.
- presign latency histogram.
- alert on presign mismatch spike and finalize timeout rate.

### Tests
- integration happy path with mocked Phantom presign callback.
- negative matrix for each checklist mismatch.
- regression: no double settlement on retries/concurrent finalize.

### Rollout / flags
- `FF_V1_SETTLEMENT_PRESIGN` per cohort.

### Acceptance criteria
- Embedded-wallet flow completes settlement without requiring extension-only capabilities.
- Backend never signs non-canonical settlement transaction.

---

## Slice E — Transfers check/finalize

### Scope
Add policy-gated transfer flow with client-only fast path and restricted/sponsored escalation.

### Touchpoints
- Routes: `app/api/v1/transfers/check/route.ts`, `.../finalize/route.ts`
- Services: new `lib/solana/transferPolicy.ts`, `lib/solana/transferFinalize.ts`
- UI: transfer initiation path in `components/game/**` (module depending on current UX entrypoint)
- Types: `types/api/transfers.ts`

### API contracts
- `/v1/transfers/check`: evaluates transfer intent and returns `mode: client_only | sponsored_required | blocked` plus constraints.
- `/v1/transfers/finalize`: records/validates confirmed transfer tx and updates audit trail.

### Data migrations
- persist transfer request record in `TxAuditLog` (or separate `TransferRequest` if needed for lifecycle clarity).

### Security controls
- allowlist/denylist policy hooks.
- amount limits, token mint policy, anti-drain velocity checks.

### Observability
- transfer_mode distribution, blocked reason codes, finalize failures.

### Tests
- policy unit tests + route integration tests for all modes.

### Rollout / flags
- `FF_V1_TRANSFERS` gated.

### Acceptance criteria
- restricted transfers cannot bypass sponsored/policy path.

---

## Slice F — Audit logging + rate limiting + monitoring/alerts + integration suite hardening

### Scope
Cross-cutting production-readiness controls for all v1 flows.

### Touchpoints
- `lib/observability/metrics.ts`, `lib/observability/logger.ts`
- `lib/security/rateLimit.ts` (or middleware)
- route instrumentation wrappers in `app/api/v1/**`
- DB: `TxAuditLog` table + indexes
- tests: `tests/integration/phantomConnect/*.test.ts`

### Machine-readable error code strategy
- Namespace by domain:
  - `AUTH_NONCE_*`, `AUTH_SESSION_*`
  - `SETTLEMENT_PREPARE_*`, `SETTLEMENT_PRESIGN_*`, `SETTLEMENT_FINALIZE_*`
  - `TRANSFER_CHECK_*`, `TRANSFER_FINALIZE_*`
- Each includes `retryable` boolean and stable documentation map in `docs/api/error-codes-v1.md`.

### Rate-limit policy (initial)
- `/v1/auth/nonce`: 10/min per IP, 5/min per wallet.
- `/v1/auth/verify`: 10/min per IP, 5/min per wallet; lockout ladder on repeated signature failures.
- `/v1/settlement/prepare`: 30/min per session, 10/min per character.
- `/v1/settlement/presign`: 60/min per session, 20/min per character.
- `/v1/settlement/finalize`: 30/min per session.
- `/v1/transfers/check|finalize`: tighter per-wallet burst limits.

### Monitoring & alerts
- SLO candidates:
  - auth verify success rate >= 99%
  - settlement finalize success (non-user-cancel) >= 98%
- alerts:
  - presign mismatch rate > 2% over 10 min
  - nonce replay attempts > threshold
  - finalize stuck in pending > N minutes

### Tests
- end-to-end integration suite across slices A-E with deterministic fixtures and seeded db.

### Rollout
- observability mandatory before broadening flags.

### Acceptance criteria
- every v1 action emits audit row + metrics + structured logs.

---

## 4) File-level change map (planned)

## 4.1 Existing files likely to be edited

### `app/api`
- `app/api/auth/anon/route.ts` (deprecate/flag or compatibility wrapper)
- `app/api/solana/character/create/prepare/route.ts` (bridge/deprecation notice)
- `app/api/solana/character/create/submit/route.ts` (bridge/deprecation notice)
- `app/api/solana/settlement/prepare/route.ts` (bridge/deprecation notice)
- `app/api/solana/settlement/submit/route.ts` (bridge/deprecation notice)
- `app/api/solana/settlement/ack/route.ts` (bridge/deprecation notice)

### `components`
- `components/game/GameClient.tsx` (remove anon bootstrap + userId transport; integrate Phantom Connect auth and presign callback orchestration)

### `lib`
- `lib/solana/phantomBrowser.ts` (replace/augment with Phantom Connect-compatible adapter abstraction)
- `lib/solana/settlementRelay.ts` (remove `authority==feePayer` requirement for sponsored path; shift to v1 services)
- `lib/solana/characterCreation.ts` (session-aware create prepare/finalize helper split)

### `types`
- `types/api/solana.ts` (retain legacy; add deprecation tags and/or slim wrapper types)

### `prisma`
- `prisma/schema.prisma` (new auth/session/settlement-request/audit models and user wallet fields)
- new migration SQL files under `prisma/migrations/*`

### `tests`
- existing tests touching settlement/character/auth routes adjusted for v1 contracts:
  - `tests/characterCreateRoute.test.ts`
  - `tests/settlementAckRoute.test.ts`
  - `tests/firstSyncRoutes.test.ts`
  - `tests/phantomBrowser.test.ts`

## 4.2 Expected new files/modules

### API routes
- `app/api/v1/auth/nonce/route.ts`
- `app/api/v1/auth/verify/route.ts`
- `app/api/v1/auth/logout/route.ts`
- `app/api/v1/characters/create/prepare/route.ts`
- `app/api/v1/characters/create/finalize/route.ts`
- `app/api/v1/settlement/prepare/route.ts`
- `app/api/v1/settlement/presign/route.ts`
- `app/api/v1/settlement/finalize/route.ts`
- `app/api/v1/transfers/check/route.ts`
- `app/api/v1/transfers/finalize/route.ts`

### Library/auth/security/observability
- `lib/auth/nonce.ts`
- `lib/auth/session.ts`
- `lib/auth/requireSession.ts`
- `lib/auth/walletVerify.ts`
- `lib/security/rateLimit.ts`
- `lib/solana/settlementPresign.ts`
- `lib/solana/transferPolicy.ts`
- `lib/solana/transferFinalize.ts`
- `lib/observability/metrics.ts`
- `lib/observability/alerts.ts`

### Types/docs/tests
- `types/api/auth.ts`
- `types/api/settlementV1.ts`
- `types/api/transfers.ts`
- `docs/api/error-codes-v1.md`
- `tests/integration/authNonceSession.test.ts`
- `tests/integration/settlementPresignFlow.test.ts`
- `tests/integration/transfersFlow.test.ts`
- `tests/integration/rateLimitAndAudit.test.ts`

---

## 5) DB migration plan (detailed)

## 5.1 `User` updates
- add `primaryWalletAddress String? @unique`
- add metadata columns:
  - `walletProvider String?`
  - `walletMode String?` (`embedded` | `injected`)
  - `authProvider String?` (`phantom_connect`)
  - `walletVerifiedAt DateTime?`
  - `lastLoginAt DateTime?`
- migration sequence:
  1. add nullable columns + unique partial index for non-null wallet
  2. backfill from existing `Character.playerAuthorityPubkey` where safe
  3. enforce invariants in app layer before optional not-null migration (if desired)

## 5.2 `AuthNonce`
- columns: `id`, `walletAddress`, `nonce`, `message`, `expiresAt`, `consumedAt`, `consumedBySessionId`, `createdAt`, `ipHash`
- indexes:
  - unique `(walletAddress, nonce)`
  - index `(expiresAt)`
  - index `(walletAddress, createdAt desc)`
- replay constraint: consume via conditional update where `consumedAt IS NULL AND expiresAt > now()`

## 5.3 `Session`
- columns: `id`, `userId`, `walletAddress`, `tokenHash`, `issuedAt`, `expiresAt`, `revokedAt`, `lastSeenAt`, `ipHash`, `userAgent`
- indexes:
  - unique `(tokenHash)`
  - index `(userId, revokedAt, expiresAt)`
  - index `(walletAddress, revokedAt, expiresAt)`

## 5.4 `SettlementRequest`
- columns: `id`, `characterId`, `sessionId`, `walletAddress`, `batchId`, `batchHash`, `prepareMessageHash`, `presignedMessageHash`, `status`, `invalidReasonCode`, `idempotencyKey`, `preparedAt`, `presignedAt`, `finalizedAt`, `expiresAt`
- uniqueness/idempotency:
  - unique `(characterId, idempotencyKey)`
  - unique `(characterId, batchHash, status in active states)` via partial unique index
  - unique `(id, presignedMessageHash)` for presign idempotency

## 5.5 `TxAuditLog`
- columns: `id`, `requestId`, `sessionId`, `userId`, `walletAddress`, `actionType`, `phase`, `status`, `errorCode`, `httpStatus`, `chainSignature`, `entityType`, `entityId`, `metadataJson`, `createdAt`
- indexes:
  - index `(actionType, createdAt)`
  - index `(walletAddress, createdAt)`
  - index `(requestId)`

---

## 6) Settlement presign design (authoritative sequence)

1. Client calls `/v1/settlement/prepare` with `characterId` + `idempotencyKey`.
2. Backend seals/loads batch, builds canonical unsigned transaction template, stores `SettlementRequest(PREPARED)` with hash-bound invariants.
3. Client invokes Phantom Connect send flow and supplies `presignTransaction` callback.
4. Callback posts tx bytes + `prepareRequestId` to `/v1/settlement/presign`.
5. Backend verifies checklist, adds sponsor/server signatures if valid, stores presign hash + status `PRESIGNED`, returns updated tx bytes.
6. Phantom submits transaction.
7. Client posts `/v1/settlement/finalize` with `prepareRequestId` + `txSignature`.
8. Backend confirms chain result, commits settlement cursor/batch status, writes audit records, returns terminal response.

### Invalidation and retry
- Any canonical mismatch => invalidate request, require new prepare.
- Rpc/confirmation transient errors => retain request state for retry if not invalidated.
- finalize retries always safe/idempotent.

---

## 7) Risk + blocker register

1. **Program/API signer mismatch risk**: current backend enforces player fee payer for settlement; must be removed for sponsored mode.
   - Mitigation: isolated `settlementPresign` module + compatibility tests.
2. **Phantom Connect SDK integration complexity** (embedded + injected parity).
   - Mitigation: adapter interface and e2e smoke tests for both wallet modes.
3. **Legacy `userId` contract surface area** broad across routes.
   - Mitigation: phased v1 namespace + bridge routes + telemetry-driven cutover.
4. **Replay/idempotency bugs in presign/finalize**.
   - Mitigation: DB unique constraints and deterministic idempotency keys.
5. **Program-level attestation formatting mismatch**.
   - Mitigation: canonical message builders shared by prepare/presign; fixture tests using validation artifact vectors.
6. **Operational blind spots** during migration.
   - Mitigation: ship audit + metrics before enabling broad flags.

Fallback designs:
- If sponsored fee payer path faces blocker, temporary fallback is client-paid settlement for injected wallets only, but keep presign verification scaffolding and do not expose as final embedded-wallet solution.

---

## 8) Implementation timeline and critical path

## Phase 0 (1-2 days): foundations
- add DB models/migrations for auth/session/request/audit.
- add auth utils + error envelope + basic metrics scaffolding.

## Phase 1 (2-3 days): auth/session slice
- ship `/v1/auth/nonce|verify|logout` + frontend login replacement behind `FF_PHANTOM_CONNECT_AUTH`.
- begin session enforcement for one low-risk route family.

## Phase 2 (2-3 days): character create v1 slice
- implement `/v1/characters/create/prepare|finalize` and UI switch.
- keep player-funded invariant explicit.

## Phase 3 (4-6 days): settlement presign slice (critical path)
- implement `/v1/settlement/prepare|presign|finalize` + canonical tx verifier + sponsor signing.
- integrate Phantom `presignTransaction` callback path in UI.
- add negative-path integration suite.

## Phase 4 (2-3 days): transfers slice
- implement `/v1/transfers/check|finalize` with policy matrix and audit.

## Phase 5 (2 days): hardening and rollout
- rate limits, alerts, dashboards, docs, staged flag rollout.
- disable legacy anon/userId frontend path after stable canary.

### Critical path dependencies
1. DB schema (sessions/nonces/settlement_requests)
2. session middleware
3. settlement canonical presign verifier
4. frontend Phantom Connect callback orchestration
5. integration tests + observability

---

## 9) Release checklist (must-pass)

- [ ] Phantom Connect is the only visible login path.
- [ ] Nonce replay blocked and covered by tests.
- [ ] Session required on all v1 game-affecting routes.
- [ ] Character create uses v1 prepare/finalize and remains player-funded.
- [ ] Settlement uses prepare/presign/finalize with sponsored fee payer support.
- [ ] Transfer check/finalize policy path live.
- [ ] Structured error codes documented and returned consistently.
- [ ] Rate limiting active on auth + settlement + transfer routes.
- [ ] Audit log populated for all tx/auth critical events.
- [ ] Metrics/alerts deployed and validated.
- [ ] Legacy anon flow disabled in UI and scheduled for API removal.

