# Phantom Connect Integration Vertical-Slice Implementation Plan (2026-04-13)

## 0) Purpose and baseline

This document is the execution plan to move `keep-pushing` from the current extension-style wallet + anonymous user model to a Phantom Connect + backend-authenticated + session-gated architecture, while preserving required gameplay behavior and aligning with `runana-program-validation` signer constraints. **If the target product behavior conflicts with current program constraints, this plan prioritizes target behavior and includes explicit runana-program changes.**

Decision clarified for this plan:
- Anonymous accounts are removed from scope.
- This migration is a deliberate breaking change.
- There is no legacy anon compatibility window and no anon progression migration/backfill requirement.

Baseline reviewed:
- `docs/phantom-connect-gap-analysis-2026-04-13.md`
- existing API/UI/Solana codepaths in `app/api/**`, `components/game/**`, `lib/solana/**`, `types/api/solana.ts`, `prisma/schema.prisma`
- local program repo `../runana-program`, especially:
  - `programs/runana-program/src/lib.rs`
  - `tests/src/fixtures.rs`
  - `tests/src/integration_helpers.rs`
  - `tests/src/test_initialize.rs`
  - `tests/src/test_slice2_replay_and_sequencing.rs`

---

## 1) Program findings from the local `runana-program` repo + required deltas to satisfy target behavior

## 1.1 Character creation signer/funding model (hard constraint)
- `CreateCharacter<'info>` in `programs/runana-program/src/lib.rs` constrains `payer.key() == authority.key()` and uses `payer = payer` for all init accounts.
- `InitializeCharacterZoneProgressPage<'info>` repeats the same `payer == authority` constraint for later page initialization.
- Current implication: both initial character creation and any later page bootstrap are player-paid/player-signed today.
- **Target requirement (updated): backend sponsor pays fees for character creation** while player still signs authority actions.
- Required delta:
  - remove the `PlayerMustSelfFund` constraint from both account structs
  - preserve `authority: Signer<'info>` and existing authority-derived PDA seeds
  - keep payer as a distinct signer so a backend/relayer can fund rent without owning gameplay authority
  - update localnet harness helpers to exercise `sponsor payer + player authority` instead of only `player payer`

## 1.2 Settlement signer model
- `ApplyBattleSettlementBatchV1<'info>` already accepts `player_authority: Signer` and does **not** include a payer account in the instruction context.
- On-chain implication: sponsored settlement fees are already compatible at the transaction layer; the fee payer can be different from `player_authority` without changing the instruction accounts.
- The actual blocker is `verify_server_attestation_preinstruction(...)`, which scans the instructions sysvar for a prior ed25519 verification signed by `program_config.trusted_server_signer`.
- **Target requirement (updated): settlement is backend-sponsored for fees; player signs authority, and server should not be required to provide extra business-authorization signatures beyond fee-payer duties.**
- Required delta:
  - keep sponsored fee payer entirely off-instruction
  - replace server-attestation-as-business-auth with player-authorization-as-business-auth
  - move settlement authorization verification to the player's canonical permit message, not a backend attestation

## 1.3 Canonical-message/signature scheme constraints
- `ProgramConfigAccount` and `InitializeProgramConfigArgs` currently store `trusted_server_signer`.
- `canonical_player_authorization_message(...)` and wallet-text support already exist in `lib.rs`, which is useful for Phantom-compatible message prompts.
- The current codepath does not yet make that player permit the sole settlement authorization primitive.
- **Target requirement (updated): player-signed authorization should be sufficient for business authorization; backend sponsor participates for fee payment only.**
- Required delta:
  - add an explicit settlement authorization mode in `ProgramConfigAccount` and `InitializeProgramConfigArgs`
  - use a compatibility enum such as `DualServerAndPlayer` -> `PlayerOnly`
  - keep `trusted_server_signer` temporarily for dual-mode rollout, then remove or deprecate after cutover
  - wire the canonical player authorization message into settlement verification so batch hash, batch id, character root, cluster id, and signature scheme stay replay-safe

## 1.4 Embedded-wallet compatibility callout
- Current app logic enforces `authority == feePayer` for settlement in backend route/service.
- This is incompatible with sponsored settlement objective and unnecessary per on-chain settlement instruction requirements.

