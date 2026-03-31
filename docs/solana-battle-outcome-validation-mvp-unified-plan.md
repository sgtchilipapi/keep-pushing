# Unified Solana Data Architecture for MVP Batch Settlement Validation

## 1) Canonical MVP Direction (Supersedes Prior Per-Battle Plan)

This document is the canonical MVP implementation plan for Solana settlement ingestion.

It **supersedes** per-battle on-chain settlement as the primary MVP path.

MVP settlement is now:

- off-chain server-authoritative combat simulation,
- off-chain aggregation into fixed-size battle batches,
- deferred on-chain submission of batches,
- on-chain validation of bounded legality and sequential state transitions.

Primary product reason:

- players must continue playing without requiring a blockchain transaction after every battle.

---


## 1.1) Canonical Field and Policy Dictionary (Normative, Workstream 6 Framing Lock)

This section is the one-page canonical dictionary referenced by all implementation docs. If another section conflicts, this section wins until the conflict is corrected.

### Canonical time and season fields

- Canonical time anchor family: `*_battle_ts` only.
- Canonical unit: `u64` Unix timestamp in **seconds**.
- Cursor fields are mandatory and canonical:
  - `last_committed_battle_ts: u64`
  - `last_committed_season_id: u32`
- Season policy terms are canonical:
  - `season_start_ts: u64`
  - `season_end_ts: u64`
  - `commit_grace_end_ts: u64`

### Canonical policy order

1. Delayed submission is allowed (submission time is not the primary validity signal).
2. Prior-season uncommitted progress expires permanently after grace closes.
3. Throughput is deterministic from the claimed battle interval (`last_battle_ts - first_battle_ts`), never from submission timing.

### Compatibility policy (explicit, no silent reinterpretation)

- `schema_version = 1` (legacy): payloads carrying `attestation_expiry_slot`/`expDelta` are accepted only by legacy validation paths.
- `schema_version >= 2` (canonical delayed-submission model):
  - `attestation_expiry_slot` is rejected if provided in canonical payload,
  - server-provided `expDelta` is rejected,
  - EXP must be registry-derived on-chain,
  - timestamp/season/grace/throughput invariants are mandatory.
- Trusted signer verification remains mandatory in all versions, but signer verification is authN/authZ and is **not** a freshness proof.

## 2) Revised MVP Trust Model (Bounded Trust)

## 2.1 What the chain trusts the server for

- exact battle simulation and turn resolution,
- action-by-action transcript correctness,
- runtime enemy behavior/adaptation details,
- creation/sealing of batch summaries.

## 2.2 What the chain does **not** trust the server for

- arbitrary progression/state jumps,
- illegal zone access claims,
- impossible zone→enemy claims,
- reward inflation beyond registry-derived bounds,
- replaying old batches,
- out-of-order settlement submission.

Mental model:

> The chain validates legal bounded **batch state transitions**, not exact per-turn battle correctness.

---

## 3) System Flow (Batch-Based)

1. **Battle execution (off-chain):** server simulates battles.
2. **Batch construction (off-chain):** server seals contiguous battle batches (recommended: ~20 battles).
3. **Deferred submission (player):** player can keep playing; later submits batches sequentially.
4. **On-chain validation:** program validates each batch against authority, continuity, legality, reward bounds, replay rules.
5. **On-chain apply:** only minimal progression + cursor accounts are updated.

Example:

- 200 battles total off-chain,
- 10 sealed batches of 20,
- later submitted in strict order from batch 1 → 10.

---

## 3.1 MVP Policy Constants (Chosen)

To avoid ambiguity in initial implementation, MVP uses these explicit defaults:

- `target_batch_size = 20` battles (server construction target),
- `max_battles_per_batch = 32` (hard on-chain acceptance ceiling),
- `max_histogram_entries_per_batch = 64`,
- `batch_id` is **required** and strictly monotonic (`+1`),
- `CharacterSettlementBatchCursorAccount` is initialized at character creation with:
  - `last_committed_end_nonce = 0`,
  - `last_committed_state_hash = genesis_state_hash(character_root)`,
  - `last_committed_batch_id = 0`,
  - `last_committed_battle_ts = character_creation_ts`,
  - `last_committed_season_id = season_id_at_character_creation`.

