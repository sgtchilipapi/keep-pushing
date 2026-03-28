# Unified Solana Data Architecture for MVP Battle Outcome Validation

## 1) Scope and Goal

This document unifies:

- `docs/solana-playable-character-data-architecture-plan.md`
- `docs/solana-enemy-data-architecture-plan.md`

for a single MVP objective:

> Validate off-chain server battle outcomes on-chain with deterministic, anti-fraud checks and minimal account surface area.

The key product question addressed here is:

- Which accounts are truly required now?
- Which existing documented accounts are not required for MVP?
- Which required accounts are currently missing from the two architecture docs?

---

## 2) MVP Trust Model (Explicit)

For this MVP, the battle simulation remains off-chain and server-authoritative, but settlement is accepted on-chain only if:

1. The settlement instruction is signed by the player authority for the character.
2. The settlement payload is authorized by a trusted server signer (or signer set) configured on-chain.
3. The claimed battle is possible from current on-chain world state.
4. Reward/progression deltas are bounded by on-chain registries.
5. The exact settlement cannot be replayed.

This gives practical anti-cheat guarantees without requiring full on-chain simulation.

---

## 3) Unified Account Inventory by MVP Status

## 3.1 Required in MVP (must implement now)

### Character-side mutable accounts

1. **CharacterRootAccount** (existing docs)  
   Purpose: authority binding, level/exp anchor, status flags.

2. **CharacterStatsAccount** (existing docs)  
   Purpose: deterministic stat bounds for sanity checks and level-up recalculation.

3. **CharacterLoadoutAccount** (existing docs)  
   Purpose: optional but strongly recommended to verify settlement references current legal loadout revision.

4. **CharacterWorldProgressAccount** (existing docs)  
   Purpose: fast zone gating summary and progression updates.

5. **CharacterZoneProgressPageAccount** (existing docs)  
   Purpose: canonical per-zone access/cleared state used for zone eligibility checks.

### Global/static validation registries

6. **ZoneRegistryAccount** (existing docs)  
   Purpose: zone definition and prerequisite metadata.

7. **ZoneEnemySetAccount** (existing docs)  
   Purpose: validate enemy claimed for a zone.

8. **EnemyArchetypeRegistryAccount** (existing docs)  
   Purpose: reward bounds and enemy identity checks.

### **Missing but required** for secure off-chain outcome ingestion

9. **ProgramConfigAccount** (**missing in existing docs**)  
   PDA seeds: `[b"program_config"]`  
   Purpose:
   - stores admin authority,
   - stores server signer(s) allowed to attest battle outcome payloads,
   - stores pause/version policy flags.

   Suggested fields:
   - `version: u8`
   - `bump: u8`
   - `admin_authority: Pubkey`
   - `server_signer_set_hash: [u8; 32]` or fixed array of signer pubkeys
   - `settlement_paused: bool`
   - `min_settlement_slot: u64` (optional circuit breaker)
   - `updated_at_slot: u64`

10. **CharacterSettlementNonceAccount** (**missing in existing docs**)  
    PDA seeds: `[b"character_settlement_nonce", character_root_pubkey]`  
    Purpose: replay protection and deterministic ordering/idempotency.

    Suggested fields:
    - `version: u8`
    - `last_nonce: u64` (monotonic)
    - `last_settlement_slot: u64`
    - `last_settlement_hash: [u8; 32]` (optional)

11. **BattleReceiptAccount (paged or hash-indexed)** (**missing in existing docs, required for strong anti-replay/audit**)  
    PDA seeds option A: `[b"battle_receipt", character_root_pubkey, nonce_u64]`  
    PDA seeds option B (space-efficient paging): `[b"battle_receipt_page", character_root_pubkey, page_index_u16]`  
    Purpose:
    - marks settlement payload hash as consumed,
    - enables idempotent retries (same payload = no double rewards),
    - provides auditability for disputes.

    Suggested minimal fields:
    - `version: u8`
    - `character_root: Pubkey`
    - `nonce: u64`
    - `battle_hash: [u8; 32]`
    - `zone_id: u16`
    - `enemy_archetype_id: u16`
    - `outcome: u8`
    - `exp_granted: u32`
    - `settled_at_slot: u64`

---

## 3.2 On hold (not required for MVP settlement validation)

### Character accounts

- **CharacterUnlocksAccount** (on hold unless settlement grants skill unlocks immediately).
- **CharacterInventoryAccount** (on hold unless loot minting/item grants are in MVP).
- **CharacterLearningStateAccount** (on hold; can remain off-chain initially).
- **CharacterTelemetrySummaryAccount** (optional analytics only).

### Enemy-instance accounts from enemy architecture doc

The following are **not required** for the specific MVP goal of validating outcome settlement for zone/archetype encounters:

- **EnemyInstanceRootAccount**
- **EnemyInstanceStatsAccount**
- **EnemyInstanceLoadoutAccount**
- **EnemyInstanceLearningStateAccount**
- **EnemyInstanceTelemetrySummaryAccount**
- **EnemyInstancePresenceAccount**
- **EnemySkillSetAccount**
- **EnemyDropTableAccount** (on hold if no on-chain loot yet)

