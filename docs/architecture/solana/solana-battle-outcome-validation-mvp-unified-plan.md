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
  - dual-signature authorization is mandatory (`trusted_server_signer` attestation + player authorization permit),
  - timestamp/season/grace/throughput invariants are mandatory.
- Trusted server signer verification remains mandatory in all versions; player authorization verification is mandatory in canonical `schema_version >= 2`. Signature verification is authN/authZ and is **not** a freshness proof.

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
3. **Deferred authorization + submission:** player can keep playing; later authorizes batches, signs a player-paid transaction, and the server may broadcast those signed batches sequentially.
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

## 4) MVP Account Set (Opinionated)

## 4.1 Character-side mutable accounts (MVP-core unless noted)

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
   Purpose: character equipment/loadout state; not used by canonical MVP settlement validation.

## 4.2 Global/static registries (required)

6. **ZoneRegistryAccount**  
   PDA: `[b"zone_registry", zone_id_u16]`  
   Purpose: static zone metadata and progression constraints.

7. **ZoneEnemySetAccount**  
   PDA: `[b"zone_enemy_set", zone_id_u16]`  
   Purpose: authoritative zone→enemy-archetype legality mapping.
   Canonical semantics: one `zone_id` maps to a bounded set of legal `enemy_archetype_id` values for that zone. The exact storage layout is implementation-defined; the MVP validation requirement is set-membership semantics, not a one-enemy-only model.

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
- `max_histogram_entries_per_batch: u16` (policy cap)
- `updated_at_slot: u64`

Purpose:

- trusted server attestation governance,
- settlement policy controls and emergency pause.

Explicit MVP scope lock:

- `ProgramConfigAccount` remains global-only.
- Seasonal timing/grace policy does **not** live in `ProgramConfigAccount`.

## 4.4 Season policy anchor (required for Slice 3+)

10. **SeasonPolicyAccount** (**required for canonical time/season validation**)  
    PDA: `[b"season_policy", season_id_u32]`

    Required fields:

- `version: u8`
- `bump: u8`
- `season_id: u32`
- `season_start_ts: u64`
- `season_end_ts: u64`
- `commit_grace_end_ts: u64`
- `updated_at_slot: u64`

Purpose:

- canonical per-season timing policy,
- historical season-window lookup by `season_id`,
- delayed-submission grace enforcement without mutating global config.

## 4.5 Replay/sequencing anchor (required)

11. **CharacterSettlementBatchCursorAccount** (**required, canonical replay/continuity state**)  
    PDA: `[b"character_batch_cursor", character_root_pubkey]`  
    Note: the longer descriptive seed label was shortened because Solana PDA seed components are limited to 32 bytes.

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

## 4.6 Receipt/audit (explicit decision)

12. **BattleSettlementBatchReceiptAccount** (**MVP optional, recommended MVP+1**)  
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

Applies exactly one server-attested, player-authorized contiguous batch.

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
- `optional_loadout_revision: Option<u32>` (optional metadata only; ignored by canonical MVP settlement validation)
- `batch_hash: [u8; 32]`
- `first_battle_ts: u64` (seconds since Unix epoch)
- `last_battle_ts: u64` (seconds since Unix epoch)
- `season_id: u32`
- `schema_version: u16`
- legacy attestation metadata MAY be present for telemetry but is non-normative in V2+
- `signature_scheme: u8` (`0 = ed25519_dual_sig_v1`)

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

MVP uses a **dual-signature authorization model**:

- **server attestation signature**: authorizes the sealed settlement batch contents,
- **player authorization signature**: authorizes applying that sealed batch to the player's character,
- for player-owned transactions, the player wallet is the transaction signer and fee payer,
- the server may broadcast the fully signed transaction, but broadcast origin is **not** an on-chain validity signal.

To prevent signature replay across environments/programs, both signed message domains must include:

- `program_id`,
- `cluster_id` (or explicit environment id),
- `character_root_pubkey`.

Canonical serialized order for the **server attestation** message is:
`program_id, cluster_id, character_root_pubkey, character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, batch_hash, schema_version, signature_scheme`.

Canonical serialized order for the **player authorization permit** message is:
`program_id, cluster_id, player_authority_pubkey, character_root_pubkey, batch_hash, batch_id, signature_scheme`.

`batch_hash` is defined as:

- `sha256(canonical_serialized_batch_payload_preimage)`.

`canonical_serialized_batch_payload_preimage` is the canonical payload serialization using the section 6.2 payload fields in order, **excluding** `batch_hash` itself and excluding all signature bytes/instruction metadata.

Canonical field order for `batch_hash` preimage is:
`character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, schema_version, signature_scheme`.

Dual-signature verification for MVP:

- use Solana ed25519 verification flow for both server attestation and player authorization,
- accept server signatures only from signer keys present in `ProgramConfigAccount.trusted_server_signers`,
- require the player authorization signature to verify against the `player_authority_pubkey` bound to the character,
- the player authorization permit is bound to an exact `batch_hash`/`batch_id`; replay is additionally blocked by continuity and cursor state,
- no expiry-window freshness gate; delayed submissions are valid when all invariants pass.

---

## 7) Canonical Accounts for `ApplyBattleSettlementBatchV1`

Required accounts:

- read: `player_authority` (not a transaction signer; used as permit subject / ownership identity)
- read: `SysvarInstructions` (to inspect ed25519 verification instructions for server + player signatures)
- read: `ProgramConfigAccount`
- read: `SeasonPolicyAccount(payload.season_id)`
- write: `CharacterRootAccount`
- write: `CharacterStatsAccount` (if level/stat change)
- read/write: `CharacterWorldProgressAccount`
- read/write: one or more `CharacterZoneProgressPageAccount` entries referenced by deltas/histogram
- read/write: `CharacterSettlementBatchCursorAccount`
- read: `ZoneRegistryAccount` entries referenced by batch
- read: `ZoneEnemySetAccount` entries referenced by histogram
- read: `EnemyArchetypeRegistryAccount` entries referenced by histogram
- optional write: `BattleSettlementBatchReceiptAccount` (if enabled)

