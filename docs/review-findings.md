# Review Findings

This document captures architecture and implementation findings across battle-related modules. Each finding includes:
- **Problem Observed**: What is currently happening.
- **Assessment**: Why it matters (impact, risk, confidence).
- **Recommendations**: Suggested corrective actions (near-term and long-term).

---

## Module: `engine/battle/battleEngine.ts`

### Entry 1 — Engine-local `CombatantSnapshot` diverges from shared combat domain type

**Status: Solved**

**Fix Applied**

Entry 1 has been resolved by adopting a single shared canonical `CombatantSnapshot` strategy (Option A) and removing the duplicate engine-local ownership.

Applied changes (per `docs/fix-combatant-snapshot-type-divergence.md`):
- Canonical `CombatantSnapshot` ownership is in `types/combat.ts`.
- `entityId` is unified as `string`.
- `initiative` is treated as runtime-derived and no longer part of the canonical input snapshot.
- Engine-required loadout fields (`activeSkillIds`, optional `passiveSkillIds`) are part of the canonical shared snapshot.
- Metadata (`side`, `name`) remains optional and engine-ignored.
- Legacy duplicate snapshot aliases/surfaces are removed rather than retained.

This closes the type divergence issue and removes naming ambiguity around `CombatantSnapshot`.

**Problem Observed**

The battle engine defines and exports its own `CombatantSnapshot` type instead of using the interface from `types/combat.ts`.

Concretely:
- Engine snapshot uses `entityId: string` and includes engine-specific fields such as `activeSkillIds` and optional `passiveSkillIds`.
- Shared combat snapshot uses `entityId: number`, includes presentation/domain fields (`side`, `name`) and includes `initiative` directly in the snapshot.

Because these shapes are incompatible, `engine/battle/battleEngine.ts` cannot directly consume `types/combat.ts` without either a transformation layer or a shared canonical model.

**Assessment**

- **Severity**: High (design consistency / type safety / integration friction).
- **Likelihood of recurring issues**: High, as both type surfaces can evolve independently.
- **Primary risks**:
  1. **Type drift and semantic drift** across modules.
  2. **Duplicated validation and mapping logic** in API/UI boundaries.
  3. **Increased cognitive load** for contributors (multiple “CombatantSnapshot” meanings).
  4. **Potential runtime contract mismatches** if one surface changes and the other is not updated.
- **Operational impact**:
  - Harder to standardize API contracts.
  - Harder to reason about replay/export/import schemas.
  - More expensive refactors when adding new combat attributes.

Overall, this appears to be a legacy split between a “shared domain type layer” and a newer engine-specific runtime input model that became de facto canonical for simulation flow.

**Recommendations**

1. **Define a canonical combatant contract strategy** (decision gate)
   - Choose one of:
     - **Option A (preferred)**: Shared canonical `CombatantSnapshot` in `types/combat.ts` with engine-only extensions layered separately.
     - **Option B**: Keep engine snapshot canonical and deprecate/rename the shared legacy shape to avoid name collision.

2. **Remove naming ambiguity immediately** (low-risk quick win)
   - Rename one of the duplicate symbols:
     - e.g., `EngineCombatantSnapshot` (engine) and `DomainCombatantSnapshot` (shared).
   - This reduces accidental imports and implicit assumptions.

3. **Introduce explicit adapters at boundaries**
   - Build `toEngineCombatantSnapshot(...)` and `fromEngineCombatantSnapshot(...)` mappers.
   - Keep mapping centralized in one module (e.g., `types/adapters/combat.ts`) to avoid ad hoc conversion logic.

4. **Align ID and field semantics**
   - Resolve the `entityId` type mismatch (`string` vs `number`) and document invariant constraints.
   - Clarify ownership of `initiative`:
     - input/domain state, or
     - derived runtime-only state.

