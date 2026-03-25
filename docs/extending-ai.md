# Extending the AI Combat Decision System

This guide explains the entire AI combat decision system end to end: the data contracts, the runtime battle plumbing, the scoring model, the one-turn forecast layer, status interactions, and the learning hooks that can bias decisions over time.

The goal is to make it safe to extend the AI without accidentally breaking determinism, replay stability, or the battle engine's assumptions.

---

## 1. Overview

At a high level, AI decision-making is not a separate service or planner. It is a deterministic scoring pipeline embedded directly into the battle loop.

When a combatant is ready to act:

1. The battle engine builds a read-only `DecisionContext` snapshot for the acting unit and its target.
2. The engine calls `chooseAction(...)` from `engine/battle/aiDecision.ts`.
3. `chooseAction(...)` enumerates candidate skills that are currently usable.
4. The AI derives tactical intent weights from current HP, statuses, and round context.
5. The AI predicts the opponent's likely next action.
6. The AI builds a one-turn projection for each candidate skill.
7. The AI extracts named features from each skill + context + projection.
8. The AI scores each skill using:
   - authored prior weights,
   - intent-conditioned weights,
   - optional learned skill weights,
   - optional learned feature residuals.
9. The highest-scoring skill is selected, with deterministic tie-breaking by `skillId`.
10. The battle engine resolves the chosen skill, emits battle events, updates cooldowns/statuses, and continues the round.

That means the "AI system" is really the combination of these modules:

- `engine/battle/battleEngine.ts`
- `engine/battle/aiDecision.ts`
- `engine/battle/skillRegistry.ts`
- `engine/battle/resolveDamage.ts`
- `engine/battle/statuses/statusRegistry.ts`
- `engine/battle/statuses/resolverRegistry.ts`
- `engine/battle/resolveStatus.ts`
- `engine/battle/learning.ts`
- `engine/battle/initiative.ts`
- shared contracts in `types/combat.ts` and `types/battle.ts`

---

## 2. Stack / Components and How They Fit Together

## 2.1 Shared combat contracts

The battle engine starts from `CombatantSnapshot` in `types/combat.ts`.

```ts
export interface CombatantSnapshot {
  entityId: string;
  side?: EntitySide;
  name?: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkillIds: [string, string];
  passiveSkillIds?: [string, string];
}
```

This is the canonical input shape for `simulateBattle(...)` in `engine/battle/battleEngine.ts`.

Battle outputs are serialized as `BattleEvent` and `BattleResult` from `types/battle.ts`. Those events are also important to the AI ecosystem because the learning system reads battle event history later to update model weights.

## 2.2 Battle engine orchestration

The runtime loop lives in `simulateBattle(...)` in `engine/battle/battleEngine.ts`.

Key responsibilities:

- seed RNG with `XorShift32`,
- clone and initialize combatants,
- track runtime-only state such as `initiative`, `cooldowns`, and active `statuses`,
- decide whose turn it is,
- invoke the AI with a read-only snapshot,
- resolve the chosen action,
- emit events,
- handle deaths, timeout, round-end cooldown decrements, and status expiry.

The AI is not allowed to mutate `RuntimeEntity`; instead the engine constructs a decision-only snapshot and passes it into `chooseAction(...)`.

## 2.3 Skill registry

The canonical skill definitions live in `engine/battle/skillRegistry.ts` as `SkillDef` records.

```ts
export type SkillDef = {
  skillId: string;
  skillName: string;
  resolutionMode: 'attack' | 'self_utility';
  basePower: number;
  accuracyModBP: number;
  cooldownTurns: number;
  tags: SkillTag[];
  executeThresholdBP?: number;
  appliesStatusIds?: StatusId[];
  selfAppliesStatusIds?: StatusId[];
};
```

The AI imports and depends on:

- `BASIC_ATTACK_SKILL_ID`
- `getSkillDef(...)`
- `type SkillDef`

from `./skillRegistry` inside `engine/battle/aiDecision.ts`.

The battle engine also imports:

- `BASIC_ATTACK_SKILL_ID`
- `getSkillDef(...)`
- `validateSkillDef(...)`

from `./skillRegistry` inside `engine/battle/battleEngine.ts`.

The AI never invents a move. It can only select among skill IDs that exist in the registry and are currently off cooldown.

## 2.4 Status system