---

## 8) Validation Sequence (Batch Canonical)

1. **Derivation and ownership**
   - verify PDA derivations,
   - verify `CharacterRootAccount.authority == player_authority`,
   - verify the player authorization permit subject matches `player_authority` and `character_root_pubkey`.

2. **Authorization and program config checks**
   - reject if `settlement_paused`,
   - verify trusted server attestation/signature under `ProgramConfigAccount` policy,
   - verify player authorization signature using Solana ed25519 native flow via `SysvarInstructions`,
   - require both signed domains to bind `program_id`, `cluster_id`, and `character_root_pubkey`,
   - require the player authorization permit to bind `player_authority`, `batch_hash`, and `batch_id`,
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
   - load `SeasonPolicyAccount(season_id)` and require:
     - `first_battle_ts >= season_start_ts`,
     - `last_battle_ts <= season_end_ts`,
     - current chain time `<= commit_grace_end_ts`,
   - reject once grace closes even if the batch itself is otherwise continuous.

5. **Throughput cap checks**
   - compute deterministic `allowed_battles` from section 9.3 integer formula,
   - require `battle_count <= allowed_battles`.

6. **Histogram integrity checks**
   - require `sum(encounter_histogram.count) == battle_count`,
   - reject zero-count or duplicate `(zone_id, enemy_archetype_id)` entries.

7. **World eligibility checks**
   - each referenced `zone_id` must be currently unlocked or become valid via allowed progression transition rules in same batch.

8. **Zone/enemy legality checks**
   - each `(zone_id, enemy_archetype_id)` must be a member of the legal enemy set represented by `ZoneEnemySetAccount(zone_id)`.

9. **Deterministic EXP derivation checks**
   - derive `derived_exp_delta` from `encounter_histogram` and registry/policy fields using the deterministic integer formula in section 8.1,
   - reject on arithmetic overflow or missing registry entries,
   - use only `derived_exp_delta` for progression application (no client/server-provided EXP input field).

10. **Apply progression transitions**
   - apply `derived_exp_delta` with normal level-up logic,
   - update stats if level changes,
   - apply `zone_progress_delta` with monotonic state transition rules (`locked -> unlocked -> cleared`, never reverse),
   - update account timestamps/versions as needed.

11. **Persist batch cursor**
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
2. Every histogram pair is zone-legal (`enemy ∈ zone_enemy_set`), where `zone_enemy_set` is the bounded legal enemy set for that zone.
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

1. dual-signature authority checks,
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

1. No batch settlement without valid player authorization signature + trusted server attestation.
2. No out-of-order batch submission.
3. No replay of previously committed batch range/hash.
4. No batch referencing locked/invalid zones.
5. No batch claiming enemies outside zone mappings.
6. No EXP input claims; only deterministic histogram+registry/policy-derived EXP is applied.
7. Every committed batch must connect to last committed state hash.
8. Only minimum required accounts are mutated.

---

## 11) Vertical Slice Implementation Plan

Implementation should proceed as **vertical slices**, not horizontal layers.

Definition:

- each slice must produce one shippable end-to-end path across:
  - player authorization UX/message generation,
  - player-paid transaction preparation,
  - server broadcast of player-signed transactions,
  - on-chain validation/application,
  - automated integration tests,
  - operator observability for that path.

The goal is to validate real system integration early instead of finishing all accounts, then all serialization, then all validation, then all relay work separately.

### Slice 0: Foundations and harness

- freeze account set, PDA seeds, canonical payload layout, and signature domains,
- use **Anchor** as the default local development framework for the Solana program and test harness,
- configure `Anchor.toml` for `localnet` during slices 0-5 local development,
- establish local integration harness covering:
  - player permit signing,
  - server attestation signing,
  - player-paid transaction assembly,
  - server broadcast flow,
  - Solana execution + assertion helpers,
- establish local Solana development workflow per Anchor local-development guidance:
  - default path: run `anchor test` against `localnet` so the validator/program/test lifecycle is managed automatically,
  - iterative debugging path: run `solana-test-validator` manually and use `anchor test --skip-local-validator`,
  - use the local validator as the canonical environment for all vertical-slice integration in this document; devnet promotion is out of scope here,
- define canonical fixture data for:
  - one character,
  - one unlocked zone,
  - one enemy archetype,
  - one valid one-batch settlement.

Exit criteria:

- one deterministic fixture set is reusable across later slices,
- test harness can construct and submit transactions with ed25519 verification instructions,
- Anchor localnet workflow is documented and working for both managed and persistent-validator modes.

### Slice 1: Happy-path single-batch settlement

- implement the minimum account set needed for one valid batch:
  - `CharacterRootAccount`,
  - `CharacterStatsAccount`,
  - `CharacterWorldProgressAccount`,
  - `CharacterZoneProgressPageAccount`,
  - `ZoneRegistryAccount`,
  - `ZoneEnemySetAccount`,
  - `EnemyArchetypeRegistryAccount`,
  - `ProgramConfigAccount`,
  - `CharacterSettlementBatchCursorAccount`,
- implement local bootstrap/deployment path required to exercise a real happy-path settlement:
  - deploy the Anchor program to localnet,
  - initialize `ProgramConfigAccount`,
  - seed minimum registry state (`ZoneRegistryAccount`, `ZoneEnemySetAccount`, `EnemyArchetypeRegistryAccount`),
  - implement character creation/bootstrap instructions that create and initialize:
    - `CharacterRootAccount`,
    - `CharacterStatsAccount`,
    - `CharacterWorldProgressAccount`,
    - initial `CharacterZoneProgressPageAccount` entries as needed,
    - `CharacterSettlementBatchCursorAccount`,
