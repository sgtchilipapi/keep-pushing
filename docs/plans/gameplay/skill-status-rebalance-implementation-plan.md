# Skill Expansion + Status Effect Rebalance Implementation Plan

## Goal
Add three new skills and rebalance two existing skills so status application is clear, deterministic, and test-covered.

### New skills to add
- **SURGE** → inflicts `overheated` on target.
- **BARRIER** → applies `shielded` to self.
- **REPAIR** → applies `recovering` to self.

### Existing skills to change
- **VOLT_STRIKE** should **only** inflict `stunned`.
- **FINISHING_BLOW** should **only** inflict `broken_armor`.

---

## Current-state summary

Based on the current skill registry:
- `VOLT_STRIKE` currently applies **target** statuses `broken_armor` + `overheated` and self-applies `shielded`.
- `FINISHING_BLOW` currently applies **target** status `stunned` and self-applies `recovering`.
- Existing statuses already referenced by these changes (`stunned`, `broken_armor`, `overheated`, `shielded`, `recovering`) exist in the battle status system.

This means the requested change is primarily a **skill-definition remap**, not the introduction of brand-new status IDs.

---

## Scope of work

## Workstream A — Skill ID and definition design

### Tasks
1. Allocate three new stable `skillId` constants for:
   - `SURGE`
   - `BARRIER`
   - `REPAIR`
2. Define each skill’s base combat tuning fields:
   - `basePower`
   - `accuracyModBP`
   - `cooldownTurns`
   - `tags`
3. Define status application behavior:
   - `SURGE.appliesStatusIds = ['overheated']`
   - `BARRIER.selfAppliesStatusIds = ['shielded']`
   - `REPAIR.selfAppliesStatusIds = ['recovering']`
4. Ensure no unintended side statuses remain for those skills.

### Deliverable
A deterministic, explicit skill registry where all five requested skill/status mappings are encoded directly in data.

---

## Workstream B — Existing skill rebalance

### Tasks
1. Update `VOLT_STRIKE` definition to:
   - keep/adjust tuning as needed,
   - set `appliesStatusIds = ['stunned']`,
   - set `selfAppliesStatusIds = []`.
2. Update `FINISHING_BLOW` definition to:
   - keep/adjust tuning as needed,
   - set `appliesStatusIds = ['broken_armor']`,
   - set `selfAppliesStatusIds = []`.
3. Re-evaluate `tags` for semantic consistency:
   - remove tags that no longer match behavior (for example, a skill tagged `stun` but not applying `stunned`, or `shieldbreak` but not aligned to intended gameplay signal).

### Deliverable
Legacy skills reflect the new single-status intent with no leftover effects.

---

## Workstream C — Runtime compatibility checks

### Tasks
1. Validate AI heuristics still behave sensibly with new mappings:
   - AI logic currently reads tags such as `stun` and `shieldbreak`; ensure tags match new effects to avoid bad scoring.
2. Validate status application pipeline requires no engine change:
   - `appliesStatusIds` and `selfAppliesStatusIds` should already flow through battle resolution.
3. Confirm no other hard-coded assumptions about which skill applies which status.

### Deliverable
Skill remap works without hidden regressions in decision logic or battle flow.

---

## Workstream D — Test updates

### Unit / registry tests
- Add/update assertions for skill definitions:
  - `SURGE` inflicts only `overheated`.
  - `BARRIER` self-applies only `shielded`.
  - `REPAIR` self-applies only `recovering`.
  - `VOLT_STRIKE` inflicts only `stunned`.
  - `FINISHING_BLOW` inflicts only `broken_armor`.

### Integration tests
- Add/update battle-flow tests that prove status events occur from the intended skill source.
- Ensure no unexpected status events from those five skills.

### Snapshot/contract tests
- Update snapshots that currently reflect the old mappings.
- Confirm deterministic ordering and payloads remain stable after intentional diff.

### Deliverable
Automated suite prevents accidental regression to old status mappings.

---

## Workstream E — Documentation and balancing follow-up

### Tasks
1. Update docs that describe default skills and status coverage paths.
2. Optionally note migration rationale:
   - status responsibilities split from overloaded skills into dedicated skills.
3. If needed, perform lightweight balancing pass after behavior lock (power/cooldown) without altering status mapping contract.

### Deliverable
Docs and behavior expectations are aligned for future contributors.

---

## Recommended implementation sequence

1. Add new skill constants + definitions (`SURGE`, `BARRIER`, `REPAIR`).
2. Re-map `VOLT_STRIKE` and `FINISHING_BLOW` status arrays.
3. Align skill tags with final behavior.
4. Update and run tests (unit → integration → snapshot).
5. Refresh docs and changelog notes.

---

## Acceptance criteria

Implementation is complete when all are true:

1. Skill registry contains `SURGE`, `BARRIER`, and `REPAIR` with requested status behavior.
2. `VOLT_STRIKE` applies only `stunned`.
3. `FINISHING_BLOW` applies only `broken_armor`.
4. No removed status effect still appears from these skills in integration/snapshot coverage.
5. Full test suite passes with deterministic output.

---

## Risks and mitigations

- **Risk:** Skill tags and statuses become inconsistent, causing AI mis-prioritization.
  - **Mitigation:** add explicit tests asserting tag/status intent per skill.

- **Risk:** Snapshot churn obscures unintended side effects.
  - **Mitigation:** verify snapshot diffs only change status application events linked to the five modified skills.

- **Risk:** New skills added but unreachable in sample loadouts.
  - **Mitigation:** ensure at least one deterministic fixture/loadout includes each new skill.
