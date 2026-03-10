# AI Decision Design Trajectory

## Purpose

This document assesses the TODO notes in `engine/battle/aiDecision.ts` and outlines a practical redesign trajectory that removes brittle hardcoded behavior while preserving deterministic, testable AI choices.

## Current State Assessment

`aiDecision.ts` currently works as a **single-pass heuristic scorer**:

- Builds candidate skills from basic attack + currently available active skills.
- Scores each skill with a base value (`skill.basePower`) plus contextual bonuses/penalties.
- Adds learned per-skill preference weight (`scoreLearnedWeightTerm`).
- Selects the highest score with lexical tie-break for determinism.

This is functional for MVP, but the TODO comments correctly identify structural issues:

1. **State inputs are too narrow**: decisions mostly inspect target HP/status, not richer combat context.
2. **Hardcoded constants dominate behavior**: static bonuses can overshadow learning and force designer intent.
3. **No explicit intent layer**: offense, control, sustain, setup, and risk are mixed into one scalar too early.
4. **Limited temporal planning**: no representation of “set up now to exploit next turn.”

## Assessment of Each TODO Cluster

### 1) Decision snapshot is too shallow

**Assessment**: Valid concern. The current `DecisionCombatantSnapshot` is minimal and target-centric, so many meaningful tactical choices cannot be represented.

**Recommendation**: Expand the snapshot into a full, read-only decision context while keeping it deterministic.

Suggested additions:

- Actor state: HP%, statuses, role/archetype, active cooldowns.
- Opponent state: HP%, statuses, likely threat estimate.
- Skill metadata: expected damage proxy, hit chance, utility tags/effects.
- Battle tempo: turn index, recent actions, status durations if available.

### 2) Hardcoded bonuses/penalties (`ACTIVE_AVAILABLE_BONUS`, etc.)

**Assessment**: Valid concern. Hardcoded offsets are useful bootstrap scaffolding, but they become policy locks and create hidden prioritization.

**Recommendation**: Replace static constants with parameterized feature weights.

- Convert each rule into a named feature contribution (e.g., `executeOpportunity`, `stunRedundancy`, `shieldBreakOpportunity`).
- Move coefficients to a configurable weight table per archetype.
- Keep deterministic computation but allow offline tuning and learning updates.

### 3) Base score starts from `skill.basePower`

**Assessment**: Partially valid. Base power is a reasonable prior for damaging actions but is not semantically complete for non-damage utility skills.

**Recommendation**: Use **intent-conditioned scoring** instead of a single universal base.

- Compute intent scores first (e.g., `finish`, `survive`, `control`, `setup`, `pressure`).
- Compute skill utility per intent.
- Final score = weighted sum across intents + learned residual.

This retains simple scalar ranking but avoids biasing all skills through pure damage-centric priors.

### 4) Reapply stun penalty and shieldbreak bonus feel over-scripted

**Assessment**: Valid concern. These are domain heuristics that should be feature-level signals rather than hard bans/boosts.

**Recommendation**:

- Keep the signals (they are strategically meaningful).
- Demote them from fixed constants to weighted features.
- Permit learning to override when context supports edge-case behavior.

Example: `stunRedundancy` can be mildly negative by default rather than a huge absolute penalty.

### 5) Think-ahead note (future-turn setup)

**Assessment**: Good strategic direction, but full lookahead may exceed MVP complexity.

**Recommendation**: Introduce a lightweight one-step expected value feature first.

- Add `nextTurnSynergyEstimate` (e.g., chance that using control now improves expected damage next turn).
- Use deterministic proxies initially.
- Defer full tree search/rollouts until combat rules stabilize.

## Proposed Redesign (Phased)

### Phase 0 — Refactor without behavior change

- Isolate feature extraction from scoring.
- Name and log all feature contributions for observability.
- Preserve current outputs to avoid regressions.

### Phase 1 — Feature-based deterministic model

- Replace hardcoded constants with weight table(s).
- Expand decision context with actor + battle-tempo signals.
- Keep deterministic tie-break and no random policy sampling.

### Phase 2 — Intent layer

- Add explicit intents (`finish`, `survive`, `control`, `setup`, `attrition`).
- Derive dynamic intent weights from context (e.g., low HP increases `survive`).
- Score each skill as utility across intents.

### Phase 3 — Learning integration upgrade

- Keep `scoreLearnedWeightTerm`, but apply as residual term over interpretable features.
- Persist per-archetype feature weights and confidence.
- Guardrails: cap update magnitude to prevent instability.

### Phase 4 — Lightweight foresight

- Add one-turn proxy for setup value and cooldown timing opportunities.
- Optionally evaluate top-N actions with shallow next-turn estimate.
- Maintain deterministic fallback to current single-step scorer.

## Suggested Target Interfaces

```ts
export type DecisionContext = {
  actor: {
    hp: number;
    hpMax: number;
    statuses: readonly StatusId[];
    cooldowns: Record<string, number>;
    archetypeId?: string;
  };
  target: {
    hp: number;
    hpMax: number;
    statuses: readonly StatusId[];
  };
  turn: number;
};

export type FeatureVector = Record<string, number>;

export type DecisionWeights = {
  feature: Record<string, number>;
  intent?: Record<string, number>;
};
```

## MVP Guardrails

To keep implementation practical:

- Do not implement full game-tree planning yet.
- Keep deterministic output for replay/testing.
- Require each new feature to have at least one unit test.
- Expose per-decision debug trace in test/dev mode.

## Recommended Next Steps

1. Introduce `DecisionContext` and `extractDecisionFeatures(...)` with parity tests.
2. Migrate current hardcoded rules into feature contributions behind default weights.
3. Add 3–5 behavior tests that validate intent-like outcomes (finish, survive, control timing).
4. Add debug tracing of score breakdown for balancing.

This path keeps the current AI functional while moving toward a more organic, learnable, and extensible decision system.
