# Fix Plan: Shared Type Layer Unification (Review Findings Entry 2)

## Status

This document captures clarified decisions and the implementation plan for fixing **Entry 2** in `docs/review-findings.md`.

Scope for this pass is **documentation/plan only**. No production code changes are included in this pass.

---

## Decision Log (locked via clarification)

| Decision Area | Locked Decision |
|---|---|
| Delivery mode | Documentation/plan only |
| Scope | Entry 2 focused, but implementation plan may touch related files needed for correctness |
| Compatibility | Breaking changes are allowed |
| Canonical ownership | Shared contracts under `/types` are canonical |
| File layout | Keep existing files (`types/combat.ts`, `types/battle.ts`) |
| Schema strategy | Single canonical schema family |
| Duplicate divergent types outside `/types` | Remove (hard cut) |
| Naming strategy | No new parallel naming families; unify in shared `/types` |
| Event key standardization | Yes, normalize keys |
| Entity ID type | `string` everywhere in canonical schema family |
| Preserve legacy useful fields/events/results | Preserve (after normalization) |
| Internal-only engine fields | Exclude runtime/bookkeeping/debug internals from shared public contracts |
| API DTOs | Leave untouched unless blocked |
| Architecture docs | Update `docs/review-findings.md` + `docs/SSOT.md`; do not update `docs/ai-decision-design-trajectory.md` |
| Rollout model | One-shot migration |
| Testing in this task | Test plan only (no implementation) |
| Verification bar (when implementing) | Full test suite |
| Legacy-negative coverage | Yes, include tests proving legacy schema usage fails |
| Commit strategy | Single commit |

---

## Context and Problem Restatement

Entry 2 identifies that `types/combat.ts` and `types/battle.ts` can appear to represent a parallel/legacy schema family when compared to engine-local event naming and payload structures.

Current state observations:

1. `types/combat.ts` now reflects Entry 1 decisions (canonical `CombatantSnapshot`, `entityId: string`, runtime-derived initiative excluded), which is aligned with shared ownership expectations.
2. `types/battle.ts` still uses event payload keys that differ from engine event keys (`actorEntityId` vs `actorId`, `targetEntityId` vs `targetId`, `roll` vs `rollBP`, `sourceEntityId` vs `sourceId`, etc.).
3. `engine/battle/battleEngine.ts` defines its own `BattleEvent` union with different key conventions and some semantic differences (`BATTLE_END` carries `reason`; `DEATH` uses `entityId`).

The resulting risk is less about one field and more about *schema authority ambiguity*: multiple valid-looking event contracts increase accidental misuse, review burden, and drift probability.

---

## Canonical Contract Direction

### Canonical owner
- The canonical battle/combat schema family should live under `/types`.

### Canonical shape policy
- Preserve current useful surface area (events/result semantics), but normalize field names to one convention.
- Use `string` entity IDs everywhere in canonical contracts.
- Keep engine-internal runtime/bookkeeping/debug fields out of shared public contracts.

### Enforcement posture
- One-shot migration and hard cut of duplicate divergent definitions outside `/types`.
- No temporary aliasing layer.

---

## Comparison Matrix (what changes and why)

## A) Event key normalization candidates

| Event | Existing in `types/battle.ts` | Existing in engine | Proposed canonical in `/types` | Why |
|---|---|---|---|---|
| `STUNNED_SKIP` | `actorEntityId` | `actorId` | `actorId` | Align with active engine naming and reduce suffix noise |
| `ACTION` | `actorEntityId`, `targetEntityId` | `actorId`, `targetId` | `actorId`, `targetId` | Consistent actor/target vocabulary |
| `HIT_RESULT` | `actorEntityId`, `targetEntityId`, `roll` | `actorId`, `targetId`, `rollBP` | `actorId`, `targetId`, `rollBP` | Clarify basis-point unit and align naming |
| `DAMAGE` | `actorEntityId`, `targetEntityId` | `actorId`, `targetId` | `actorId`, `targetId` | Consistency with all actor-target events |
| `STATUS_APPLY`/`STATUS_REFRESH` | `sourceEntityId`, `targetEntityId` | `sourceId`, `targetId` | `sourceId`, `targetId` | Canonical short IDs and consistency |
| `STATUS_EXPIRE` | `targetEntityId` | `targetId` | `targetId` | Consistency |
| `DEATH` | `targetEntityId` | `entityId` | `entityId` | Better represents single subject |
| `BATTLE_END` | `winnerEntityId`, `loserEntityId` | `winnerEntityId`, `reason` | Preserve useful fields, normalize contract | Keep useful outputs while reconciling semantics |

## B) Internal-only exclusion candidates (explicit)

These are **not** to be exposed as shared public type contract fields unless explicitly required by API/UI contract:

1. Runtime initiative counters and scheduling internals.
2. Mutable cooldown bookkeeping maps/counters.
3. Mutable status storage implementation details.
4. Resolver-local temporary flags and intermediate combat math state.
5. Debug-only / trace-only metadata not required by stable consumers.