- implement `ApplyBattleSettlementBatchV1` happy-path validation only for:
  - PDA derivation,
  - server signature verification,
  - player permit verification,
  - ownership binding,
  - batch hash equality,
  - basic continuity,
  - histogram sum/count integrity,
  - deterministic EXP application,
  - cursor persistence,
- implement server flow to:
  - build canonical payload,
  - build server attestation bytes,
  - build player permit bytes,
  - collect player authorization,
  - prepare a player-paid transaction with both ed25519 verification instructions,
  - broadcast the unchanged player-signed transaction successfully,
- add one end-to-end test that executes a successful settlement from permit request through on-chain apply.

Exit criteria:

- one real settlement batch succeeds end to end in integration tests,
- character progression and cursor state update correctly,
- no manual transaction crafting is required outside the tested player-paid broadcast flow.

### Slice 2: Replay and sequencing defenses

- enforce strict oldest-first continuity:
  - `start_nonce`,
  - `start_state_hash`,
  - `batch_id`,
  - nonce range math,
- enforce player-permit binding to:
  - `program_id`,
  - `cluster_id`,
  - `player_authority`,
  - `character_root_pubkey`,
  - `batch_hash`,
  - `batch_id`,
- add negative end-to-end tests for:
  - replayed batch,
  - out-of-order batch,
  - wrong batch hash,
  - wrong batch id,
  - wrong character owner,
  - wrong signature domain values.

Exit criteria:

- same harness proves replay/out-of-order submissions fail on-chain for the expected reasons.

### Slice 3: Time, season, and throughput controls

- implement:
  - monotonic battle timestamp checks,
  - season monotonicity,
  - season/grace eligibility,
  - deterministic throughput cap,
- extend end-to-end vectors for:
  - delayed submission success,
  - grace-window boundary pass/fail,
  - season regression failure,
  - pre-character timestamp failure,
  - throughput boundary pass/fail.

Exit criteria:

- old but valid batches can still settle,
- stale or impossible timing patterns fail in integration tests.

### Slice 4: World legality and deterministic rewards

- enforce:
  - unlocked-zone/world eligibility,
  - zone→enemy legality,
  - duplicate/zero-count histogram rejection,
  - deterministic EXP derivation with overflow rejection,
- test legal and illegal encounter histograms end to end.

Exit criteria:

- registry-backed legality and reward derivation are proven through integrated success/failure cases, not only unit tests.

### Slice 5: Progression completeness and account envelope

- finish monotonic `zone_progress_delta` application,
- verify summary/page consistency policy,
- support multi-page zone progress account access,
- benchmark compute for worst-case canonical batch,
- harden account mutability/readonly enforcement and instruction-account ordering.

Exit criteria:

- the full canonical MVP validation sequence is implemented for production-sized batches within compute limits.

### Slice 6: Canonical mixed-registry batching

- correct the interim single-registry-tuple settlement limitation in place,
- allow one settlement batch to reference multiple `zone_id`s and multiple `enemy_archetype_id`s,
- require the canonical settlement account envelope to include:
  - additional `CharacterZoneProgressPageAccount`s in ascending `page_index` order,
  - all referenced `ZoneRegistryAccount`s in ascending `zone_id` order,
  - all referenced `ZoneEnemySetAccount`s in ascending `zone_id` order,
  - all referenced `EnemyArchetypeRegistryAccount`s in ascending `enemy_archetype_id` order,
- define `ZoneEnemySetAccount` as one bounded, sorted, unique legal-enemy set per zone,
- validate legality and derive EXP per histogram row against the matching zone/enemy registries.

Exit criteria:

- mixed-zone and mixed-enemy batches settle end to end through the existing canonical instruction,
- missing/duplicate/out-of-order grouped remaining accounts are rejected deterministically,
- mixed-registry legality and EXP derivation are proven through integrated success/failure tests.

---

## 12) Final MVP Build Ticket Scope

This section is the **scope inventory**, not the recommended implementation order. Delivery order is defined by the vertical slices in section 11.

Implement now (MVP-core scope):

1. CharacterRootAccount
2. CharacterStatsAccount
3. CharacterWorldProgressAccount
4. CharacterZoneProgressPageAccount
5. ZoneRegistryAccount
6. ZoneEnemySetAccount
7. EnemyArchetypeRegistryAccount
8. ProgramConfigAccount
9. CharacterSettlementBatchCursorAccount
10. `ApplyBattleSettlementBatchV1`
11. local bootstrap/deployment path for localnet:
   - Anchor program deployment,
   - `ProgramConfigAccount` initialization,
   - minimum registry seeding,
   - character creation/bootstrap path for character-owned accounts and cursor defaults
12. dual-signature authority flow:
   - trusted server attestation,
   - player authorization permit,
   - relayer transaction assembly with ed25519 verification instructions
13. canonical histogram validation + deterministic EXP derivation

Optional (MVP+1):

- BattleSettlementBatchReceiptAccount
- CharacterLoadoutAccount (only if another MVP domain needs it; not part of canonical settlement validation)

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

1. Freeze exact deterministic EXP derivation inputs and registry dependencies (`exp_reward_base`, zone multiplier fields, and integer math policy).
2. Freeze arithmetic safety policy for EXP math (intermediate width, overflow behavior, and clamp/reject semantics).
3. Decide whether zero-EXP non-empty batches are valid or rejected as anomalous.
4. Confirm all level-up side effects in MVP scope versus deferred domains.

### 13.6 Optional components to lock now

