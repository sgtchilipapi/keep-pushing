# Fix Plan: Prevent Self-Targeted Utility Skills from Damaging Enemies

## Problem Statement

Self-targeted utility skills (for example, `Repair` and `Barrier`) currently flow through the same hit/damage attack pipeline as offensive skills.
As a result, they can:

- roll hit/miss against the enemy,
- emit enemy-targeted `HIT_RESULT`/`DAMAGE` events,
- and chip enemy HP even when the skill intent is purely self-buff/heal-over-time setup.

This behavior contradicts design intent and test scenario expectations for self-target utility skills.

## Root Cause Summary

The battle loop executes attack resolution for every selected skill before status side effects are processed.
The engine has no explicit runtime branch that says "this skill is utility/self-only, skip attack pipeline".

Current behavior is effectively:

1. Select skill.
2. Emit `ACTION` against enemy target.
3. Resolve attack hit + damage against enemy.
4. Apply target statuses.
5. Apply self statuses.

For utility self skills, steps 2-4 should not occur.

## Decision: Should Every Selected Skill Be Filtered Before Normal Attack Pipeline?

**Yes, with an explicit skill-intent gate**.

Do not rely on ad-hoc heuristics in the battle loop.
Instead, introduce a canonical, data-driven skill resolution mode and branch by mode before attack resolution.

This keeps behavior deterministic and future-proof as the skill catalog grows.

## Proposed Design

### 1) Add explicit skill targeting/resolution intent to `SkillDef`

Introduce a field such as:

- `resolutionMode: 'attack' | 'self_utility'`

Suggested mapping:

- `Basic Attack`, `Volt Strike`, `Finishing Blow`, `Surge` => `attack`
- `Barrier`, `Repair` => `self_utility`

This avoids brittle checks like `basePower === 0` and makes intent unambiguous.

### 2) Branch in `simulateBattle` before attack pipeline

After action selection and cooldown handling:

- If `resolutionMode === 'self_utility'`:
  - Emit `ACTION` with `targetId = actor.entityId` (or preserve schema with actor-targeted semantics).
  - Skip `resolveAttack`, `HIT_RESULT`, and `DAMAGE`.
  - Apply `selfAppliesStatusIds` only.
  - Skip enemy-side status application from `appliesStatusIds` (or validate that utility skills do not define them).

- If `resolutionMode === 'attack'`:
  - Run existing hit/damage pipeline unchanged.

### 3) Add safety invariants

At runtime (and/or tests), assert expected combinations:

- `self_utility` skills should have no offensive effect payload:
  - `basePower` can be `0`,
  - `appliesStatusIds` should be empty,
  - offensive tags should be absent.

Fail fast on invalid registry configuration to prevent regression.

### 4) Event contract expectations

For `self_utility` actions:

- Keep `ACTION` event (for replay visibility), but target should be self.
- No `HIT_RESULT` and `DAMAGE` for that action.
- `STATUS_APPLY`/`STATUS_REFRESH` should be actor-targeted.

This removes contradictory logs ("uses Repair on self" followed by "hits enemy").

## Implementation Steps

1. **Type/Registry update**
   - Extend `SkillDef` with `resolutionMode`.
   - Populate all current skill entries.

2. **Battle engine flow split**
   - Refactor action resolution into two explicit paths:
     - `resolveSelfUtilityAction(...)`
     - `resolveAttackAction(...)`
   - Keep shared cooldown/action scaffolding in one place.

3. **Validation guardrails**
   - Add skill-def invariant checks for `self_utility` mode.

4. **Tests**
   - Add focused engine test:
     - selecting `Repair`/`Barrier` emits no `HIT_RESULT`/`DAMAGE`.
     - enemy HP unchanged after utility action.
     - self status applied/refreshed.
   - Add/adjust exhaustive simulation invariants:
     - if a skill is `self_utility`, next events cannot be enemy hit/damage.

5. **Simulation/logging alignment**
   - Ensure script/event formatting logic reflects new event sequence without heuristics.

## Test Plan

- Unit-level:
  - Skill registry integrity tests for `resolutionMode` values.
- Engine integration:
  - deterministic battle where actor only has `Repair`/`Barrier` and enemy HP never decreases from those actions.
- Regression:
  - existing offensive skill tests remain green.
  - status-application semantics unchanged for offensive skills.

## Rollout & Risk

- **Primary risk:** breaking existing tests that implicitly assumed all skills produce hit/damage events.
- **Mitigation:** introduce explicit mode-aware assertions and adjust scenario snapshots accordingly.
- **Secondary risk:** schema consumers expecting enemy-targeted `ACTION` for all turns.
- **Mitigation:** communicate `ACTION.targetId` semantics update for self-utility actions and version snapshots.

## Acceptance Criteria

- Utility self skills never emit enemy-targeted `HIT_RESULT` or `DAMAGE`.
- Utility self skills never reduce enemy HP.
- Utility self skills still set cooldown and apply intended self statuses.
- Battle logs are semantically consistent (self-target action paired with self effects only).