Statuses are split into three layers:

1. **Definition layer** — `engine/battle/statuses/statusRegistry.ts`
   - owns `StatusId`
   - owns immutable `StatusDef`
   - describes duration, round-start HP effect, and incoming-damage multiplier.

2. **Resolver layer** — `engine/battle/statuses/resolverRegistry.ts`
   - maps statuses to runtime resolution logic
   - decides whether a status acts on `onApply`, `onRoundStart`, or both
   - defines resolver priority ordering.

3. **Mutable application layer** — `engine/battle/resolveStatus.ts`
   - stores `ActiveStatuses`
   - applies and refreshes statuses
   - decrements durations at round end
   - emits expire/apply events.

The AI reads immutable status definitions in order to reason about future value. It never mutates status state directly.

## 2.5 Damage system

`engine/battle/resolveDamage.ts` provides deterministic combat math:

- `calculateHitChanceBP(...)`
- `calculateDamage(...)`
- `resolveAttack(...)`

The AI uses the pure helpers `calculateHitChanceBP(...)` and `calculateDamage(...)` to project expected one-turn damage. The battle engine uses `resolveAttack(...)` to perform the actual hit roll using the seeded RNG.

That split is important:

- **AI forecasting** uses deterministic expected values.
- **Battle resolution** uses deterministic seeded randomness.

## 2.6 Learning model

`engine/battle/learning.ts` contains optional model data used to bias action selection.

The AI imports these into `engine/battle/aiDecision.ts`:

```ts
import {
  getPriorWeightScaleBP,
  scoreLearnedFeatureTerm,
  scoreLearnedWeightTerm,
  type ArchetypeDecisionModel
} from './learning';
```

This lets the same scoring pipeline operate in two modes:

- a plain skill-weight map (`Record<string, number>`), or
- a richer `ArchetypeLearningState` with learned feature residuals, confidence, and prior scaling.

## 2.7 Initiative / turn scheduling

`engine/battle/initiative.ts` decides when AI is asked to act.

The battle engine imports:

- `applyRoundInitiative(...)`
- `hasReadyActor(...)`
- `nextActorIndex(...)`
- `timeoutWinner(...)`

The AI does not participate in initiative math directly, but the order of turns changes the decision context it receives.

---

## 3. Core Decision Types

The main decision types all live in `engine/battle/aiDecision.ts`.

## 3.1 `DecisionCombatantSnapshot`

This is the read-only combatant shape used by the AI.

```ts
export type DecisionCombatantSnapshot = {
  entityId: string;
  archetypeId?: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  accuracyBP: number;
  evadeBP: number;
  statuses: readonly StatusId[];
  activeSkillIds?: readonly [string, string];
  cooldowns?: Readonly<Record<string, number>>;
};
```

Important detail: target snapshots make `activeSkillIds` and `cooldowns` optional, but `DecisionContext.actor` requires them. That lets the AI predict the opponent if those fields are available, while still keeping the snapshot flexible.

## 3.2 `DecisionBattleSnapshot`

```ts
export type DecisionBattleSnapshot = {
  round: number;
  maxRounds: number;
  roundsRemaining: number;
};
```

This is how the AI knows whether it is early battle, late battle, or near timeout.

## 3.3 `DecisionContext`

```ts
export type DecisionContext = {
  actor: {
    entityId: string;
    archetypeId?: string;
    hp: number;
    hpMax: number;
    atk: number;
    def: number;
    accuracyBP: number;
    evadeBP: number;
    statuses: readonly StatusId[];
    activeSkillIds: readonly [string, string];
    cooldowns: Readonly<Record<string, number>>;
  };
  target: DecisionCombatantSnapshot;
  battle: DecisionBattleSnapshot;
};
```

This is the full snapshot passed into `chooseAction(...)`.

## 3.4 `DecisionTrace`

`chooseAction(...)` can emit a detailed trace through `DecisionLogger`.

This trace includes:

- candidate skill IDs,
- intent weights,
- predicted opponent skill,
- per-skill feature sets,
- projections,
- feature contributions,
- total selected score.

This trace is what makes the AI explainable and testable.

---

## 4. Runtime Plumbing: Complete Data Flow

This section follows the actual runtime path in order.

## 4.1 Battle starts: `simulateBattle(...)`

The entrypoint is:

```ts
export function simulateBattle(input: BattleInput): BattleResult
```

from `engine/battle/battleEngine.ts`.

`BattleInput` includes these AI-relevant fields:

```ts
export type BattleInput = {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  playerSkillWeights?: ArchetypeDecisionModel;
  enemySkillWeights?: ArchetypeDecisionModel;
  maxRounds?: number;
  decisionLogger?: (decision: { round: number; actorId: string; targetId: string; trace: DecisionTrace }) => void;
};
```

So the engine is responsible for injecting both:

- the initial combatants, and
- the optional AI model for each side.

## 4.2 Runtime entities are created

Inside `simulateBattle(...)`, the engine builds a mutable `RuntimeEntity`:

```ts
type RuntimeEntity = CombatantSnapshot & {
  initiative: number;
  cooldowns: Record<string, number>;
  statuses: ActiveStatuses;
};
```

This is intentionally broader than `DecisionContext` because the engine needs mutable state for the actual simulation.

Initialization path:

1. `cloneEntity(...)` copies the static snapshot.
2. `applyFlatPassives(...)` modifies baseline stats.
3. `initializeCooldowns(...)` builds a zeroed cooldown record from `activeSkillIds`.
4. `statuses` starts empty.

The AI never sees `initiative` or mutable `statuses` maps directly.

## 4.3 Round start status resolution happens before AI acts

Before normal actions, the engine calls:

```ts
winner = resolveRoundStartStatuses(round, combatants, events);
```

That function:

- collects active status IDs with `getActiveStatusIds(...)`,
- resolves round-start status resolvers using `getResolversForRoundStart(...)`,
- applies HP changes through `emitStatusEffectResolution(...)`,
- can kill a unit before any turn is taken.

This matters for AI extension because any new forecast logic should remember that statuses like `overheated` and `recovering` produce value at round start, not necessarily during the acting unit's immediate action.

## 4.4 Initiative determines the acting unit

After round-start effects:

```ts
applyRoundInitiative(combatants);
while (hasReadyActor(combatants)) {
  const actorIndex = nextActorIndex(combatants);
  ...
}
```

The next acting combatant becomes `actor`; the other becomes `target`.

## 4.5 The engine builds `DecisionContext`

This is the critical handoff from engine state to AI state.

The battle engine calls `chooseAction(...)` like this:

```ts
const selectedAction = chooseAction(
  {
    actor: {
      entityId: actor.entityId,
      hp: actor.hp,
      hpMax: actor.hpMax,
      atk: actor.atk,
      def: actor.def,
      accuracyBP: actor.accuracyBP,
      evadeBP: actor.evadeBP,
      statuses: getActiveStatusIds(actor),
      activeSkillIds: actor.activeSkillIds,
      cooldowns: { ...actor.cooldowns }
    },
    target: {
      entityId: target.entityId,
      hp: target.hp,
      hpMax: target.hpMax,
      atk: target.atk,
      def: target.def,
      accuracyBP: target.accuracyBP,
      evadeBP: target.evadeBP,
      statuses: getActiveStatusIds(target),
      activeSkillIds: target.activeSkillIds,
      cooldowns: { ...target.cooldowns }
    },
    battle: {
      round,
      maxRounds,
      roundsRemaining: Math.max(0, maxRounds - round)
    }
  },
  actorIndex === 0 ? (input.playerSkillWeights ?? {}) : (input.enemySkillWeights ?? {}),
  (trace) => {
    input.decisionLogger?.({
      round,
      actorId: actor.entityId,
      targetId: target.entityId,
      trace
    });
  }
);
```

Important plumbing details:

- `getActiveStatusIds(...)` converts mutable `ActiveStatuses` into a sorted `StatusId[]`.
- cooldowns are copied with `{ ...actor.cooldowns }` / `{ ...target.cooldowns }`, so the AI cannot mutate runtime state.
- the decision model is side-specific: player uses `playerSkillWeights`, enemy uses `enemySkillWeights`.
- the trace is wrapped with battle metadata before being passed to the caller.

## 4.6 `chooseAction(...)` enumerates candidate actions

Inside `engine/battle/aiDecision.ts`, the AI starts with:

```ts
const candidateSkillIds: string[] = [BASIC_ATTACK_SKILL_ID];

for (const activeSkillId of actor.activeSkillIds) {
  if ((actor.cooldowns[activeSkillId] ?? 0) === 0) {
    candidateSkillIds.push(activeSkillId);
  }
}
```