## 1.5 Concrete program implementation delta
- `programs/runana-program/src/lib.rs`
  - update `CreateCharacter<'info>` and `InitializeCharacterZoneProgressPage<'info>` to allow distinct `payer` and `authority`
  - extend `ProgramConfigAccount` / `InitializeProgramConfigArgs` with `settlement_authorization_mode`
  - add a `verify_player_authorization_preinstruction(...)` path that validates the player's ed25519 permit against `canonical_player_authorization_message(...)`
  - replace direct calls to `verify_server_attestation_preinstruction(...)` inside `apply_battle_settlement_batch_v1(...)` with a mode-aware `verify_settlement_authorization(...)`
  - keep `player_authority: Signer<'info>` as the gameplay authority check; do not add a settlement payer account
- `tests/src/fixtures.rs`
  - include the authorization-mode fixture field
  - generate canonical player-only fixture variants in addition to legacy dual-sign variants
- `tests/src/integration_helpers.rs`
  - add sponsor-payer create helpers
  - split ed25519 preinstruction builders into dual-mode and player-only variants
- `tests/src/test_initialize.rs`
  - replace the current "payer must equal authority" expectation with sponsor-payer success coverage
  - add a negative test that still fails when the player authority signer is missing or mismatched
- `tests/src/test_slice2_replay_and_sequencing.rs`
  - retain player-permit mismatch coverage
  - move server-attestation mismatch coverage under explicit dual-mode compatibility tests only
- `migrations/deploy.ts`
  - initialize the new program-config authorization mode when bootstrapping local deployments

## 1.6 Program change policy for this plan
- **Desired implementation prevails.** If any runtime/program constraint blocks target Phantom Connect behavior, the plan adds a runana-program change slice rather than degrading product behavior.
- Program changes are first-class deliverables (IDL/version bump, migration/backfill, compatibility window, and chain fixture updates).

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
- Settlement: prepare -> client calls Phantom `signAndSendTransaction` with `presignTransaction` callback -> backend presign verifies canonical tx and applies sponsor fee-payer signature -> finalize.
- Transfers: check/finalize with policy gate; all allowed transfer modes are backend sponsor-paid while client remains the authority signer.
- No anonymous login or legacy anonymous-gameplay path remains in the target state.

## 2.3 Auth/session boundaries
- Frontend trusted for UX orchestration only.
- Backend trusted for:
  - wallet proof verification
  - session issuance/revocation
  - settlement policy decision and sponsor presign approval
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
| Character create | Yes (required) | No (except sponsor fee-payer signature) | Backend sponsor | Yes | Requires program change to remove `payer==authority` |
| Settlement | Yes (`player_authority`) | No business-signature (sponsor fee-payer only) | Backend sponsor | Yes (via `presignTransaction`) | Remove/replace server-attestation requirement if retained today |
| Transfer (unrestricted) | Yes | No | Backend sponsor | Yes | client submits, backend pays |
| Transfer (restricted/policy-required) | Yes | No business-signature (sponsor fee-payer only) | Backend sponsor | Yes | policy-gated but not server-authorized by signature |

---

## 3) Vertical slices (execution order)

## Slice 0 — Runana program alignment (mandatory)

### Scope
Apply the confirmed on-chain changes required to satisfy target Phantom Connect behavior without compromising trust guarantees. This slice must complete before app-side v1 character-create and settlement work.

### Touchpoints
- Program source in `../runana-program/programs/runana-program/src/lib.rs`.
- Generated IDL/client bindings consumed by `keep-pushing`, especially `lib/solana/runanaProgram.ts`, `lib/solana/runanaCharacterInstructions.ts`, and `lib/solana/runanaSettlementInstructions.ts`.
- Client builders in `lib/solana/runana*`, `lib/solana/*Instructions.ts`, `lib/solana/settlementTransactionAssembly.ts`.
- Backend verifiers in new `lib/solana/settlementPresign.ts`.