1. Confirm `optional_loadout_revision` remains metadata-only and is ignored by canonical MVP settlement validation.
2. Decide if `BattleSettlementBatchReceiptAccount` remains MVP+1 or is promoted into MVP-core for ops/audit reasons.
3. Confirm `max_histogram_entries_per_batch` launch value and governance tuning rules.
4. Confirm server batch construction policy (`target_batch_size = 20`) and whether adaptive sizing is allowed under constraints.

---

## 14) Vertical Slice Delivery Checklist

Use this checklist as the execution tracker. Each slice should finish with at least one end-to-end integration test passing through the real relayer flow.

### Slice 0) Governance + harness

- [x] Resolve and freeze all Section 13 decision points with lean MVP choices.
- [x] Publish error-code map and operator runbook for settlement failures.
- [x] Set up Anchor-based local development (`Anchor.toml` on `localnet`) for slices 0-5.
- [x] Create canonical test fixtures for one character / one zone / one enemy / one valid batch.
- [x] Verify managed local workflow: `anchor test`.
- [x] Verify persistent local-validator workflow: `solana-test-validator` + `anchor test --skip-local-validator`.
- [x] Build integration helpers for:
  - [x] server attestation signing,
  - [x] player permit signing,
  - [x] ed25519 instruction insertion,
  - [x] player-paid transaction submission via server broadcast,
  - [x] post-transaction state assertions.

### Slice 1) Current `runana-program` Status Snapshot

Observed in `runana-program` at this stage:

- Anchor is already in use.
- `Anchor.toml` sets `provider.cluster = "localnet"` and includes a `programs.localnet` entry.
- The managed local workflow has been verified with a successful `anchor test` run.
- The persistent-validator workflow has been verified with a successful `anchor test --skip-local-validator` run against `solana-test-validator`.
- Canonical Slice 0 fixtures now exist in `runana-program/tests/src/fixtures.rs` and are verified by `runana-program/tests/src/test_canonical_fixtures.rs`.
- Integration helpers now exist in `runana-program/tests/src/integration_helpers.rs` and are unit-verified by `runana-program/tests/src/test_integration_helpers.rs`.
- The on-chain program now includes the minimum Slice 1 account set and happy-path bootstrap instructions for `ProgramConfigAccount`, zone registries, enemy registries, character creation, and `CharacterSettlementBatchCursorAccount`.
- `ApplyBattleSettlementBatchV1` now performs real happy-path settlement application: canonical `batch_hash` recomputation, dual-ed25519 message verification, character ownership binding, continuity checks, deterministic EXP application, and cursor persistence.
- The networked harness now bootstraps localnet fixture state and submits one real settlement batch end to end instead of only exercising the prior smoke path.
- The networked harness currently submits the Slice 1 settlement as a player-paid v0 transaction with an address lookup table so the canonical dual-ed25519 settlement flow fits within Solana transaction size limits on localnet.

Assessment:

- Slice 0 remains complete.
- Slice 1 happy-path settlement is complete in `runana-program`.
- Slice 2 replay/sequencing defenses are complete in `runana-program`.
- Slice 3 time/season/throughput controls now use a dedicated per-season `SeasonPolicyAccount` instead of storing season lifecycle state in `ProgramConfigAccount`.

Next implementation frontier:

1. Slice 4 world legality and deterministic rewards.


! Observations and Questions: Can a character be created with a timestamp < the current season start?
### Slice 1) Happy-path single-batch settlement

- [x] Implement and test minimum account layouts + PDA derivations for:
  - [x] CharacterRootAccount
  - [x] CharacterStatsAccount
  - [x] CharacterWorldProgressAccount
  - [x] CharacterZoneProgressPageAccount
  - [x] ZoneRegistryAccount
  - [x] ZoneEnemySetAccount
  - [x] EnemyArchetypeRegistryAccount
  - [x] ProgramConfigAccount
  - [x] CharacterSettlementBatchCursorAccount
- [x] Deploy the Anchor program to localnet as part of the happy-path integration flow.
- [x] Initialize `ProgramConfigAccount` on localnet.
- [x] Seed minimum registry state on localnet:
  - [x] `ZoneRegistryAccount`
  - [x] `ZoneEnemySetAccount`
  - [x] `EnemyArchetypeRegistryAccount`
- [x] Implement character creation/bootstrap path that creates and initializes:
  - [x] `CharacterRootAccount`
  - [x] `CharacterStatsAccount`
  - [x] `CharacterWorldProgressAccount`
  - [x] initial `CharacterZoneProgressPageAccount` entries as needed
  - [x] `CharacterSettlementBatchCursorAccount`
- [x] Initialize cursor defaults during character creation:
  - [x] `last_committed_end_nonce = 0`
  - [x] `last_committed_state_hash = genesis_state_hash(character_root)`
  - [x] `last_committed_batch_id = 0`
  - [x] `last_committed_battle_ts = character_creation_ts`
  - [x] `last_committed_season_id = season_id_at_character_creation`
- [x] Implement `ApplyBattleSettlementBatchV1` happy-path instruction data layout exactly as frozen.
- [x] Align the schema surface used by this repo with the canonical settlement schema (`runana-program` does not currently contain a `types/settlement.ts` file; the canonical schema is represented here in Rust instruction/types + fixtures).
- [x] Implement canonical serialization for:
  - [x] `batch_hash` preimage (excluding `batch_hash` itself and excluding signature bytes/instruction metadata),
  - [x] server attestation,
  - [x] player authorization permit.