5. **Deprecation and migration plan**
   - Mark the non-canonical interface with deprecation comments.
   - Update imports incrementally (engine, API route, UI, tests).
   - Add a migration checklist in docs to prevent partial transitions.

6. **Contract tests for type evolution safety**
   - Add compile-time and runtime contract tests ensuring payload compatibility between API request validation and simulation input.
   - Include snapshot tests for serialized battle payloads.

---

## Module: `types/combat.ts` and `types/battle.ts`

### Entry 2 — Shared type layer appears to represent a parallel/legacy event and entity schema

**Status: Solved**

**Fix Applied**

Entry 2 has been resolved by unifying battle/combat contracts in the shared `/types` layer and hard-cutting away parallel schema interpretation.

Applied changes (per `docs/fix-shared-type-layer.md`):
- `/types` is treated as canonical source of truth for shared battle/combat contracts.
- Event payload keys are normalized to canonical names (for example: `actorId`, `targetId`, `sourceId`, `rollBP`) to eliminate dual key families.
- Shared contracts use `string` entity IDs consistently.
- Divergent duplicate event/result type surfaces outside `/types` are removed in favor of canonical shared types.
- Migration approach is one-shot (no compatibility alias layer), preventing ongoing schema drift.

This closes the parallel/legacy schema finding by establishing one authoritative shared contract surface.

**Status Update (Migration in progress)**

- Canonical battle/combat contracts are now unified under `/types` with normalized event keys (`actorId`, `targetId`, `sourceId`, `rollBP`) and `string` entity IDs.
- Engine-local duplicate `BattleEvent`/`BattleResult` type surfaces have been removed in favor of shared `/types` contracts.
- Migration is one-shot (no compatibility alias layer). Legacy key families (e.g., `*EntityId`, `roll`) are no longer part of canonical shared event contracts.

**Problem Observed**

`types/combat.ts` and `types/battle.ts` define a full combat and battle schema that does not align with the active engine event model and field naming conventions (e.g., numeric entity IDs and alternate event payload keys).

This creates two conceptually valid but practically incompatible schema families in the same codebase.

**Assessment**

- **Severity**: Medium-High.
- **Primary risks**:
  1. Incorrect assumptions by new contributors.
  2. API/model coupling errors during feature additions.
  3. Dead or underused type definitions that continue to drift.
- **Maintainability impact**:
  - Reduced discoverability of true source-of-truth contracts.
  - Increased review burden to verify “which schema” is used.

**Recommendations**

1. **Document source-of-truth contracts** in a short architecture note.
2. **Tag legacy types clearly** with `@deprecated` and migration pointers if they are retained.
3. **If still needed, scope legacy schemas** under `types/legacy/*` to prevent accidental adoption.
4. **If not needed, remove unused surfaces** after confirming no external consumers rely on them.
5. **Add CI checks** (import boundaries or lint rules) to prevent accidental cross-use of legacy and active schemas.

---

## Module: `app/api/combat/route.ts`

### Entry 3 — API contract validation is tightly coupled to engine-internal snapshot shape

**Status: Clarified (implementation pending)**

**Fix Direction Locked**

Entry 3 is now clarification-complete with a locked implementation direction documented in `docs/fix-api-contract-validation.md`.

Locked direction:
- Introduce canonical API DTO ownership under `/types/api/combat.ts` (separate from engine internal types).
- Move route validation to schema-first DTO validation (strict unknown-field rejection) with inferred TypeScript types.
- Validate DTO payloads first, then map DTO → engine input via explicit API-layer adapters.
- Treat seed as server-generated (remove client seed ownership).
- Keep canonical response event keys (`actorId`, `targetId`, `sourceId`, `rollBP`, `entityId`) and full event logs.
- Apply a hard cut on legacy payload shapes, with migration examples documented.
- Keep current client-supplied snapshot request mode for near-term combat-rules iteration; later evolve API toward character-ID inputs with server-side snapshot assembly from persisted data.

This status update records decision closure for Entry 3; implementation remains a subsequent code pass.

