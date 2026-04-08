# Character SSOT Adaptation Plan (Aligned to Current Engine)

This revision adapts the Character SSOT to the **current implementation constraints** and calls out what is unsupported.

## Scope requested

From the prior incompatibility set:

1. Data model mismatch (`HIT` vs `accuracyBP/evadeBP` + `hpMax`)
2. Skill catalog mismatch (handle by creating v2 registry docs using current schema)
3. Passive model mismatch (flat-only SSOT vs current conditional-capable engine)
4. Damage formula mismatch (`ATK - DEF` vs current mitigation formula)

This document resolves #1, #3, #4 by recommending SSOT changes, and resolves #2 by proposing a v2 skill registry spec that conforms to current logic.

---

## Current implementation constraints (must prevail)

- Combat snapshot contract currently uses: `hp`, `hpMax`, `atk`, `def`, `spd`, `accuracyBP`, `evadeBP`, `activeSkillIds`, optional `passiveSkillIds`. No `HIT` field exists.
- Skills are resolved using schema: `resolutionMode`, `basePower`, `accuracyModBP`, `cooldownTurns`, `tags`, `appliesStatusIds`, `selfAppliesStatusIds`.
- Valid status IDs are currently: `stunned`, `shielded`, `broken_armor`, `overheated`, `recovering`.
- Damage and hit math are currently:
  - hit chance: `clamp(accuracyBP - evadeBP + accuracyModBP, 500, 9500)`
  - damage: `max(1, floor((basePower + atk) * 100 / (100 + def)))`
- Passives support both flat and conditional modifiers.

---

## 1) Data model adaptation (SSOT change required)

### Why
Your SSOT defines `HIT` as a single stat and does not include `hpMax`, but the engine requires `accuracyBP`, `evadeBP`, and `hpMax` in the canonical combatant contract.

### What should change in Character SSOT

1. Replace stat surface section with:
   - `HP` (runtime current hp)
   - `HP_MAX`
   - `ATK`
   - `DEF`
   - `SPD`
   - `ACC_BP`
   - `EVA_BP`
2. If you want to keep presentation-level `HIT`, treat it as a derived/editor value only, then map to engine fields before simulation.
3. Keep initiative runtime-derived (do not include in canonical input snapshot).

### Refactor assessment

- Code change size: **Medium** (type/schema/docs/API contracts where SSOT is enforced).
- Risk: **Medium** (data migration + balancing due to split hit model).

---

## 3) Passive model adaptation (SSOT change required)

### Why
Current passives can be conditional (e.g., trigger on target HP threshold). SSOT currently forbids conditional passives.

### What should change in Character SSOT

Adopt one of these two explicit policies:

- **Policy A (recommended):** allow conditional passives but only deterministic integer predicates (e.g., target hp below basis points), no randomness.
- **Policy B:** keep flat-only passives for v2 catalog and mark conditional passives as engine capability not used by this balance set.

Either policy must be stated explicitly to avoid spec drift.

### Refactor assessment

- If Policy A: **Low/Medium** cost, **Low** risk (already supported).
- If Policy B: **Low** cost, **Low** risk (content restriction only).

---

## 4) Damage formula adaptation (SSOT change required)

### Why
Current engine damage formula is mitigation-based with `basePower + atk`; SSOT baseline says `ATK - DEF`.

### What should change in Character SSOT

Replace baseline damage section with the current engine formula:

```txt
damage = max(1, floor((basePower + ATK) * 100 / (100 + DEF)))
```

Keep `ATK - DEF` only as historical note, not active rule.

### Refactor assessment

- If SSOT adapts to engine: **Low** cost, **Low** risk.
- If engine changes to SSOT: **Medium** cost, **High** risk (major rebalance + AI score drift).

---

## 2) Skills: v2 registry proposal in current schema

Below is the proposed v2 catalog status under **current resolution logic**.

