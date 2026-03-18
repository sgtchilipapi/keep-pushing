import { BASIC_ATTACK_SKILL_ID, getSkillDef, type SkillDef } from './skillRegistry';
import type { StatusId } from './statuses/statusRegistry';
import { getWeakPriorWeight, scoreLearnedWeightTerm, type ArchetypeSkillWeights } from './learning';

export type DecisionCombatantSnapshot = {
  entityId: string;
  hp: number;
  hpMax: number;
  statuses: readonly StatusId[];
  activeSkillIds: readonly [string, string];
  cooldowns: Record<string, number>;
};

export type DecisionBattleSnapshot = {
  round: number;
  maxRounds: number;
  roundsRemaining: number;
};

export type DecisionContext = {
  actor: DecisionCombatantSnapshot;
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
  | 'survivalRecovery'
  | 'survivalShield'
  | 'controlOpportunity'
  | 'setupPressure'
  | 'attritionPressure';

export type FeatureContribution = {
  featureId: SkillFeatureId;
  value: number;
  weight: number;
  contribution: number;
};

export type IntentContribution = {
  intentId: IntentId;
  weight: number;
  utility: number;
  contribution: number;
};

export type SkillScoreBreakdown = {
  skillId: string;
  featureContributions: readonly FeatureContribution[];
  intentContributions: readonly IntentContribution[];
  priorScore: number;
  learnedWeight: number;
  totalScore: number;
};

export type DecisionTrace = {
  version: 'intent_v1';
  context: DecisionContext;
  candidateSkillIds: readonly string[];
  intentWeights: Record<IntentId, number>;
  scores: readonly SkillScoreBreakdown[];
  selectedSkillId: string;
};

export type DecisionLogger = (trace: DecisionTrace) => void;

type SkillFeatures = Record<SkillFeatureId, number>;
type IntentUtilities = Record<IntentId, number>;

function hpPercentBP(combatant: Pick<DecisionCombatantSnapshot, 'hp' | 'hpMax'>): number {
  if (combatant.hpMax <= 0) {
    return 0;
  }

  return Math.floor((combatant.hp * 10000) / combatant.hpMax);
}

function extractSkillFeatures(skill: SkillDef, context: DecisionContext): SkillFeatures {
  const actorHpBP = hpPercentBP(context.actor);
  const targetHpBP = hpPercentBP(context.target);
  const targetStatuses = new Set(context.target.statuses);
  const actorStatuses = new Set(context.actor.statuses);

  return {
    basePower: skill.basePower,
    activeSkillPreference: skill.skillId === BASIC_ATTACK_SKILL_ID ? 0 : 1,
    executeOpportunity:
      skill.tags.includes('execute') && targetHpBP <= (skill.executeThresholdBP ?? 0) ? 1 : 0,
    stunRedundancy: skill.tags.includes('stun') && targetStatuses.has('stunned') ? -1 : 0,
    shieldbreakOpportunity: skill.tags.includes('shieldbreak') && targetStatuses.has('shielded') ? 1 : 0,
    survivalRecovery:
      skill.selfAppliesStatusIds?.includes('recovering') === true && actorHpBP < 10000 && !actorStatuses.has('recovering')
        ? 1
        : 0,
    survivalShield:
      skill.selfAppliesStatusIds?.includes('shielded') === true && actorHpBP < 10000 && !actorStatuses.has('shielded')
        ? 1
        : 0,
    controlOpportunity: skill.tags.includes('stun') && !targetStatuses.has('stunned') && targetHpBP > 3000 ? 1 : 0,
    setupPressure:
      skill.appliesStatusIds?.includes('overheated') === true && !targetStatuses.has('overheated') && context.battle.roundsRemaining > 1
        ? 1
        : 0,
    attritionPressure:
      skill.appliesStatusIds?.includes('overheated') === true && context.battle.roundsRemaining > 1 ? 1 : 0
  };
}

function deriveIntentWeights(context: DecisionContext): Record<IntentId, number> {
  const actorHpBP = hpPercentBP(context.actor);
  const targetHpBP = hpPercentBP(context.target);
  const roundsRemaining = context.battle.roundsRemaining;

  return {
    finish: targetHpBP <= 3000 ? 700 : targetHpBP <= 5000 ? 250 : 0,
    survive: actorHpBP <= 2500 ? 850 : actorHpBP <= 4500 ? 300 : 0,
    control: targetHpBP > 3000 && !context.target.statuses.includes('stunned') ? 325 : 0,
    setup: roundsRemaining > 2 && targetHpBP > 3500 ? 180 : 0,
    attrition: roundsRemaining > 1 ? 120 : 0
  };
}

function deriveIntentUtilities(skill: SkillDef, features: SkillFeatures): IntentUtilities {
  return {
    finish: features.executeOpportunity * 5 + Math.floor(features.basePower / 70),
    survive: features.survivalRecovery * 6 + features.survivalShield * 5,
    control: features.controlOpportunity * 4 + (skill.tags.includes('stun') ? 1 : 0),
    setup: features.setupPressure * 4 + ((skill.selfAppliesStatusIds?.length ?? 0) > 0 ? 1 : 0),
    attrition: features.attritionPressure * 3 + features.shieldbreakOpportunity * 2
  };
}

function scoreSkill(skill: SkillDef, context: DecisionContext, skillWeights: ArchetypeSkillWeights): SkillScoreBreakdown {
  const features = extractSkillFeatures(skill, context);
  const featureContributions: FeatureContribution[] = [];
  let priorScore = 0;

  for (const featureId of Object.keys(features) as SkillFeatureId[]) {
    const value = features[featureId];
    const weight = getWeakPriorWeight(featureId);
    const contribution = value * weight;
    priorScore += contribution;
    featureContributions.push({ featureId, value, weight, contribution });
  }

  const intentWeights = deriveIntentWeights(context);
  const intentUtilities = deriveIntentUtilities(skill, features);
  const intentContributions: IntentContribution[] = [];

  for (const intentId of Object.keys(intentWeights) as IntentId[]) {
    const weight = intentWeights[intentId];
    const utility = intentUtilities[intentId];
    const contribution = Math.floor((weight * utility) / 100);
    priorScore += contribution;
    intentContributions.push({ intentId, weight, utility, contribution });
  }

  const learnedWeight = scoreLearnedWeightTerm(skillWeights, skill.skillId);

  return {
    skillId: skill.skillId,
    featureContributions,
    intentContributions,
    priorScore,
    learnedWeight,
    totalScore: priorScore + learnedWeight
  };
}

export function chooseAction(
  context: DecisionContext,
  skillWeights?: ArchetypeSkillWeights,
  decisionLogger?: DecisionLogger
): CandidateAction;
export function chooseAction(
  actorActiveSkillIds: readonly [string, string],
  actorCooldowns: Record<string, number>,
  target: Pick<DecisionCombatantSnapshot, 'hp' | 'hpMax' | 'statuses'>,
  skillWeights?: ArchetypeSkillWeights,
  decisionLogger?: DecisionLogger
): CandidateAction;
export function chooseAction(
  contextOrActorSkills: DecisionContext | readonly [string, string],
  actorCooldownsOrSkillWeights: Record<string, number> | ArchetypeSkillWeights = {},
  targetOrDecisionLogger?: Pick<DecisionCombatantSnapshot, 'hp' | 'hpMax' | 'statuses'> | DecisionLogger,
  skillWeightsOrUndefined: ArchetypeSkillWeights = {},
  decisionLoggerOrUndefined?: DecisionLogger
): CandidateAction {
  let context: DecisionContext;
  let skillWeights: ArchetypeSkillWeights;
  let decisionLogger: DecisionLogger | undefined;

  if (Array.isArray(contextOrActorSkills)) {
    const legacyActorSkills = contextOrActorSkills as readonly [string, string];
    const legacyTarget = targetOrDecisionLogger as Pick<DecisionCombatantSnapshot, 'hp' | 'hpMax' | 'statuses'>;
    context = {
      actor: {
        entityId: 'actor',
        hp: 1,
        hpMax: 1,
        statuses: [],
        activeSkillIds: legacyActorSkills,
        cooldowns: actorCooldownsOrSkillWeights as Record<string, number>
      },
      target: {
        entityId: 'target',
        hp: legacyTarget.hp,
        hpMax: legacyTarget.hpMax,
        statuses: legacyTarget.statuses,
        activeSkillIds: [BASIC_ATTACK_SKILL_ID, BASIC_ATTACK_SKILL_ID],
        cooldowns: {}
      },
      battle: {
        round: 1,
        maxRounds: 1,
        roundsRemaining: 0
      }
    };
    skillWeights = skillWeightsOrUndefined;
    decisionLogger = typeof targetOrDecisionLogger === 'function' ? targetOrDecisionLogger : decisionLoggerOrUndefined;
  } else {
    context = contextOrActorSkills as DecisionContext;
    skillWeights = actorCooldownsOrSkillWeights as ArchetypeSkillWeights;
    decisionLogger = targetOrDecisionLogger as DecisionLogger | undefined;
  }
  const candidateSkillIds: string[] = [BASIC_ATTACK_SKILL_ID];

  for (const activeSkillId of context.actor.activeSkillIds) {
    if ((context.actor.cooldowns[activeSkillId] ?? 0) === 0) {
      candidateSkillIds.push(activeSkillId);
    }
  }

  const ordered = candidateSkillIds
    .map((skillId) => ({ skillId, score: scoreSkill(getSkillDef(skillId), context, skillWeights) }))
    .sort((a, b) => {
      if (a.score.totalScore !== b.score.totalScore) {
        return b.score.totalScore - a.score.totalScore;
      }

      return a.skillId.localeCompare(b.skillId);
    });

  decisionLogger?.({
    version: 'intent_v1',
    context: {
      actor: {
        ...context.actor,
        activeSkillIds: [...context.actor.activeSkillIds] as [string, string],
        cooldowns: { ...context.actor.cooldowns },
        statuses: [...context.actor.statuses]
      },
      target: {
        ...context.target,
        activeSkillIds: [...context.target.activeSkillIds] as [string, string],
        cooldowns: { ...context.target.cooldowns },
        statuses: [...context.target.statuses]
      },
      battle: { ...context.battle }
    },
    candidateSkillIds,
    intentWeights: deriveIntentWeights(context),
    scores: ordered.map((entry) => entry.score),
    selectedSkillId: ordered[0].skillId
  });

  return { skillId: ordered[0].skillId };
}
