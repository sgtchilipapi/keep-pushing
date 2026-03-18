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

## Execution Model

The current documents should remain the **capability map**: WS1-WS6 still describe the major technical concerns that must exist in the final system.

However, delivery should execute those capabilities as **vertical slices**. Each slice should cut through contracts, scoring, tests, logging, and rollout concerns to produce an end-to-end usable increment.

In other words:

- **WS1-WS6 answer _what capabilities we need_.**
- **Vertical slices answer _how we should ship them_.**

This keeps the architecture legible while avoiding a delivery plan that only moves horizontally through subsystems.

**Important**: WS1-WS6 are **not** the execution order for implementation tickets. They are reference buckets describing the capability surface. Implementation should be planned, assigned, and shipped by the vertical slices defined later in this document.

## Capability Map (Workstreams)

## WS1 — Contracts and data plumbing

### Capability intent

WS1 defines the shared decision-time contracts and plumbing required to move battle state into the AI layer in a deterministic, read-only form.

### Includes

- AI-facing context contracts such as `DecisionContext`, `DecisionActorState`, `DecisionTargetState`, and `DecisionBattleState`.
- Battle-engine plumbing that passes actor state, target state, and round/max-round context into decision selection.
- Decision-log payload structure and versioning metadata for trace consumers.

### Capability is present when

- AI receives actor + target + battle context without reading mutable runtime objects directly.
- TypeScript compilation passes.
- Existing battle simulations remain deterministic.

### Evidence

- Unit/regression coverage proves decision traces include the new context fields.
- Parity checks prove the richer context does not change action selection under transitional defaults.

## WS2 — Feature extraction + weak-prior parity layer

### Capability intent

WS2 defines the feature-scoring foundation that replaces hardcoded action bonuses with explicit, inspectable scoring terms while preserving a transitional parity mode.

### Includes

- Feature extraction primitives such as `extractSkillFeatures(skill, context)`.
- Weighted scoring primitives such as `scoreSkillWithWeights(features, weights, learnedResidual)`.
- Transitional mappings from current hardcoded behavior into named features like active-skill preference, execute opportunity, stun redundancy, and shieldbreak opportunity.
- Deterministic tie-break preservation.

### Capability is present when

- Under transitional defaults, selected actions match the legacy scorer in the existing scenario matrix.
- Decision traces expose per-feature contributions.
- The scoring system can later reduce transitional defaults toward weak-prior defaults without API redesign.

### Evidence

- Parity tests cover representative combinations such as low target HP + execute, target stunned + stun-tagged skill, target shielded + shieldbreak-tagged skill, and cooldown-gated candidate sets.

## WS3 — Intent-conditioned scoring

### Capability intent

WS3 defines the intent layer that converts raw features into context-sensitive tactical pressure such as finishing, surviving, controlling, setting up, or playing attrition.

### Includes

- Intent sets such as `finish`, `survive`, `control`, `setup`, and `attrition`.
- Context-driven intent-weight derivation.
- Per-intent utility mapping from extracted features.
- Final score composition that combines intent utilities with learned residuals and low-magnitude priors.

### Capability is present when

- Intent weights are deterministic and explainable from context.
- Utility skills can outrank pure damage in high-survival-pressure contexts.
- Intent weighting still allows learning residuals to become the dominant long-run policy term.

### Evidence

- Behavior tests demonstrate low-self-HP defensive choices, low-target-HP finishing choices, and setup/control choices when near-future value exceeds immediate damage.

## WS4 — Opponent probable-action and one-turn projections

### Capability intent

WS4 defines lightweight anticipation: the system's ability to estimate likely opponent action and project one-turn incoming/outgoing value without escalating to deep search.

### Includes

- Deterministic opponent-action prediction based on mirrored scoring.
- One-turn projection helpers for outgoing damage/recovery, incoming damage/recovery, and simple status continuation effects.
- Projection-derived features that can influence action selection with bounded weight contribution.

### Capability is present when

- Projections are deterministic and bounded.
- AI traces expose projected values and the rationale they contributed to.

### Evidence

- Unit tests validate projection arithmetic and clamping.
- Scenario tests prove projected incoming pressure changes action choice in expected situations.

## WS5 — Learning model integration

### Capability intent

WS5 defines how weak priors and repeated combat experience produce long-run policy improvement without abandoning determinism or numeric stability.

### Includes

- Preservation of current per-skill residual behavior as a compatibility baseline.
- Optional feature-level residual adjustment with bounded numeric update rules.
- Confidence/decay logic to reduce short-streak overreaction.
- Near-neutral initial priors that encourage learning-led policy formation.

