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
 * Default per-match adjustment strength used when updating skill weights.
 */
export const DEFAULT_LEARNING_RATE = 150;

/**
 * Persistent preference weights keyed by skill identifier for a combat archetype.
 *
 * Positive values increase AI selection score, while negative values suppress usage.
 */
export type ArchetypeSkillWeights = Record<string, number>;

export const WEAK_PRIOR_FEATURE_WEIGHTS = {
  basePower: 1,
  activeSkillPreference: 40,
  executeOpportunity: 120,
  stunRedundancy: 150,
  shieldbreakOpportunity: 90,
  survivalRecovery: 140,
  survivalShield: 120,
  controlOpportunity: 80,
  setupPressure: 55,
  attritionPressure: 45
} as const;

export type WeakPriorFeatureWeightId = keyof typeof WEAK_PRIOR_FEATURE_WEIGHTS;

export function getWeakPriorWeight(featureId: WeakPriorFeatureWeightId): number {
  return WEAK_PRIOR_FEATURE_WEIGHTS[featureId];
}

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

/**
 * Clamps a weight value into the supported learning range.
 */
function clampWeight(weight: number): number {
  return Math.min(MAX_LEARNING_WEIGHT, Math.max(MIN_LEARNING_WEIGHT, weight));
}

/**
 * Reads a learned weight for a skill and normalizes it to valid bounds.
 *
 * Missing entries are treated as neutral preference.
 *
 * @param skillWeights - Stored archetype weight table.
 * @param skillId - Skill identifier to look up.
 * @returns The clamped learned preference for the requested skill.
 */
export function getLearnedWeight(skillWeights: ArchetypeSkillWeights, skillId: string): number {
  return clampWeight(skillWeights[skillId] ?? 0);
}

/**
 * Produces the additive AI scoring term contributed by learned preference data.
 *
 * @param skillWeights - Stored archetype weight table.
 * @param skillId - Skill identifier being scored.
 * @returns The clamped score modifier to add to heuristic skill scoring.
 */
export function scoreLearnedWeightTerm(skillWeights: ArchetypeSkillWeights, skillId: string): number {
  return getLearnedWeight(skillWeights, skillId);
}

/**
 * Reconstructs per-skill performance contributions from an actor's battle events.
 *
 * Damage and applied-status turns are attributed to the most recent ACTION event
 * emitted by each actor, which assumes subsequent DAMAGE/STATUS events were caused
 * by that selected skill.
 *
 * @param events - Ordered battle event stream from a completed or partial match.
 * @param actorId - Actor whose skill contributions should be extracted.
 * @returns Contribution totals keyed by skill identifier.
 */
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

/**
 * Updates learned skill preferences using normalized battle contributions and outcome.
 *
 * Each contributing skill receives a signed adjustment derived from dealt damage and
 * applied status duration. Winning increases preference and losing decreases it.
 * Updated weights are clamped into the configured learning bounds.
 *
 * This function is pure and returns a new weight map.
 *
 * @param params - Update inputs including current weights, contributions, and match context.
 * @param params.currentSkillWeights - Existing learned weights for the archetype.
 * @param params.skillContributions - Per-skill contribution totals from the battle.
 * @param params.enemyHpMax - Enemy maximum HP used to normalize damage influence.
 * @param params.didWin - Whether the actor won the battle.
 * @param params.learningRate - Optional override for adjustment intensity.
 * @returns A new skill-weight map with applied learning deltas.
 */
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
