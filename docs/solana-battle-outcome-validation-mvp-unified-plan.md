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
  - `last_committed_batch_id = 0`.

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
- `exp_delta: u32`
- `zone_progress_delta: Vec<ZoneProgressDeltaEntry>`
- `encounter_histogram: Vec<EncounterCountEntry>`
- `optional_loadout_revision: Option<u32>`
- `batch_hash: [u8; 32]`
- attestation domain fields (e.g., `attestation_slot: u64`, `attestation_expiry_slot: u64`)
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
- all fields in section 6.2 in canonical serialization order.

`batch_hash` is defined as:

- `sha256(canonical_serialized_batch_payload_without_signature)`.

Server attestation verification for MVP:

- use Solana ed25519 verification flow,
- accept only signer keys present in `ProgramConfigAccount.trusted_server_signers`,
- reject if `attestation_expiry_slot < current_slot`.

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

4. **Histogram integrity checks**
   - require `sum(encounter_histogram.count) == battle_count`,
   - reject zero-count or duplicate `(zone_id, enemy_archetype_id)` entries.

5. **World eligibility checks**
   - each referenced `zone_id` must be currently unlocked or become valid via allowed progression transition rules in same batch.

6. **Zone/enemy legality checks**
   - each `(zone_id, enemy_archetype_id)` must exist in `ZoneEnemySetAccount(zone_id)`.

7. **Reward sanity checks**
   - compute `max_allowed_exp = Σ(count * exp_cap_per_encounter(enemy_archetype_id))` from registries/policy,
   - require `exp_delta <= max_allowed_exp`.

8. **Optional loadout consistency**
   - if `optional_loadout_revision` present, require equality to `CharacterLoadoutAccount.loadout_revision`.

9. **Apply progression transitions**
   - apply `exp_delta` with normal level-up logic,
   - update stats if level changes,
   - apply `zone_progress_delta` with monotonic state transition rules (`locked -> unlocked -> cleared`, never reverse),
   - update account timestamps/versions as needed.

10. **Persist batch cursor**
   - set `cursor.last_committed_end_nonce = end_nonce`,
   - set `cursor.last_committed_state_hash = end_state_hash`,
   - set `cursor.last_committed_batch_id = batch_id` (if used),
   - optionally write batch receipt.

This sequence replaces per-battle validation as the MVP ingestion path.

---

## 9) Histogram Validation Invariants (Required)

1. `sum(count) == battle_count`.
2. Every histogram pair is zone-legal (`enemy ∈ zone_enemy_set`).
3. Referenced zones must be world-legal for the character under transition constraints.
4. `exp_delta` must not exceed histogram-derived registry bound.
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

## 10) Non-Negotiable MVP Invariants

1. No batch settlement without valid player authority + trusted server attestation.
2. No out-of-order batch submission.
3. No replay of previously committed batch range/hash.
4. No batch referencing locked/invalid zones.
5. No batch claiming enemies outside zone mappings.
6. No EXP inflation beyond histogram-derived bounds.
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
4. What is the canonical default attestation validity window (`attestation_expiry_slot - attestation_slot`)?

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
