# Fix Plan: Status Effect Resolution Phase (Review Findings Entry 4)

## Status

This document captures clarified decisions and the implementation plan for fixing **Entry 4** in `docs/review-findings.md`.

Scope for this pass is **documentation/plan only**. No production code changes are included in this pass.

---

## Decision Log (locked via clarification)

| Decision Area | Locked Decision |
|---|---|
| Delivery mode | Documentation/plan only |
| Rollout model | **Hard cut** (no compatibility behavior) |
| Scope | Engine status flow + API/event contracts if required for observability |
| Core round order | **Status resolution → action resolution → status decrement → cooldown decrement → round end** |
| Status timing classes | Multiple: `onRoundStart` and `onApply` |
| Round-start timing | Resolve once at round start before any actions from both sides |
| On-apply timing | Resolve immediately on apply/reapply only if resulting duration > 0 |
| Duration-0 apply behavior | Treat as failed application (emit failure event) |
| Duration semantics | No stacking; reapply extends duration via `max(currentRemaining, baseDuration)` |
| Reapply behavior | Reapply still triggers `onApply` effect resolution |
| Same-round reapply edge | Reapply can appear "not extended" after same-round decrement (accepted behavior) |
| Resolver architecture | Centralized typed resolver registry keyed by status ID |
| Unknown status resolver | Fail fast |
| Resolver purity | Pure deterministic transforms only |
| Compile-time coverage | Enforce full `StatusId -> resolver` completeness |
| Eventing | Add dedicated `STATUS_EFFECT_RESOLVE` event |
| Event payload | Include `statusId`, `sourceId`, `targetId`, `round`, `phase`, and computed deltas |
| Key naming | Normalize to canonical keys (`actorId`, `targetId`, `sourceId`, `entityId`, `rollBP`) |
| Zero-effect resolution logs | Emit resolve events even if net effect is zero |
| Passive interaction point | Passives that affect status periodic effects evaluate at round start |
| Death handling | Death stops all further processing immediately |
| Interaction precedence | Action-time and status-time effects compound |
| Control-loss periodic effects | Allowed during status resolution if status defines periodic mechanics |
| Numeric rules | Integer math only |
| RNG rules | Seeded RNG only |
| Intra-phase ordering | Explicit per-status priority |
| Multi-target deterministic order | `SPD` descending, then `entityId` ascending |
| Testing scope | Both unit + engine integration tests |
| Snapshot testing | Use snapshot-style event log tests |
| Docs in implementation pass | Update `docs/review-findings.md` and `docs/SSOT.md` |

---

## Why this is a hard-cut change (and how behavior differs)

Entry 4 currently describes a system where status lifecycle progression exists, but mechanical effect resolution is not guaranteed as a centralized phase. The hard-cut model changes this from an implicit/distributed pattern to an explicit deterministic contract.

### Before (current risk profile)

- Status lifecycle events may be emitted without guaranteeing a centralized mechanical resolution window.
- Effect timing can drift by implementation site (action code path vs status lifecycle code path).
- New statuses can be tracked in state but have missing or inconsistent effect timing.

### After (hard-cut target)

- Every active status has declared resolution timings (`onApply`, `onRoundStart`) in one central registry.
- Round start executes status effects before any actions.
- Status decrement occurs after actions (same round), then cooldown decrement.
- Reapply behavior is deterministic and includes immediate `onApply` effect.
- Unknown status IDs without resolvers fail fast (compile-time + runtime guards).
- Replay logs include both lifecycle and effect-resolution timing via explicit events.

This hard cut intentionally removes transitional ambiguity and enforces one canonical status timeline.

---

## SSOT alignment and required spec update

`docs/SSOT.md` already enforces determinism, integer math, seeded RNG, and canonical contract ownership. Entry 4 implementation must align and clarify one missing area: **status timing semantics**.

### Required SSOT addition (implementation pass)

Add an explicit subsection under combat flow to define canonical phase order:

1. `Status Effect Resolution Phase` (round start)
2. `Action Resolution Phase`
3. `Status Duration Decrement/Expire`
4. `Cooldown Decrement`
5. `Round End`

Also document:
- `onApply` immediate resolution rule for duration `> 0`
- failed application behavior for duration `<= 0`
- deterministic status priority + deterministic multi-target ordering
- death short-circuit behavior

---

## Detailed implementation plan (for subsequent code pass)

## 1) Introduce centralized status resolver registry

### Planned files
- `engine/battle/statuses/*` (new folder)
- `engine/battle/statuses/registry.ts` (new)
- `engine/battle/statuses/types.ts` (new)

### Planned changes
1. Define canonical status resolver interface:
   - `statusId`
   - `priority` (explicit integer)
   - `timings` (`onApply`, `onRoundStart`)
   - `resolve(context): ResolutionResult`
2. Define `StatusId` canonical type and enforce:
   - `Record<StatusId, StatusResolverDefinition>` for compile-time completeness.
3. Implement runtime guard for unknown status IDs (throw with explicit error including `statusId`).

### Why
- Centralizes ownership of status mechanics.
- Eliminates lifecycle/effect drift.
- Prevents statuses from existing without deterministic effects.

---

## 2) Add explicit status-effect phase to round processing

### Planned files
- `engine/battle/battleEngine.ts`
- (optional extraction) `engine/battle/phases/statusResolutionPhase.ts` (new)

### Planned changes
1. Insert round-start status resolution phase before any action resolution.
2. Resolve active statuses in deterministic order:
   - status `priority` ascending (`1` resolves before `2`)
   - per-status target order: `SPD` desc then `entityId` asc.
