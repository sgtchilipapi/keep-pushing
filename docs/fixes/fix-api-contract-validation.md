# Fix Plan: API Contract Validation Decoupling (Review Findings Entry 3)

## Status

This document captures clarified decisions and the implementation plan for fixing **Entry 3** in `docs/analysis/review-findings.md`.

Scope for this pass is **documentation/plan only**. No production code changes are included in this pass.

---

## Decision Log (locked via clarification)

| Decision Area | Locked Decision |
|---|---|
| Delivery mode | Documentation/plan only |
| Scope | Entry 3 focused; implementation plan may include adjacent files needed for correctness |
| Compatibility | Breaking changes are allowed |
| Rollout model | One-shot migration |
| API contract ownership | Introduce canonical API DTO layer under `/types/api/combat.ts` |
| DTO vs engine types | Keep explicit separation even when fields overlap |
| Validation flow | Validate API DTO first, then map to engine input |
| Validation technology | Use schema-first validation with **Zod** and infer TypeScript types from schema |
| Unknown fields | Reject unknown fields (`strict`) |
| Error envelope | Standardized structured validation errors (`code`, `message`, `details[]`) |
| Versioning | Defer explicit API versioning for now |
| Request field naming | Keep as-is for this migration |
| Entity ID type | `string` only (no numeric fallback) |
| Client `initiative` field | Reject at API boundary (runtime-derived only) |
| Optional metadata fields | Allow declared optional metadata (`side`, `name`) only; reject unknown extras |
| Skill tuple constraints | Require exact tuple cardinality for active/passive skill IDs |
| Additional request constraints | Add explicit API-level invariants for stat ranges, positivity, and distinct combatants |
| Seed ownership | Server-generated only; client must not supply seed |
| Request mode | Single battle request only (no batch mode) |
| Snapshot ownership horizon | Near-term: client-supplied snapshots allowed; Future: client supplies character IDs and server builds snapshots from persisted character data |
| Adapters | Yes; add explicit API DTO → engine input mapper |
| Adapter location | Keep adapter in API layer (`app/api/combat/*`) |
| Adapter behavior | Structural mapping + explicit server defaults; no hidden gameplay mutation |
| Mapping failure behavior | Return 400 with structured field-level errors |
| Response contract | Decouple to API response DTO from engine result type |
| Response payload depth | Return full event log |
| Response naming | Use canonical normalized keys (`actorId`, `targetId`, `sourceId`, `rollBP`, `entityId`) |
| Response internals/debug fields | Include when exposed by canonical response DTO |
| Legacy payload handling | Hard cut; legacy request shapes rejected |
| Migration communication | Include explicit old→new contract examples in docs |
| Test implementation in this task | Test plan only (no test code changes) |
| Verification bar (implementation pass) | Full test suite + full type-check |
| Documentation updates in this task | Update `docs/analysis/review-findings.md` and `docs/architecture/SSOT.md` |
| Commit strategy | Single commit |

---

## Clarifications applied for “suggest” items

1. **Why introduce DTOs if they may look similar today?**
   - To prevent internal engine refactors from becoming accidental API breaking changes.
   - To let API-specific concerns (validation, error reporting, versioning) evolve independently of simulation internals.

2. **Why introduce adapters if mapping is near-identity?**
   - Adapters formalize boundary ownership and make future divergence safe.
   - They centralize policy decisions (server-generated seed, runtime-only initiative exclusion, metadata handling).
   - They make migration reviews explicit and testable.

3. **How `#11` (unknown fields) connects to `initiative` and metadata questions**
   - With `strict` validation, unknown fields are rejected globally.
   - `initiative` remains explicitly rejected because it is not part of the API DTO.
   - `side` and `name` are allowed because they are explicit optional DTO fields.