### Legend
- **Supported**: can be represented exactly with current skill schema + status model.
- **Supported with revision**: close, but text/effects must be rewritten to match current model.
- **Not supported**: cannot be represented without engine changes; current implementation should prevail.

| Skill | SSOT intent | Support status | Why |
|---|---|---|---|
| Strike | DMG `ATK + 5` | Supported with revision | Represent as `attack` + tuned `basePower`; exact additive text replaced by formula-based damage. |
| Guard | `+5 DEF` buff | Not supported | No direct temporary DEF stat buff in skill effects; only status-based multipliers currently. |
| Break | `-5 DEF` enemy | Not supported | No direct temporary enemy DEF reducer; `broken_armor` is damage-taken multiplier, not DEF stat change. |
| Pulse | DMG `ATK + 8` | Supported with revision | Same as Strike: tunable via `basePower`. |
| Mend | HOT heal/turn | Supported with revision | Can map to self status apply (`recovering`), but current tick/duration values differ. |
| Wither | DOT dmg/turn | Supported with revision | Can map to target status apply (`overheated`), but current values differ. |
| Overdrive | self `+ATK` and `-DEF` | Not supported | Multi-stat temporary self modifier is not modeled by current skill effect schema. |
| Cleave | DMG + accuracy penalty this action | Supported | `attack` skill with tuned `basePower` and negative `accuracyModBP`. |
| Shatter | enemy `-DEF` | Not supported | Same limitation as Break. |
| Fortify | self `+DEF` | Not supported | Same limitation as Guard. |
| Crush | DMG `ATK + DEF/2` | Not supported | Dynamic formula terms from actor DEF are not expressible in scalar `basePower`. |
| Reinforce | HOT heal/turn | Supported with revision | Same mapping limits as Mend. |
| Velocity | DMG `ATK + SPD/2` | Not supported | Dynamic SPD-based scaling is not expressible in scalar `basePower`. |
| Bleed | DOT dmg/turn | Supported with revision | Map to `overheated`; values/duration require SSOT revision or new status defs. |
| Surge (SSOT) | `+15 SPD` buff | Not supported | No temporary SPD buff effect path in skill schema. |
| Flicker | `+120 initiative` self | Not supported | No utility path to directly modify initiative from skill execution. |

### Proposed v2 skill registry shape (doc-level)

Use current `SkillDef` fields only:

- `skillId`, `skillName`, `resolutionMode`, `basePower`, `accuracyModBP`, `cooldownTurns`, `tags`, `appliesStatusIds`, `selfAppliesStatusIds`

For unsupported skills above, either:
1. replace with supported equivalents using existing statuses/formulas, or
2. keep as future backlog requiring explicit engine feature work.

---

## Character classes/archetypes: implementation assessment

### Current state

- Combat contract does not currently enforce class/archetype identity in `CombatantSnapshot`.
- AI context supports optional `archetypeId`, so the concept exists but is not canonical at the shared combat DTO boundary.

### What should change

1. Add optional then required `archetypeId` to `CombatantSnapshot` with enum/string-union values (e.g., `Balanced`, `High_ATK`, `High_DEF`, `High_SPD`).
2. Add class-to-archetype mapping in shared types or config (`Meridian/Raze/Bulwark/Swift`).
3. Validate loadout rules by archetype (allowed active/passive IDs).
4. Use `archetypeId` as the deterministic hook for AI priors and balancing tables.

### Refactor assessment

- Type/API change: **Low/Medium**.
- Validation + content wiring: **Medium**.
- Runtime risk: **Low/Medium** (mostly contract and registry wiring, not core battle loop).

---

## Recommended next decision

If you want minimal disruption, adopt this order:

1. Update SSOT text to engine-aligned stat/hit/damage rules (#1, #4).
2. Freeze passive policy explicitly (#3 Policy A or B).
3. Publish v2 registry with only supported skills; mark unsupported skills as backlog.
4. Add `archetypeId` to canonical combat snapshot and class-loadout validation.