- [x] Recompute and equality-check `batch_hash` on-chain.
- [x] Parse `SysvarInstructions` and verify both ed25519 instructions.
- [x] Accept only `trusted_server_signers` from `ProgramConfigAccount`.
- [x] Bind verified player authorization to `CharacterRootAccount.authority`.
- [x] Require readonly `player_authority` account and readonly `SysvarInstructions` account in the canonical instruction account list.
- [x] Build the canonical player permit bytes from `program_id`, `cluster_id`, `player_authority_pubkey`, `character_root_pubkey`, `batch_hash`, `batch_id`, and `signature_scheme`.
- [x] Construct player-paid transactions that include both ed25519 verification instructions before `ApplyBattleSettlementBatchV1`.
- [x] Submit one successful settlement transaction through server broadcast of the player-signed transaction.
- [x] Add one happy-path end-to-end test asserting progression and cursor updates.

### Slice 2) Replay and sequencing defenses

- [x] Implement derivation/ownership checks.
- [x] Implement continuity checks (`start_nonce`, `start_state_hash`, `batch_id`, nonce range).
- [x] Require the player authorization permit to bind `program_id`, `cluster_id`, `player_authority`, `character_root_pubkey`, `batch_hash`, and `batch_id`.
- [x] Enforce strict oldest-first submission continuity in the relayer path.
- [x] Store batch metadata needed for retry/reconciliation and replay diagnostics.
- [x] Add end-to-end negative tests for:
  - [x] replayed batch,
  - [x] out-of-order batch,
  - [x] wrong `batch_hash`,
  - [x] wrong `batch_id`,
  - [x] wrong `CharacterRootAccount.authority`,
  - [x] wrong signature-domain fields.

### Slice 3) Time, season, and throughput controls

- [x] Enforce monotonic time anchor validation (`first_battle_ts >= cursor.last_committed_battle_ts`, `last_battle_ts >= first_battle_ts`).
- [x] Implement season eligibility and stale-progress expiry rules.
- [x] Implement deterministic throughput cap checks.
- [x] Enforce `settlement_paused` behavior per locked policy.
- [x] Add end-to-end tests for:
  - [x] delayed submission success,
  - [x] grace-window boundary pass/fail,
  - [x] season regression,
  - [x] pre-character timestamp rejection,
  - [x] throughput boundary pass/fail.

### Slice 4) World legality and deterministic rewards

- [x] Implement policy checks (`max_battles_per_batch`, `max_histogram_entries_per_batch`).
- [x] Implement histogram integrity checks (sum/count, non-zero counts, duplicates forbidden).
- [x] Implement world eligibility checks for all referenced zones.
- [x] Implement zone/enemy legality checks against registry mapping.
- [x] Implement deterministic EXP derivation from histogram + registry data with `u128` intermediate math and overflow rejection.
- [x] Treat `optional_loadout_revision` as metadata-only and ignore it in canonical MVP settlement validation.
- [x] Add end-to-end tests for:
  - [x] illegal zone access,
  - [x] illegal zone→enemy pair,
  - [x] duplicate histogram entry,
  - [x] zero-count histogram entry,
  - [x] EXP arithmetic overflow / invalid registry input.

### Slice 5) Progression completeness and compute envelope

- [x] Apply progression transitions with monotonic rules.
- [x] Persist cursor updates across sequential successful batches.
- [x] Support multi-page zone progress account access for large batches.
- [x] Enforce required account mutability/read-only constraints across the implemented settlement account envelope.
- [ ] Benchmark compute for worst-case allowed batch (`battle_count=32`, histogram entries=64).
- [x] Add end-to-end sequential-batch tests covering page access and cumulative progression.

### Slice 6) Canonical mixed-registry batching

- [x] Evolve `ApplyBattleSettlementBatchV1` in place to accept canonical grouped remaining accounts for mixed zones and enemies.
- [x] Promote `ZoneEnemySetAccount` to one bounded sorted unique legal-enemy set per zone.
- [x] Validate every histogram row against the matching zone registry, zone enemy set membership, and enemy registry.
- [x] Derive EXP per histogram row and sum it across mixed batches with overflow rejection preserved.
- [x] Reject missing, duplicate, out-of-order, and extra grouped remaining accounts deterministically.
- [x] Add end-to-end tests for mixed-zone success, mixed-enemy success, grouped-account failures, overflow, and sequential mixed batches.

### Explicitly deferred

- [ ] Ops and optional auditability workstream after Slice 6.
- [ ] Inventory/drop settlement domains.
- [ ] On-chain learning persistence extensions.
- [ ] Persistent enemy instance domains.

---


## 14.1) Slice-to-Code Mapping Appendix (Normative)

- **Slice 0: harness**
  - Anchor localnet setup (`Anchor.toml`, managed validator flow, persistent-validator flow),
  - integration test harness and fixture builders,
  - signing helpers for server attestation and player permit,
  - relay transaction assembly helpers.
- **Slice 1: happy path**
  - localnet Anchor program deployment/bootstrap helpers,
  - `ProgramConfigAccount` initialization and minimum registry seeding,
  - character creation/bootstrap instructions for character-owned accounts and cursor defaults,
  - account layout/types for the minimum MVP-core account set,
  - canonical serialization for `batch_hash` preimage, server attestation, and player permit,
  - `ApplyBattleSettlementBatchV1` happy-path validation/application,
  - end-to-end happy-path settlement test.
- **Slice 2: replay/sequencing**
  - continuity validation logic,
  - permit-domain binding checks,
  - retry/reconciliation metadata in server submission path,
  - replay/out-of-order integration tests.
- **Slice 3: time/season/throughput**
  - season/grace validation logic,
  - deterministic throughput formula enforcement,
  - delayed-submission and boundary integration tests.
- **Slice 4: legality/rewards**
  - histogram integrity validation,
  - zone/world legality checks,
  - deterministic EXP derivation and overflow rejection,
  - illegal-claim integration tests.
- **Slice 5: progression/envelope**
  - full progression application,
  - multi-page zone progress access,
  - account mutability/read-only hardening,
  - compute benchmarking and sequential-batch tests.