These values can be governance-tuned later, but are canonical for MVP launch.

---

## 4) Required MVP Account Set (Opinionated)

## 4.1 Character-side mutable accounts (required)

1. **CharacterRootAccount**  
   PDA: `[b"character", authority_pubkey, character_id]`  
   Purpose: ownership anchor, level/exp base progression identity.

2. **CharacterStatsAccount**  
   PDA: `[b"character_stats", character_root_pubkey]`  
   Purpose: deterministic stat recalculation target when level changes.

3. **CharacterWorldProgressAccount**  
   PDA: `[b"character_world_progress", character_root_pubkey]`  
   Purpose: compact progression summary and fast gating updates.

4. **CharacterZoneProgressPageAccount**  
   PDA: `[b"character_zone_progress", character_root_pubkey, page_index_u16]`  
   Purpose: canonical per-zone unlocked/cleared state used for batch legality checks.

5. **CharacterLoadoutAccount** (**recommended in MVP**)  
   PDA: `[b"character_loadout", character_root_pubkey]`  
   Purpose: optional consistency guard using `loadout_revision` at batch commit time.

## 4.2 Global/static registries (required)

6. **ZoneRegistryAccount**  
   PDA: `[b"zone_registry", zone_id_u16]`  
   Purpose: static zone metadata and progression constraints.

7. **ZoneEnemySetAccount**  
   PDA: `[b"zone_enemy_set", zone_id_u16]`  
   Purpose: authoritative zone→enemy-archetype legality mapping.

8. **EnemyArchetypeRegistryAccount**  
   PDA: `[b"enemy_archetype", enemy_archetype_id_u16]`  
   Purpose: enemy identity + reward bounds (`exp_reward_base`, caps/policy fields).

## 4.3 Program auth/policy (required)

9. **ProgramConfigAccount** (**required**)  
   PDA: `[b"program_config"]`

   Required fields:

- `version: u8`
- `bump: u8`
- `admin_authority: Pubkey`
- `trusted_server_signers: [Pubkey; N]` (or signer-set hash + verification strategy)
- `settlement_paused: bool`
- `max_battles_per_batch: u16` (policy cap)
- `updated_at_slot: u64`

Purpose:

- trusted server attestation governance,
- settlement policy controls and emergency pause.

## 4.4 Replay/sequencing anchor (required)

10. **CharacterSettlementBatchCursorAccount** (**required, canonical replay/continuity state**)  
    PDA: `[b"character_settlement_batch_cursor", character_root_pubkey]`

    Required fields:

- `version: u8`
- `last_committed_end_nonce: u64`
- `last_committed_state_hash: [u8; 32]`
- `last_committed_batch_id: u64` (optional but recommended)
- `last_committed_battle_ts: u64` (canonical monotonic time anchor; seconds)
- `last_committed_season_id: u32`
- `updated_at_slot: u64`

Purpose:

- strict sequence continuity,
- anti-replay anchor,
- state-transition chaining between batches.

## 4.5 Receipt/audit (explicit decision)

11. **BattleSettlementBatchReceiptAccount** (**MVP optional, recommended MVP+1**)  
    PDA (recommended): `[b"battle_batch_receipt", character_root_pubkey, end_nonce_u64]`

Decision:

- **Not MVP-core** to keep compute/write surface minimal.
- Recommended in MVP+1 for richer auditability/indexing and easier dispute tooling.

If enabled, fields:

- `version: u8`
- `start_nonce: u64`
- `end_nonce: u64`
- `batch_hash: [u8; 32]`
- `start_state_hash: [u8; 32]`
- `end_state_hash: [u8; 32]`
- `battle_count: u16`
- `exp_delta: u32`
- `settled_at_slot: u64`

---

## 5) Accounts Explicitly De-Prioritized for MVP Ingestion

These remain valid future domains but are **not settlement-critical for batch MVP**:

- per-battle `CharacterSettlementNonceAccount` concept,
- per-battle `BattleReceiptAccount`,
- enemy instance accounts (`EnemyInstanceRoot/Stats/Loadout/Learning/Telemetry/Presence`),
- `CharacterUnlocksAccount` (unless unlocks must settle now),
- `CharacterInventoryAccount`,
- `CharacterLearningStateAccount`,
- telemetry summary accounts,
- drop table accounts (unless loot settlement is in-scope now).

---

## 6) Canonical Batch Payload Contract

## 6.1 Instruction

`ApplyBattleSettlementBatchV1`

Applies exactly one server-attested contiguous batch.

## 6.2 Required payload fields

- `character_id: [u8; 16]` (or project-standard opaque id)
- `batch_id: u64`
- `start_nonce: u64`
- `end_nonce: u64`
- `battle_count: u16`
- `start_state_hash: [u8; 32]`
- `end_state_hash: [u8; 32]`
- `zone_progress_delta: Vec<ZoneProgressDeltaEntry>`
- `encounter_histogram: Vec<EncounterCountEntry>`
- `optional_loadout_revision: Option<u32>`
- `batch_hash: [u8; 32]`
- `first_battle_ts: u64` (seconds since Unix epoch)
- `last_battle_ts: u64` (seconds since Unix epoch)
- `season_id: u32`
- `schema_version: u16`
- legacy attestation metadata MAY be present for telemetry but is non-normative in V2+
- `signature_scheme: u8` (`0 = ed25519_server_sig_v1`)

## 6.3 Required supporting types

### EncounterCountEntry

- `zone_id: u16`
- `enemy_archetype_id: u16`
- `count: u16`

### ZoneProgressDeltaEntry

- `zone_id: u16`
- `new_state: u8` (`1 = unlocked`, `2 = cleared`)

Design requirement:

- histogram is mandatory in MVP batch payload,
- full per-battle listing is not required.

## 6.4 Canonical hash/signature domain (required)

To prevent signature replay across environments/programs, the signed message domain must include:

- `program_id`,
- `cluster_id` (or explicit environment id),
- `character_root_pubkey`,
- all fields in section 6.2 in canonical serialization order (with no `exp_delta` field).

Canonical serialized order for hashing/signing is:
`character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, batch_hash, schema_version, signature_scheme`.

`batch_hash` is defined as:

- `sha256(canonical_serialized_batch_payload_without_signature)`.

Server attestation verification for MVP:

- use Solana ed25519 verification flow,
- accept only signer keys present in `ProgramConfigAccount.trusted_server_signers`,
- no expiry-window freshness gate; delayed submissions are valid when all invariants pass.

---

## 7) Canonical Accounts for `ApplyBattleSettlementBatchV1`

Required accounts:

- signer: `player_authority`
- read: `ProgramConfigAccount`
- write: `CharacterRootAccount`
- write: `CharacterStatsAccount` (if level/stat change)
- read/write: `CharacterWorldProgressAccount`
- read/write: one or more `CharacterZoneProgressPageAccount` entries referenced by deltas/histogram
- optional read: `CharacterLoadoutAccount`
- read/write: `CharacterSettlementBatchCursorAccount`
- read: `ZoneRegistryAccount` entries referenced by batch
- read: `ZoneEnemySetAccount` entries referenced by histogram
- read: `EnemyArchetypeRegistryAccount` entries referenced by histogram
- optional write: `BattleSettlementBatchReceiptAccount` (if enabled)

---

## 8) Validation Sequence (Batch Canonical)

1. **Derivation and ownership**
   - verify PDA derivations,
   - verify `player_authority` owns character root.

2. **Program config checks**
   - reject if `settlement_paused`,
   - verify trusted server attestation/signature under `ProgramConfigAccount` policy,
   - enforce batch size policy (`battle_count <= max_battles_per_batch`),
   - enforce `encounter_histogram.len() <= max_histogram_entries_per_batch`.

3. **Batch continuity checks**
   - require `start_nonce == cursor.last_committed_end_nonce + 1`,
   - require `start_state_hash == cursor.last_committed_state_hash`,
   - require `batch_id == cursor.last_committed_batch_id + 1`,
   - require `end_nonce >= start_nonce`,
   - require `battle_count == (end_nonce - start_nonce + 1)`.

