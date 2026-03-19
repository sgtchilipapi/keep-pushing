import { calculateDamage, calculateHitChanceBP } from './resolveDamage';
import { BASIC_ATTACK_SKILL_ID, getSkillDef, type SkillDef } from './skillRegistry';
import { getStatusDef, type StatusId } from './statuses/statusRegistry';
import { scoreLearnedWeightTerm, type ArchetypeSkillWeights } from './learning';

/**
 * Read-only combat snapshot used by the AI scorer when evaluating candidate skills.
 *
 * This shape intentionally contains only data required by heuristics so decision-making
 * remains deterministic and independent from mutable battle engine state.
 */
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

export type DecisionBattleSnapshot = {
  round: number;
  maxRounds: number;
  roundsRemaining: number;
};

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

export type CandidateAction = {
  skillId: string;
};

export type IntentId = 'finish' | 'survive' | 'control' | 'setup' | 'attrition';

export type SkillFeatureId =
  | 'basePower'
  | 'activeSkillPreference'
  | 'executeOpportunity'
  | 'stunRedundancy'
  | 'shieldbreakOpportunity'
  | 'controlOpportunity'
  | 'defensiveShieldValue'
  | 'defensiveRepairValue'
  | 'setupOpportunity'
  | 'attritionOpportunity'
  | 'projectedOutgoingPressure'
  | 'projectedIncomingMitigation'
  | 'projectedRecoveryValue'
  | 'projectedControlValue';

export type SkillFeatures = Record<SkillFeatureId, number>;
export type IntentWeights = Record<IntentId, number>;

export type ProjectionSnapshot = {
  skillId: string;
  projectedOutgoingDamage: number;
  projectedIncomingDamage: number;
  projectedRecovery: number;
  projectedNetPressure: number;
  projectedStatusSwing: number;
  predictedOpponentSkillId: string;
};

export type FeatureContribution = {
  featureId: SkillFeatureId;
  value: number;
  priorWeight: number;
  priorContribution: number;
  intentWeights: Partial<Record<IntentId, number>>;
  intentContribution: number;
  totalContribution: number;
};

export type SkillScoreBreakdown = {
  skillId: string;
  basePower: number;
  activeSkillBonus: number;
  executeBonus: number;
  stunPenalty: number;
  shieldbreakBonus: number;
  learnedWeight: number;
  priorContributionTotal: number;
  intentContributionTotal: number;
  intentWeights: IntentWeights;
  features: SkillFeatures;
  projections: ProjectionSnapshot;
  featureContributions: readonly FeatureContribution[];
  totalScore: number;
};

export type DecisionTrace = {
  traceVersion: 'decision-trace.v4';
  actorActiveSkillIds: readonly [string, string];
  actorCooldowns: Record<string, number>;
  target: DecisionCombatantSnapshot;
  context: DecisionContext;
  intentWeights: IntentWeights;
  predictedOpponentSkillId: string;
  candidateSkillIds: readonly string[];
  scores: readonly SkillScoreBreakdown[];
  selectedSkillId: string;
};

export type DecisionLogger = (trace: DecisionTrace) => void;

type ScoreOptions = {
  disableForecast?: boolean;
};

const FEATURE_PRIOR_WEIGHTS: Record<SkillFeatureId, number> = {
  basePower: 10,
  activeSkillPreference: 25,
  executeOpportunity: 120,
  stunRedundancy: -220,
  shieldbreakOpportunity: 90,
  controlOpportunity: 20,
  defensiveShieldValue: 35,
  defensiveRepairValue: 35,
  setupOpportunity: 20,
  attritionOpportunity: 25,
  projectedOutgoingPressure: 4,
  projectedIncomingMitigation: 5,
  projectedRecoveryValue: 5,
  projectedControlValue: 35
};