- **Slice 6: mixed batching**
  - canonical grouped remaining-account validation,
  - bounded per-zone enemy membership sets,
  - mixed-row legality and EXP derivation tests.

## 14.2) QA-Readiness Test Matrix (Required)

1. Slice 1 happy-path settlement succeeds end to end through the real relayer flow.
2. Replay/out-of-order batch rejection is enforced in Slice 2.
3. Wrong `cluster_id`/`program_id`/`character_root_pubkey` in server attestation is rejected in Slice 2.
4. Wrong `cluster_id`/`program_id`/`character_root_pubkey`/`player_authority` in player authorization permit is rejected in Slice 2.
5. Player permit with wrong `batch_hash` or wrong `batch_id` is rejected in Slice 2.
6. Settlement is rejected when `CharacterRootAccount.authority != player_authority` in Slice 2.
7. Settlement is rejected when required ed25519 verification instructions are missing, malformed, or incorrectly ordered in Slice 2.
8. Delayed submission is accepted with valid continuity/season/throughput in Slice 3.
9. Prior-season batch is rejected after `commit_grace_end_ts` in Slice 3.
10. Prior-season batch is accepted at `commit_grace_end_ts - 1` in Slice 3.
11. Season regression is rejected in Slice 3.
12. Pre-character timestamp is rejected in Slice 3.
13. Throughput exact boundary pass and +1 fail are both covered in Slice 3.
14. Illegal zone access, illegal zone→enemy pairs, duplicate histogram entries, and zero-count histogram entries are rejected in Slice 4.
15. Deterministic EXP derivation success/failure, including overflow/invalid-registry cases, is covered in Slice 4.
16. Sequential successful batches, multi-page progression access, and compute-envelope checks are covered in Slice 5.
17. Mixed-zone and mixed-enemy batches, including missing/misordered grouped registry accounts and mixed-row EXP overflow, are covered in Slice 6.

## 15) Section 13 Decision Locks (Lean MVP Defaults)

These decisions are now **locked for MVP** to unblock implementation.

### 15.1 Product & trust boundaries (locks)

1. **Dispute/remediation path:** no on-chain dispute flow in MVP; disputes are handled off-chain by support + ops replay tooling.
2. **Signer model:** single trusted server signer key in `trusted_server_signers` at launch plus separate player off-chain authorization permit; the player is the transaction signer and fee payer for player-owned flows in MVP.
3. **Paused behavior:** when `settlement_paused = true`, all settlement submissions are blocked; no admin bypass path in MVP.
4. **Freshness policy:** no attestation expiry gate in MVP V2; freshness is enforced via monotonic timestamps, season/grace eligibility, and throughput bounds.

### 15.2 Batch identity, ordering, replay semantics (locks)

1. `batch_id` is strictly monotonic per character and never resets in MVP.
2. `genesis_state_hash(character_root)` is `sha256(character_root_pubkey || character_id || 0u64_nonce || 0u64_batch_id)` with canonical little-endian integer encoding.
3. Deterministic continuity error buckets are frozen: nonce gap, state-hash mismatch, batch-id gap, nonce-range mismatch.
4. Backlog submission is strict oldest-first only; no skipping or parallelized commit lanes.

### 15.3 Payload canonicalization & signature domain (locks)

1. Canonical serialization is strict field-order Borsh-compatible encoding for the server attestation over all section 6.2 fields (without `exp_delta`), plus a separate canonical player authorization permit message.

   `batch_hash` is computed over the canonical payload preimage that excludes `batch_hash` itself and excludes signature bytes/instruction metadata.

   Canonical field order for `batch_hash` preimage:
   `character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, schema_version, signature_scheme`.

   Canonical field order for server attestation hashing/signing:
   `program_id, cluster_id, character_root_pubkey, character_id, batch_id, start_nonce, end_nonce, battle_count, first_battle_ts, last_battle_ts, season_id, start_state_hash, end_state_hash, zone_progress_delta, encounter_histogram, optional_loadout_revision, batch_hash, schema_version, signature_scheme`.
   
   Canonical field order for player authorization hashing/signing:
   `program_id, cluster_id, player_authority_pubkey, character_root_pubkey, batch_hash, batch_id, signature_scheme`.
2. `cluster_id` is an explicit `u8` enum in signed domain (`1=localnet`, `2=devnet`, `3=testnet`, `4=mainnet-beta`).
3. Compatibility strategy: new layouts require new `signature_scheme` discriminant and/or new instruction version; no silent reinterpretation.
4. `batch_hash` is always recomputed on-chain and must exactly match payload-provided hash.

### 15.4 Season policy storage (locks)

1. Seasonal timing policy is stored in a dedicated `SeasonPolicyAccount(season_id)`, not in `ProgramConfigAccount`.
2. `ProgramConfigAccount` remains global-only and does not carry mutable season lifecycle fields.
3. Slice 3 settlement validation loads the claimed season account and enforces:
   - battle timestamps inside the season interval,
   - current chain time `<= commit_grace_end_ts`,
   - stale prior-season progress expiry once grace closes.

### 15.5 World progression semantics (locks)

1. `locked -> cleared` is globally forbidden in MVP (no zone-level exceptions at launch).
2. If histogram-implied progression conflicts with `zone_progress_delta`, `zone_progress_delta` is canonical and conflicts fail validation.
3. `zone_id -> page_index_u16` mapping is `page_index = zone_id / 256` (integer division).
4. If summary and page data are inconsistent at validation time, fail settlement (no repair path in instruction).

### 15.6 Reward and balance guardrails (locks)

1. Per-encounter EXP base input is read from `EnemyArchetypeRegistryAccount.exp_reward_base` for MVP and combined with zone policy multipliers in deterministic derivation.
2. EXP math uses `u128` intermediates; overflow during intermediate math is rejection, not clamp.
3. Zero-EXP non-empty batches are valid in MVP.
4. MVP level-up side effects are limited to level/exp/stat recalculation domains only; inventory/unlocks/learning side effects are deferred.