So the candidate set is always:

- basic attack (`1000`), plus
- each equipped active skill whose cooldown is zero.

There is no probabilistic exploration and no invalid-skill path here.

## 4.7 Intent weights are derived from the current context

The AI next calls:

```ts
const intentWeights = deriveIntentWeights(context);
```

`deriveIntentWeights(...)` computes five intent channels:

- `finish`
- `survive`
- `control`
- `setup`
- `attrition`

using:

- actor HP percentage,
- target HP percentage,
- whether target is already `stunned`,
- whether battle is early (`round <= 2`),
- whether battle is late (`roundsRemaining <= 2`).

Code excerpt:

```ts
return {
  finish: targetHpBP <= 3000 ? 7 : targetHpBP <= 5000 ? 3 : lateBattle,
  survive: actorHpBP <= 2500 ? 7 : actorHpBP <= 5000 ? 4 : 1,
  control: targetAlreadyControlled ? 0 : targetHpBP >= 4500 ? 4 : 2,
  setup: earlyBattle && targetHpBP >= 5000 ? 3 : earlyBattle,
  attrition: targetHpBP >= 6500 ? 3 : targetHpBP >= 4000 ? 2 : 1
};
```

This is the first place where battle state is turned into tactical pressure.

## 4.8 Opponent prediction happens through mirrored AI scoring

Unless forecasting is disabled, `chooseAction(...)` predicts the opponent's next skill:

```ts
const predictedOpponentSkillId = options.disableForecast
  ? BASIC_ATTACK_SKILL_ID
  : predictOpponentAction(context, decisionModel).skillId;
```

`predictOpponentAction(...)` constructs a mirrored `DecisionContext` where:

- the original target becomes the predicted actor,
- the original actor becomes the predicted target.

Snippet:

```ts
const opponentContext: DecisionContext = {
  actor: {
    entityId: context.target.entityId,
    archetypeId: context.target.archetypeId,
    hp: context.target.hp,
    hpMax: context.target.hpMax,
    atk: context.target.atk,
    def: context.target.def,
    accuracyBP: context.target.accuracyBP,
    evadeBP: context.target.evadeBP,
    statuses: context.target.statuses,
    activeSkillIds: context.target.activeSkillIds ?? ['1000', '1000'],
    cooldowns: context.target.cooldowns ?? {}
  },
  target: {
    entityId: context.actor.entityId,
    ...
  },
  battle: context.battle
};
```

Then it recursively calls:

```ts
return chooseAction(opponentContext, decisionModel, undefined, { disableForecast: true });
```

That `disableForecast: true` is the guardrail that prevents infinite recursive forecasting.

## 4.9 Per-skill projection snapshot is built

For every candidate skill, `scoreSkill(...)` calls:

```ts
const projections = buildProjectionSnapshot(skill, context, predictedOpponentSkill);
```

`buildProjectionSnapshot(...)` computes:

- `projectedOutgoingDamage`
- `projectedIncomingDamage`
- `projectedRecovery`
- `projectedNetPressure`
- `projectedStatusSwing`
- `predictedOpponentSkillId`

The flow is:

1. `predictOutgoingDamage(skill, context)` -> expected current actor damage against current target.
2. `applyProjectedStatuses(...)` -> simulate statuses that this skill would add to actor or target.
3. `predictIncomingDamage(predictedOpponentSkill, projectedTarget, projectedActor)` -> expected retaliation after those projected statuses exist.
4. `projectStatusRoundStartHp(...)` -> estimate future HP swing from status round-start effects.

This means self-buffs and target debuffs affect forecast values immediately in the projection layer, even though actual battle resolution remains event-driven.

## 4.10 Feature extraction turns raw projection/context into named features

`extractSkillFeatures(...)` converts each candidate skill into a `SkillFeatures` record.

Current feature IDs are:

- `basePower`
- `activeSkillPreference`
- `executeOpportunity`
- `stunRedundancy`
- `shieldbreakOpportunity`
- `controlOpportunity`
- `defensiveShieldValue`
- `defensiveRepairValue`
- `setupOpportunity`
- `attritionOpportunity`
- `projectedOutgoingPressure`
- `projectedIncomingMitigation`
- `projectedRecoveryValue`
- `projectedControlValue`

