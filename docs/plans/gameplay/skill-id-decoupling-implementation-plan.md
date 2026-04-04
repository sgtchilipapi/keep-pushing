# Implementation Plan: Numeric String Skill IDs + `skillName` for Active and Passive Skills

## Status

This document defines a migration plan to decouple stable skill identifiers from display-facing names by introducing numeric-string IDs for both active and passive skills, and by adding an explicit `skillName` field.

Scope for this pass is **documentation/plan only**.

---

## Goals

1. Use a **numeric string** ID as the canonical identity for all active and passive skills (for example: `"1001"`, `"2001"`).
2. Add a separate `skillName` field to hold human-readable / design-facing naming.
3. Keep runtime behavior deterministic and unchanged except for identifier plumbing.
4. Make renaming skills low-risk by avoiding identity changes when only display names change.

---

## Problem Statement

Current data flow treats string literals like `"1001"` and `"2001"` as both:

- identity keys used by registries, loadouts, events, persistence, and tests, and
- user/design-facing names.

This coupling makes rename work expensive and risky because many systems currently rely on name literals as stable IDs.

---

## Target Contract

## Canonical principles

- **ID is identity**: canonical key is a numeric-string `skillId`/`passiveId`.
- **Name is metadata**: `skillName` is mutable display/design metadata.
- **Behavior does not key by name**: all runtime maps and joins key by ID.

## Proposed type shape

### Active skill definition

```ts
export type SkillDef = {
  skillId: string;      // numeric string (canonical identity)
  skillName: string;    // mutable display/config name
  basePower: number;
  accuracyModBP: number;
  cooldownTurns: number;
  tags: SkillTag[];
  executeThresholdBP?: number;
  appliesStatusIds?: StatusId[];
  selfAppliesStatusIds?: StatusId[];
};
```

### Passive skill definition

```ts
export type PassiveDef = {
  passiveId: string;    // numeric string (canonical identity)
  skillName: string;    // mutable display/config name
  flatStats?: PassiveStatModifiers;
  conditional?: ConditionalPassiveModifier[];
};
```

### Snapshot/loadout shape

No shape-size change required; skill arrays remain string tuples, but values are numeric-string IDs.

- `activeSkillIds: [string, string]`
- `passiveSkillIds?: [string, string]`

---

## ID Strategy

1. Reserve disjoint numeric ranges by category for readability and validation:
   - active skills: `1000+`
   - passive skills: `2000+`
2. Treat IDs as strings at boundaries to avoid numeric parsing ambiguity.
3. Enforce canonical formatting (digits only, no signs, no decimals, no leading/trailing whitespace).
4. Keep names unique only if product requires it; uniqueness should not be identity-critical.

---

## Implementation Workstreams

## Workstream A — Type and registry model updates

### Tasks
1. Add `skillName` to `SkillDef` and `PassiveDef` registry types.
2. Convert existing registry keys/values to numeric-string IDs.
3. Keep lookup helpers (`getSkillDef`, `getPassiveDef`) keyed exclusively by ID.
4. Add optional helper APIs for name lookup only if needed (`getSkillByName` should not be used in runtime-critical paths).

### Deliverable
All canonical definitions expose both stable ID and mutable name.

---

## Workstream B — Runtime engine migration

### Tasks
1. Ensure all battle engine paths (cooldowns, AI scoring, status attribution, events) continue to use `skillId` values only.
2. Verify passive application and conditional logic remain keyed by passive ID.
3. Confirm event payloads preserve existing keys while values become numeric strings.

### Deliverable
Combat logic behavior is unchanged while identifier format is migrated.

---

## Workstream C — API and persistence alignment

### Tasks
1. Validate create/equip/combat route validators accept numeric-string IDs.
2. Keep API payload field names stable unless explicit API versioning is desired.
3. Confirm persistence tables/columns continue storing string IDs; no integer conversion.
4. If seed/default loadouts exist, replace old symbolic IDs with numeric-string IDs.

### Deliverable
API/database boundary remains stable and tolerant of name changes.

---

## Workstream D — Front-end and UX mapping

### Tasks
1. Update UI dropdown/options to bind by ID while displaying `skillName`.
2. Avoid rendering raw IDs where user-facing names are expected.
3. Add deterministic mapping utilities where UI currently relies on enum-like literals.

### Deliverable
Users see names; system submits and stores IDs.

---

## Workstream E — Test and fixture migration

### Tasks
1. Replace fixture loadouts and expectations that hardcode symbolic IDs.
2. Keep test assertions on behavior/event ordering; only update literal ID values where needed.
3. Add coverage proving that changing `skillName` alone does not break identity-based behavior.
4. Add validation tests rejecting non-numeric-string IDs.

### Deliverable
Test suite protects decoupled identity/name behavior.

---

## Workstream F — Documentation and SSOT updates

### Tasks
1. Update `docs/architecture/SSOT.md` to explicitly define skill identity vs display naming.
2. Document numeric-string ID conventions and allocation policy.
3. Add migration notes for downstream consumers (analytics, tools, replay readers).

### Deliverable
Contract ownership and naming rules are explicit and durable.

---

## Suggested Migration Sequence

1. Introduce `skillName` fields in types/registries without removing old constants yet.
2. Assign numeric-string IDs to active/passive registries.
3. Migrate engine and API callsites to new IDs.
4. Update UI option rendering (ID submit, name display).
5. Migrate tests and fixtures.
6. Remove legacy symbolic-ID assumptions/constants.
7. Run full suite and snapshot updates in one focused pass.

---

## Validation Plan

1. **Type checks**
   - compile passes after registry/type updates.
2. **Unit checks**
   - registry lookup by ID succeeds for all seeded active/passive skills.
   - name-only changes do not affect lookup or behavior.
3. **Integration checks**
   - character create/equip/combat flows accept new IDs.
   - battle replay/event contracts remain deterministic.
4. **Negative checks**
   - reject malformed IDs (non-digit strings, whitespace, empty values).
5. **Regression checks**
   - existing damage/status/passive behavior remains unchanged.

---

## Risks and Mitigations

1. **Risk**: Hidden hardcoded symbolic IDs in tests/UI break at runtime.
   - **Mitigation**: repo-wide literal scan + fixture migration checklist.

2. **Risk**: Numeric strings accidentally coerced to numbers and reformatted.
   - **Mitigation**: keep IDs typed/stored as `string` end-to-end.

3. **Risk**: Confusion between active and passive ID spaces.
   - **Mitigation**: reserve category-specific numeric ranges and validate them.

4. **Risk**: Event consumers treat IDs as display names.
   - **Mitigation**: document `skillName` as presentation field; keep event IDs canonical.

---

## Definition of Done

This migration is complete when:

1. Active and passive skills both use numeric-string IDs as canonical identity.
2. Both active and passive definitions include `skillName` metadata.
3. Runtime logic, persistence, and APIs use IDs (not names) for all joins/lookups.
4. UI displays names while submitting IDs.
5. Tests verify that renaming `skillName` does not change behavior.
