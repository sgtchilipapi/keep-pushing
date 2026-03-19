import type { BattleEvent } from '../../types/battle';

/**
 * Lower saturation bound applied to learned skill preference values.
 */
export const MIN_LEARNING_WEIGHT = -1000;
/**
 * Upper saturation bound applied to learned skill preference values.
 */
export const MAX_LEARNING_WEIGHT = 1000;
/**
 * Lower saturation bound applied to learned feature residual values.
 */
export const MIN_FEATURE_LEARNING_WEIGHT = -250;
/**
 * Upper saturation bound applied to learned feature residual values.
 */
export const MAX_FEATURE_LEARNING_WEIGHT = 250;
/**
 * Default per-match adjustment strength used when updating skill weights.
 */
export const DEFAULT_LEARNING_RATE = 150;
/**
 * Default per-match adjustment strength used when updating feature residuals.
 */
export const DEFAULT_FEATURE_LEARNING_RATE = 60;
/**
 * Default decay applied to learned values between training batches.
 */
export const DEFAULT_LEARNING_DECAY_BP = 9750;
/**
 * Default confidence gain applied when a feature is reinforced during training.
 */
export const DEFAULT_CONFIDENCE_STEP_BP = 2000;
/**
 * Near-neutral authored-weight scale used by Slice 4 feature-model training harnesses.
 */
export const DEFAULT_WEAK_PRIOR_SCALE_BP = 2500;

/**
 * Persistent preference weights keyed by skill identifier for a combat archetype.
 *
 * Positive values increase AI selection score, while negative values suppress usage.
 */
export type ArchetypeSkillWeights = Record<string, number>;
export type LearnedFeatureWeights = Record<string, number>;
export type LearnedFeatureConfidence = Record<string, number>;

export type ArchetypeDecisionModel = ArchetypeSkillWeights | ArchetypeLearningState;

export type ArchetypeLearningState = {
  skillWeights: ArchetypeSkillWeights;
  featureWeights: LearnedFeatureWeights;
  featureConfidence: LearnedFeatureConfidence;
  priorWeightScaleBP: number;
  decayBP: number;
  featureLearningRate: number;
  confidenceStepBP: number;
};

/**
 * Aggregated impact metrics attributed to one skill over a battle.
 */
export type SkillContribution = {
  damageDealt: number;
  statusTurnsApplied: number;
};

/**
 * Per-skill contribution map derived from battle event history.
 */
export type SkillContributions = Record<string, SkillContribution>;

export type FeatureContribution = {
  totalValue: number;
  selections: number;
};

export type FeatureContributions = Record<string, FeatureContribution>;

function isLearningState(model: ArchetypeDecisionModel): model is ArchetypeLearningState {
  return (
    typeof model === 'object' &&
    model !== null &&
    'skillWeights' in model &&
    'featureWeights' in model &&
    'featureConfidence' in model
  );
}

function clampWeight(weight: number): number {
  return Math.min(MAX_LEARNING_WEIGHT, Math.max(MIN_LEARNING_WEIGHT, weight));
}

function clampFeatureWeight(weight: number): number {
  return Math.min(MAX_FEATURE_LEARNING_WEIGHT, Math.max(MIN_FEATURE_LEARNING_WEIGHT, weight));
}

function clampBasisPoints(value: number): number {
  return Math.min(10000, Math.max(0, value));
}

function applyDecay(value: number, decayBP: number): number {
  return Math.trunc((value * decayBP) / 10000);
}

export function createLearningState(overrides: Partial<ArchetypeLearningState> = {}): ArchetypeLearningState {
  return {
    skillWeights: overrides.skillWeights ?? {},
    featureWeights: overrides.featureWeights ?? {},
    featureConfidence: overrides.featureConfidence ?? {},
    priorWeightScaleBP: overrides.priorWeightScaleBP ?? DEFAULT_WEAK_PRIOR_SCALE_BP,
    decayBP: overrides.decayBP ?? DEFAULT_LEARNING_DECAY_BP,
    featureLearningRate: overrides.featureLearningRate ?? DEFAULT_FEATURE_LEARNING_RATE,
    confidenceStepBP: overrides.confidenceStepBP ?? DEFAULT_CONFIDENCE_STEP_BP
  };
}

