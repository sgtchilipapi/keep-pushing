# AI Decision Design Trajectory

## Purpose

This document updates the assessment of the TODO notes in `engine/battle/aiDecision.ts` and proposes a practical redesign trajectory that:

- expands the AI decision context to include self/opponent/battle-tempo information,
- replaces hardcoded scoring constants with explicit feature weights,
- preserves deterministic behavior and replay safety,
- and introduces lightweight foresight without overcommitting to full tree search.

A delivery-grade implementation plan (tasks, milestones, tests, risks, rollout) is captured in `docs/ai-decision-implementation-plan.md`.
That implementation plan should keep the current documents as the **capability map**, while executing delivery as **vertical slices** that cut across those capabilities end-to-end.

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

## Preferred Direction: Option B (Weak-Prior + Learning Hybrid)

This trajectory should favor **Option B**: start combatants with weak, near-neutral priors and let repeated combat experience drive most policy improvement.

Option B is the best fit for the current codebase because it preserves deterministic scoring and debuggability while avoiding both extremes:

- **Not Option A (pure self-tuning)**: pure self-tuning is attractive philosophically, but in the current architecture it would make early variance, credit-assignment errors, and local optima too influential.
- **Not Option C (designer-weighted but learnable)**: heavily authored priors would keep behavior stable, but would weaken the goal of agents genuinely learning their own combat preferences.

Under Option B:

- authored weights exist only as weak priors or tie-break helpers,
- learning is expected to dominate long-run behavior,
- hard tactical scripts are avoided,
- and numeric stability controls exist only to keep learning from collapsing.

## Design Principles

1. **Determinism first**: same inputs must produce the same action and trace.
2. **Feature transparency**: every decision score must be explainable by named terms.
3. **Weak priors, strong learning**: initial weights should be small enough that repeated combat experience meaningfully reshapes policy.
4. **No hard tactical scripts**: avoid authoring fixed behavior rules except where required for legality or deterministic replay.
5. **Shallow foresight before deep search**: add one-turn deterministic proxies before any branching planner.
6. **Backwards-safe migration**: each phase ships with parity/behavior tests and trace compatibility strategy.

## Proposed Architecture

### 1) Decision context expansion
Introduce a read-only `DecisionContext` passed from battle engine to AI scorer.

**Status**: completed on the current branch for the Slice 1 parity increment and expanded in Slice 3; actor/target/battle snapshots now flow into `chooseAction(...)`, decision traces include a versioned `context` payload, and the snapshots carry the combat stats needed for deterministic one-turn forecasting.

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

### 3) Weight-based scoring with weak priors
Replace fixed constants with weight tables, but treat authored weights as weak priors rather than durable hand-authored strategy:

```ts
score(skill) = Σ(featureValue(feature, skill, context) * priorWeight(feature, archetype))
             + learnedResidual(skill)
```

In Option B, the prior term should be intentionally low-magnitude so that repeated combat outcomes can outweigh it over time.

### 4) Intent layer (phase-gated)
Add dynamic intent weights (`finish`, `survive`, `control`, `setup`, `attrition`) derived from context. Skill score becomes weighted utility across intents plus residual.

### 5) Opponent action likelihood (lightweight)
Estimate probable next opponent action via mirrored deterministic scoring (top-1 or top-k normalized ranking), then reuse it for projected incoming damage/recovery proxies.

### Future add-on: personality priors and strategy templates
Two future extensions fit the current Option B direction well if they remain low-magnitude and fully traceable:

- **Personality templates as base priors**: personality presets such as aggressive, cautious, controller, or attrition-focused can provide small feature-prior offsets on top of the neutral/default weight table. This should affect the prior layer only, so learning can still dominate long-run behavior.
- **Strategy templates as intent-derivation presets**: strategy presets such as rushdown, turtle, control, or opportunist can adjust the thresholds and ramps used by `deriveIntentWeights(...)` rather than directly hardcoding final intent weights. This preserves deterministic, context-explainable intent outputs while allowing authored tactical framing.

Recommended constraint for both add-ons:

