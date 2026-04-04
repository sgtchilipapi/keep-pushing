# Solana Playable Character Data Architecture Plan (Future-Proof, Modular Accounts)

## 1) Purpose and Constraints

This document proposes a modular Solana account model for playable characters that:

- aligns with deterministic combat and per-character learning requirements in SSOT,
- allows isolated reads/writes for efficiency,
- supports future growth without repeatedly migrating a monolithic account,
- enables on-chain validation that claimed battles are possible from each character’s unlocked world state.

## 2) Design Anchors from SSOT

The account model is designed around these canonical rules:

- One player controls one combatant character in current slice.
- Combat simulation is deterministic and server-authoritative.
- Character progression includes core stats, loadout, unlocks, inventory, world access, and per-character/per-enemy learning.
- Persistence stores character-centric domains separately (equipment, inventory, skill unlocks, world progression, learning, etc.).

## 3) High-Level Strategy

Use a **Character Root** plus **domain-specific child accounts** (PDA-per-domain), each with:

- explicit version byte,
- bounded scope of mutable fields,
- stable IDs for skills/passives/items/zones/enemies,
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

### 4.8 CharacterWorldProgressAccount

**PDA seeds**: `[b"character_world_progress", character_root_pubkey]`

Fields:

- `version: u8`
- `highest_main_zone_unlocked: u16`
- `highest_main_zone_cleared: u16`
- `flags: u32`
- `updated_at_slot: u64`

Role and notes:

- Lightweight summary layer for fast checks and UI reads.
- Useful for quick gating (for example, “is character at least in zone N?”) and linear fallback checks.
- Not sufficient alone for non-linear world validation; complements detailed per-zone page data.

### 4.9 CharacterZoneProgressPageAccount

**PDA seeds**: `[b"character_zone_progress", character_root_pubkey, page_index_u16]`

Fields:

- `version: u8`
- `page_index: u16`
- `entries: Vec<ZoneProgressEntry>`

Role and notes:

- Canonical per-zone access state for non-linear progression.
- Supports optional branches, skipped zones, and revisits.
- Uses paging to avoid unbounded single-account growth and expensive realloc.

### 4.10 ZoneProgressEntry

Fields:

- `zone_id: u16`
- `state: u8` where:
  - `0 = locked`
  - `1 = unlocked`
  - `2 = cleared`

Role and notes:

- Primary source of truth for “can this character fight in zone X?”
- Drives unlock transitions after settlement.

### 4.11 ZoneRegistryAccount

**PDA seeds**: `[b"zone_registry", zone_id_u16]`

Fields:

- `version: u8`
- `zone_id: u16`
- `region_id: u16`
- `recommended_level: u16`
- `enemy_set_id: u16`
- `prereq_zone_id: u16` (optional semantics)
- `flags: u32`

Role and notes:

- Global/admin-controlled zone definition (shared across all characters).
- Provides progression, unlock, and validation context without duplicating static design data per character.

### 4.12 ZoneEnemySetAccount

**PDA seeds**: `[b"zone_enemy_set", zone_id_u16]`

Fields:

- `version: u8`
- `zone_id: u16`
- `enemy_ids: Vec<u16>`

Role and notes:

- Canonical zone→enemy mapping used to validate claimed battles.
- Prevents fabricated claims that an arbitrary enemy was fought in a zone.

### 4.13 EnemyArchetypeRegistryAccount

**PDA seeds**: `[b"enemy_archetype", enemy_archetype_id_u16]`

Fields:

- `version: u8`
- `enemy_archetype_id: u16`
- `exp_reward_base: u32`
- `flags: u32`

Role and notes:

- Global enemy identity and reward anchor.
- Used for reward sanity checks and anti-inflation guardrails.

## 5) Why These World/Zone Accounts Exist

These accounts add personal world access control and on-chain validation anchors for battle settlement.

They solve the key trust problem:

- Server claims a character defeated an enemy.
- Program must verify that this was possible given that character’s unlocked zones and zone enemy set.

This is enforced by combining:

- personal zone progression (per-character mutable state), and
- global zone→enemy mapping and enemy definitions (admin-controlled registries).

## 6) Separation of Concerns

Personal (mutable, per-character):

- what zones the character can enter,
- what zones the character has cleared.

Global (static/admin-controlled):

- what zones exist,
- what enemies belong to each zone,
- what reward bounds apply to enemy archetypes.

## 7) Global Registries (read-only or admin-updated)

Keep static definitions in separate registries, not per-character accounts:

- `SkillRegistryAccount` (skill definitions)
- `PassiveRegistryAccount`
- `StatusRegistryAccount`
- `ItemRegistryAccount`
- `ZoneRegistryAccount`
- `ZoneEnemySetAccount`
- `EnemyArchetypeRegistryAccount`

Character accounts should store only IDs and dynamic state, never duplicated definitions.

## 8) Instruction-to-Account Write Matrix

