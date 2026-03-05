import type { BattleEvent } from './battleEngine';

export const MIN_LEARNING_WEIGHT = -1000;
export const MAX_LEARNING_WEIGHT = 1000;
export const DEFAULT_LEARNING_RATE = 150;

export type ArchetypeSkillWeights = Record<string, number>;

export type SkillContribution = {
  damageDealt: number;
  statusTurnsApplied: number;
};

export type SkillContributions = Record<string, SkillContribution>;

function clampWeight(weight: number): number {
  return Math.min(MAX_LEARNING_WEIGHT, Math.max(MIN_LEARNING_WEIGHT, weight));
}

export function getLearnedWeight(skillWeights: ArchetypeSkillWeights, skillId: string): number {
  return clampWeight(skillWeights[skillId] ?? 0);
}

export function scoreLearnedWeightTerm(skillWeights: ArchetypeSkillWeights, skillId: string): number {
  return getLearnedWeight(skillWeights, skillId);
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