Reason: MVP validation can operate against zone→archetype mappings plus archetype reward bounds without persistent enemy-instance lifecycle state.

---

## 3.3 Optional now, easy later

- **EnemyDropTableAccount** if item drops must be validated on-chain in MVP+1.
- **CharacterUnlocksAccount** if unlock progression must be settled in same transaction family.
- **CharacterInventoryAccount** when moving to on-chain inventory.
- **EnemyInstancePresenceAccount** only when open-world persistent enemies become an on-chain source of truth.

---

## 4) Direct Answers to Product Questions

## 4.1 Are all accounts in existing docs needed for MVP?

**No.** A large portion are growth/future-state domains (inventory, learning, telemetry, persistent enemy instances). MVP settlement validation needs only character core + world progression + zone/enemy registries + new auth/replay-protection accounts.

## 4.2 Are all necessary accounts included in existing docs?

**No.** The two critical gaps for secure off-chain outcome ingestion are:

1. **ProgramConfigAccount** for server attestor/key governance.
2. **Replay-protection state** (`CharacterSettlementNonceAccount` and/or `BattleReceiptAccount`).

Without these, a valid-looking server payload can be replayed or signer trust cannot be managed safely on-chain.

---

## 5) Canonical MVP Settlement Instruction Contract

## 5.1 Instruction: `ApplyBattleSettlementV1`

Inputs (payload signed by trusted server signer):

- `character_id`
- `nonce` (monotonic per character)
- `battle_hash` (hash of deterministic off-chain battle transcript summary)
- `zone_id`
- `enemy_archetype_id`
- `outcome` (`win`/`lose`)
- `exp_gained`
- `server_signed_at_slot` or timestamp domain field
- optional `loadout_revision`

Accounts:

- signer: `player_authority`
- read: `ProgramConfigAccount`
- write: `CharacterRootAccount`
- write: `CharacterStatsAccount` (if level/stat changes)
- read/write: `CharacterWorldProgressAccount`
- read/write: `CharacterZoneProgressPageAccount`
- read: `ZoneRegistryAccount(zone_id)`
- read: `ZoneEnemySetAccount(zone_id)`
- read: `EnemyArchetypeRegistryAccount(enemy_archetype_id)`
- read/write: `CharacterSettlementNonceAccount`
- write: `BattleReceiptAccount` (or receipt page)
- optional read: `CharacterLoadoutAccount`

---

## 6) Validation Sequence (MVP Final)

1. **Derivation + ownership checks**
   - verify all PDAs and authority links.

2. **Program-level checks**
   - reject if paused,
   - verify trusted server signature against `ProgramConfigAccount` signer set.

3. **Replay protection**
   - require `nonce > last_nonce`,
   - reject if `battle_hash` already consumed (receipt lookup/page scan strategy).

4. **World eligibility**
   - from `CharacterZoneProgressPageAccount`, ensure zone is unlocked.

5. **Zone/enemy consistency**
   - ensure `enemy_archetype_id` exists in `ZoneEnemySetAccount(zone_id)`.

6. **Reward sanity**
   - check `exp_gained` against `EnemyArchetypeRegistryAccount` bounds/policy.

7. **Optional loadout consistency**
   - if payload includes `loadout_revision`, require equality to current `CharacterLoadoutAccount.loadout_revision`.

8. **Apply state transitions**
   - update EXP/level/stats,
   - apply zone clear/unlock transitions,
   - bump root/world timestamps.

9. **Persist replay guards**
   - update `CharacterSettlementNonceAccount.last_nonce`,
   - write `BattleReceiptAccount` record.

---

## 7) Minimal Account Set for MVP Build Ticketing

Implement now:

1. `CharacterRootAccount`
2. `CharacterStatsAccount`
3. `CharacterLoadoutAccount` (recommended-now)
4. `CharacterWorldProgressAccount`
5. `CharacterZoneProgressPageAccount`
6. `ZoneRegistryAccount`
7. `ZoneEnemySetAccount`
8. `EnemyArchetypeRegistryAccount`
9. `ProgramConfigAccount` (**new**)
10. `CharacterSettlementNonceAccount` (**new**)
11. `BattleReceiptAccount` (**new**)

Everything else: move to backlog unless directly required by an already-committed MVP player loop.

---

## 8) Migration/Phasing Update (Unified)

### Phase A (immediate)

- Freeze schema/seeds for the 11-account MVP set above.
- Implement `ApplyBattleSettlementV1` with all checks in section 6.

### Phase B

- Add inventory + drop table settlement if loot becomes in-scope.

### Phase C

- Add learning-state on-chain persistence if anti-tamper requirements extend to adaptation.

### Phase D

- Introduce persistent enemy-instance accounts only when world-presence/stateful enemies are chain-tracked requirements.

---

## 9) Non-Negotiable Invariants for MVP Acceptance

1. No settlement without valid player authority + trusted server attestation.
2. No settlement replay for the same nonce/hash.
3. No battle claim in locked zone.
4. No enemy claim outside the zone’s enemy set.
5. No reward inflation beyond archetype policy.
6. All mutable writes are confined to minimum required accounts.