- **CreateCharacter** → Root + Stats + Loadout + WorldProgress (+ first Unlocks/Inventory/ZoneProgress pages)
- **EquipLoadout** → Loadout only
- **GrantUnlock** → Unlocks page only
- **AddItem/ConsumeItem** → Inventory page only
- **ApplyBattleLearning** → Learning page(s) only
- **ApplyBattleSettlement** → WorldProgress + relevant ZoneProgress page + Root (+ Stats if level-up recalculation needed)
- **LevelUp** → Root + Stats
- **AdminUpsertZoneRegistry** → ZoneRegistry only
- **AdminUpsertZoneEnemySet** → ZoneEnemySet only
- **AdminUpsertEnemyArchetype** → EnemyArchetypeRegistry only

This mapping is the core efficiency win for isolated writes.

## 9) On-Chain Settlement Validation Sequence

Server-provided settlement inputs should include at minimum:

- `zone_id`
- `enemy_archetype_id`
- `exp_gained`
- `outcome` (win/lose)

Validation order:

1. **Zone access check**
   - Read `CharacterZoneProgressPageAccount` containing `zone_id`.
   - Ensure entry exists and `state >= unlocked`.
   - If false, reject.
2. **Enemy validity check**
   - Read `ZoneEnemySetAccount(zone_id)`.
   - Ensure `enemy_archetype_id ∈ enemy_ids`.
   - If false, reject.
3. **Reward sanity check**
   - Read `EnemyArchetypeRegistryAccount(enemy_archetype_id)`.
   - Ensure `exp_gained` is within allowed bounds for that archetype.
   - If false, reject.
4. **Apply progression updates**
   - Apply EXP/level updates.
   - Optionally mark zone cleared and unlock next zones according to rules.
   - Update `updated_at_slot` fields and revision markers as needed.

## 10) Versioning and Migration Plan

### 10.1 Versioning

- Every account starts with `version: u8`.
- Program dispatches decode path by version.
- New optional fields go to new version or extension account, not in-place breaking layout.

### 10.2 Migrations

- Prefer additive extension accounts over mass rewrites.
- Provide one-time admin/user migration instructions per account family.
- Keep old readers temporarily for backward compatibility windows.

## 11) Determinism and Security Rules

- Keep combat formula inputs integer-encoded and normalized before simulation.
- Never trust client/server-claimed combat context when chain state can verify it.
- Validate ownership (`authority == signer`) and account derivations on each write.
- Enforce bounds for all basis-point and stat fields at instruction boundaries.
- Enforce zone-entry/state invariants before accepting settlement.
- Enforce zone→enemy membership checks before accepting enemy claims.
- Enforce reward bounds against known enemy archetype definitions.

## 12) Practical Sizing Guidance

- Keep high-churn accounts under ~1-2 KB where feasible.
- Use paged/chunked accounts for unbounded domains.
- Reserve bytes only where near-term growth is likely; otherwise prefer extension accounts.
- Keep summary accounts (`CharacterWorldProgressAccount`) compact and derivable from detailed pages where practical.

## 13) Implementation Phases

### Phase 0: Contract freeze

- Freeze field names/types and PDA seed conventions.
- Publish account schemas and instruction write matrix.

### Phase 1: MVP on-chain character

- Implement Root, Stats, Loadout.
- Implement create/equip/levelup paths.

### Phase 2: Growth domains

- Add Unlocks pages and Inventory pages.
- Add registry accounts if not already present.

### Phase 3: World progression + settlement validation

- Add `CharacterWorldProgressAccount` and `CharacterZoneProgressPageAccount`.
- Add `ZoneRegistryAccount`, `ZoneEnemySetAccount`, and `EnemyArchetypeRegistryAccount`.
- Enforce settlement checks (zone access, zone enemy membership, reward sanity).

### Phase 4: Learning integration

- Add LearningState partitioned accounts.
- Wire post-battle learning updates per archetype page.

### Phase 5: Migration and hardening

- Backfill/migrate existing off-chain character state.
- Add indexer/read-model for fast API hydration.
- Add invariant/property tests for deterministic decoding and updates.

## 14) Invariants Enforced by This Design

1. A character cannot claim a battle in a locked zone.
2. A character cannot claim an enemy outside that zone.
3. Rewards must match known enemy definitions.
4. Server cannot fabricate progression jumps without failing account-state validation.

## 15) Open Decisions to Finalize Before Build

1. `character_id` representation (UUID bytes vs hash-derived id).
2. Exact chunk/page capacities per account family.
3. Whether to include compressed/event-sourced history vs current-state only.
4. Which telemetry counters are on-chain vs off-chain indexed only.
5. Upgrade authority and governance model for registries.
6. Exact reward-bound formula (`exp_reward_base` with modifiers/caps) for settlement checks.

## 16) Definition of Done for Architecture Step

- Account schema RFC approved.
- PDA seed spec approved.
- Instruction-account write matrix approved.
- Settlement validation sequence approved.
- Versioning/migration strategy approved.
- Test plan defined (serialization, ownership checks, bounds, deterministic rebuild, zone/enemy validation).

## 17) Final Mental Model

- `CharacterZoneProgress` = “Where am I allowed to fight?”
- `ZoneEnemySet` = “What enemies exist there?”
- `EnemyArchetypeRegistry` = “What rewards are valid?”

All three must agree for a settlement transaction to succeed.
