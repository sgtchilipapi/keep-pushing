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

- [x] Replace shared `CombatantSnapshot` in `types/combat.ts` with canonical unified shape.
- [x] Remove engine-local `CombatantSnapshot` in `engine/battle/battleEngine.ts`.
- [x] Import and use shared `CombatantSnapshot` inside engine.
- [x] Remove snapshot-level `initiative` from shared contract and keep it runtime-derived only.
- [x] Update ID-related shared types to align with canonical string entity IDs where needed.
- [x] Confirm API route validation still aligns with canonical fields (no API contract redesign yet).
- [x] Add deprecation/migration comments for removed assumptions.
- [x] Run compile/type check.
- [x] Execute targeted battle-engine and API checks.

---

## Testing Plan (plan only; not implemented in this pass)

The goal of this plan is to verify that **all affected contracts now match the canonical shared `CombatantSnapshot`** and that mismatched legacy assumptions are rejected.

### 1) Compile/type-check coverage (project-wide)

1. **Global TypeScript compile check**
   - **Should**: project compiles with `CombatantSnapshot.entityId` as `string`, no references to snapshot-level `initiative`, and no stale imports of engine-local snapshot type.
   - **Actual check**: run full TypeScript type-check for the repo.

2. **Type-level usage audit for changed identity semantics**
   - **Should**: callsites that consume entity IDs from shared combat types treat IDs as `string` consistently.
   - **Actual check**: compile catches remaining `number` assumptions and any incompatible assignments.

3. **Type-level usage audit for runtime-only initiative ownership**
   - **Should**: only runtime engine state carries `initiative`; shared snapshot users must not require it.
   - **Actual check**: compile fails if any shared snapshot construction/consumption still expects `initiative`.

### 2) Unit tests — shared type and engine behavior

4. **Engine input acceptance with canonical snapshot (baseline positive)**
   - **Should**: battle engine accepts snapshots containing required canonical fields, including `activeSkillIds` and optional metadata (`side`, `name`).
   - **Actual check**: construct canonical snapshots and assert battle execution initializes entities correctly.

5. **Optional `passiveSkillIds` handling (present vs omitted)**
   - **Should**: both shapes work:
     - with `passiveSkillIds` present,
     - with `passiveSkillIds` omitted.
   - **Actual check**: assert runtime cooldown/effect setup remains valid in both variants.

6. **Skill tuple shape enforcement (negative)**
   - **Should**: malformed skill arrays (wrong length/type) are not accepted where shape checks exist.
   - **Actual check**: feed invalid shapes via tested boundary (API validation and/or guarded constructors) and assert rejection path.

7. **No dependence on snapshot-level `initiative` (negative regression)**
   - **Should**: engine helpers do not read `initiative` from input snapshot.
   - **Actual check**: run engine setup tests with canonical snapshots lacking `initiative`; assert no crash and deterministic runtime initiative derivation behavior.

8. **Entity ID string semantics in core flows**
   - **Should**: engine lookup/event attribution continues to work when IDs are strings.
   - **Actual check**: assert status/source references and event entity linkage use string IDs without coercion bugs.

### 3) Unit tests — API request validation behavior

9. **Canonical request payload accepted (positive)**
   - **Should**: `POST /api/combat` request with canonical snapshot fields passes validation.
   - **Actual check**: assert non-error response and simulation output presence.

10. **Legacy numeric `entityId` rejected (negative)**
    - **Should**: payloads using numeric `entityId` fail validation (or are rejected by guard path) per canonical `string` contract.
    - **Actual check**: submit numeric IDs and assert 4xx with validation error details.

11. **Invalid string ID rejected (negative)**
    - **Should**: IDs that violate accepted format/conversion requirements are rejected.
    - **Actual check**: submit malformed ID values and assert 4xx rejection.

12. **Missing required canonical fields rejected (negative)**
    - **Should**: requests missing required stats or `activeSkillIds` fail validation.
    - **Actual check**: table-driven invalid payload cases asserting 4xx with field-specific errors.

13. **`initiative` supplied by client is ignored or rejected per route behavior**
    - **Should**: because initiative is runtime-derived, client-provided snapshot-level initiative must not become required behavior.
    - **Actual check**: send payload with extra `initiative`; assert route behavior is explicit and stable (either ignored safely or rejected intentionally).

### 4) Integration tests — end-to-end behavior

14. **End-to-end combat simulation with canonical snapshots (positive)**
    - **Should**: full API-to-engine flow succeeds and produces expected round/event structure using string IDs.
    - **Actual check**: submit representative canonical battle request and assert response shape plus non-empty deterministic event timeline invariants.

15. **End-to-end failure on mixed-schema payload (negative)**
    - **Should**: payloads combining legacy/shared-old assumptions (e.g., numeric IDs + snapshot initiative reliance) do not silently pass.
    - **Actual check**: submit mixed-schema request and assert failure response with clear validation diagnostics.

16. **Backward-compatibility guardrail test (intentional break confirmation)**
    - **Should**: tests explicitly document that legacy snapshot shape is no longer accepted, matching "breaking changes allowed" decision.
    - **Actual check**: add a named regression test proving old-shape payload fails, preventing accidental reintroduction.

### 5) Suggested execution order (when implementing tests)

1. Add/adjust compile test gate first (fastest signal for migration completeness).
2. Add engine unit tests for canonical snapshot + initiative/runtime ownership.
3. Add API validation unit tests (positive + negative matrix).
4. Add end-to-end API integration tests.
5. Run full test suite and type-check together before merge.

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