4. **Additional request constraints (what and why)**
   - Enforce deterministic and sane boundaries at API edge:
     - positive/valid combat stats,
     - `hp <= hpMax`,
     - tuple-size skill constraints,
     - different `playerInitial.entityId` and `enemyInitial.entityId`.
   - This reduces invalid simulation invocations and improves error quality.

---

## Problem Context

Entry 3 identifies that `app/api/combat/route.ts` currently validates requests directly against `CombatantSnapshot` (engine-facing shared type), coupling public API payload shape to internal simulation input evolution.

Current risks:
1. Engine-facing type changes can unintentionally break external API clients.
2. Validation policy and runtime mapping concerns are mixed in route logic.
3. There is no explicit API contract artifact to communicate and evolve independently.

This plan introduces a clear boundary:

**API DTO schema (public contract) → validated payload → adapter mapping → engine input types**.

---

## Target End State

1. `POST /api/combat` accepts only canonical API DTO request payloads (strict schema).
2. Route rejects unknown keys and legacy request variants.
3. Seed is generated server-side only.
4. Route maps validated DTO into engine input through a dedicated adapter.
5. Response is typed and emitted via a public API response DTO (full event log, canonical keys).
6. Contract ownership is documented in SSOT and review findings.

---

## Product Horizon Note (accepted by clarification)

Current tactical direction and future strategic direction are both valid and intentionally staged:

1. **Now (combat-rules focus):** Allow client-supplied snapshots as the request model to keep battle-rule iteration fast.
2. **Later (persistence-driven flow):** Shift external API to character-identity inputs (for example `playerCharacterId` / `enemyCharacterId`) and have server-side application code assemble simulation snapshots from persisted character data.

Implications for this Entry 3 plan:
- DTO + adapter boundary is still the correct immediate fix because it supports both phases without coupling API clients to engine internals.
- In the later phase, adapter responsibilities expand from near-identity mapping to hydration/orchestration (DB fetch + derivation + engine input assembly).

---

## Detailed Implementation Plan (for subsequent code pass)

## 1) Add API DTO schema/type layer

### Planned files
- `types/api/combat.ts` (new)

### Planned changes
1. Define `CombatRequestDtoSchema` with strict object validation.
2. Define nested combatant DTO schema with:
   - `entityId: string` (numeric-string format as currently expected),
   - required core stats,
   - `activeSkillIds` tuple length 2,
   - optional `passiveSkillIds` tuple length 2,
   - optional `side`/`name`,
   - no `initiative` allowed.
3. Define `CombatResponseDtoSchema` for stable API response surface using canonical event keys and full event log.
4. Infer `CombatRequestDto` and `CombatResponseDto` TypeScript types from Zod schemas.

### Why
- Creates explicit public contract ownership independent from engine internals.
- Enables rich validation errors and safer long-term versioning.

---

## 2) Refactor API route to DTO-first validation + mapping

### Planned files
- `app/api/combat/route.ts`
- `app/api/combat/adapters.ts` (new)

### Planned changes
1. Parse JSON safely; validate using `CombatRequestDtoSchema.safeParse(...)`.
2. Return standardized 400 envelope for validation failures:
   - `code: "INVALID_REQUEST"`
   - `message: "Request validation failed"`
   - `details: [{ path, message, rule }]`
3. Remove client-controlled `seed`; generate seed server-side in route.
4. Use adapter function(s) to map request DTO to engine call input.
5. Map engine result to `CombatResponseDto` (or assert compatibility and return typed DTO).
6. Keep handler behavior as single-request combat simulation.

### Why
- Enforces clean boundary and removes direct coupling to engine-internal contract drift.
- Standardizes error quality for API consumers.

---

## 3) Enforce API-level invariants at contract boundary

### Planned location
- Encoded primarily in DTO schema refinements (`types/api/combat.ts`)

### Planned constraints
1. `entityId` required and valid per accepted format.
2. `playerInitial.entityId !== enemyInitial.entityId`.
3. Stat integrity checks (including `hp <= hpMax`, positive numeric requirements).
4. Strict tuple validation for skills.
5. Reject unknown keys globally (`strict`).