4. **Season/time eligibility checks**
   - require `first_battle_ts >= cursor.last_committed_battle_ts`,
   - require `last_battle_ts >= first_battle_ts`,
   - require `first_battle_ts >= character_creation_ts`,
   - require `season_id >= cursor.last_committed_season_id` (unless explicit migration instruction),
   - enforce season window + grace eligibility and stale-progress expiry rules.

5. **Throughput cap checks**
   - compute deterministic `allowed_battles` from section 9.3 integer formula,
   - require `battle_count <= allowed_battles`.

6. **Histogram integrity checks**
   - require `sum(encounter_histogram.count) == battle_count`,
   - reject zero-count or duplicate `(zone_id, enemy_archetype_id)` entries.

7. **World eligibility checks**
   - each referenced `zone_id` must be currently unlocked or become valid via allowed progression transition rules in same batch.

8. **Zone/enemy legality checks**
   - each `(zone_id, enemy_archetype_id)` must exist in `ZoneEnemySetAccount(zone_id)`.

9. **Deterministic EXP derivation checks**
   - derive `derived_exp_delta` from `encounter_histogram` and registry/policy fields using the deterministic integer formula in section 8.1,
   - reject on arithmetic overflow or missing registry entries,
   - use only `derived_exp_delta` for progression application (no client/server-provided EXP input field).

10. **Optional loadout consistency**
   - if `optional_loadout_revision` present, require equality to `CharacterLoadoutAccount.loadout_revision`.

11. **Apply progression transitions**
   - apply `derived_exp_delta` with normal level-up logic,
   - update stats if level changes,
   - apply `zone_progress_delta` with monotonic state transition rules (`locked -> unlocked -> cleared`, never reverse),
   - update account timestamps/versions as needed.

12. **Persist batch cursor**
   - set `cursor.last_committed_end_nonce = end_nonce`,
   - set `cursor.last_committed_state_hash = end_state_hash`,
   - set `cursor.last_committed_batch_id = batch_id` (if used),
   - set `cursor.last_committed_battle_ts = last_battle_ts`,
   - set `cursor.last_committed_season_id = season_id`,
   - optionally write batch receipt.

This sequence replaces per-battle validation as the MVP ingestion path.

## 8.1 Deterministic EXP Derivation Formula (Canonical)

Use exact integer math below to derive batch EXP and prevent implementation drift:

```text
let total_exp_u128 = 0
for each entry in encounter_histogram:
    // all fields are unsigned integers
    count_u128 = u128(entry.count)
    base_exp_u128 = u128(EnemyArchetypeRegistry[entry.enemy_archetype_id].exp_reward_base)
    zone_num_u128 = u128(ZoneRegistry[entry.zone_id].exp_multiplier_num)      // e.g., 100 for 1.00x
    zone_den_u128 = u128(ZoneRegistry[entry.zone_id].exp_multiplier_den)      // must be > 0

    weighted_exp_u128 = (count_u128 * base_exp_u128 * zone_num_u128) / zone_den_u128
    // division is integer floor (round toward zero)

    total_exp_u128 += weighted_exp_u128

require(total_exp_u128 <= u128(u32::MAX))
derived_exp_delta_u32 = u32(total_exp_u128)
```

Rules:
- overflow in any intermediate multiply/add is validation failure,
- `zone_den_u128 == 0` is validation failure,
- no floating point is allowed,
- rounding mode is always floor via integer division.


---

## 9) Histogram Validation Invariants (Required)

1. `sum(count) == battle_count`.
2. Every histogram pair is zone-legal (`enemy ∈ zone_enemy_set`).
3. Referenced zones must be world-legal for the character under transition constraints.
4. EXP is derived deterministically from histogram + registry/policy fields (no EXP input claims).
5. Duplicate `(zone_id, enemy_archetype_id)` entries are invalid.
6. `battle_count == end_nonce - start_nonce + 1`.

---

## 9.1 Zone Progress Delta Invariants (Required)

1. A batch cannot downgrade a zone state.
2. A zone may only transition by allowed edges:
   - `locked -> unlocked`,
   - `unlocked -> cleared`,
   - `locked -> cleared` is forbidden unless explicitly enabled by zone policy.