const FEATURE_INTENT_WEIGHTS: Record<SkillFeatureId, Partial<Record<IntentId, number>>> = {
  basePower: { finish: 4, attrition: 2 },
  activeSkillPreference: { setup: 10, attrition: 5 },
  executeOpportunity: { finish: 160 },
  stunRedundancy: { control: -180, finish: -25 },
  shieldbreakOpportunity: { finish: 75, attrition: 25 },
  controlOpportunity: { control: 60, survive: 20 },
  defensiveShieldValue: { survive: 180, attrition: 30 },
  defensiveRepairValue: { survive: 220, attrition: 45 },
  setupOpportunity: { setup: 95, attrition: 35 },
  attritionOpportunity: { attrition: 60, setup: 20 },
  projectedOutgoingPressure: { finish: 5, attrition: 2 },
  projectedIncomingMitigation: { survive: 10, attrition: 2 },
  projectedRecoveryValue: { survive: 12, attrition: 2 },
  projectedControlValue: { control: 80, setup: 20, survive: 15 }
};

function hpPercentBP(combatant: DecisionCombatantSnapshot): number {
  if (combatant.hpMax <= 0) return 0;
  return Math.floor((combatant.hp * 10000) / combatant.hpMax);
}

function hasSelfAppliedStatus(skill: SkillDef, statusId: StatusId): boolean {
  return (skill.selfAppliesStatusIds ?? []).includes(statusId);
}

function hasTargetAppliedStatus(skill: SkillDef, statusId: StatusId): boolean {
  return (skill.appliesStatusIds ?? []).includes(statusId);
}

function normalizeProjectionValue(value: number): number {
  return Math.max(0, Math.floor(value / 25));
}

function normalizeSignedProjectionValue(value: number): number {
  if (value === 0) return 0;
  return Math.trunc(value / 25);
}

function projectStatusRoundStartHp(statuses: readonly StatusId[]): number {
  return statuses.reduce((sum, statusId) => sum + getStatusDef(statusId).roundStartHpDelta, 0);
}

function applyProjectedStatuses(baseStatuses: readonly StatusId[], addedStatuses: readonly StatusId[]): StatusId[] {
  return [...new Set([...baseStatuses, ...addedStatuses])].sort();
}

function predictIncomingDamage(skill: SkillDef, actor: DecisionCombatantSnapshot, target: DecisionCombatantSnapshot): number {
  if (skill.resolutionMode !== 'attack') return 0;
  const hitChanceBP = calculateHitChanceBP(actor, target, skill);
  const rawDamage = calculateDamage(actor, target, skill);
  const incomingMultiplierBP = target.statuses.reduce((acc, statusId) => {
    return Math.floor((acc * getStatusDef(statusId).incomingDamageMultiplierBP) / 10000);
  }, 10000);
  const adjustedDamage = Math.max(1, Math.floor((rawDamage * incomingMultiplierBP) / 10000));
  return Math.floor((adjustedDamage * hitChanceBP) / 10000);
}

function predictOutgoingDamage(skill: SkillDef, context: DecisionContext): number {
  return predictIncomingDamage(skill, context.actor, context.target);
}

function predictOpponentAction(context: DecisionContext, actorSkillWeights: ArchetypeSkillWeights): CandidateAction {
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
      archetypeId: context.actor.archetypeId,
      hp: context.actor.hp,
      hpMax: context.actor.hpMax,
      atk: context.actor.atk,
      def: context.actor.def,
      accuracyBP: context.actor.accuracyBP,
      evadeBP: context.actor.evadeBP,
      statuses: context.actor.statuses,
      activeSkillIds: context.actor.activeSkillIds,
      cooldowns: context.actor.cooldowns
    },
    battle: context.battle
  };

  return chooseAction(opponentContext, actorSkillWeights, undefined, { disableForecast: true });
}

function buildProjectionSnapshot(
  skill: SkillDef,
  context: DecisionContext,
  predictedOpponentSkill: SkillDef
): ProjectionSnapshot {
  const projectedOutgoingDamage = predictOutgoingDamage(skill, context);
  const projectedStatusesOnActor = applyProjectedStatuses(
    context.actor.statuses,
    skill.selfAppliesStatusIds ?? []
  );
  const projectedStatusesOnTarget = applyProjectedStatuses(
    context.target.statuses,
    skill.appliesStatusIds ?? []
  );
  const projectedIncomingDamage = predictIncomingDamage(
    predictedOpponentSkill,
    {
      ...context.target,
      statuses: projectedStatusesOnTarget
    },
    {
      ...context.actor,
      statuses: projectedStatusesOnActor
    }
  );
  const projectedRecovery = Math.max(0, projectStatusRoundStartHp(projectedStatusesOnActor));
  const projectedTargetRoundStartHp = projectStatusRoundStartHp(projectedStatusesOnTarget);
  const projectedStatusSwing = projectedRecovery - projectedTargetRoundStartHp;

  return {
    skillId: skill.skillId,
    projectedOutgoingDamage,
    projectedIncomingDamage,
    projectedRecovery,
    projectedNetPressure: projectedOutgoingDamage + projectedRecovery - projectedIncomingDamage - projectedTargetRoundStartHp,
    projectedStatusSwing,
    predictedOpponentSkillId: predictedOpponentSkill.skillId
  };
}