- keep templates additive and low-magnitude,
- keep them separate from learned residuals,
- expose their contribution in decision traces,
- and avoid using them as hard tactical scripts.

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
For the requested richer decision information under **Option B** (without deep planner): **~2–4 weeks** for one engineer, including learning calibration and tests.

## Non-Obvious Costs and Risks

1. **Balance/tuning overhead** likely exceeds pure coding time once feature counts grow.
2. **Test fixture churn** as assertions shift from hardcoded constants to behavior/trace semantics.
3. **Trace schema evolution** requires backward-compatible logging strategy.
4. **Projection drift risk** if forecast proxies diverge from actual resolver outcomes.
5. **Complexity creep** if multi-turn lookahead is attempted before single-turn model stabilizes.

### Why balance/tuning overhead can dominate implementation time

The coding work is mostly finite (new context types, scoring functions, projection helpers). The tuning work is open-ended because each new feature creates an interaction surface with every other feature.

Illustrative example with 8 features:

- At implementation time, we add 8 weight values and deterministic formulas.
- At tuning time, we must validate behavior across many tactical states (high HP, low HP, cooldown windows, status stacks, speed mismatch, mirror matchups, etc.).
- A small change to one weight (for example, survival pressure) can unexpectedly flip decisions in several other states where setup/control also has influence.

In practice, one extra feature often implies:

- more scenario tests,
- more simulation re-runs,
- and more iteration cycles to avoid regressions in previously good behaviors.

This is why balancing cost can exceed raw coding cost even in a deterministic model.

### Self-tuning vision within Option B

Your direction is valid, and Option B is exactly the compromise this plan should favor: start agents with weak priors and let repeated combat push policy toward better outcomes.

Recommended interpretation of “no guardrails” for this system:

- **No hard tactical scripts** (e.g., always use X below Y HP).
- **No fixed hand-authored policy tree**.
- **Learning drives policy movement** through outcome-linked updates.

However, we should still keep **numerical safety constraints** (not tactical constraints):

- bounded update magnitudes,
- bounded weight ranges,
- deterministic tie-breaks.

These are not behavior guardrails; they are stability rails to prevent irreversible collapse from noisy short-term outcomes.

### Illustration: how natural improvement can still fail without numeric safety

Suppose all feature weights initialize near `0` and learning updates are fully unconstrained:

1. Early random streak favors high-variance stun usage.
2. Large positive updates over-credit stun features after a few wins.
3. Agent over-commits to stun loops even when damage race requires finishing.
4. Policy drifts into local optimum and win-rate falls versus resilient archetypes.

With bounded updates + many-match averaging, the same system can still self-tune organically while avoiding unstable swings.

So the Option B goal is:

- **organic policy emergence** from play outcomes,
- with **weak authored priors** instead of strong designer strategy,
- with **numerical stability controls**,
- and without hardcoded tactical behavior constraints.

## Guardrails

- Do not introduce stochastic policy sampling.
- Keep lexical tie-break for stable replay outputs.
- Any new feature must have at least one direct unit test and one scenario-level behavior test.
- Gate expensive foresight behind deterministic budget limits.
- Keep an easy fallback path to single-step scorer.
- Prefer soft numeric safety (bounded ranges/step sizes) over hard tactical rules so self-tuning remains organic.

## Immediate Next Steps

1. ✅ Landed `DecisionContext` plumbing and AI trace v2 fields on the current branch.
2. Next: implement feature extraction that mirrors current behavior under **weak-prior defaults**.
3. Next: add parity tests proving no behavior regression with the transitional defaults.
4. Next: add a focused behavior suite for finish/survive/control/setup choices.
5. Next: implement learning calibration batches that verify long-run policy movement away from priors.
6. Next: implement one-turn projection helpers for expected incoming/outgoing damage and recovery.

## Related Documents

- `docs/ai-decision-implementation-plan.md` (detailed execution plan)
- `docs/planned-features.md` (portfolio-level tracking)

## Current delivery note

Slice 3 is now implemented on the current branch: the scorer predicts the opponent's most likely action with mirrored deterministic evaluation, projects one-turn outgoing/incoming pressure plus simple round-start status continuation, and records those projection terms in `decision-trace.v4`.