A few examples:

```ts
executeOpportunity:
  skill.tags.includes('execute') && targetHpBP <= (skill.executeThresholdBP ?? 0) ? 1 : 0,

stunRedundancy:
  skill.tags.includes('stun') && context.target.statuses.includes('stunned') ? 1 : 0,

defensiveShieldValue:
  hasSelfAppliedStatus(skill, 'shielded') && !context.actor.statuses.includes('shielded') ? 1 : 0,

setupOpportunity:
  hasTargetAppliedStatus(skill, 'overheated') && !context.target.statuses.includes('overheated') ? 1 : 0,
```

Projection-backed features are normalized into compact integer ranges using:

- `normalizeProjectionValue(...)`
- `normalizeSignedProjectionValue(...)`

That keeps scores bounded and easier to interpret.

## 4.11 Feature contributions are assembled from priors, intents, and learned terms

`buildFeatureContributions(...)` is the heart of explainability.

For each feature:

1. it reads the feature value,
2. looks up the authored prior weight from `FEATURE_PRIOR_WEIGHTS`,
3. scales authored priors by `getPriorWeightScaleBP(decisionModel)`,
4. looks up per-intent authored weights from `FEATURE_INTENT_WEIGHTS`,
5. multiplies them by the current `intentWeights`,
6. adds learned feature residuals from `scoreLearnedFeatureTerm(...)`.

Pseudo-shape from the implementation:

```ts
return {
  featureId,
  value,
  priorWeight,
  priorContribution,
  intentWeights: perIntentWeights,
  intentBreakdown,
  intentContribution,
  learnedWeight: learnedFeatureTerm.learnedWeight,
  learnedConfidenceBP: learnedFeatureTerm.confidenceBP,
  learnedContribution: learnedFeatureTerm.contribution,
  totalContribution: priorContribution + intentContribution + learnedFeatureTerm.contribution
};
```

This is why the decision trace is so rich: you can inspect exactly why a skill won.

## 4.12 The skill-level learned bias is added

Separately from feature residuals, `scoreSkill(...)` adds:

```ts
const learnedWeight = scoreLearnedWeightTerm(decisionModel, skill.skillId);
```

This is a flat per-skill preference term.

So each total skill score is:

- feature prior contributions
- feature intent contributions
- learned feature contributions
- learned flat skill weight

More precisely, `buildWeightBreakdown(...)` aggregates them and sets:

```ts
totalScore = priorContributionTotal + intentContributionTotal + learnedFeatureContributionTotal + learnedWeight
```

## 4.13 Deterministic ordering decides the winner

Finally `chooseAction(...)` sorts candidate skills like this:

```ts
.sort((a, b) => {
  if (a.score.totalScore !== b.score.totalScore) return b.score.totalScore - a.score.totalScore;
  return a.skillId.localeCompare(b.skillId);
});
```

That means ties always resolve lexicographically by skill ID. No randomness is involved.

The function then returns:

```ts
return { skillId: ordered[0].skillId };
```

and optionally emits a `DecisionTrace` through `decisionLogger`.

## 4.14 The battle engine resolves the selected skill

Back in `simulateBattle(...)`, the engine converts the chosen `skillId` into a canonical `SkillDef`:

```ts
const selectedSkill = getSkillDef(selectedAction.skillId);
validateSkillDef(selectedSkill);
```

Then it chooses the runtime target:

```ts
const actionTarget = selectedSkill.resolutionMode === 'self_utility' ? actor : target;
```

and emits an `ACTION` event.

### If the skill is on cooldown after use

For non-basic skills:

```ts
if (selectedSkill.skillId !== BASIC_ATTACK_SKILL_ID) {
  actor.cooldowns[selectedSkill.skillId] = selectedSkill.cooldownTurns;
  events.push({ type: 'COOLDOWN_SET', ... });
}
```

### If the skill is an attack

The engine path is:

1. `applyConditionalPassives(...)`
2. `resolveAttack(...)`
3. emit `HIT_RESULT`
4. if hit, `adjustDamageForStatuses(...)`
5. subtract HP
6. emit `DAMAGE`
7. apply target statuses with `applyStatus(...)`
8. apply self statuses with `applyStatus(...)`
9. run `emitStatusEffectResolution(...)` for any `onApply` statuses
10. emit `DEATH` if needed.

