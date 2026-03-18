# AI Decision Redesign — Detailed Implementation Plan

## Objective

Implement a deterministic, feature-driven AI decision system that favors **Option B (weak-prior + learning hybrid)** and can reason over:

- **Self**: archetype, HP, statuses, available skills/cooldowns, projected damage/recovery,
- **Opponent**: equivalent snapshot plus probable next action and projected impact,
- **Battle context**: current round and remaining rounds,

while maintaining replay stability and testability.

## Scope

### In scope

- Decision context expansion and plumbing from battle engine.
- Feature extraction and weight-based scoring.
- Intent-conditioned scoring (phase-gated).
- One-turn deterministic projections.
- Decision trace schema upgrades and tests.

### Out of scope (for this plan)

- Full tree search / Monte Carlo rollout planner.
- Non-deterministic policy sampling.
- Loot/flee chance modeling (not currently needed).

## Chosen Policy Direction

This implementation plan explicitly favors **Option B**:

- initialize agents with weak, near-neutral priors,
- preserve deterministic scoring and traces,
- let repeated combat learning dominate long-run policy,
- avoid hard tactical scripts,
- and keep only numeric stability controls.

This means the implementation should optimize for **learnability and observability**, not for hand-authoring a strong static policy.

## Workstreams

## WS1 — Contracts and data plumbing

### Tasks

1. Add AI-facing context contracts in `engine/battle/aiDecision.ts` (or extracted file):
   - `DecisionContext`, `DecisionActorState`, `DecisionTargetState`, `DecisionBattleState`.
2. Update battle engine `chooseAction(...)` call to pass full context:
   - actor state, target state, round/max rounds.
3. Extend optional `decisionLogger` payload with context versioning metadata.

### Acceptance criteria

- AI receives actor + target + battle context without reading mutable runtime objects directly.
- TypeScript compilation passes.
- Existing battle simulations remain deterministic.

### Tests

- Add/adjust unit test to assert decision trace includes new context fields.
- Add regression test proving same selected skill under default parity weights.

## WS2 — Feature extraction + weak-prior parity layer

### Tasks

1. Introduce `extractSkillFeatures(skill, context)` returning named feature map.
2. Introduce `scoreSkillWithWeights(features, weights, learnedResidual)`.
3. Map old hardcoded terms to equivalent transitional weights/features while preparing to reduce them toward weak priors:
   - active skill bonus,
   - execute opportunity,
   - stun redundancy,
   - shieldbreak opportunity.
4. Keep tie-break behavior unchanged.

### Acceptance criteria

- Under transitional defaults, selected actions match legacy scorer for existing scenario matrix.
- Decision trace includes per-feature contributions.
- The weight system supports a later reduction from parity defaults to weak-prior defaults without API redesign.

### Tests

- Parity test set for representative combinations:
   - low target HP + execute,
   - target stunned + stun-tagged skill,
   - target shielded + shieldbreak-tagged skill,
   - cooldown-gated candidate set.

## WS3 — Intent-conditioned scoring

### Tasks

1. Define intent set and context-driven intent weights:
   - `finish`, `survive`, `control`, `setup`, `attrition`.
2. Add per-intent utility mapping from features.
3. Compose final score as intent-weighted utility + residual.
4. Add config object for archetype-level intent/feature weights, keeping priors intentionally low-magnitude by default.

### Acceptance criteria

- Intent weights are deterministic and explainable from context.
- Utility skills can outrank pure damage in high-survival-pressure contexts.
- Intent weighting still allows learning residuals to become the dominant long-run policy term.

### Tests

- Behavior tests:
   - low self HP chooses defensive utility over minor damage,
   - low target HP prefers finisher behavior,
   - setup/control chosen when immediate damage is lower but next-turn value is higher.

## WS4 — Opponent probable-action and one-turn projections

### Tasks

1. Build deterministic opponent action predictor:
   - mirror scoring with opponent-as-actor, self-as-target,
   - expose top-1 or top-k probability-like normalized scores.
2. Add one-turn projection helpers:
   - expected outgoing damage/recovery,
   - expected incoming damage/recovery (from predicted opponent action),
   - simple status continuation effects.
3. Add projection features into scoring with bounded weights.

### Acceptance criteria

- Projections are deterministic and bounded.
- AI trace logs projected values and selected rationale.

### Tests

- Unit tests for projection arithmetic and clamping.
- Scenario tests where projected incoming damage changes chosen action.

## WS5 — Learning model integration

### Tasks

1. Preserve current per-skill residual (`scoreLearnedWeightTerm`) behavior.
2. Add optional feature-level residual adjustment with bounded numeric update rules.
3. Add confidence/decay logic to reduce short-streak overreaction.
4. Initialize new agents with near-neutral (very low-magnitude) prior weights to encourage learning-led policy formation.

