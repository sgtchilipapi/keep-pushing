# Review Findings

This document captures architecture and implementation findings across battle-related modules. Each finding includes:
- **Problem Observed**: What is currently happening.
- **Assessment**: Why it matters (impact, risk, confidence).
- **Recommendations**: Suggested corrective actions (near-term and long-term).

---

## Module: `engine/battle/battleEngine.ts`

### Entry 1 — Engine-local `CombatantSnapshot` diverges from shared combat domain type

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