3. `zone_progress_delta` must reference only zones present in relevant registry space.
4. Summary (`CharacterWorldProgressAccount`) and detailed page state must remain consistent after apply.

---

## 9.2) Delayed Submission, Monotonic Anchoring, and Season Eligibility (Required)

Validation ordering (normative):

1. authority/signature checks,
2. continuity checks (nonce/state hash/batch id),
3. season eligibility checks,
4. throughput checks,
5. legality + deterministic reward derivation.

Rules:

- delayed submission is explicitly valid: batches may be submitted any time later if all checks pass;
- monotonic time anchor: `first_battle_ts >= cursor.last_committed_battle_ts`;
- in-batch order: `last_battle_ts >= first_battle_ts`;
- character lower bound: `first_battle_ts >= character_creation_ts`;
- cross-season monotonicity: `season_id >= cursor.last_committed_season_id` unless a future explicit migration instruction says otherwise;
- season window eligibility requires battle timestamps to be in the active season interval or in the prior-season commit grace window (`<= commit_grace_end_ts`);
- stale-progress expiry: once grace closes, uncommitted prior-season batches are permanently ineligible.

Failure modes:

- `ERR_SEASON_WINDOW_CLOSED`
- `ERR_SEASON_REGRESSION`
- `ERR_PRE_CHARACTER_TIMESTAMP`

Timeline examples:

- Valid near grace boundary: season S ends at `1,700,259,200`, grace ends at `1,700,345,600`; a batch with `last_battle_ts = 1,700,345,599` and `season_id = S` is eligible.
- Invalid after grace closure: same season but `last_battle_ts = 1,700,345,601` is rejected with `ERR_SEASON_WINDOW_CLOSED`.

## 9.3) Deterministic Throughput Cap (Required)

Constants:

- `throughput_cap_per_minute = 20` battles/minute (default MVP policy constant).

Arithmetic (integer-only, deterministic across languages):

```text
interval_seconds = last_battle_ts - first_battle_ts
allowed_battles = floor((interval_seconds * 20) / 60) + 1
require(battle_count <= allowed_battles)
```

Notes and corner cases:

- `+1` permits one battle at the interval start instant.
- Equal timestamps (`interval_seconds = 0`) allow exactly one battle.
- If timestamps differ by 1..2 seconds, still deterministic integer floor behavior applies.
- Throughput does not replace nonce continuity; both are mandatory.
- Throughput is evaluated only after season eligibility passes.

Examples:

- Boundary pass: `interval_seconds=60` => `allowed_battles=21`; `battle_count=21` passes.
- Boundary fail: `interval_seconds=60`; `battle_count=22` fails.
- Delayed submission pass: an old interval still passes if continuity + season/grace + throughput invariants pass.

## 10) Non-Negotiable MVP Invariants

1. No batch settlement without valid player authority + trusted server attestation.
2. No out-of-order batch submission.
3. No replay of previously committed batch range/hash.
4. No batch referencing locked/invalid zones.
5. No batch claiming enemies outside zone mappings.
6. No EXP input claims; only deterministic histogram+registry/policy-derived EXP is applied.
7. Every committed batch must connect to last committed state hash.
8. Only minimum required accounts are mutated.

---

## 11) Revised Implementation Phases

### Phase A

- Freeze batch-based account set + schema + seeds.
- Freeze `ApplyBattleSettlementBatchV1` payload and validation rules.

### Phase B

- Implement `ApplyBattleSettlementBatchV1` with cursor-based continuity + histogram validation.

### Phase C

- Add optional `BattleSettlementBatchReceiptAccount` for audit/indexing (if excluded from Phase B).

### Phase D

- Add inventory/drop settlement domains when loot is in-scope.

### Phase E

- Add on-chain learning persistence if anti-tamper scope expands.

### Phase F

- Add enemy instance persistence only when persistent world enemies become chain-tracked requirements.

---

## 12) Final MVP Build Ticket Checklist

Implement now (MVP-core):