export function deriveIntentWeights(context: DecisionContext): IntentWeights {
  const actorHpBP = hpPercentBP(context.actor);
  const targetHpBP = hpPercentBP(context.target);
  const targetAlreadyControlled = context.target.statuses.includes('stunned');
  const earlyBattle = context.battle.round <= 2 ? 1 : 0;
  const lateBattle = context.battle.roundsRemaining <= 2 ? 1 : 0;

  return {
    finish: targetHpBP <= 3000 ? 7 : targetHpBP <= 5000 ? 3 : lateBattle,
    survive: actorHpBP <= 2500 ? 7 : actorHpBP <= 5000 ? 4 : 1,
    control: targetAlreadyControlled ? 0 : targetHpBP >= 4500 ? 4 : 2,
    setup: earlyBattle && targetHpBP >= 5000 ? 3 : earlyBattle,
    attrition: targetHpBP >= 6500 ? 3 : targetHpBP >= 4000 ? 2 : 1
  };
}

export function extractSkillFeatures(
  skill: SkillDef,
  context: DecisionContext,
  projection: ProjectionSnapshot,
  options: ScoreOptions = {}
): SkillFeatures {
  const targetHpBP = hpPercentBP(context.target);
  const projectionEnabled = !options.disableForecast;

  return {
    basePower: Math.floor(skill.basePower / 10),
    activeSkillPreference: skill.skillId === BASIC_ATTACK_SKILL_ID ? 0 : 1,
    executeOpportunity:
      skill.tags.includes('execute') && targetHpBP <= (skill.executeThresholdBP ?? 0) ? 1 : 0,
    stunRedundancy: skill.tags.includes('stun') && context.target.statuses.includes('stunned') ? 1 : 0,
    shieldbreakOpportunity: skill.tags.includes('shieldbreak') && context.target.statuses.includes('shielded') ? 1 : 0,
    controlOpportunity: skill.tags.includes('stun') && !context.target.statuses.includes('stunned') ? 1 : 0,
    defensiveShieldValue: hasSelfAppliedStatus(skill, 'shielded') && !context.actor.statuses.includes('shielded') ? 1 : 0,
    defensiveRepairValue: hasSelfAppliedStatus(skill, 'recovering') && !context.actor.statuses.includes('recovering') ? 1 : 0,
    setupOpportunity: hasTargetAppliedStatus(skill, 'overheated') && !context.target.statuses.includes('overheated') ? 1 : 0,
    attritionOpportunity:
      (hasTargetAppliedStatus(skill, 'overheated') && !context.target.statuses.includes('overheated')) ||
      (hasSelfAppliedStatus(skill, 'shielded') && !context.actor.statuses.includes('shielded')) ||
      (hasSelfAppliedStatus(skill, 'recovering') && !context.actor.statuses.includes('recovering'))
        ? 1
        : 0,
    projectedOutgoingPressure: projectionEnabled ? normalizeProjectionValue(projection.projectedOutgoingDamage) : 0,
    projectedIncomingMitigation: projectionEnabled
      ? normalizeProjectionValue(Math.max(0, projection.projectedOutgoingDamage + projection.projectedRecovery - projection.projectedIncomingDamage))
      : 0,
    projectedRecoveryValue: projectionEnabled ? normalizeProjectionValue(projection.projectedRecovery) : 0,
    projectedControlValue: projectionEnabled
      ? Math.max(
          0,
          (hasTargetAppliedStatus(skill, 'stunned') && predictedOpponentCannotAttack(projection.predictedOpponentSkillId) ? 4 : 0) +
            normalizeSignedProjectionValue(projection.projectedStatusSwing)
        )
      : 0
  };
}

function predictedOpponentCannotAttack(skillId: string): boolean {
  return getSkillDef(skillId).resolutionMode === 'self_utility';
}