### Capability is present when

- Learning updates remain bounded and deterministic.
- Legacy skill-level learning mode remains available as fallback.
- Agents with near-neutral priors improve win-rate over repeated deterministic training batches in benchmark scenarios.

### Evidence

- Clamp/cap tests validate update boundaries.
- Stability tests validate repeated simulated battles do not drift destructively.
- Progression tests compare early-batch and late-batch win-rate across multiple matchup archetype pairs.

### Clarification on “guardrails”

This capability avoids hard tactical scripting (for example, forcing specific skills under fixed HP thresholds). Instead, it uses numeric safety constraints only:

- bounded update sizes,
- bounded parameter ranges,
- deterministic selection/tie-break.

These constraints preserve organic self-tuning while preventing destructive drift from short-run variance.

## WS6 — Traceability, migration, and rollout

### Capability intent

WS6 defines the observability, compatibility, and controlled-rollout surface required to ship the new AI safely.

### Includes

- Versioned decision-trace schemas.
- Backward-compatible migration fields during transition periods.
- Model/config gates such as `aiModel: 'legacy' | 'feature_v1' | 'intent_v1'`.
- Balancing and tuning playbook documentation.

### Capability is present when

- Legacy and new models can be toggled without code changes.
- Replay output remains stable under the same model version and seed.

### Evidence

- Snapshot tests cover model-version trace outputs.
- Determinism tests repeat identical seeds/contexts and prove stable outcomes.

## Vertical Slice Delivery Plan

The slices below are the **only intended execution model** for implementation work. A coding agent should not pick up WS1-WS6 one-by-one as a horizontal sequence. Instead, each implementation increment should be framed as one of these slices and may touch multiple workstreams at once.

### Slice 1 — Rich decision context with parity behavior

**Goal**: deliver a richer end-to-end `DecisionContext` and trace model while preserving current action selection.

**Touches capabilities**:
- WS1 contracts and plumbing,
- WS2 parity scoring foundation,
- WS6 trace/versioning support.

**Done when**:
- AI receives actor/target/battle context,
- decision traces expose the richer context,
- legacy-equivalent action selection is preserved under transitional defaults.

### Slice 2 — Intent-aware tactical behavior

**Goal**: deliver the first visible decision-quality improvement, especially around finish/survive/control tradeoffs.

**Touches capabilities**:
- WS2 feature extraction,
- WS3 intent-conditioned scoring,
- WS6 rollout/testing gates.

**Done when**:
- behavior tests demonstrate improved survival/finish/control choices,
- traces explain intent influence,
- weak priors still allow learned residuals to dominate over time.

### Slice 3 — Opponent-aware one-turn forecasting

**Goal**: deliver lightweight anticipation so setup/control can be valued for near-future payoff.

**Touches capabilities**:
- WS2 feature extraction updates,
- WS4 opponent prediction and one-turn projections,
- WS6 determinism and trace coverage.

**Done when**:
- AI can estimate probable opponent next action,
- projected incoming/outgoing damage/recovery appears in traces,
- scenario tests prove projections change decisions in expected spots.

### Slice 4 — Weak-prior learning progression

**Goal**: deliver the Option B promise that repeated combat meaningfully improves policy from near-neutral priors.

**Touches capabilities**:
- WS5 learning integration,
- WS6 rollout/model-gating,
- plus the already-landed scoring and projection foundations.

**Done when**:
- deterministic training batches show measurable improvement from near-neutral priors,
- learning remains bounded and stable,
- rollout gates check parity, behavior, and progression together.

## Milestones and Timeline (single engineer estimate)

1. **M1 (Week 1)**: Slice 1 complete (WS1 + WS2 + WS6 parity plumbing).
2. **M2 (Week 2)**: Slice 2 complete (WS2 + WS3 tactical behavior improvements).
3. **M3 (Week 3)**: Slice 3 complete (WS2 + WS4 one-turn forecasting).
4. **M4 (Week 4)**: Slice 4 complete (WS5 + WS6 learning progression gates).
5. **M5 (Week 5, optional)**: extended deterministic training leagues and rebalance pass.

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
2. Land Slice 1 and run CI scenario matrix comparing legacy vs transitional parity.
3. Land Slice 2 and require behavior gates for finish/survive/control scenarios.
4. Land Slice 3 and require projection-aware determinism and trace coverage.
5. Land Slice 4, reduce priors toward weak-prior defaults, and validate deterministic learning progression.
6. Promote `feature_v1` to default when parity, behavior, projection, and learning-progression gates are green.