### 15.7 Optional components to lock now (locks)

1. `optional_loadout_revision` remains metadata-only in MVP and is not enforced during canonical settlement validation.
2. `BattleSettlementBatchReceiptAccount` remains MVP+1 (not MVP-core).
3. Launch `max_histogram_entries_per_batch = 64`; governance can lower/raise through program config update.
4. Server batch construction targets 20 battles but may adapt size as long as on-chain constraints are met.

---

## 16) MVP Settlement Error-Code Map (Initial Publication)

This section satisfies the Slice 0 requirement to publish an error-code map and operator runbook early.

These are **canonical support codes**, not a promise about final Anchor numeric discriminants. Final on-chain/server implementations must map 1:1 into these support buckets for observability, support triage, and replay diagnostics.

Interpretation rules:

1. The first failing invariant should determine the surfaced support code.
2. Do not silently collapse distinct continuity failures into a generic replay error.
3. If a request fails before instruction execution, no settlement support code is guaranteed; use transport/RPC diagnostics first.
4. Support codes must be stable across retries and across client/server surfaces for the same root cause.

| Support code | Canonical failure bucket | Trigger / meaning | Operator default action |
| --- | --- | --- | --- |
| `SETTLE-OPS-001` | settlement paused | `settlement_paused = true` blocked submission | Do not retry until governance/admin unpauses; no MVP bypass path |
| `SETTLE-AUTH-101` | missing or malformed server attestation verification | server ed25519 verification instruction missing, malformed, or not in canonical position | Rebuild transaction assembly; safe to retry after relayer fix |
| `SETTLE-AUTH-102` | untrusted server signer | attestation signer not present in `ProgramConfigAccount.trusted_server_signers` | Verify active server key and config; retry only after config/key correction |
| `SETTLE-AUTH-103` | server signature domain mismatch | server attestation domain fields do not match `program_id`, `cluster_id`, or `character_root_pubkey` | Rebuild canonical attestation bytes; do not blind retry |
| `SETTLE-AUTH-111` | missing or malformed player permit verification | player ed25519 verification instruction missing, malformed, or incorrectly ordered | Rebuild transaction assembly; safe to retry after relayer fix |
| `SETTLE-AUTH-112` | player permit domain mismatch | player permit domain fields do not match `program_id`, `cluster_id`, `player_authority`, `character_root_pubkey`, `batch_hash`, or `batch_id` | Rebuild permit payload and recollect authorization if needed |
| `SETTLE-AUTH-113` | character authority mismatch | `CharacterRootAccount.authority != player_authority` | Verify ownership binding; escalate to support if player expected a different wallet |
| `SETTLE-ACCT-201` | invalid account derivation or ownership | required PDA/account owner/account mutability/read-only constraints are wrong | Fix account list derivation or bootstrap state; retry after correction |
| `SETTLE-PAYLOAD-211` | batch hash mismatch | on-chain recomputed `batch_hash` differs from payload-provided `batch_hash` | Recompute canonical serialization; do not blind retry |
| `SETTLE-CONT-301` | nonce gap | `start_nonce` is older/newer than strict oldest-first expectation | Find the missing older batch first; do not skip ahead |
| `SETTLE-CONT-302` | state-hash mismatch | `start_state_hash` does not equal cursor `last_committed_state_hash` | Replay backlog and reconstruct expected prior batch chain before retry |
| `SETTLE-CONT-303` | batch-id gap | `batch_id` is not the next strict per-character batch id | Submit the oldest missing batch first or rebuild batch numbering |
| `SETTLE-CONT-304` | nonce-range mismatch | `(end_nonce - start_nonce + 1)` is inconsistent with declared battle range/payload semantics | Regenerate the batch payload; do not retry unchanged |
| `SETTLE-TIME-401` | pre-character timestamp | first battle occurred before character creation anchor | Treat as invalid data; investigate server batch construction |
| `SETTLE-TIME-402` | battle timestamp regression | `last_battle_ts < first_battle_ts` or monotonic time anchor rules fail | Regenerate batch timestamps; do not retry unchanged |
| `SETTLE-TIME-403` | season regression | batch season moved backward relative to committed cursor | Submit backlog in order or regenerate batch against correct season |
| `SETTLE-TIME-404` | prior-season grace expired | uncommitted prior-season progress was submitted after `commit_grace_end_ts` | Do not retry unchanged; prior-season uncommitted progress is lost in MVP |
| `SETTLE-TIME-405` | throughput exceeded | deterministic interval math shows impossible battle density | Investigate server batching/timestamping; split or delay future batches |
| `SETTLE-WORLD-501` | illegal zone access | batch references a zone the character has not unlocked or cannot legally enter | Investigate progression state and server encounter selection |
| `SETTLE-WORLD-502` | illegal zone-enemy pair | histogram references an enemy not legal for the zone registry mapping | Fix registry data or encounter generation; retry only after correction |
| `SETTLE-WORLD-503` | invalid zone progress delta | `zone_progress_delta` violates monotonic policy or conflicts with canonical rules | Regenerate progression delta from valid world state |
| `SETTLE-WORLD-504` | summary/page inconsistency | summary progression and page data conflict at validation time | Repair underlying state before resubmission; no instruction-side repair path |
| `SETTLE-HIST-601` | histogram count mismatch | histogram totals do not match declared `battle_count` | Recompute histogram from canonical battle list |
| `SETTLE-HIST-602` | duplicate histogram entry | same `(zone_id, enemy_id)` tuple appears more than once | Normalize histogram before signing |
| `SETTLE-HIST-603` | zero-count histogram entry | histogram contains zero-count rows | Remove anomalous entries and rebuild payload |
| `SETTLE-HIST-604` | histogram entry limit exceeded | batch exceeds `max_histogram_entries_per_batch` | Split the batch and resubmit in strict continuity order |
| `SETTLE-REWARD-701` | invalid registry input | registry data required for deterministic EXP derivation is missing or invalid | Repair registry/config state before retry |
| `SETTLE-REWARD-702` | EXP arithmetic overflow | deterministic EXP math overflowed under `u128` intermediate policy | Treat as invalid config/data; investigate registry multipliers immediately |
| `SETTLE-VERS-801` | unsupported version or signature scheme | unknown instruction version or `signature_scheme` | Upgrade client/relayer payload generation to the canonical supported scheme |