### Exact implementation tasks in `runana-program`
1. Character funding decoupling
- edit `CreateCharacter<'info>` and `InitializeCharacterZoneProgressPage<'info>` in `programs/runana-program/src/lib.rs`
- delete the `payer.key() == authority.key()` constraint while keeping `authority` as a required signer
- verify PDA derivations remain authority-bound, not payer-bound
- update `tests/src/integration_helpers.rs` so the relayer can act as fee payer while the canonical player still signs

2. Settlement authorization mode
- add a small enum or `u8` mode field to `ProgramConfigAccount` and `InitializeProgramConfigArgs`
- recommended modes:
  - `0 = DualServerAndPlayer`
  - `1 = PlayerOnly`
- bump the program/account version and IDL so app code can branch cleanly during rollout

3. Settlement verifier rewrite
- replace `verify_server_attestation_preinstruction(...)` with a mode-aware `verify_settlement_authorization(...)`
- in `PlayerOnly` mode:
  - scan prior ed25519 instruction(s) for a signature by `player_authority`
  - recompute `canonical_player_authorization_message(...)`
  - require the permit message to bind `program_id`, cluster id, character root, batch hash, batch id, and signature scheme
- in `DualServerAndPlayer` mode:
  - keep current trusted-server compatibility behavior temporarily for old clients/tests

4. Error and compatibility cleanup
- deprecate `PlayerMustSelfFund` from the create path
- replace server-specific settlement errors/messages with authorization-mode-aware errors where needed
- keep `trusted_server_signer` readable during the migration window even if `PlayerOnly` becomes the default for new deployments

5. Test harness and fixtures
- update `tests/src/fixtures.rs` to emit config fixtures for both authorization modes
- update `tests/src/test_initialize.rs` to prove sponsor-paid character creation succeeds
- update `tests/src/test_slice2_replay_and_sequencing.rs` so replay and wrong-permit failures still hold in player-only mode
- add one compatibility test proving dual-mode still accepts legacy server-attested settlement during the transition window

### Security controls
- every program delta must preserve: character authority binding, anti-replay, and canonical payload integrity.
- any payer relaxation must include anti-spam constraints (rent funding limits + backend policy + per-wallet cooldown).
- player-only settlement authorization must continue to bind the canonical permit message to the exact sealed batch hash and signer scheme.

### Test strategy
- runana program unit/integration tests for new signer model and replay guarantees.
- contract test that proves regenerated `keep-pushing` instruction builders/IDL bindings still serialize the upgraded `runana-program` interfaces correctly.
- app integration tests against upgraded IDL + fixtures before enabling feature flags.

### Rollout
- introduce `RUNANA_PROGRAM_VERSION` compatibility gate in backend and client.
- support dual-version decoding during transition window; remove old path post-migration.

### Acceptance criteria
- Target Phantom Connect flow works end-to-end in embedded mode with no behavior downgrade.
- Program invariants remain provably enforced by tests.
- Updated IDL/types and app-side instruction builders are regenerated and wired into `keep-pushing` before Slice C or Slice D begins.

---

## Slice A — Auth foundation: nonce + verify + sessions

### Scope
Implement wallet-proof login and backend session infrastructure as the only supported entry path.

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
- security regression:
  - session rotation on login issues a fresh token and invalidates the old session where applicable
  - revoked and expired sessions are rejected consistently
  - logout invalidates server-side session state, not only the browser cookie

### Rollout / flags
- `FF_PHANTOM_CONNECT_AUTH` (off by default).
- No anon compatibility path: `/api/auth/anon` is removed or hard-fails once this slice is enabled.

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
- CSRF/origin enforcement tests:
  - cross-origin cookie-authenticated POST requests are rejected
  - same-origin authenticated POST requests still succeed
- breaking-change tests:
  - `/api/auth/anon` and legacy `userId`-driven routes fail explicitly once the new auth/session path is active

### Rollout / flags
- `FF_V1_SESSION_ENFORCEMENT` incremental by route family.

### Acceptance criteria
- `GameClient` no longer stores or sends `userId`.
- Protected v1 routes reject anonymous access consistently.

---

## Slice C — Character create prepare/finalize (client-only submit path)

### Scope
Refactor to `/v1/characters/create/prepare|finalize` using session identity and wallet binding with backend-sponsored fee payer (player signs authority only).

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
- end-to-end app test for sponsored character creation:
  - session-authenticated `prepare -> wallet sign/send -> finalize` succeeds with backend fee sponsorship and player authority preserved

