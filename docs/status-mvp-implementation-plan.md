# Status MVP Implementation Plan

## Goal
Deliver a minimally complete status system for MVP with exactly one operational status per requested type:

- **Disable** → `stunned`
- **HOT** → `recovering`
- **DOT** → `overheated`
- **Buff** → `shielded`
- **Debuff** → `broken_armor`

All five statuses must be:

1. Defined in canonical registry metadata.
2. Applyable from normal combat flow.
3. Mechanically effective in battle simulation.
4. Observable through deterministic battle events.
5. Covered by automated tests.

---

## Current-state summary

- Status IDs and durations already exist in `statusRegistry`, but metadata is currently too minimal to encode full mechanics.
- Resolver registry exists with deterministic ordering, but only some statuses have meaningful effects today.
- Round-start status resolution phase and stun action-gate are already integrated in battle flow.
- Existing skill loadout does not yet guarantee practical application paths for all five MVP statuses.

---

## MVP status mechanics contract (to lock before coding)

Define and freeze exact behavior for each status.

### 1) `stunned` (Disable)
- Core effect: target skips action opportunities while active.
- Timing: immediate behavioral effect during action gate; status resolution event still emitted per configured phase.
- Duration: existing 1-turn baseline unless design updates it.
- Reapply rule: refresh/extend via current `applyStatus` policy.

### 2) `recovering` (HOT)
- Core effect: periodic healing each round start while active.
- Timing: `onRoundStart` required, `onApply` optional depending on intended burst-heal behavior.
- Clamp rule: HP must not exceed `hpMax` after healing.
- Death interaction: cannot resurrect defeated targets.

### 3) `overheated` (DOT)
- Core effect: periodic damage each round start while active.
- Timing: `onRoundStart` required, `onApply` optional.
- Clamp rule: HP floors at 0.
- Death interaction: if DOT reduces HP to 0, emit `DEATH` deterministically in phase order.

### 4) `shielded` (Buff)
- Core effect: defensive buff (e.g., temporary damage reduction or defense amplification).
- Timing: primarily action-time mitigation; status phase may remain no-op except for observability if desired.
- Scope: should alter incoming damage results while active.

### 5) `broken_armor` (Debuff)
- Core effect: defensive debuff (e.g., increased incoming damage or reduced effective defense).
- Timing: primarily action-time damage amplification.
- Scope: should alter incoming damage results while active.

---

## Implementation workstreams

## Workstream A — Canonical status model

### Tasks
1. Extend `StatusDef` to encode archetype/effect parameters needed by runtime logic.
2. Add explicit semantic fields (example: `kind`, `timings`, `magnitude`, `caps`, etc.).
3. Ensure every `StatusId` has complete metadata in `STATUS_REGISTRY`.
4. Keep strong typing exhaustive so adding a new status requires complete config.

### Deliverable
A self-describing status registry that can drive resolvers and runtime behavior without hidden constants.

---

## Workstream B — Resolver completeness

### Tasks
1. Implement concrete resolver behavior for all five statuses.
2. Ensure each resolver declares deterministic priority and phase timings.
3. Keep resolvers pure and deterministic based on explicit context input.
4. Validate sign conventions for `hpDelta` and consistency with engine application.

### Deliverable
No MVP status is backed by a no-op placeholder unless intentionally documented.

---

## Workstream C — Battle runtime integration

### Tasks
1. Keep round-start status resolution before action resolution.
2. Preserve/extend disable gate behavior for `stunned`.
3. Integrate `shielded` and `broken_armor` into action-time damage pipeline.
4. Enforce HP clamps (`0..hpMax`) after all status-driven HP changes.
5. Preserve deterministic ordering for multi-status scenarios.

### Deliverable
Status mechanics affect real combat outcomes in expected phases.

---

## Workstream D — Skill/application coverage

### Tasks
1. Ensure skills or fixtures can apply all five statuses in practical scenarios.
2. Keep skill registry valid and deterministic (cooldown/action flow unaffected).
3. Avoid dead statuses that exist in registry but cannot be triggered.

### Deliverable
Each status can be exercised in full-battle simulations without test-only hacks.

---

## Workstream E — Event and contract clarity

### Tasks
1. Confirm `STATUS_EFFECT_RESOLVE` payload remains sufficient for replay/debug.
2. Add event-level assertions for timing (`onApply` vs `onRoundStart`) and ordering.
3. Document any interpretation changes (especially `hpDelta` direction and clamp behavior).

### Deliverable
Consumers can reliably interpret status behavior from event streams.

---

## Workstream F — Test plan

### Unit tests
- Registry exhaustiveness and resolver lookup safety.
- Per-status resolver output behavior in isolation.
- `applyStatus` refresh semantics and round-end decrement/expiry ordering.

### Integration tests
- Round start ordering: status resolution occurs before first action.
- `stunned` skip gate prevents action.
- `recovering` heals correctly with cap at `hpMax`.
- `overheated` damages and can cause deterministic death.
- `shielded` reduces incoming damage while active.
- `broken_armor` increases incoming damage while active.
- Combined status ordering remains deterministic.

### Contract/snapshot tests
- Event sequence stability for representative battles.
- Payload correctness for source/target/status attribution.

### Acceptance criteria
- All five statuses have at least one direct mechanic assertion + one full-flow integration assertion.
- Existing deterministic snapshot guarantees remain stable (or intentionally updated with rationale).

---

## Execution sequence (recommended)

1. Lock final behavior numbers for all five statuses.
2. Implement status metadata extension.
3. Implement/finish resolvers.
4. Wire action-time buff/debuff effects into damage path.
5. Ensure skill coverage for all statuses.
6. Add/update tests (unit → integration → snapshots).
7. Run full suite and finalize docs.

---

## Risks and mitigations

- **Risk:** Ambiguous buff/debuff formulas cause unstable balancing.
  - **Mitigation:** freeze integer-only formulas and deterministic rounding rules before coding.

- **Risk:** Status timing confusion (`onApply` vs `onRoundStart`) causes contract drift.
  - **Mitigation:** enforce timing assertions in integration tests and document timing matrix.

- **Risk:** Event consumers misread HP delta direction.
  - **Mitigation:** add explicit tests and documentation examples for positive/negative `hpDelta`.

- **Risk:** Partial implementation leaves status defined but unreachable.
  - **Mitigation:** require skill-level application path for each MVP status.

---

## Definition of done

Status MVP is complete when:

1. All five mapped statuses are operational (Disable/HOT/DOT/Buff/Debuff).
2. Each status is applyable in normal combat and materially changes outcomes.
3. Event stream deterministically reflects status lifecycle and mechanics.
4. Automated tests cover behavior, timing, and ordering.
5. Documentation reflects implemented mechanics and known MVP limitations.