export function getSkillWeights(model: ArchetypeDecisionModel): ArchetypeSkillWeights {
  return isLearningState(model) ? model.skillWeights : model;
}

export function getFeatureWeights(model: ArchetypeDecisionModel): LearnedFeatureWeights {
  return isLearningState(model) ? model.featureWeights : {};
}

export function getFeatureConfidence(model: ArchetypeDecisionModel): LearnedFeatureConfidence {
  return isLearningState(model) ? model.featureConfidence : {};
}

export function getPriorWeightScaleBP(model: ArchetypeDecisionModel): number {
  return isLearningState(model) ? clampBasisPoints(model.priorWeightScaleBP) : 10000;
}

export function getLearnedWeight(skillWeights: ArchetypeSkillWeights, skillId: string): number {
  return clampWeight(skillWeights[skillId] ?? 0);
}

export function scoreLearnedWeightTerm(model: ArchetypeDecisionModel, skillId: string): number {
  return getLearnedWeight(getSkillWeights(model), skillId);
}

export function scoreLearnedFeatureTerm(
  model: ArchetypeDecisionModel,
  featureId: string,
  featureValue: number
): { learnedWeight: number; confidenceBP: number; contribution: number } {
  if (featureValue === 0 || !isLearningState(model)) {
    return { learnedWeight: 0, confidenceBP: 0, contribution: 0 };
  }

  const learnedWeight = clampFeatureWeight(model.featureWeights[featureId] ?? 0);
  const confidenceBP = clampBasisPoints(model.featureConfidence[featureId] ?? 0);
  const contribution = Math.trunc((featureValue * learnedWeight * confidenceBP) / 10000);

  return { learnedWeight, confidenceBP, contribution };
}

export function buildSkillContributions(events: readonly BattleEvent[], actorId: string): SkillContributions {
  const contributions: SkillContributions = {};
  const latestActionSkillByActor: Record<string, string> = {};

  for (const event of events) {
    if (event.type === 'ACTION') {
      latestActionSkillByActor[event.actorId] = event.skillId;
      continue;
    }

    if (event.type === 'DAMAGE' && event.actorId === actorId) {
      const skillId = latestActionSkillByActor[event.actorId];
      if (skillId !== undefined) {
        const entry = (contributions[skillId] ??= { damageDealt: 0, statusTurnsApplied: 0 });
        entry.damageDealt += event.amount;
      }
      continue;
    }

    if ((event.type === 'STATUS_APPLY' || event.type === 'STATUS_REFRESH') && event.sourceId === actorId) {
      const skillId = latestActionSkillByActor[event.sourceId];
      if (skillId !== undefined) {
        const entry = (contributions[skillId] ??= { damageDealt: 0, statusTurnsApplied: 0 });
        entry.statusTurnsApplied += event.remainingTurns;
      }
    }
  }

  return contributions;
}

export function buildFeatureContributions(
  traces: ReadonlyArray<{ selectedSkillId: string; selectedScore: { skillId: string; features: Record<string, number> } }>
): FeatureContributions {
  const contributions: FeatureContributions = {};

  for (const trace of traces) {
    if (trace.selectedScore.skillId !== trace.selectedSkillId) {
      continue;
    }

    for (const [featureId, value] of Object.entries(trace.selectedScore.features)) {
      if (value === 0) continue;
      const entry = (contributions[featureId] ??= { totalValue: 0, selections: 0 });
      entry.totalValue += value;
      entry.selections += 1;
    }
  }

  return contributions;
}

