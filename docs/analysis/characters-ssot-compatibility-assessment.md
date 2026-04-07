# Character SSOT Compatibility Assessment (Current Engine)

This assessment compares the proposed Character SSOT to the **current battle implementation**.

## Executive summary

The SSOT is **not directly compatible** with the current implementation. The largest incompatibilities are:

1. Data model mismatch (`HIT` vs `accuracyBP/evadeBP`, plus extra `hpMax`).
2. Skill catalog mismatch (SSOT skills/classes do not exist in registry).
3. Passive model mismatch (SSOT flat-only passives vs current support for conditional passives).
4. Formula mismatch (SSOT damage baseline `ATK - DEF` vs current mitigation formula).

All of these are refactorable, but introducing the SSOT as-is is a **medium/high-risk gameplay migration** unless done behind versioned registries.

## Current implementation baseline (evidence)

- Combat snapshot currently uses `hp`, `hpMax`, `atk`, `def`, `spd`, `accuracyBP`, `evadeBP`, two active skills, and optional two passives. There is no `HIT` stat field. (`types/combat.ts`).
- Skill system is registry-driven with hardcoded IDs `1000-1005` and names: Basic Attack, Volt Strike, Finishing Blow, Surge, Barrier, Repair (`engine/battle/skillRegistry.ts`).
- Status system supports exactly: `stunned`, `shielded`, `broken_armor`, `overheated`, `recovering` (`engine/battle/statuses/statusRegistry.ts`).
- Passive system supports both flat modifiers and conditional modifiers (for example `target_hp_below_bp`) (`engine/battle/passiveRegistry.ts`, `engine/battle/applyPassives.ts`).
- Damage currently uses `floor((skill.basePower + atk) * 100 / (100 + def))`, with minimum 1 (`engine/battle/resolveDamage.ts`).

## Incompatibility matrix and estimated refactor cost/risk

| SSOT item | Compatibility with current code | Why incompatible (current behavior) | Refactor cost | Refactor risk |
|---|---|---|---|---|
| Base/derived stat naming (`baseHP`→`HP`, etc.) | **Incompatible** | Runtime and DTO use lowercase live combat stats, no base-to-derived layer, and use `accuracyBP/evadeBP` not `HIT`. | **Medium** | **Medium** |
| Stat surface locked to `HP/ATK/DEF/SPD/HIT` only | **Incompatible** | Current surface includes `hpMax` and separate hit components (`accuracyBP`,`evadeBP`). | **Medium** | **Medium** |
| Hit rule `roll <= HIT` | **Partially incompatible** | Current hit uses `accuracyBP - evadeBP + skill accuracy mod`, clamped to `[500,9500]`, then `roll<=chance`. | **Low/Medium** | **Medium** |
| Damage baseline `ATK - DEF` min 1 | **Incompatible** | Current formula is defense-mitigation scaling with `basePower` contribution. | **Medium** | **High** (major rebalance) |
| 4 archetypes + world labels | **Partially compatible** | `archetypeId` exists in AI context, but not enforced as SSOT class map in combat contracts. | **Low** | **Low** |
| Global/class skill catalogs (16 active skills total) | **Incompatible** | Registry currently contains 6 fixed skills with different semantics/tags/status bindings. | **High** | **High** |
| Skill categories (`DMG/BUFF/DEBUFF/HOT/DOT/UTILITY`) | **Incompatible** | Current system models behavior via `resolutionMode`, `tags`, status application arrays; no category enum. | **Medium** | **Medium** |
| Multi-effect skills (e.g., Overdrive +ATK/-DEF) | **Incompatible** | No direct per-skill transient stat bundle; effects are represented through statuses/passives. | **Medium/High** | **Medium/High** |
| Formula skills (`ATK + DEF/2`, `ATK + SPD/2`) | **Partially incompatible** | Technically possible, but current skill def only has scalar `basePower`; would need formula hooks/expressions. | **Medium** | **Medium** |
| Flicker `+120 initiative` self utility | **Incompatible** | No mechanism for utility skill to add initiative directly; utility currently applies statuses only. | **Medium** | **Medium** |
| Cooldowns/durations in SSOT values | **Partially compatible** | Engine supports both cooldowns and status durations, but many values differ from SSOT and are currently hardcoded in registries. | **Low/Medium** | **Low/Medium** |
| No stacking; refresh duration only | **Compatible** | `applyStatus` refreshes by setting remaining turns to max(current, base duration) and does not stack duplicates. | **Low** | **Low** |
| Flat-only passives, no conditional passives | **Incompatible by policy** | Implementation currently allows conditional passives (e.g., execution window accuracy bonus). | **Low/Medium** | **Low** |
| Common/class passive catalog (7 passives) | **Incompatible** | Registry currently defines only 2 passives with different identities/effects. | **Medium** | **Medium** |
| Initiative: +SPD, action cost 100 | **Compatible** | This matches current initiative loop behavior. | **Low** | **Low** |

## Suggested migration path (risk reduction)

1. **Introduce `combatRulesVersion` (v1 current, v2 SSOT)** at input boundary and event metadata.
2. **Add v2 registries** (`skillRegistry.v2.ts`, `passiveRegistry.v2.ts`, status mapping) rather than replacing in place.
3. **Add a stat adapter** for v2 (`HIT` -> internal accuracy model) or migrate all internals to strict `HIT`.
4. **Gate formula differences** (damage, hit, initiative utility effects) behind version-specific resolver modules.
5. **Dual-run deterministic snapshot tests** for v1/v2 to verify no regressions in existing battles.
6. **Switch default to v2** only after telemetry + fixture parity.

## Recommended cost/risk rollup

- **If done as in-place replacement:** cost **High**, risk **High**.
- **If done as versioned migration:** cost **High**, risk **Medium**.
- **Most volatile area:** battle balance and AI scoring behavior after formula/catalog changes.
