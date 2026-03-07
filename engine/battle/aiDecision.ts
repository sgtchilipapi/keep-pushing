import { BASIC_ATTACK_SKILL_ID, getSkillDef, type SkillDef } from './skillRegistry';
import type { StatusId } from './statusRegistry';
import { scoreLearnedWeightTerm, type ArchetypeSkillWeights } from './learning';

export type DecisionCombatantSnapshot = {
  hp: number;
  hpMax: number;
  statuses: readonly StatusId[];
};

export type CandidateAction = {
  skillId: string;
};

const ACTIVE_AVAILABLE_BONUS = 200;
const EXECUTE_BONUS = 500;
const SHIELDBREAK_BONUS = 350;
const WASTED_STUN_PENALTY = 10_000;

function hpPercentBP(combatant: DecisionCombatantSnapshot): number {
  if (combatant.hpMax <= 0) {
    return 0;
  }

  return Math.floor((combatant.hp * 10000) / combatant.hpMax);
}

function scoreSkill(skill: SkillDef, target: DecisionCombatantSnapshot, skillWeights: ArchetypeSkillWeights): number {
  // Heuristic intentionally starts from base power so every modifier is an additive preference, not a hard rule.
  let score = skill.basePower;

  if (skill.skillId !== BASIC_ATTACK_SKILL_ID) {
    score += ACTIVE_AVAILABLE_BONUS;
  }

  if (skill.tags.includes('execute')) {
    const targetHpBP = hpPercentBP(target);
    const threshold = skill.executeThresholdBP ?? 0;

    if (targetHpBP <= threshold) {
      score += EXECUTE_BONUS;
    }
  }

  if (skill.tags.includes('stun') && target.statuses.includes('stunned')) {
    // Reapplying stun is heavily penalized to avoid wasting turns on non-stacking control effects.
    score -= WASTED_STUN_PENALTY;
  }

  if (skill.tags.includes('shieldbreak') && target.statuses.includes('shielded')) {
    score += SHIELDBREAK_BONUS;
  }

  score += scoreLearnedWeightTerm(skillWeights, skill.skillId);

  return score;
}

export function chooseAction(
  actorActiveSkillIds: readonly [string, string],
  actorCooldowns: Record<string, number>,
  target: DecisionCombatantSnapshot,
  skillWeights: ArchetypeSkillWeights = {}
): CandidateAction {
  const candidateSkillIds: string[] = [BASIC_ATTACK_SKILL_ID];

  for (const activeSkillId of actorActiveSkillIds) {
    if ((actorCooldowns[activeSkillId] ?? 0) === 0) {
      candidateSkillIds.push(activeSkillId);
    }
  }

  const ordered = candidateSkillIds
    .map((skillId) => ({ skillId, score: scoreSkill(getSkillDef(skillId), target, skillWeights) }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      // Lexical tie-break keeps action selection deterministic for replay and test consistency.
      return a.skillId.localeCompare(b.skillId);
    });

  return { skillId: ordered[0].skillId };
}