export function updateSkillWeights(params: {
  currentSkillWeights: ArchetypeSkillWeights;
  skillContributions: SkillContributions;
  enemyHpMax: number;
  didWin: boolean;
  learningRate?: number;
}): ArchetypeSkillWeights {
  const learningRate = params.learningRate ?? DEFAULT_LEARNING_RATE;
  const sign = params.didWin ? 1 : -1;
  const nextSkillWeights: ArchetypeSkillWeights = { ...params.currentSkillWeights };
  const safeEnemyHpMax = Math.max(1, params.enemyHpMax);

  for (const [skillId, contribution] of Object.entries(params.skillContributions)) {
    const damagePart = Math.floor((contribution.damageDealt * 1000) / safeEnemyHpMax);
    const statusPart = Math.floor((contribution.statusTurnsApplied * 1000) / 3);
    const contrib = Math.floor((700 * damagePart + 300 * statusPart) / 1000);

    const delta = sign * Math.floor((learningRate * contrib) / 1000);
    const currentWeight = nextSkillWeights[skillId] ?? 0;
    nextSkillWeights[skillId] = clampWeight(currentWeight + delta);
  }

  return nextSkillWeights;
}

export function updateLearningState(params: {
  currentModel: ArchetypeLearningState;
  skillContributions: SkillContributions;
  featureContributions: FeatureContributions;
  enemyHpMax: number;
  didWin: boolean;
  learningRate?: number;
  featureLearningRate?: number;
  decayBP?: number;
  confidenceStepBP?: number;
}): ArchetypeLearningState {
  const currentModel = createLearningState(params.currentModel);
  const decayBP = clampBasisPoints(params.decayBP ?? currentModel.decayBP);
  const confidenceStepBP = clampBasisPoints(params.confidenceStepBP ?? currentModel.confidenceStepBP);
  const featureLearningRate = params.featureLearningRate ?? currentModel.featureLearningRate;
  const sign = params.didWin ? 1 : -1;
  const nextSkillWeights = updateSkillWeights({
    currentSkillWeights: currentModel.skillWeights,
    skillContributions: params.skillContributions,
    enemyHpMax: params.enemyHpMax,
    didWin: params.didWin,
    learningRate: params.learningRate
  });
  const nextFeatureWeights: LearnedFeatureWeights = {};
  const nextFeatureConfidence: LearnedFeatureConfidence = {};
  const featureIds = new Set([...Object.keys(currentModel.featureWeights), ...Object.keys(params.featureContributions)]);

  for (const featureId of featureIds) {
    const decayedWeight = applyDecay(currentModel.featureWeights[featureId] ?? 0, decayBP);
    const decayedConfidence = clampBasisPoints(applyDecay(currentModel.featureConfidence[featureId] ?? 0, decayBP));
    const contribution = params.featureContributions[featureId];

    if (contribution === undefined) {
      if (decayedWeight !== 0) nextFeatureWeights[featureId] = clampFeatureWeight(decayedWeight);
      if (decayedConfidence !== 0) nextFeatureConfidence[featureId] = decayedConfidence;
      continue;
    }

    const normalizedValue = Math.max(1, Math.trunc((contribution.totalValue * 1000) / Math.max(1, contribution.selections)));
    const delta = sign * Math.trunc((featureLearningRate * normalizedValue) / 1000);
    const nextWeight = clampFeatureWeight(decayedWeight + delta);
    const nextConfidence = clampBasisPoints(decayedConfidence + confidenceStepBP);

    if (nextWeight !== 0) nextFeatureWeights[featureId] = nextWeight;
    if (nextConfidence !== 0) nextFeatureConfidence[featureId] = nextConfidence;
  }

  return {
    ...currentModel,
    skillWeights: nextSkillWeights,
    featureWeights: nextFeatureWeights,
    featureConfidence: nextFeatureConfidence,
    decayBP,
    featureLearningRate,
    confidenceStepBP
  };
}