### Rollout / flags
- `FF_V1_CHARACTER_CREATE`.

### Acceptance criteria
- Character creation succeeds with backend sponsor fee payer and player authority signature only.
- finalize is idempotent and returns prior result on retry.

---

## Slice D — Settlement prepare/presign/finalize with Phantom presign callback

### Scope
Implement sponsored settlement pipeline aligned with Phantom embedded wallet flow where backend pays fees and does not add business-authorization signatures.

### Touchpoints
- New routes:
  - `app/api/v1/settlement/prepare/route.ts`
  - `app/api/v1/settlement/presign/route.ts`
  - `app/api/v1/settlement/finalize/route.ts`
- Services:
  - evolve `lib/solana/settlementRelay.ts` (remove `authority==feePayer` coupling)
  - add `lib/solana/settlementPresign.ts` (canonical decode/verify/sponsor-fee-payer signing only)
  - add `lib/solana/settlementPolicy.ts`
- Frontend:
  - `components/game/GameClient.tsx` settlement execution updated to `signAndSendTransaction(..., { presignTransaction })`
- Types:
  - add `types/api/settlementV1.ts` with explicit `prepareRequestId`, `presignToken`, `error.code`

### API contracts
1. `POST /v1/settlement/prepare` -> returns canonical unsigned tx payload + `prepareRequestId` + expected invariants + presign challenge token.
2. Phantom invokes presign callback with tx bytes -> client sends to `POST /v1/settlement/presign`.
3. `/presign` verifies canonical tx checklist (below), applies sponsor fee-payer signature only if valid, returns updated tx bytes.
4. Client sends tx; then `POST /v1/settlement/finalize` with `{ prepareRequestId, txSignature }`.

### Canonical transaction verification checklist (/presign)
Reject unless all pass:
- request/session binding: active session, wallet matches `player_authority`.
- one active settlement request in `PREPARED` state for `prepareRequestId`.
- transaction message hash exactly matches prepared canonical hash.
- instruction set:
  - includes expected Runana settlement instruction only (plus allowed compute budget pattern)
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
Add policy-gated transfer flow with backend-sponsored fee payer for all transfer modes; client signs and submits.

### Touchpoints
- Routes: `app/api/v1/transfers/check/route.ts`, `.../finalize/route.ts`
- Services: new `lib/solana/transferPolicy.ts`, `lib/solana/transferFinalize.ts`
- UI: transfer initiation path in `components/game/**` (module depending on current UX entrypoint)
- Types: `types/api/transfers.ts`

### API contracts
- `/v1/transfers/check`: evaluates transfer intent and returns sponsor policy + constraints (all allowed modes are sponsor-paid).
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
- include coverage that legacy anon entrypoints and legacy `userId` request shapes are rejected after the breaking-change rollout.

### Rollout
- observability mandatory before broadening flags.

### Acceptance criteria
- every v1 action emits audit row + metrics + structured logs.

---

## 4) File-level change map (planned)

## 4.1 Existing files likely to be edited

### `app/api`
- `app/api/auth/anon/route.ts` (remove or convert to explicit breaking-change error)
- `app/api/solana/character/create/prepare/route.ts` (remove or convert to explicit breaking-change error)
- `app/api/solana/character/create/submit/route.ts` (remove or convert to explicit breaking-change error)
- `app/api/solana/settlement/prepare/route.ts` (remove or convert to explicit breaking-change error)
- `app/api/solana/settlement/submit/route.ts` (remove or convert to explicit breaking-change error)
- `app/api/solana/settlement/ack/route.ts` (remove or convert to explicit breaking-change error)

### `components`
- `components/game/GameClient.tsx` (remove anon bootstrap + userId transport; integrate Phantom Connect auth and presign callback orchestration)

### `lib`
- `lib/solana/phantomBrowser.ts` (replace/augment with Phantom Connect-compatible adapter abstraction)
- `lib/solana/settlementRelay.ts` (remove `authority==feePayer` requirement for sponsored path; shift to v1 services)
- `lib/solana/characterCreation.ts` (session-aware create prepare/finalize helper split)

