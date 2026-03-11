# Fix Plan: CombatantSnapshot Type Divergence (Review Findings Entry 1)

## Status

This document captures clarified decisions and the implementation plan for fixing **Entry 1** in `docs/review-findings.md`.

Scope is intentionally minimal and documentation-first for this pass.

---

## Confirmed Decisions (from clarification)

1. **Canonical strategy**: Use **Option A** — one shared canonical `CombatantSnapshot` in `types/combat.ts`.
2. **Scope level**: Minimal, Entry 1 only.
3. **Canonical name**: Keep **`CombatantSnapshot`** as the single final shared type name.
   - Transitional prefixes (`Engine*`, `Domain*`) only if needed during implementation.
4. **Type ownership location**: Shared type layer.
5. **Legacy aliases**: Do **not** keep aliases. Remove legacy duplicates fully.
6. **`entityId` canonical type**: `string`.
7. **ID conversion rule**: Parse numeric strings where conversion is required.
8. **Invalid ID conversion behavior**: Reject invalid values.
9. **`initiative` ownership**: Runtime-derived (not part of canonical input snapshot).
10. **`side` / `name`**: Engine-ignored metadata.
11. **`activeSkillIds` / `passiveSkillIds`**: Move into canonical shared snapshot.
12. **Adapters**: Do not introduce adapters in this task.
13. **API route**: Keep existing validation approach for now (no DTO refactor in this task).
14. **Breaking changes**: Allowed.
15. **Deprecation/migration guidance**: Yes, include migration checklist.
16. **Tests**: No test implementation now; provide test plan only (compile, unit, integration coverage plan).
17. **Output location**: This document (`docs/fix-combatant-snapshot-type-divergence.md`).
18. **Commit strategy**: Single commit.

---

## Problem Context

There are currently two incompatible `CombatantSnapshot` definitions:

- `types/combat.ts` currently defines a shared snapshot with `entityId: number`, and includes fields like `side`, `name`, and `initiative`.
- `engine/battle/battleEngine.ts` defines its own snapshot with `entityId: string`, plus engine-executed loadout fields like `activeSkillIds` and optional `passiveSkillIds`.

This divergence creates name collision, semantic drift risk, and cross-module integration friction.

---

## Target End State

A **single shared canonical** `CombatantSnapshot` in `types/combat.ts` that is suitable for engine input and removes duplicate type definitions.

### Canonical Snapshot Shape (target)

- `entityId: string`
- Core stat fields used by engine:
  - `hp`, `hpMax`, `atk`, `def`, `spd`, `accuracyBP`, `evadeBP`
- Skill fields used by engine:
  - `activeSkillIds: [string, string]`
  - `passiveSkillIds?: [string, string]`
- Optional/metadata fields allowed but not required for engine logic:
  - `side?`, `name?` (engine ignored)
- `initiative` is **not** part of the canonical snapshot (runtime-derived only).

---

## Detailed Implementation Plan (high-level, file-by-file)

## 1) `types/combat.ts`

### Planned changes
- Replace current `CombatantSnapshot` definition with the canonical shared shape above.
- Change `entityId` from `number` to `string`.
- Remove `initiative` from the shared snapshot interface.
- Add `activeSkillIds` and `passiveSkillIds` to shared snapshot.
- Keep `side` and `name` as engine-ignored metadata (optional).
- Update related shared types that currently use numeric entity IDs and should align with canonical combatant identity semantics (e.g., `ActiveStatus.sourceEntityId`) to keep internal consistency with `string` IDs.
- Add migration/deprecation note comments in this file where appropriate (for removed assumptions like numeric IDs and snapshot-level initiative).

### Why
- Establishes one source-of-truth type.
- Eliminates cross-module type divergence.
- Aligns shared type with active simulation usage and payload identity semantics.

---

## 2) `engine/battle/battleEngine.ts`

### Planned changes
- Remove local `CombatantSnapshot` type definition.
- Import shared `CombatantSnapshot` from `types/combat.ts`.
- Keep runtime-only `initiative` on runtime entity type only.
- Ensure helper functions (`cloneEntity`, cooldown initialization, etc.) type-check against shared canonical snapshot.
- If temporary renaming is needed while editing (to avoid local collisions), use it only during transition and remove before final state.

### Why
- Prevents duplicate type ownership.
- Keeps runtime derivations (initiative, cooldowns, statuses) in engine runtime state, not input contract.

---

## 3) `app/api/combat/route.ts`

### Planned changes
- Keep current validation strategy (as requested).
- Update imports if required by type relocation/use changes.
- Verify runtime shape checks still match canonical fields after unification.
- Do not introduce DTO schema versioning or adapter layer in this task.

### Why
- Maintains requested minimal scope while preserving behavior.

---

## 4) Documentation updates

### Planned changes
- Add brief migration notes near touched type definitions and/or in comments where legacy assumptions are removed.
- Ensure reviewers can see that Entry 1 resolution is intentional and canonical strategy is explicit.

### Why
- Makes future changes less error-prone.
- Avoids re-introduction of competing snapshot definitions.

---

## Migration Checklist

- [ ] Replace shared `CombatantSnapshot` in `types/combat.ts` with canonical unified shape.
- [ ] Remove engine-local `CombatantSnapshot` in `engine/battle/battleEngine.ts`.
- [ ] Import and use shared `CombatantSnapshot` inside engine.
- [ ] Remove snapshot-level `initiative` from shared contract and keep it runtime-derived only.
- [ ] Update ID-related shared types to align with canonical string entity IDs where needed.
- [ ] Confirm API route validation still aligns with canonical fields (no API contract redesign yet).
- [ ] Add deprecation/migration comments for removed assumptions.
- [ ] Run compile/type check.
- [ ] Execute targeted battle-engine and API checks.

---

## Test Plan (plan only; not implemented in this pass)

### Compile coverage
- Type-check whole project to catch all callsites expecting numeric `entityId` or snapshot-level `initiative`.

### Unit coverage
- Validate battle engine helpers still accept canonical snapshot fields and preserve optional `passiveSkillIds` behavior.
- Validate validation guard behavior for canonical fields in API route.

### Integration coverage
- POST `/api/combat` with canonical payload and verify successful simulation.
- Negative-case request(s) for invalid IDs/non-canonical shapes to verify rejection behavior remains strict where applicable.

---

## Non-goals (explicitly out of scope for this fix)

- Introducing adapter layer functions.
- Refactoring API route to DTO + mapping architecture.
- Introducing schema libraries (zod/json-schema).
- Broad legacy-type cleanup beyond Entry 1 minimal scope.
- Implementing new tests in this pass (plan only).

---

## Risks and Mitigations

- **Risk**: Hidden consumers assume numeric entity IDs.
  - **Mitigation**: Compile/type-check and update affected shared ID fields consistently.
- **Risk**: Partial migration leaves mixed contracts.
  - **Mitigation**: Remove engine-local duplicate type entirely in same change.
- **Risk**: Engine/runtime semantics accidentally leak into shared snapshot again.
  - **Mitigation**: Keep explicit comments that `initiative` is runtime-derived.