### Acceptance criteria

- Learning updates remain bounded and deterministic.
- Legacy skill-level learning mode remains available as fallback.
- Agents with near-neutral priors improve win-rate over repeated deterministic training batches in benchmark scenarios.

### Tests

- Clamp/cap tests for update steps.
- Stability tests over repeated simulated battles.
- Progression tests comparing early-batch and late-batch win-rate for at least 3 matchup archetype pairs.

### Clarification on “guardrails”

This plan avoids hard tactical scripting (for example, forcing specific skills under fixed HP thresholds). Instead, it uses numeric safety constraints only:

- bounded update sizes,
- bounded parameter ranges,
- deterministic selection/tie-break.

These constraints preserve organic self-tuning while preventing destructive drift from short-run variance.

## WS6 — Traceability, migration, and rollout

### Tasks

1. Version decision trace schema (e.g., `decisionTraceVersion: 2`).
2. Keep backward-compatible fields during migration window.
3. Add feature flag / config gate:
   - `aiModel: 'legacy' | 'feature_v1' | 'intent_v1'`.
4. Document balancing/tuning playbook.

### Acceptance criteria

- Legacy and new models can be toggled without code changes.
- Replay output remains stable under same model version + seed.

### Tests

- Snapshot tests by model version.
- Determinism test repeated N runs with same seed/context.

## Milestones and Timeline (single engineer estimate)

1. **M1 (Week 1)**: WS1 + WS2 transitional parity foundation complete.
2. **M2 (Week 2)**: WS3 intent scoring complete with behavior tests.
3. **M3 (Week 3)**: WS4 one-turn projection complete.
4. **M4 (Week 4)**: WS5 learning upgrades + weak-prior calibration complete.
5. **M5 (Week 5, optional)**: run deterministic training leagues to confirm Option B policy improvement over priors.

## File-Level Change Plan (expected)

- `engine/battle/aiDecision.ts`
  - add context contracts, feature extraction, weighted scorer, trace v2.
- `engine/battle/battleEngine.ts`
  - pass richer context + battle round state to `chooseAction`.
- `engine/battle/learning.ts`
  - optional feature-level residual APIs.
- `tests/aiDecision.decisionLog.test.ts`
  - trace schema + feature contribution assertions.
- `tests/combatSimulation.scenarioMatrix.test.ts`
  - parity and behavior scenario coverage.
- `docs/ai-decision-design-trajectory.md`
  - architecture and rationale summary.

## Definition of Done

- Deterministic behavior verified for same seed and model version.
- Transitional parity achieved for `feature_v1` defaults in baseline scenarios.
- Intent behavior tests cover at least 5 tactical scenarios.
- Trace output explains selected action with named feature contributions.
- Documentation updated with tuning guidance and migration notes.

## Risks and Mitigations

1. **Risk**: behavior regressions from context expansion.
   - **Mitigation**: parity defaults + scenario regression matrix.
2. **Risk**: overfitting to handcrafted weights.
   - **Mitigation**: initialize near-neutral priors and let repeated match outcomes drive most policy movement; use audits only for diagnostics.
3. **Risk**: projection inaccuracies skew action choice.
   - **Mitigation**: start with 1-turn conservative proxies and calibrate against sim outputs.
4. **Risk**: test brittleness from exact-score assertions.
   - **Mitigation**: prefer ranking/behavior assertions over raw constants where possible.
5. **Risk**: uncontrolled self-tuning drift (local optima from lucky streaks).
   - **Mitigation**: many-match averaging, bounded numeric updates, and regression leagues against fixed reference opponents.

## Backlog Tickets (suggested)

1. `AI-101` Add `DecisionContext` and battle-engine plumbing.
2. `AI-102` Introduce feature extraction and weighted scorer parity mode.
3. `AI-103` Add decision trace v2 with feature contributions.
4. `AI-104` Add intent-weight derivation and utility aggregation.
5. `AI-105` Add opponent action predictor and one-turn projection helpers.
6. `AI-106` Add bounded feature-level learning residuals.
7. `AI-107` Add weak-prior calibration harness and deterministic training leagues.
8. `AI-108` Add model version flag and replay compatibility coverage.
9. `AI-109` Add scenario matrix expansion for Option B learning progression.

## Rollout Strategy

1. Ship `feature_v1` behind config flag, default to legacy.
2. Run CI scenario matrix comparing legacy vs transitional parity.
3. Enable `feature_v1` in test environment with trace logging.
4. Reduce priors toward weak-prior defaults and validate deterministic training improvement.
5. Promote `feature_v1` to default when parity, behavior, and learning-progression gates are green.
