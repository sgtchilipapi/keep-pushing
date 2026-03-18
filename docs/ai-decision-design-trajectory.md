# AI Decision Design Trajectory

## Purpose

This document updates the assessment of the TODO notes in `engine/battle/aiDecision.ts` and proposes a practical redesign trajectory that:

- expands the AI decision context to include self/opponent/battle-tempo information,
- replaces hardcoded scoring constants with explicit feature weights,
- preserves deterministic behavior and replay safety,
- and introduces lightweight foresight without overcommitting to full tree search.

A delivery-grade implementation plan (tasks, milestones, tests, risks, rollout) is captured in `docs/ai-decision-implementation-plan.md`.

## Current State Assessment (Codebase Reality)

`aiDecision.ts` currently behaves as a deterministic single-pass heuristic scorer:

- candidate pool = basic attack + active skills with cooldown `0`,
- score = `basePower` + hardcoded contextual bonuses/penalties + learned per-skill residual,
- winner = highest score with lexical tie-break.

This model is stable and easy to debug, but strategically shallow:

1. **Input context is target-centric**: AI mostly sees target HP/status with little self-state or battle-tempo context.
2. **Hardcoded constants dominate policy**: fixed offsets encode behavior directly and can overshadow learned terms.
3. **No explicit intent representation**: offense/control/survival/setup get collapsed too early into one scalar.
4. **No explicit forecast**: setup actions are undervalued when their payoff happens next turn.

## Gap Analysis Against Desired Decision Information

### About self
Desired: archetype, HP current/max, skills available/cooldown, statuses, projected action/damage/recovery.

- **Available today**: HP, cooldowns, statuses (runtime), active skills.
- **Missing/partial**: explicit archetype identity in decision context, projected self outcome.

### About opponent
Desired: same as self plus probable next actions and projected outcomes.

- **Available today**: opponent HP/statuses from runtime state.
- **Missing/partial**: probable next action model and projected outcome model.

### Battle context
Desired: current round / total rounds.

- **Available today**: round index and max-round limit exist in battle loop.
- **Missing/partial**: not currently provided as explicit AI context fields.

## Design Principles

1. **Determinism first**: same inputs must produce the same action and trace.
2. **Feature transparency**: every decision score must be explainable by named terms.
3. **Policy by configuration**: tune behavior through weights, not hardcoded logic branches.
4. **Shallow foresight before deep search**: add one-turn deterministic proxies before any branching planner.
5. **Backwards-safe migration**: each phase ships with parity/behavior tests and trace compatibility strategy.

## Proposed Architecture

### 1) Decision context expansion
Introduce a read-only `DecisionContext` passed from battle engine to AI scorer.

```ts
export type DecisionContext = {
  actor: {
    entityId: string;
    archetypeId?: string;
    hp: number;
    hpMax: number;
    statuses: readonly StatusId[];
    activeSkillIds: readonly [string, string];
    cooldowns: Record<string, number>;
  };
  target: {
    entityId: string;
    archetypeId?: string;
    hp: number;
    hpMax: number;
    statuses: readonly StatusId[];
    activeSkillIds?: readonly [string, string];
    cooldowns?: Record<string, number>;
  };
  battle: {
    round: number;
    maxRounds: number;
    roundsRemaining: number;
  };
};
```

### 2) Feature extraction layer
Move scoring signals into explicit features, e.g.:

- `expectedDamageNow`
- `executeOpportunity`
- `stunRedundancy`
- `shieldBreakOpportunity`
- `selfSurvivalPressure`
- `targetThreatEstimate`
- `cooldownOpportunityCost`
- `nextTurnSynergyEstimate` (deterministic one-turn proxy)

### 3) Weight-based scoring
Replace fixed constants with weight tables:

```ts
score(skill) = Σ(featureValue(feature, skill, context) * weight(feature, archetype))
             + learnedResidual(skill)
```

### 4) Intent layer (phase-gated)
Add dynamic intent weights (`finish`, `survive`, `control`, `setup`, `attrition`) derived from context. Skill score becomes weighted utility across intents plus residual.

### 5) Opponent action likelihood (lightweight)
Estimate probable next opponent action via mirrored deterministic scoring (top-1 or top-k normalized ranking), then reuse it for projected incoming damage/recovery proxies.

## Delivery Phases and Cost Envelope

### Phase 0 — Structural refactor, no behavior change
- Isolate `extractFeatures` and `scoreFeatures` internals.
- Preserve existing outcome order and trace fields.
- Add parity tests.

**Effort**: ~1–2 engineering days.

### Phase 1 — Context expansion + feature-weight migration
- Introduce `DecisionContext` from battle engine.
- Map existing constants to named features with default weights reproducing current behavior.
- Keep deterministic selection and tie-break.

**Effort**: ~3–5 engineering days.

### Phase 2 — Intent-conditioned scoring
- Add intent derivation and per-skill intent utility.
- Add behavior tests for finish/survive/control scenarios.

**Effort**: ~4–7 engineering days.

### Phase 3 — Learning upgrade
- Keep skill residual, then add optional bounded feature-level residual updates.
- Add confidence/caps to prevent runaway policy shifts.

**Effort**: ~3–6 engineering days.

### Phase 4 — Lightweight foresight
- One-turn projection for self/opponent expected damage/recovery.
- Optional top-N shallow evaluation before final pick.

**Effort**: ~5–10 engineering days.

### Total practical MVP window
For the requested richer decision information (without deep planner): **~2–4 weeks** for one engineer, including tuning and tests.

## Non-Obvious Costs and Risks

1. **Balance/tuning overhead** likely exceeds pure coding time once feature counts grow.
2. **Test fixture churn** as assertions shift from hardcoded constants to behavior/trace semantics.
3. **Trace schema evolution** requires backward-compatible logging strategy.
4. **Projection drift risk** if forecast proxies diverge from actual resolver outcomes.
5. **Complexity creep** if multi-turn lookahead is attempted before single-turn model stabilizes.

## Guardrails

- Do not introduce stochastic policy sampling.
- Keep lexical tie-break for stable replay outputs.
- Any new feature must have at least one direct unit test and one scenario-level behavior test.
- Gate expensive foresight behind deterministic budget limits.
- Keep an easy fallback path to single-step scorer.

## Immediate Next Steps

1. Land `DecisionContext` plumbing and AI trace v2 fields.
2. Implement feature extraction that mirrors current behavior under default weights.
3. Add parity tests proving no behavior regression with default weights.
4. Add a focused behavior suite for finish/survive/control/setup choices.
5. Implement one-turn projection helpers for expected incoming/outgoing damage and recovery.

## Related Documents

- `docs/ai-decision-implementation-plan.md` (detailed execution plan)
- `docs/planned-features.md` (portfolio-level tracking)