---

## 17) MVP Operator Runbook For Settlement Failures (Initial Publication)

This is the initial Slice 0 runbook publication. Production hardening, richer reconciliation storage, and optional receipt tooling remain explicitly deferred after Slice 6.

### 17.1 Required incident artifacts

For every failed settlement, capture:

- transaction signature, if one exists,
- support code from section 16, if one exists,
- `character_id`,
- `character_root_pubkey`,
- `player_authority_pubkey`,
- `batch_id`,
- `batch_hash`,
- `start_nonce` / `end_nonce`,
- `first_battle_ts` / `last_battle_ts`,
- `season_id`,
- relayer request id / internal trace id,
- active `cluster_id`,
- trusted server signer pubkey used for the attestation.

### 17.2 Triage sequence

1. Determine whether the failure happened before chain execution, during preflight, or on-chain after instruction execution began.
2. If there is no on-chain execution, inspect relayer/RPC transport first before using the support-code map.
3. If there is an on-chain failure, map it to exactly one support code from section 16.
4. Decide whether the failure is:
   - safe same-payload retry,
   - rebuild-and-retry,
   - state-repair required,
   - permanent rejection.
5. Record the outcome against the batch so replay diagnostics stay deterministic.

### 17.3 Retry policy

Safe same-payload retry:

- transport timeout or dropped RPC submission where no on-chain execution occurred,
- temporary relayer delivery failure before validator acceptance.

Rebuild transaction, then retry:

- `SETTLE-AUTH-101`
- `SETTLE-AUTH-103`
- `SETTLE-AUTH-111`
- `SETTLE-AUTH-112`
- `SETTLE-ACCT-201`
- `SETTLE-PAYLOAD-211`
- `SETTLE-HIST-601`
- `SETTLE-HIST-602`
- `SETTLE-HIST-603`

Repair config/state/data first, then retry:

- `SETTLE-AUTH-102`
- `SETTLE-AUTH-113`
- `SETTLE-WORLD-501`
- `SETTLE-WORLD-502`
- `SETTLE-WORLD-503`
- `SETTLE-WORLD-504`
- `SETTLE-REWARD-701`
- `SETTLE-REWARD-702`
- `SETTLE-VERS-801`

Do not blindly retry unchanged payload:

- `SETTLE-OPS-001`
- `SETTLE-CONT-301`
- `SETTLE-CONT-302`
- `SETTLE-CONT-303`
- `SETTLE-CONT-304`
- `SETTLE-TIME-401`
- `SETTLE-TIME-402`
- `SETTLE-TIME-403`
- `SETTLE-TIME-404`
- `SETTLE-TIME-405`
- `SETTLE-HIST-604`

### 17.4 Family-specific operator actions

Auth failures:

- Verify the correct `cluster_id`, `program_id`, `character_root_pubkey`, `player_authority_pubkey`, and `batch_id` were serialized into the signed domains.
- Confirm both ed25519 verification instructions are present before `ApplyBattleSettlementBatchV1`.
- Confirm the attestation signer is the currently trusted server signer for the active environment.

Continuity failures:

- Query the character cursor state first.
- Identify the oldest missing batch and submit backlog strictly oldest-first.
- Never skip a missing batch to force a newer batch through.

Time / season / throughput failures:

- Compare the submitted interval against the committed cursor anchors.
- If grace has expired, treat prior-season uncommitted progress as permanently lost for MVP.
- If throughput was exceeded, adjust future server batching and timestamping policy; do not mutate historical timestamps just to pass validation.

World / progression failures:

- Verify the character's unlocked zones and the current summary/page progression state.
- Verify zone-to-enemy legality against registry data.
- If summary/page data are inconsistent, repair state out of band before resubmission.

Reward / registry failures:

- Inspect enemy archetype EXP values and zone policy multipliers.
- Treat overflow as a configuration or data bug, not a recoverable player-facing transient.

### 17.5 Player-support guidance

- If the failure is auth or relayer assembly related, tell the player the submission can be retried after server-side correction.
- If the failure is continuity related, explain that older uncommitted progress must settle first.
- If the failure is grace expiry related, explain that MVP policy permanently expires prior-season uncommitted progress after `commit_grace_end_ts`.
- If the failure is `settlement_paused`, explain that settlement is temporarily disabled globally and no admin bypass exists in MVP.

### 17.6 Implementation requirement

When the on-chain program and relayer are implemented, every surfaced settlement rejection must map to one support code in section 16 and follow the retry/remediation policy in this runbook.

## 18) Zone-Run Redesign Cross-Reference

The agreed zone-run execution and run-native settlement redesign is maintained in a separate document to avoid confusion with the currently implemented battle-native MVP plan.

Canonical document:

- `/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md`

Scope note:

- this unified plan remains the canonical reference for the currently implemented and battle-native MVP settlement path,
- the separate zone-run document is the canonical reference for the next-phase redesign workstream,
- implementation work for nodes, subnodes, active runs, closed-run summaries, and run-native settlement should follow the separate zone-run document rather than appending new rules here.