### If the skill is self-utility

The engine only applies `selfAppliesStatusIds` to the actor and runs any `onApply` resolvers.

This separation matters when extending AI features: if you add a new utility skill, the AI must score its future value, but the actual engine path still resolves through the status application layer.

## 4.15 Round end mutates the next decision context

At the end of each round, the engine calls:

```ts
events.push(...decrementStatusesAtRoundEnd(player.statuses, player.entityId, round));
events.push(...decrementStatusesAtRoundEnd(enemy.statuses, enemy.entityId, round));
decrementCooldowns(player);
decrementCooldowns(enemy);
```

Those mutations are exactly what affect the next call to `chooseAction(...)`:

- statuses may expire,
- cooldowns may become available again,
- HP totals may have changed,
- initiative continues accumulating.

---

## 5. Code-Level Walkthrough by File

## 5.1 `engine/battle/aiDecision.ts`

This is the main AI brain.

### Imports and dependencies

```ts
import { calculateDamage, calculateHitChanceBP } from './resolveDamage';
import { BASIC_ATTACK_SKILL_ID, getSkillDef, type SkillDef } from './skillRegistry';
import { getStatusDef, type StatusId } from './statuses/statusRegistry';
import {
  getPriorWeightScaleBP,
  scoreLearnedFeatureTerm,
  scoreLearnedWeightTerm,
  type ArchetypeDecisionModel
} from './learning';
```

So this file depends on:

- damage formulas,
- skill definitions,
- status definitions,
- learning state / residuals.

### Main exported functions

- `deriveIntentWeights(context)`
- `extractSkillFeatures(skill, context, projection, options)`
- `chooseAction(context, decisionModel, decisionLogger, options)`

### Important internal helpers

- `hpPercentBP(...)`
- `hasSelfAppliedStatus(...)`
- `hasTargetAppliedStatus(...)`
- `projectStatusRoundStartHp(...)`
- `applyProjectedStatuses(...)`
- `predictIncomingDamage(...)`
- `predictOutgoingDamage(...)`
- `predictOpponentAction(...)`
- `buildProjectionSnapshot(...)`
- `buildFeatureContributions(...)`
- `buildWeightBreakdown(...)`
- `scoreSkill(...)`

### Key extension points

If you add a new tactical concept, you usually need to touch all of these categories:

1. **Skill data** in `skillRegistry.ts`
2. **Status data** in `statusRegistry.ts` and maybe `resolverRegistry.ts`
3. **Feature extraction** in `extractSkillFeatures(...)`
4. **Weight tables** in `FEATURE_PRIOR_WEIGHTS` and `FEATURE_INTENT_WEIGHTS`
5. **Projection math** if the new mechanic changes future damage/recovery/control value
6. **Decision trace tests**.

## 5.2 `engine/battle/battleEngine.ts`

This is the orchestrator and the only place where the AI is actually invoked during battle.

### Imports relevant to AI

```ts
import { chooseAction, type DecisionTrace } from './aiDecision';
import { BASIC_ATTACK_SKILL_ID, getSkillDef, validateSkillDef } from './skillRegistry';
import type { ArchetypeDecisionModel } from './learning';
```

### AI-facing functions and variables

- `BattleInput.playerSkillWeights`
- `BattleInput.enemySkillWeights`
- `BattleInput.decisionLogger`
- `getActiveStatusIds(...)`
- `simulateBattle(...)`

### Important plumbing variables

- `actor`
- `target`
- `selectedAction`
- `selectedSkill`
- `actionTarget`
- `events`
- `maxRounds`

If you are trying to trace "where does the AI input come from?", this file is the answer.

## 5.3 `engine/battle/skillRegistry.ts`

This file defines the move vocabulary available to the AI.

Current exported constants:

- `BASIC_ATTACK_SKILL_ID`
- `VOLT_STRIKE_SKILL_ID`
- `FINISHING_BLOW_SKILL_ID`
- `SURGE_SKILL_ID`
- `BARRIER_SKILL_ID`
- `REPAIR_SKILL_ID`
- `ALL_SKILL_IDS`

Current registry entries show the intended tactical identity:

- `Volt Strike` -> stun / control
- `Finishing Blow` -> execute + shieldbreak / finisher
- `Surge` -> attack that applies `overheated` / setup + attrition
- `Barrier` -> self utility that applies `shielded` / defense
- `Repair` -> self utility that applies `recovering` / sustain