**Problem Observed**

The API validator checks payloads against the engine-local `CombatantSnapshot` rather than a stable public API DTO contract. This couples external request shape directly to internal engine typing choices.

**Assessment**

- **Severity**: Medium.
- **Primary risks**:
  1. Engine refactors can become API breaking changes.
  2. Harder versioning for API consumers.
  3. Duplication of contract logic if alternate interfaces (admin tools, replay ingest, batch sim jobs) are added.

**Recommendations**

1. **Introduce explicit API DTO types** independent of engine internals.
2. **Validate DTOs, then map to engine input** using adapter functions.
3. **Version API contract** when schema changes are expected.
4. **Publish contract examples** (request/response) in docs to aid clients and prevent ambiguity.
5. **Add schema-based validation** (e.g., zod/json-schema) for better error quality and evolvability.

---

## Module: `engine/battle` status resolution flow (cross-cutting)

### Entry 4 — Statuses should resolve their gameplay effects before duration decrement in a general, centralized phase

**Status: Solved**

**Fix Applied**

Entry 4 has been implemented with a hard-cut centralized status-effect resolution model:
- Added explicit status effect resolution timing windows (`onApply`, `onRoundStart`) with deterministic ordering.
- Enforced round flow: status resolution → action resolution → status decrement/expire → cooldown decrement → round end.
- Added canonical `STATUS_EFFECT_RESOLVE` events (including phase and effect deltas) alongside lifecycle events.
- Added fail-fast resolver guards and compile-time-complete status resolver registry coverage.
- Added coverage tests for on-apply/round-start timing and fail-fast unknown-resolver behavior.

**Problem Observed**

Status lifecycle events are advanced consistently (`STATUS_APPLY`/`STATUS_REFRESH`/`STATUS_EXPIRE`), but effect resolution is not modeled as a first-class, general phase that runs before end-of-round duration decrement.

As a result, effect behavior can become fragmented across action-time code paths, and newly introduced statuses can accidentally participate in lifecycle tracking without guaranteed mechanical resolution timing.

This finding is intentionally system-level and cross-cutting, rather than scoped to a single file, skill, or status identifier.

The desired invariant is: active status effects resolve in a deterministic phase before status duration is decremented.

**Assessment**

- **Severity**: High (combat correctness / systemic extensibility).
- **Likelihood of recurring issues**: High, especially as status catalog grows.
- **Primary risks**:
  1. **Lifecycle/effect drift**: statuses can be present in state and events without deterministic gameplay impact windows.
  2. **Inconsistent timing semantics**: effect application timing may vary by implementation site rather than engine rule.
  3. **Feature regression risk**: adding statuses requires touching multiple systems, increasing omission probability.
  4. **Replay/audit ambiguity**: consumers can see status events without clear proof of when effects were actually resolved.
- **Design impact**:
  - Harder to enforce universal invariants such as: “active statuses resolve before decrement.”
  - Harder to reason about ordering interactions (passives, damage, control-loss, and expiration).

**Recommendations**

1. **Define an explicit status-effect resolution phase**
   - Add a deterministic phase in round processing where active statuses resolve their gameplay effects.
   - Ensure this phase executes **before** status duration decrement/expiration.

2. **Centralize status effect handlers by status ID**
   - Introduce a single dispatch surface (e.g., per-status resolver registry) so each active status has a declared mechanical outcome and timing.

3. **Document timing invariants in engine comments/docs**
   - Record the expected order of operations (action resolution, status effect resolution, cooldown decrement, status decrement/expire, round end).

4. **Add status-phase tests at engine level**
   - Include tests that assert effect resolution occurs while status is active and before decrement, including boundary rounds where expiration occurs.

5. **Improve observability with phase-accurate events (optional but recommended)**
   - Consider dedicated status-effect-resolved events to make replay and diagnostics reflect both lifecycle and mechanical effect timing.