---

## Detailed One-Shot Implementation Plan (for subsequent code pass)

## 1) `types/battle.ts` — unify as canonical battle event and result contract

### Planned changes
1. Normalize event payload key names to canonical forms (table above).
2. Keep event coverage preserved (do not drop currently useful events).
3. Reconcile `BATTLE_END` shape to preserve useful outcome data while standardizing semantics.
4. Preserve `BattleResult` as canonical shared output contract and align its event array to the normalized event union.
5. Add migration comments for renamed keys (short-lived comments to aid migration reviewers).

### Why
- Establishes one obvious source of truth for battle event contracts.
- Removes accidental dual-schema interpretation.

---

## 2) `engine/battle/battleEngine.ts` — consume canonical shared `BattleEvent` contract

### Planned changes
1. Remove or stop exporting divergent engine-local `BattleEvent` union.
2. Import and use canonical `BattleEvent` from `types/battle.ts`.
3. Update event emission sites to match normalized canonical keys.
4. Keep runtime-only fields/types internal (no leakage into shared contracts).

### Why
- Hard-cuts duplicate out-of-`/types` event contracts.
- Prevents re-divergence by type-checking event emission against shared canonical union.

---

## 3) Related callsites (touch as needed to keep build green)

### Planned changes
1. Update any consumers expecting old key names (`*EntityId`, `roll`) to normalized names.
2. Keep API DTO contract untouched unless strict type blocking occurs.
3. If API layer remains unchanged, explicitly document API/internal decoupling rationale.

### Why
- One-shot migration requires all direct consumers to agree on a single contract.

---

## 4) Documentation updates (required by decisions)

### `docs/review-findings.md`
- Add status note under Entry 2 indicating canonical shared type unification path and hard-cut migration intent.

### `docs/SSOT.md`
- Add/adjust section declaring `/types` as source of truth for battle/combat contracts, with pointer to normalized event schema.

### `docs/ai-decision-design-trajectory.md`
- No changes (explicitly out of scope).

---

## 5) Removal policy for duplicate/divergent type surfaces

During implementation pass:

1. Identify type unions/interfaces outside `/types` that duplicate canonical battle/combat contracts.
2. Remove them in the same commit (hard cut).
3. Refactor imports to canonical `/types` exports.
4. Do not keep compatibility aliases.

---

## Migration Checklist (implementation pass)

- [ ] Normalize `types/battle.ts` event keys to one canonical naming convention.
- [ ] Ensure `string` entity IDs across all canonical battle/combat event payload fields.
- [ ] Update engine event emissions to canonical shared event keys.
- [ ] Remove duplicate/divergent event type definitions outside `/types`.
- [ ] Update all compile-affected consumers/imports.
- [ ] Preserve useful event and battle-result semantics while standardizing key names.
- [ ] Keep runtime/bookkeeping/debug internals out of shared public contracts.
- [ ] Keep API DTO contract untouched unless migration is blocked by type-level constraints.
- [ ] Update `docs/review-findings.md` with Entry 2 status.
- [ ] Update `docs/SSOT.md` source-of-truth note.
- [ ] Run full test suite.
- [ ] Add/verify negative coverage that legacy schema usage fails clearly.

---

## Validation Plan (test-plan only; no tests implemented in this pass)

## A) Compile and static checks
1. Type-check passes with only canonical `/types` battle/combat contracts in use.
2. No remaining imports of removed duplicate event schema surfaces.

## B) Unit tests
3. Event emission unit tests validate normalized keys (`actorId`, `targetId`, `sourceId`, `rollBP`, etc.).
4. Regression tests validate preserved event semantics and battle result semantics after key normalization.

## C) API/contract boundary tests
5. Verify API behavior remains stable if DTOs are untouched.
6. If API consumes shared event types directly, update tests to assert canonical key names.

## D) Negative migration tests (required)
7. Add explicit tests asserting legacy payload keys are rejected or no longer type-compatible.
8. Add tests proving duplicate legacy schema imports are not available/usable.

## E) Full suite gate
9. Run full test suite as merge gate for the implementation pass.

---

## Non-goals for this pass

1. No production code modifications.
2. No adapter/compatibility shim layer.
3. No phased rollout; this plan targets a one-shot migration.
4. No changes to `docs/ai-decision-design-trajectory.md`.

---

## Risks and Mitigations

1. **Risk**: Hidden consumers rely on old event key names.  
   **Mitigation**: one-shot compile-driven migration plus explicit legacy-negative tests.

2. **Risk**: Over-normalization may accidentally drop useful result semantics.  
   **Mitigation**: preserve useful fields/events intentionally; capture field mapping in PR notes.

3. **Risk**: Re-divergence after migration.  
   **Mitigation**: remove duplicate external type surfaces and treat `/types` as sole contract authority in docs.
