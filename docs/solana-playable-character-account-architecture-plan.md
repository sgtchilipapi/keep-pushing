# Solana Playable Character Data Architecture Plan (Future-Proof, Modular Accounts)

## 1) Purpose and Constraints

This document proposes a modular Solana account model for playable characters that:

- aligns with deterministic combat and per-character learning requirements in SSOT,
- allows isolated reads/writes for efficiency,
- supports future growth without repeatedly migrating a monolithic account.

## 2) Design Anchors from SSOT

The account model is designed around these canonical rules:

- One player controls one combatant character in current slice.
- Combat simulation is deterministic and server-authoritative.
- Character progression includes core stats, loadout, unlocks, inventory, and per-character/per-enemy learning.
- Persistence stores character-centric domains separately (equipment, inventory, skill unlocks, learning, etc.).

## 3) High-Level Strategy

Use a **Character Root** plus **domain-specific child accounts** (PDA-per-domain), each with:

- explicit version byte,
- bounded scope of mutable fields,
- stable IDs for skills/passives/items,
- append- or chunk-friendly extension strategy where growth is unbounded.

This minimizes lock contention and compute costs by writing only the account relevant to a given action.

## 4) Account Topology

### 4.1 CharacterRootAccount (small, stable)

**PDA seeds**: `[b"character", authority_pubkey, character_id]`

Fields (minimal canonical identity):

- `version: u8`
- `bump: u8`
- `authority: Pubkey` (owner)
- `character_id: [u8; 16 or 32]` (opaque deterministic id)
- `archetype_id: u16` (optional future class/origin)
- `level: u16`
- `exp: u32`
- `status_flags: u32`
- `created_at_slot: u64`
- `updated_at_slot: u64`

Notes:

- Keep root intentionally compact and rarely reallocated.
- Do not place frequently mutating vectors/lists here.

### 4.2 CharacterStatsAccount

**PDA seeds**: `[b"character_stats", character_root_pubkey]`

Fields:

- `version: u8`
- `hp_base: u32`
- `atk_base: u16`
- `def_base: u16`
- `spd_base: u16`
- `accuracy_bp_base: u16`
- `evade_bp_base: u16`
- `hp_bonus_flat: i32`
- `atk_bonus_flat: i16`
- `def_bonus_flat: i16`
- `spd_bonus_flat: i16`
- `accuracy_bp_bonus: i16`
- `evade_bp_bonus: i16`
- `last_recalc_slot: u64`

Notes:

- Split base stats vs aggregated modifiers for deterministic rebuild.
- Supports future equipment/talent systems without schema break.

### 4.3 CharacterLoadoutAccount

**PDA seeds**: `[b"character_loadout", character_root_pubkey]`

Fields:

- `version: u8`
- `active_skill_ids: [u32; 2]`
- `passive_skill_ids: [u32; 2]`
- `loadout_revision: u32`
- `updated_at_slot: u64`

Notes:

- Fixed-size arrays match SSOT MVP loadout (2 active + 2 passive).
- Skill IDs remain immutable identity keys.

### 4.4 CharacterUnlocksAccount (chunked)

**PDA seeds**: `[b"character_unlocks", character_root_pubkey, chunk_index_u16]`

Fields:

- `version: u8`
- `chunk_index: u16`
- `skill_ids: Vec<u32>` (bounded per chunk)
- `passive_ids: Vec<u32>` (bounded per chunk)

Notes:

- Avoid one unbounded vector; chunk to cap realloc/compute.
- Choose deterministic max entries/chunk (e.g., 64).

### 4.5 CharacterInventoryAccount (chunked or map pages)

**PDA seeds**: `[b"character_inventory", character_root_pubkey, page_index_u16]`

Fields:

- `version: u8`
- `page_index: u16`
- `entries: Vec<InventoryEntry>` where `InventoryEntry { item_id: u32, qty: u32 }`

Notes:

- Page-based updates isolate writes for a small set of items.
- Enables later item metadata changes in separate registry accounts.