### Why
- Moves correctness checks to a reusable contract layer and prevents malformed simulation input.

---

## 4) Documentation and source-of-truth updates

### `docs/analysis/review-findings.md`
- Update Entry 3 with a status note that the decoupling direction is locked:
  - API DTO-first validation,
  - strict schema checks,
  - adapter boundary,
  - server-generated seed,
  - legacy payload hard cut in implementation pass.

### `docs/architecture/SSOT.md`
- Extend Type Contract SSOT section to include:
  - API DTOs under `/types/api/*` as canonical for external API contracts,
  - engine input types as internal simulation contracts,
  - boundary mapping requirement from API DTOs to engine inputs.

### Why
- Prevents future ambiguity about where public vs internal contracts are owned.

---

## 5) Legacy payload migration notes (required)

Include explicit examples in docs for clients:
1. Remove request `seed` (now server-generated).
2. Remove any `initiative` field from input snapshots.
3. Replace any legacy or extra payload keys with canonical strict DTO keys.
4. Keep canonical event key expectations in response (`actorId`, `targetId`, `sourceId`, `rollBP`, `entityId`).

---

## Migration Checklist (implementation pass)

- [ ] Add `types/api/combat.ts` with strict Zod request/response schemas.
- [ ] Infer DTO types from schemas (schema-first ownership).
- [ ] Add API adapter module in `app/api/combat/adapters.ts`.
- [ ] Refactor route to validate DTOs before any engine calls.
- [ ] Remove client-provided seed and generate seed server-side.
- [ ] Enforce strict unknown-key rejection and no `initiative` in request.
- [ ] Return standardized validation error envelope.
- [ ] Ensure full event log response uses canonical normalized key names.
- [ ] Hard reject legacy request shapes.
- [ ] Add migration examples in docs for old→new payload differences.
- [ ] (Future phase) Introduce character-ID request DTO and server-side snapshot hydration path.
- [ ] Run full type-check and full test suite.

---

## Validation Plan (test-plan only; no tests implemented in this pass)

## A) Compile/static
1. Type-check confirms route consumes DTO types, not engine snapshot directly.
2. Adapter signatures enforce DTO-to-engine boundary.

## B) API request validation tests
3. Canonical valid request accepted.
4. Unknown extra keys rejected.
5. Request containing `initiative` rejected.
6. Missing required fields rejected with field-level details.
7. Malformed skill tuples rejected.
8. Same player/enemy entity IDs rejected.
9. Legacy request shape rejected.

## C) API response contract tests
10. Response conforms to API response DTO schema.
11. Full event log is present.
12. Canonical event keys are used consistently.

## D) Integration tests
13. End-to-end `POST /api/combat` succeeds with canonical DTO.
14. Seed in request payload is ignored/rejected per final schema (target: rejected because field not allowed).

## E) Merge gate
15. Full test suite + full type-check must pass.

---

## Non-goals for this pass

1. No production code changes in this documentation pass.
2. No API versioning rollout yet.
3. No batch simulation contract.
4. No immediate migration to character-ID-only request contract in this pass (tracked as future phase).
5. No changes outside `docs/fixes/fix-api-contract-validation.md`, `docs/analysis/review-findings.md`, and `docs/architecture/SSOT.md` in this pass.

---

## Risks and Mitigations

1. **Risk**: Hard-cut strict validation breaks undeclared clients.
   - **Mitigation**: Provide explicit migration examples and clear validation error details.

2. **Risk**: DTO and engine types drift over time.
   - **Mitigation**: Keep adapter boundary explicit and cover with contract tests in implementation pass.

3. **Risk**: Overly strict numeric constraints could block legitimate tuning values.
   - **Mitigation**: Start with SSOT-informed invariants and adjust deliberately via DTO schema updates.