3. Enforce death short-circuit after each resolution application.
4. Keep action phase separate and unchanged except for interaction with updated status state.
5. Run status decrement/expire after action resolution.
6. Run cooldown decrement after status decrement.

### Why
- Implements the requested invariant exactly.
- Makes ordering auditable and testable.

---

## 3) Implement on-apply resolution semantics

### Planned files
- `engine/battle/statuses/applyStatus.ts` (new or refactor existing helper)
- `engine/battle/battleEngine.ts` (call site updates)

### Planned changes
1. On apply/reapply:
   - compute resulting duration
   - if resulting duration `<= 0`, treat as failed application and emit failure lifecycle event
   - if duration `> 0`, emit apply/refresh lifecycle event, then immediately run `onApply` resolver.
2. Reapply duration semantics:
   - no stack accumulation
   - extension rule: `remaining = max(currentRemaining, baseDuration)`
   - still trigger immediate `onApply` effect every successful reapply.

### Why
- Matches required burn/overheat behavior.
- Prevents status payloads from being accepted when mechanically inert.

---

## 4) Add canonical event for mechanical resolution

### Planned files
- `types/battle.ts`
- `engine/battle/*` event emission points
- `types/api/combat.ts` (if API DTO response requires event union updates)

### Planned changes
1. Add `STATUS_EFFECT_RESOLVE` event to canonical event union.
2. Payload fields include:
   - `statusId`
   - `sourceId`
   - `targetId`
   - `round`
   - `phase` (`onApply` or `onRoundStart`)
   - effect deltas (damage/heal/buff/debuff details)
3. Use normalized keys consistent with canonical event naming.
4. Emit even when net delta is zero.

### Why
- Separates lifecycle observability from mechanical observability.
- Improves replay/debugging/auditability.

---

## 5) Normalize and document lifecycle/event naming

### Planned files
- `types/battle.ts`
- `docs/SSOT.md`
- `docs/review-findings.md`

### Planned changes
1. Verify lifecycle events use canonical key names.
2. Normalize any non-canonical payload keys as part of hard cut.
3. Document event schema changes and migration examples.

### Why
- Avoids creating another parallel key-family divergence.
- Keeps downstream clients/tooling predictable.

---

## 6) Interaction rules implementation (compound effects + control-loss)

### Planned files
- `engine/battle/statuses/*`
- `engine/battle/battleEngine.ts`

### Planned changes
1. Ensure status periodic effects and action-time effects compound additively/deterministically.
2. Allow control-loss statuses to include periodic mechanics in status phase.
3. Ensure dead combatants immediately stop further processing.

### Why
- Aligns to requested gameplay behavior without introducing non-determinism.

---

## 7) Test plan (implementation pass)

## Unit tests
1. Registry completeness compile-time constraint (all `StatusId` mapped).
2. Unknown active status ID triggers fail-fast throw with `statusId` in error.
3. Deterministic resolver ordering by status priority.
4. Deterministic multi-target ordering (`SPD` desc, `entityId` asc).

## Engine integration tests (snapshot-style event logs)
5. Duration-1 status applies, resolves on-apply, then expires correctly.
6. Round-start resolution occurs before any actions from either side.
7. Reapply same round triggers on-apply again and uses `max(...)` extension rule.
8. Status decrement occurs before cooldown decrement.
9. Death during status phase halts remaining processing.
10. Control-loss + periodic damage status resolves as defined at round start.
11. `STATUS_EFFECT_RESOLVE` emitted with canonical keys and expected payload.
12. Zero-effect resolution still emits resolve event.

---

## File-by-file change map (implementation pass)

| File | Change Type | Why |
|---|---|---|
| `engine/battle/battleEngine.ts` | Refactor phase ordering + hooks | Enforce canonical timing invariant |
| `engine/battle/statuses/types.ts` | New typed interfaces | Strong deterministic resolver contract |
| `engine/battle/statuses/registry.ts` | New registry | Single dispatch/ownership for status behavior |
| `engine/battle/statuses/applyStatus.ts` | New/Refactor | Correct on-apply + reapply semantics |
| `engine/battle/phases/statusResolutionPhase.ts` | New (optional) | Keep round flow maintainable and testable |
| `types/battle.ts` | Extend event union | Add `STATUS_EFFECT_RESOLVE` canonical event |
| `types/api/combat.ts` | Update response DTO if needed | Keep API event contracts aligned |
| `docs/SSOT.md` | Spec update | Codify status timing as SSOT |
| `docs/review-findings.md` | Status update for Entry 4 | Mark direction locked, implementation pending/completed |
| `tests/*` | New/updated tests | Verify deterministic ordering and fail-fast guarantees |

---

## Migration notes for consumers (hard cut)

When implementation begins, consumers should assume:
1. Status effects now resolve in explicit `onApply` and round-start windows.
2. New `STATUS_EFFECT_RESOLVE` events appear in battle logs.
3. Event payload key names are canonicalized.
4. Missing/unknown status resolvers are treated as engine errors.

No compatibility layer is planned.

---

## Completion criteria for “Entry 4 solved”

Entry 4 can be marked solved when all are true:
1. Engine executes status effects in centralized round-start phase and on-apply path.
2. Phase order is exactly:
   - status resolution
   - action resolution
   - status decrement/expire
   - cooldown decrement
   - round end
3. Reapply semantics match non-stacking + immediate on-apply behavior.
4. `STATUS_EFFECT_RESOLVE` is emitted with canonical payload keys.
5. Unknown status IDs fail fast.
6. SSOT explicitly documents timing semantics.
7. Snapshot integration tests cover boundary and regression cases.