function buildFeatureContributions(features: SkillFeatures, intentWeights: IntentWeights): readonly FeatureContribution[] {
  return (Object.keys(features) as SkillFeatureId[]).map((featureId) => {
    const value = features[featureId];
    const priorWeight = FEATURE_PRIOR_WEIGHTS[featureId];
    const priorContribution = value * priorWeight;
    const perIntentWeights = FEATURE_INTENT_WEIGHTS[featureId];
    let intentContribution = 0;

    for (const [intentId, featureIntentWeight] of Object.entries(perIntentWeights) as [IntentId, number][]) {
      intentContribution += value * featureIntentWeight * intentWeights[intentId];
    }

    return {
      featureId,
      value,
      priorWeight,
      priorContribution,
      intentWeights: perIntentWeights,
      intentContribution,
      totalContribution: priorContribution + intentContribution
    };
  });
}

function scoreSkill(
  skill: SkillDef,
  context: DecisionContext,
  skillWeights: ArchetypeSkillWeights,
  intentWeights: IntentWeights,
  predictedOpponentSkill: SkillDef,
  options: ScoreOptions = {}
): SkillScoreBreakdown {
  const projections = buildProjectionSnapshot(skill, context, predictedOpponentSkill);
  const features = extractSkillFeatures(skill, context, projections, options);
  const featureContributions = buildFeatureContributions(features, intentWeights);
  const priorContributionTotal = featureContributions.reduce((sum, item) => sum + item.priorContribution, 0);
  const intentContributionTotal = featureContributions.reduce((sum, item) => sum + item.intentContribution, 0);
  const learnedWeight = scoreLearnedWeightTerm(skillWeights, skill.skillId);
  const totalScore = priorContributionTotal + intentContributionTotal + learnedWeight;

  return {
    skillId: skill.skillId,
    basePower: features.basePower,
    activeSkillBonus: features.activeSkillPreference * FEATURE_PRIOR_WEIGHTS.activeSkillPreference,
    executeBonus: features.executeOpportunity * FEATURE_PRIOR_WEIGHTS.executeOpportunity,
    stunPenalty: features.stunRedundancy * FEATURE_PRIOR_WEIGHTS.stunRedundancy,
    shieldbreakBonus: features.shieldbreakOpportunity * FEATURE_PRIOR_WEIGHTS.shieldbreakOpportunity,
    learnedWeight,
    priorContributionTotal,
    intentContributionTotal,
    intentWeights,
    features,
    projections,
    featureContributions,
    totalScore
  };
}

export function chooseAction(
  context: DecisionContext,
  skillWeights: ArchetypeSkillWeights = {},
  decisionLogger?: DecisionLogger,
  options: ScoreOptions = {}
): CandidateAction {
  const { actor } = context;
  const candidateSkillIds: string[] = [BASIC_ATTACK_SKILL_ID];

  for (const activeSkillId of actor.activeSkillIds) {
    if ((actor.cooldowns[activeSkillId] ?? 0) === 0) {
      candidateSkillIds.push(activeSkillId);
    }
  }

  const intentWeights = deriveIntentWeights(context);
  const predictedOpponentSkillId = options.disableForecast
    ? BASIC_ATTACK_SKILL_ID
    : predictOpponentAction(context, skillWeights).skillId;
  const predictedOpponentSkill = getSkillDef(predictedOpponentSkillId);
  const ordered = candidateSkillIds
    .map((skillId) => ({
      skillId,
      score: scoreSkill(getSkillDef(skillId), context, skillWeights, intentWeights, predictedOpponentSkill, options)
    }))
    .sort((a, b) => {
      if (a.score.totalScore !== b.score.totalScore) return b.score.totalScore - a.score.totalScore;
      return a.skillId.localeCompare(b.skillId);
    });

  decisionLogger?.({
    traceVersion: 'decision-trace.v4',
    actorActiveSkillIds: actor.activeSkillIds,
    actorCooldowns: { ...actor.cooldowns },
    target: context.target,
    context,
    intentWeights,
    predictedOpponentSkillId,
    candidateSkillIds,
    scores: ordered.map((entry) => entry.score),
    selectedSkillId: ordered[0].skillId
  });

  return { skillId: ordered[0].skillId };
}
