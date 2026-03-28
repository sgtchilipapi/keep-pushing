# Solana Enemy Data Architecture Plan (Persistent Spawned Enemy Instances)

## 1) Purpose and Constraints

This document defines the enemy-side Solana account architecture for persistent spawned enemies that:

- aligns with deterministic combat and snapshot assembly conventions already used for playable characters,
- supports persistent enemy identity and world presence over time,
- enables adaptive enemy behavior without mutating static archetype templates,
- preserves bounded/account-partitioned write paths for efficient settlement and progression updates.

## 2) Design Anchors from SSOT

The enemy account model inherits the same system-level constraints as character architecture:

- Combat remains deterministic, integer-only, and server-authoritative.
- Replay/event streams remain sufficient for deterministic validation and analytics.
- Skill and passive IDs are immutable identity keys.
- Character and enemy snapshots should be shape-compatible wherever practical.
- World/presence state must validate whether an enemy is currently available to encounter.

## 3) High-Level Strategy

Use an **Enemy Instance Root** plus **domain-specific child accounts**, with static registries separated from live mutable instance state.

### 3.1 Separation of concerns

- **Instance accounts (mutable):** per-spawned-enemy identity, stats, loadout, adaptation, telemetry, and world presence.
- **Registry/template accounts (shared/admin):** archetype baselines, reusable skill sets, and drop definitions.

### 3.2 Versioning and growth conventions

Each account includes a leading `version: u8` and uses paging/chunking where growth can become unbounded (for example learning/telemetry vectors).

## 4) Enemy Instance Account Topology

## 4.1 EnemyInstanceRootAccount

**Equivalent of:** `CharacterRootAccount`  
**PDA seeds:** `[b"enemy_instance", enemy_instance_id]`

Fields:

- `version: u8`
- `bump: u8`
- `enemy_instance_id: [u8; 16 or 32]`
- `enemy_archetype_id: u16`
- `current_zone_id: u16`
- `spawned_at_slot: u64`
- `updated_at_slot: u64`
- `status_flags: u32`
- `body_count: u32`
- `lifetime_battles: u32`
- `lifetime_wins: u32`

Notes:

- Canonical identity header for a persistent spawned enemy.
- No `authority` field (enemy instances are system-owned, not player-owned).
- `body_count` and lifetime counters support notoriety/progression mechanics.

## 4.2 EnemyInstanceStatsAccount

**Equivalent of:** `CharacterStatsAccount`  
**PDA seeds:** `[b"enemy_instance_stats", enemy_instance_root_pubkey]`

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

- Maintains stat-shape parity with characters for uniform snapshot assembly.
- Base values initialize from archetype, while bonus fields capture long-lived divergence/adaptation.

## 4.3 EnemyInstanceLoadoutAccount

**Equivalent of:** `CharacterLoadoutAccount`  
**PDA seeds:** `[b"enemy_instance_loadout", enemy_instance_root_pubkey]`

Fields:

- `version: u8`
- `active_skill_ids: [u32; 2]` (or selected fixed cap)
- `passive_skill_ids: [u32; 2]`
- `loadout_revision: u32`
- `updated_at_slot: u64`

Notes:

- Fixed-size slots keep account sizing stable and deterministic for MVP.
- Supports instance-specific loadout evolution over enemy lifetime.

## 4.4 EnemyInstanceLearningStateAccount

**Equivalent of:** `CharacterLearningStateAccount`  
**PDA seeds:** `[b"enemy_instance_learning", enemy_instance_root_pubkey, opponent_bucket_id_u16, page_index_u16]`

Fields:

- `version: u8`
- `opponent_bucket_id: u16`
- `page_index: u16`
- `weights: Vec<SkillWeightEntry>`
- `last_battle_slot: u64`

Where:

- `SkillWeightEntry { skill_id: u32, weight: i16 }`

Notes:

- Captures adaptive behavior per enemy instance.
- Uses **opponent buckets** (not per-player-character keys) to prevent storage explosion.
- Recommended bucket dimensions: player archetype, weapon family, build category, class/role.

## 4.5 EnemyInstanceTelemetrySummaryAccount (optional)

**Equivalent of:** `CharacterTelemetrySummaryAccount`  
**PDA seeds:** `[b"enemy_instance_telemetry", enemy_instance_root_pubkey, season_or_epoch_u32]`

Fields:

- `version: u8`
- `battles: u32`
- `wins: u32`
- `losses: u32`
- `kills: u32`
- `damage_dealt_total: u64`
- `damage_taken_total: u64`
- `skill_usage_counts: Vec<SkillUsageCounter>` (or paged variant)

Optional:

- `SkillUsageCounter { skill_id: u32, count: u32 }`

Notes:

- Optional for MVP; keep only root counters if minimal telemetry is sufficient.

## 4.6 EnemyInstancePresenceAccount (enemy-only)

**No direct character equivalent**  
**PDA seeds:** `[b"enemy_instance_presence", enemy_instance_root_pubkey]`

Fields:

- `version: u8`
- `zone_id: u16`
- `spawn_node_id: u32` (optional)
- `state: u8`
  - `0 = active`
  - `1 = dead`
  - `2 = despawned`
  - `3 = reserved`
- `respawn_at_slot: u64` (optional)
- `last_killed_at_slot: u64` (optional)

Notes:

- Canonical live-world lifecycle state for persistent enemies.
- Determines encounter eligibility and respawn logic boundaries.

## 5) Supporting Registry/Template Accounts

These are global/shared definitions used by enemy instances.

## 5.1 EnemyArchetypeRegistryAccount

**PDA seeds:** `[b"enemy_archetype", enemy_archetype_id_u16]`

Fields:

- `version: u8`
- `enemy_archetype_id: u16`
- `family_id: u16`
- `flags: u32`
- `base_level: u16`
- `hp_base: u32`
- `atk_base: u16`
- `def_base: u16`
- `spd_base: u16`
- `accuracy_bp_base: u16`
- `evade_bp_base: u16`
- `exp_reward_base: u32`
- `drop_table_id: u16`
- `skill_set_id: u16`
- `ai_profile_id: u16`
- `power_rating: u32`
- `updated_at_slot: u64`

Notes:

- Static design template for initialization and validation.
- Never mutated for per-instance adaptation.

## 5.2 EnemySkillSetAccount (optional)

**PDA seeds:** `[b"enemy_skill_set", skill_set_id_u16]`

Fields:

- `version: u8`
- `skill_set_id: u16`
- `active_skill_ids: Vec<u32>`
- `passive_skill_ids: Vec<u32>`
- `flags: u32`

Notes:

- Optional reusable skill-set abstraction to avoid archetype duplication.

## 5.3 EnemyDropTableAccount

**PDA seeds:** `[b"enemy_drop_table", drop_table_id_u16]`

Fields:

- `version: u8`
- `drop_table_id: u16`
- `entries: Vec<DropTableEntry>`

Where:

- `DropTableEntry { item_id: u32, weight_bp: u16 or weight: u32, min_qty: u16, max_qty: u16 }`

Notes:

- Used to validate settlement-time loot claims against bounded reward tables.

## 6) Character ↔ Enemy Account Mapping

### 6.1 Character-equivalent domains

- `CharacterRootAccount` → `EnemyInstanceRootAccount`
- `CharacterStatsAccount` → `EnemyInstanceStatsAccount`
- `CharacterLoadoutAccount` → `EnemyInstanceLoadoutAccount`
- `CharacterLearningStateAccount` → `EnemyInstanceLearningStateAccount`
- `CharacterTelemetrySummaryAccount` → `EnemyInstanceTelemetrySummaryAccount` (optional)

### 6.2 Enemy-only domain

- `EnemyInstancePresenceAccount`

### 6.3 Registry/template side

- `EnemyArchetypeRegistryAccount`
- `EnemySkillSetAccount` (optional)
- `EnemyDropTableAccount`

## 7) Minimal Enemy Account Set for MVP

Required MVP set:

- `EnemyArchetypeRegistryAccount`
- `EnemyInstanceRootAccount`
- `EnemyInstanceStatsAccount`
- `EnemyInstanceLoadoutAccount`
- `EnemyInstanceLearningStateAccount`
- `EnemyInstancePresenceAccount`

Optional/post-MVP:

- `EnemyInstanceTelemetrySummaryAccount`
- `EnemySkillSetAccount`
- `EnemyDropTableAccount` (if loot validation remains off-chain for initial slice)

## 8) Instruction-to-Account Write Matrix (Recommended)

- **Spawn enemy instance**
  - Write: `EnemyInstanceRootAccount`, `EnemyInstanceStatsAccount`, `EnemyInstanceLoadoutAccount`, `EnemyInstancePresenceAccount`
  - Read: `EnemyArchetypeRegistryAccount`, optional `EnemySkillSetAccount`

- **Start encounter validation**
  - Read: `EnemyInstanceRootAccount`, `EnemyInstancePresenceAccount`, `EnemyInstanceStatsAccount`, `EnemyInstanceLoadoutAccount`

- **Settle battle (enemy defeated)**
  - Write: `EnemyInstanceRootAccount` (`body_count`, counters), `EnemyInstancePresenceAccount` (`state`, `last_killed_at_slot`, optional `respawn_at_slot`)
  - Optional write: `EnemyInstanceTelemetrySummaryAccount`
  - Read: `EnemyDropTableAccount`, `EnemyArchetypeRegistryAccount`

- **Settle battle (enemy survived)**
  - Write: `EnemyInstanceRootAccount` (lifetime counters), `EnemyInstanceLearningStateAccount`, optional `EnemyInstanceTelemetrySummaryAccount`

- **Respawn/relocate enemy**
  - Write: `EnemyInstancePresenceAccount`, optional `EnemyInstanceRootAccount.current_zone_id`

## 9) Implementation Sequence

1. Define account structs + PDA derivation constants for root/stats/loadout/presence.
2. Implement deterministic spawn and presence-state transitions.
3. Add learning bucket strategy (`opponent_bucket_id`) and paging constraints.
4. Add settlement hooks for lifetime counters/body count updates.
5. Integrate optional telemetry and drop-table validation.
6. Add migration/versioning notes for future account growth.

## 10) Open Decisions

- Final `enemy_instance_id` width (`[u8; 16]` vs `[u8; 32]`).
- Fixed slot count for active/passive arrays (keeping parity with character 2/2 is recommended for MVP).
- Standardization of `weight_bp` vs wide `weight` in drop entries.
- Policy for when `state = despawned` vs `state = dead` for long-lived world entities.