### `types`
- `types/api/solana.ts` (shrink to only the still-supported surfaces or remove once v1 types fully replace it)

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

## 4.3 `runana-program` repo files expected to change

### Program source
- `../runana-program/programs/runana-program/src/lib.rs`
- `../runana-program/migrations/deploy.ts`

### Program tests and helpers
- `../runana-program/tests/src/fixtures.rs`
- `../runana-program/tests/src/integration_helpers.rs`
- `../runana-program/tests/src/test_initialize.rs`
- `../runana-program/tests/src/test_slice2_replay_and_sequencing.rs`
- additional slice tests under `../runana-program/tests/src/test_slice3_*.rs` through `test_slice6_*.rs` if they rely on legacy dual-sign preinstructions

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
5. Backend verifies checklist, adds sponsor fee-payer signature if valid, stores presign hash + status `PRESIGNED`, returns updated tx bytes.
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
   - Mitigation: phased v1 namespace + direct route replacement/removal + telemetry-driven cutover.
4. **Replay/idempotency bugs in presign/finalize**.
   - Mitigation: DB unique constraints and deterministic idempotency keys.
5. **Program authorization-mode migration risk**.
   - Mitigation: keep dual-mode support briefly, share canonical message builders between app presign and on-chain verification, and pin fixtures in both repos to the same batch-hash vectors.
6. **Operational blind spots** during migration.
   - Mitigation: ship audit + metrics before enabling broad flags.

Fallback designs:
- If a blocker appears, modify runana-program + backend/client to preserve the target sponsor-paid + player-signed model across create/settlement/transfers.
- Do not reintroduce anon as a fallback.

---

## 8) Implementation timeline and critical path

## Phase -1 (1-3 days): program delta implementation
- land the `runana-program` changes first in `../runana-program`:
  - decouple payer from authority for character creation/page init
  - add settlement authorization mode
  - switch settlement business authorization to player permit verification
- generate the updated IDL/types and define the compatibility matrix before app route work begins.

## Phase 0 (1-2 days): foundations
- add DB models/migrations for auth/session/request/audit.
- add auth utils + error envelope + basic metrics scaffolding.

## Phase 1 (2-3 days): auth/session slice
- ship `/v1/auth/nonce|verify|logout` + frontend login replacement behind `FF_PHANTOM_CONNECT_AUTH`.
- begin session enforcement for one low-risk route family.

## Phase 2 (2-3 days): character create v1 slice
- implement `/v1/characters/create/prepare|finalize` and UI switch.
- enforce sponsor-paid fee model with player authority signature only.

## Phase 3 (4-6 days): settlement presign slice (critical path)
- implement `/v1/settlement/prepare|presign|finalize` + canonical tx verifier + sponsor signing.
- integrate Phantom `presignTransaction` callback path in UI.
- add negative-path integration suite.

## Phase 4 (2-3 days): transfers slice
- implement `/v1/transfers/check|finalize` with policy matrix and audit.

## Phase 5 (2 days): hardening and rollout
- rate limits, alerts, dashboards, docs, staged flag rollout.
- remove legacy anon/userId frontend and API paths as part of the breaking-change rollout.

### Critical path dependencies
1. runana-program delta + IDL/version readiness
2. DB schema (sessions/nonces/settlement_requests)
3. session middleware
4. settlement canonical presign verifier
5. frontend Phantom Connect callback orchestration
6. integration tests + observability

---

## 9) Release checklist (must-pass)

- [ ] Phantom Connect is the only visible login path.
- [ ] Nonce replay blocked and covered by tests.
- [ ] Session required on all v1 game-affecting routes.
- [ ] Character create uses v1 prepare/finalize with backend sponsor fee payer.
- [ ] Settlement uses prepare/presign/finalize with backend sponsor fee payer and no server business-signature requirement.
- [ ] Transfer check/finalize policy path live with backend sponsor fee payer.
- [ ] Structured error codes documented and returned consistently.
- [ ] Rate limiting active on auth + settlement + transfer routes.
- [ ] Audit log populated for all tx/auth critical events.
- [ ] Metrics/alerts deployed and validated.
- [ ] Legacy anon flow removed from UI and legacy anon endpoints removed or hard-failed.