### 4.6 CharacterLearningStateAccount (partitioned by enemy archetype)

**PDA seeds**: `[b"character_learning", character_root_pubkey, enemy_archetype_id_u16, page_index_u16]`

Fields:

- `version: u8`
- `enemy_archetype_id: u16`
- `page_index: u16`
- `weights: Vec<SkillWeightEntry>` where `SkillWeightEntry { skill_id: u32, weight: i16 }`
- `last_battle_slot: u64`

Notes:

- Mirrors SSOT: learning is per character and per enemy archetype.
- Partitioning avoids writing all matchup data after each battle.

### 4.7 CharacterTelemetrySummaryAccount (optional for balancing)

**PDA seeds**: `[b"character_telemetry", character_root_pubkey, season_or_epoch_u32]`

Fields:

- `version: u8`
- counters for battles, wins, rounds, damage totals, usage counts.

Notes:

- Keep optional and roll-over by epoch/season to bound size.

## 5) Global Registries (read-only or admin-updated)

Keep static definitions in separate registries, not per-character accounts:

- `SkillRegistryAccount` (skill definitions)
- `PassiveRegistryAccount`
- `StatusRegistryAccount`
- `ItemRegistryAccount`
- `EnemyArchetypeRegistryAccount`

Character accounts should store only IDs and dynamic state, never duplicated definitions.

## 6) Instruction-to-Account Write Matrix

- **CreateCharacter** → Root + Stats + Loadout (+ first Unlocks/Inventory page)
- **EquipLoadout** → Loadout only
- **GrantUnlock** → Unlocks page only
- **AddItem/ConsumeItem** → Inventory page only
- **ApplyBattleLearning** → Learning page(s) only
- **LevelUp** → Root + Stats

This mapping is the core efficiency win for isolated writes.

## 7) Versioning and Migration Plan

### 7.1 Versioning

- Every account starts with `version: u8`.
- Program dispatches decode path by version.
- New optional fields go to new version or extension account, not in-place breaking layout.

### 7.2 Migrations

- Prefer additive extension accounts over mass rewrites.
- Provide one-time admin/user migration instructions per account family.
- Keep old readers temporarily for backward compatibility windows.

## 8) Determinism and Security Rules

- Keep combat formula inputs integer-encoded and normalized before simulation.
- Never trust client-provided loadout/stats when chain state is source of truth.
- Validate ownership (`authority == signer`) and account derivations on each write.
- Enforce bounds for all basis-point and stat fields at instruction boundaries.

## 9) Practical Sizing Guidance

- Keep high-churn accounts under ~1-2 KB where feasible.
- Use paged/chunked accounts for unbounded domains.
- Reserve bytes only where near-term growth is likely; otherwise prefer extension accounts.

## 10) Implementation Phases

### Phase 0: Contract freeze

- Freeze field names/types and PDA seed conventions.
- Publish account schemas and instruction write matrix.

### Phase 1: MVP on-chain character

- Implement Root, Stats, Loadout.
- Implement create/equip/levelup paths.

### Phase 2: Growth domains

- Add Unlocks pages and Inventory pages.
- Add registry accounts if not already present.

### Phase 3: Learning integration

- Add LearningState partitioned accounts.
- Wire post-battle learning updates per archetype page.

### Phase 4: Migration and hardening

- Backfill/migrate existing off-chain character state.
- Add indexer/read-model for fast API hydration.
- Add invariant/property tests for deterministic decoding and updates.

## 11) Open Decisions to Finalize Before Build

1. `character_id` representation (UUID bytes vs hash-derived id).
2. Exact chunk/page capacities per account family.
3. Whether to include compressed/event-sourced history vs current-state only.
4. Which telemetry counters are on-chain vs off-chain indexed only.
5. Upgrade authority and governance model for registries.

## 12) Definition of Done for Architecture Step

- Account schema RFC approved.
- PDA seed spec approved.
- Instruction-account write matrix approved.
- Versioning/migration strategy approved.
- Test plan defined (serialization, ownership checks, bounds, deterministic rebuild).