If you add a new skill and want AI to understand it, adding only the registry row is not enough. You must also decide how that skill is represented in feature extraction and forecasts.

## 5.4 `engine/battle/statuses/statusRegistry.ts`

This file is the authoritative source of status semantics used by AI projection.

Key fields in `StatusDef`:

```ts
export type StatusDef = {
  id: StatusId;
  kind: 'disable' | 'dot' | 'hot' | 'buff' | 'debuff';
  durationTurns: number;
  roundStartHpDelta: number;
  incomingDamageMultiplierBP: number;
};
```

These two values matter directly to the AI forecast layer:

- `roundStartHpDelta`
- `incomingDamageMultiplierBP`

For example:

- `shielded` sets `incomingDamageMultiplierBP: 8000`
- `broken_armor` sets `incomingDamageMultiplierBP: 13000`
- `overheated` sets `roundStartHpDelta: -120`
- `recovering` sets `roundStartHpDelta: 90`

The AI reads these through `getStatusDef(...)`.

## 5.5 `engine/battle/statuses/resolverRegistry.ts`

This file defines when statuses actually do something.

Important exports:

- `STATUS_RESOLVER_REGISTRY`
- `getStatusResolver(...)`
- `hasStatusResolveTiming(...)`
- `getResolversForRoundStart(...)`

If you introduce a status with round-start value and forget to add a resolver here, the engine will not realize that value, even if the AI projects it.

So AI correctness and engine correctness both depend on this registry staying in sync with `statusRegistry.ts`.

## 5.6 `engine/battle/resolveStatus.ts`

This file handles mutable status state.

Important exports:

- `type ActiveStatuses`
- `applyStatus(...)`
- `decrementStatusesAtRoundEnd(...)`

AI does not import this file directly, but the AI depends on the engine's runtime status map eventually being converted into the sorted status ID list used in `DecisionContext`.

## 5.7 `engine/battle/resolveDamage.ts`

This file provides the exact combat math used both by the battle engine and by AI projections.

Important exports:

- `calculateHitChanceBP(...)`
- `calculateDamage(...)`
- `resolveAttack(...)`

Projection uses the pure functions. Resolution uses the RNG-backed function.

That means if you change hit or damage formulas here, you automatically affect:

- real battle outcomes,
- AI forecast values,
- skill ranking behavior.

## 5.8 `engine/battle/learning.ts`

This file defines the optional long-term bias model.

Important exports consumed by AI selection:

- `type ArchetypeDecisionModel`
- `getPriorWeightScaleBP(...)`
- `scoreLearnedWeightTerm(...)`
- `scoreLearnedFeatureTerm(...)`

Important exports for training/updating outside immediate selection:

- `createLearningState(...)`
- `buildSkillContributions(...)`
- `buildFeatureContributions(...)`
- `updateSkillWeights(...)`
- `updateLearningState(...)`

The selection side is synchronous and deterministic. The training/update side is post-battle and event-driven.

---

## 6. How Learning Connects Back Into Decisions

The learning system does not run inside the battle loop automatically. Instead, battle output and traces can be fed back into `learning.ts` after a battle.

## 6.1 Skill contribution extraction from battle events

`buildSkillContributions(events, actorId)` reads `BattleEvent[]` and accumulates, per skill:

- `damageDealt`
- `statusTurnsApplied`

It does this by remembering the latest `ACTION` skill per actor and attaching later `DAMAGE`, `STATUS_APPLY`, and `STATUS_REFRESH` events to that skill.

## 6.2 Feature contribution extraction from decision traces

`buildFeatureContributions(traces)` reads selected traces and totals the feature values that were actually chosen.

That means the training layer can answer both:

- "which skills contributed to wins/losses?"
- "which feature patterns were reinforced?"

## 6.3 Weight updates

`updateSkillWeights(...)` applies bounded updates to per-skill weights.

`updateLearningState(...)` extends that by also:

- decaying feature weights,
- decaying feature confidence,
- updating feature residuals,
- increasing confidence for reinforced features.

The next time `chooseAction(...)` is called with the updated model, those learned terms flow into:

- `scoreLearnedWeightTerm(...)`
- `scoreLearnedFeatureTerm(...)`