1. CharacterRootAccount
2. CharacterStatsAccount
3. CharacterWorldProgressAccount
4. CharacterZoneProgressPageAccount
5. CharacterLoadoutAccount (recommended)
6. ZoneRegistryAccount
7. ZoneEnemySetAccount
8. EnemyArchetypeRegistryAccount
9. ProgramConfigAccount
10. CharacterSettlementBatchCursorAccount
11. ApplyBattleSettlementBatchV1 + required histogram validation logic

Optional (MVP+1):

- BattleSettlementBatchReceiptAccount

Everything else is explicitly deferred unless product scope changes.

---

## 13) Pre-Implementation Clarifications & Decision Points

Before implementation begins, explicitly resolve and record answers for the following.

### 13.1 Product & trust boundaries

1. What is the MVP dispute/remediation path for server-attested but player-disputed batches?
2. What signer model is used in `ProgramConfigAccount.trusted_server_signers` for MVP (single signer, small rotating set, or signer-set hash strategy)?
3. When `settlement_paused = true`, are all settlement paths blocked, or is there an admin-only emergency path?
4. Legacy expiry-slot freshness is removed in V2; delayed submission is allowed subject to continuity + season/grace + throughput invariants.

### 13.2 Batch identity, ordering, replay semantics

1. Confirm `batch_id` monotonicity scope and reset policy (strict per-character sequence unless explicit reset/migration).
2. Freeze the exact `genesis_state_hash(character_root)` construction and serialization source of truth.
3. Define deterministic replay/out-of-order error code mapping for client/support observability.
4. Confirm backlog submission behavior (strict oldest-first continuity across multiple sessions/transactions).

### 13.3 Payload canonicalization & signature domain

1. Freeze canonical serialization format used by `batch_hash` and signature verification.
2. Freeze canonical `cluster_id` / environment identifier set in signed domain fields.
3. Define compatibility/versioning strategy for future payload evolution (`signature_scheme` and/or instruction versioning).
4. Confirm whether `batch_hash` is always recomputed and strictly equality-checked on-chain.

### 13.4 World progression semantics

1. Decide if any zones may permit `locked -> cleared` directly via explicit policy (otherwise globally forbidden in MVP).
2. Define conflict resolution if `zone_progress_delta` and inferred progression from encounters diverge.
3. Freeze deterministic `zone_id -> page_index_u16` mapping for `CharacterZoneProgressPageAccount`.
4. Define repair-vs-fail policy when summary and detailed zone progress state are inconsistent at validation time.

### 13.5 Reward and balance guardrails

1. Freeze exact `exp_cap_per_encounter(enemy_archetype_id)` policy function and registry dependencies.
2. Freeze arithmetic safety policy for EXP math (intermediate width, overflow behavior, and clamp/reject semantics).
3. Decide whether zero-EXP non-empty batches are valid or rejected as anomalous.
4. Confirm all level-up side effects in MVP scope versus deferred domains.

### 13.6 Optional components to lock now

1. Decide whether `optional_loadout_revision` remains optional by policy or becomes effectively required for all submissions.
2. Decide if `BattleSettlementBatchReceiptAccount` remains MVP+1 or is promoted into MVP-core for ops/audit reasons.
3. Confirm `max_histogram_entries_per_batch` launch value and governance tuning rules.
4. Confirm server batch construction policy (`target_batch_size = 20`) and whether adaptive sizing is allowed under constraints.

---

## 14) Updated End-to-End Implementation Checklist

Use this checklist as the execution tracker for implementing the full unified plan.

### 0) Governance decisions (must lock first)

- [x] Resolve and freeze all Section 13 decision points with lean MVP choices.
- [ ] Publish error-code map and operator runbook for settlement failures.

### 1) On-chain account model (MVP-core)

- [ ] Implement and test account layouts + PDA derivations for:
  - [ ] CharacterRootAccount
  - [ ] CharacterStatsAccount
  - [ ] CharacterWorldProgressAccount
  - [ ] CharacterZoneProgressPageAccount
  - [ ] CharacterLoadoutAccount
  - [ ] ZoneRegistryAccount
  - [ ] ZoneEnemySetAccount
  - [ ] EnemyArchetypeRegistryAccount
  - [ ] ProgramConfigAccount
  - [ ] CharacterSettlementBatchCursorAccount