with no change required to the battle engine.

---

## 7. End-to-End Example: Why a Skill Wins

Suppose the actor has `Finishing Blow (1002)` available, and the target is low HP and currently `shielded`.

The decision path is:

1. `battleEngine.ts` includes `1002` in the actor's `activeSkillIds` and confirms cooldown zero.
2. `chooseAction(...)` includes `1002` in `candidateSkillIds`.
3. `deriveIntentWeights(...)` gives high `finish` pressure because target HP is low.
4. `extractSkillFeatures(...)` sees:
   - `executeOpportunity = 1`
   - `shieldbreakOpportunity = 1`
   - `activeSkillPreference = 1`
5. `buildFeatureContributions(...)` gives those features large prior and finish-weighted contributions.
6. `scoreLearnedWeightTerm(...)` may also add a learned positive bias for `1002`.
7. If `1002` has the largest `totalScore`, it wins.
8. The engine resolves the action as an attack, applies damage, and applies `broken_armor` if it hits.

This exact pattern is covered by `tests/aiDecision.decisionLog.test.ts`, which asserts that the trace contains execute and shieldbreak-related scoring breakdowns.

---

## 8. Safe Extension Checklist

When extending the AI, use this checklist.

## 8.1 Adding a new skill

Update at least:

1. `engine/battle/skillRegistry.ts`
2. `engine/battle/aiDecision.ts`
   - feature extraction
   - prior weights
   - intent weights
   - projection logic if needed
3. tests for:
   - action choice,
   - trace shape,
   - battle resolution.

Questions to answer:

- Is it `attack` or `self_utility`?
- Does it apply target or self statuses?
- Does it need a new `SkillTag`?
- Does forecast logic need to understand its future value explicitly?

## 8.2 Adding a new status

Update at least:

1. `engine/battle/statuses/statusRegistry.ts`
2. `engine/battle/statuses/resolverRegistry.ts`
3. possibly `engine/battle/resolveStatus.ts` if lifecycle semantics differ
4. `engine/battle/aiDecision.ts` if the status should influence features or projection.

Questions to answer:

- Does it do something on `onApply`, `onRoundStart`, or both?
- Should it change incoming damage?
- Should it change projected control value?
- Should the AI treat duplicate application as redundant or desirable?

## 8.3 Adding a new tactical concept

If the concept is not fully expressible as an existing feature, then add:

1. a new `SkillFeatureId`
2. a slot in `SkillFeatures`
3. a prior weight in `FEATURE_PRIOR_WEIGHTS`
4. optional intent weights in `FEATURE_INTENT_WEIGHTS`
5. extraction logic in `extractSkillFeatures(...)`
6. assertions in decision trace tests.

## 8.4 Preserving determinism

Be careful to preserve all of the following:

- integer math / basis point conventions,
- sorted/tie-broken status lists,
- deterministic skill sorting,
- no random sampling in AI scoring,
- no mutation of runtime combat state from inside `chooseAction(...)`.

---

## 9. Common Pitfalls

### 9.1 Adding a skill but not teaching the AI what it means

If you only add a registry row, the AI may only understand the skill through generic `basePower` and active-skill preference. Utility or combo value will be invisible.

### 9.2 Adding a status to the registry but not the resolver registry

The AI may forecast value from `roundStartHpDelta`, but the engine will never realize it if no resolver timing exists.

### 9.3 Changing damage formulas without re-evaluating AI behavior

Because projections use the same formulas, even a small change in `calculateDamage(...)` can change move ranking.

### 9.4 Breaking trace stability

Tests inspect decision traces. If you change scoring structure, update tests and preserve versioning discipline.

### 9.5 Forgetting cooldown gating

The AI only scores currently available skills. If a test expects a skill choice, make sure its cooldown is zero in the supplied `DecisionContext`.

---

## 10. Minimal Mental Model

If you want one compact model of the system, think of it like this:

- `battleEngine.ts` owns **when** a decision is requested.
- `skillRegistry.ts` and `statusRegistry.ts` define **what exists**.
- `aiDecision.ts` decides **which available action is best right now**.
- `resolveDamage.ts` and the status resolver stack define **what the chosen action actually does**.
- `types/battle.ts` records **what happened**.
- `learning.ts` uses what happened plus decision traces to bias **future choices**.

That is the full plumbing loop.