- [ ] Initialize cursor defaults during character creation:
  - [ ] `last_committed_end_nonce = 0`
  - [ ] `last_committed_state_hash = genesis_state_hash(character_root)`
  - [ ] `last_committed_batch_id = 0`
  - [ ] `last_committed_battle_ts = character_creation_ts`
  - [ ] `last_committed_season_id = season_id_at_character_creation`

### 2) Instruction + canonical payload contract

- [ ] Implement `ApplyBattleSettlementBatchV1`/`V2` instruction data layout exactly as frozen.
- [ ] Align `types/settlement.ts` with canonical schema (`*_battle_ts`, season cursors, no server `expDelta` in canonical path).
- [ ] Implement canonical serialization for payload hashing/signature verification.
- [ ] Recompute and equality-check `batch_hash` on-chain for every submission.
- [ ] Enforce signature-domain separation (`program_id`, `cluster_id`, `character_root_pubkey`).

### 3) Attestation and trust checks

- [ ] Verify ed25519 server signature with Solana native flow.
- [ ] Accept only `trusted_server_signers` from `ProgramConfigAccount`.
- [ ] Enforce monotonic time anchor validation (`first_battle_ts >= cursor.last_committed_battle_ts`, `last_battle_ts >= first_battle_ts`).
- [ ] Enforce `settlement_paused` behavior per locked policy.

### 4) Batch validation sequence (instruction core)

- [ ] Implement derivation/ownership checks.
- [ ] Implement policy checks (`max_battles_per_batch`, `max_histogram_entries_per_batch`).
- [ ] Implement continuity checks (`start_nonce`, `start_state_hash`, `batch_id`, nonce range).
- [ ] Implement histogram integrity checks (sum/count, non-zero counts, duplicates forbidden).
- [ ] Implement world eligibility checks for all referenced zones.
- [ ] Implement zone/enemy legality checks against registry mapping.
- [ ] Implement reward cap checks using registry-bound policy.
- [ ] Implement optional loadout revision check.
- [ ] Apply progression transitions with monotonic rules.
- [ ] Persist cursor updates.

### 5) Account access wiring + compute envelope

- [ ] Enforce required account set and mutability constraints in instruction account validation.
- [ ] Support multi-page zone progress account access for large batches.
- [ ] Benchmark compute for worst-case allowed batch (`battle_count=32`, histogram entries=64).

### 6) Server batch construction + submission orchestration

- [ ] Implement contiguous batch construction target (`target_batch_size=20`).
- [ ] Enforce strict oldest-first submission continuity.
- [ ] Store batch metadata for retries/reconciliation and support tooling.

### 7) Testing + verification gates

- [ ] Add deterministic success/failure vectors for every invariant.
- [ ] Add replay/out-of-order test matrix across sequential batches.
- [ ] Add boundary tests for max-size payloads and arithmetic behavior.
- [ ] Add signature-domain replay tests (wrong cluster/program/character root).

### 8) MVP+1 optional

- [ ] Decide and implement `BattleSettlementBatchReceiptAccount` if promoted.
- [ ] Add receipt indexing/dispute support tooling.

### 9) Explicitly deferred

- [ ] Inventory/drop settlement domains.
- [ ] On-chain learning persistence extensions.
- [ ] Persistent enemy instance domains.

---


## 14.1) Implementation Mapping Appendix (Normative)

- **Types layer:** `types/settlement.ts`
  - remove canonical reliance on `expDelta` and `attestationExpirySlot` for `schema_version >= 2`,
  - add `firstBattleTs`, `lastBattleTs`, `seasonId`, and cursor fields `lastCommittedBattleTs`, `lastCommittedSeasonId`.
- **Validation logic:** `lib/solana/settlementBatchValidation.ts`
  - remove expiry-slot freshness gate,
  - insert validation order: authority/signature -> continuity -> season eligibility -> throughput -> legality/reward derivation,
  - enforce deterministic throughput formula and season/grace failures.
- **Serialization/hash domain:** settlement payload canonical encoding path
  - freeze V2 field order from section 6.4; reject unknown/legacy fields under V2.
- **Tests:** `tests/settlementBatchValidation.test.ts`
  - add positive/negative vectors for delayed submission, grace-expiry rejection, season regression, pre-character timestamp, throughput boundary pass/fail, and season transition continuity.

## 14.2) QA-Readiness Test Matrix (Required)

1. Delayed submission accepted with valid continuity/season/throughput.
2. Prior-season batch rejected after `commit_grace_end_ts`.
3. Prior-season batch accepted at `commit_grace_end_ts - 1`.
4. Season regression rejected (`season_id < cursor.last_committed_season_id`).
5. Pre-character timestamp rejected.
6. Throughput exact boundary pass.
7. Throughput +1 overflow fail.
8. Equal timestamp single battle pass, multi-battle fail.
9. Replay/out-of-order batch rejection still enforced with delayed submission model.

## 15) Section 13 Decision Locks (Lean MVP Defaults)

These decisions are now **locked for MVP** to unblock implementation.

### 15.1 Product & trust boundaries (locks)

1. **Dispute/remediation path:** no on-chain dispute flow in MVP; disputes are handled off-chain by support + ops replay tooling.
2. **Signer model:** single trusted server signer key in `trusted_server_signers` at launch (array size may expand later without schema break).
3. **Paused behavior:** when `settlement_paused = true`, all player settlement submissions are blocked; no admin bypass path in MVP.
4. **Freshness policy:** no attestation expiry gate in MVP V2; freshness is enforced via monotonic timestamps, season/grace eligibility, and throughput bounds.

### 15.2 Batch identity, ordering, replay semantics (locks)

1. `batch_id` is strictly monotonic per character and never resets in MVP.
2. `genesis_state_hash(character_root)` is `sha256(character_root_pubkey || character_id || 0u64_nonce || 0u64_batch_id)` with canonical little-endian integer encoding.
3. Deterministic continuity error buckets are frozen: nonce gap, state-hash mismatch, batch-id gap, nonce-range mismatch.
4. Backlog submission is strict oldest-first only; no skipping or parallelized commit lanes.

### 15.3 Payload canonicalization & signature domain (locks)

1. Canonical serialization is strict field-order Borsh-compatible encoding for all section 6.2 fields (without `exp_delta`).

   Canonical field order for hashing/signing:
   `character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, batch_hash, schema_version, signature_scheme`.
2. `cluster_id` is an explicit `u8` enum in signed domain (`1=localnet`, `2=devnet`, `3=testnet`, `4=mainnet-beta`).
3. Compatibility strategy: new layouts require new `signature_scheme` discriminant and/or new instruction version; no silent reinterpretation.
4. `batch_hash` is always recomputed on-chain and must exactly match payload-provided hash.

### 15.4 World progression semantics (locks)

1. `locked -> cleared` is globally forbidden in MVP (no zone-level exceptions at launch).
2. If histogram-implied progression conflicts with `zone_progress_delta`, `zone_progress_delta` is canonical and conflicts fail validation.
3. `zone_id -> page_index_u16` mapping is `page_index = zone_id / 256` (integer division).
4. If summary and page data are inconsistent at validation time, fail settlement (no repair path in instruction).

### 15.5 Reward and balance guardrails (locks)

1. Per-encounter EXP base input is read from `EnemyArchetypeRegistryAccount.exp_reward_base` for MVP and combined with zone policy multipliers in deterministic derivation.
2. EXP math uses `u128` intermediates; overflow during intermediate math is rejection, not clamp.
3. Zero-EXP non-empty batches are valid in MVP.
4. MVP level-up side effects are limited to level/exp/stat recalculation domains only; inventory/unlocks/learning side effects are deferred.

### 15.6 Optional components to lock now (locks)

1. `optional_loadout_revision` remains optional in MVP policy.
2. `BattleSettlementBatchReceiptAccount` remains MVP+1 (not MVP-core).
3. Launch `max_histogram_entries_per_batch = 64`; governance can lower/raise through program config update.
4. Server batch construction targets 20 battles but may adapt size as long as on-chain constraints are met.
