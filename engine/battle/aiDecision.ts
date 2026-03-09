import { BASIC_ATTACK_SKILL_ID, getSkillDef, type SkillDef } from './skillRegistry';
import type { StatusId } from './statusRegistry';
import { scoreLearnedWeightTerm, type ArchetypeSkillWeights } from './learning';

/**
 * Read-only combat snapshot used by the AI scorer when evaluating candidate skills.
 *
 * This shape intentionally contains only data required by heuristics so decision-making
 * remains deterministic and independent from mutable battle engine state.
 * 
 * @todo: So as for now, a combatant only uses enemy hp and statuses? That is too shallow for MVP.
 *       To have a meaningful combat agent, they should have need to be able to factor in multiple information and weigh the possible actions to take.
 *       For example, skills might be for offense or self-preservation. Or skills might be to set a trap hence the agent understands timing.
 *       Moreover, the agent must have the ability to anticipate even if crude at first which it improves over time through weights as well.
 *       
 *       Idea: Should agents decide based on ratios or levels of multiple stats? Like for example, combatantHp, enemyHp, skillDamageOutput, hitChance, etc?
 *             So agents actually decide based on the current situation rather than just decide based on skill weights alone?
 * 
 *       Re-design.
 */
export type DecisionCombatantSnapshot = {
  hp: number;
  hpMax: number;
  statuses: readonly StatusId[];
};

/**
 * Action selected by the AI decision phase.
 *
 * The battle engine resolves the referenced skill as the actor's next command.
 */
export type CandidateAction = {
  skillId: string;
};

/**
 * @todo: Where did we get these hardcoded values from? As far as I know, we dont want hardcoded bonuses and organically let the combatants learn
 *        and choose on their own.
 *        
 *        Re-design.
 */
const ACTIVE_AVAILABLE_BONUS = 200;
const EXECUTE_BONUS = 500;
const SHIELDBREAK_BONUS = 350;
const WASTED_STUN_PENALTY = 10_000;

/**
 * Converts current HP into basis points to avoid floating-point comparisons in heuristics.
 */
function hpPercentBP(combatant: DecisionCombatantSnapshot): number {
  if (combatant.hpMax <= 0) {
    return 0;
  }

  return Math.floor((combatant.hp * 10000) / combatant.hpMax);
}

/**
 * Computes a deterministic priority score for a skill against the current target snapshot.
 *
 * The score combines static skill power, context-sensitive tag bonuses/penalties,
 * and learned archetype preferences.
 */
function scoreSkill(skill: SkillDef, target: DecisionCombatantSnapshot, skillWeights: ArchetypeSkillWeights): number {
  /** Heuristic intentionally starts from base power so every modifier is an additive preference, not a hard rule.
   * @todo: Why we use skill.basePower as a base? I gues this only applies when the combatant decides to execute an offensive action.
   *        Decide where to create a decision point between offensive or defensive. Before specific skill weights? Or after skill weights?
   *        Re-design.
   */
  let score = skill.basePower;

  /**
   * @see: We dont want to influence with hardcoded bonuses. Re-design.
   */
  if (skill.skillId !== BASIC_ATTACK_SKILL_ID) {
    score += ACTIVE_AVAILABLE_BONUS;
  }

  /**
   * @see: This is yet another hardcoded bonus to influence the agent's decision making. We dont want this. Re-design.
   */
  if (skill.tags.includes('execute')) {
    const targetHpBP = hpPercentBP(target);
    const threshold = skill.executeThresholdBP ?? 0;

    if (targetHpBP <= threshold) {
      score += EXECUTE_BONUS;
    }
  }

  /**
   * @todo: This is hardcoded influence about how a combatant should be efficient. We dont want this.
   *       Imagine a combatant almost winning if only it uses a high-damage high-hit-chance skill for the last time on a stunned enemy.
   *       But it doesnt because such skill includes a 'stun' tag? That is undesirable. We want organic learning even if it is rule-based.
   * 
   *       Re-design.
   */
  if (skill.tags.includes('stun') && target.statuses.includes('stunned')) {
    // Reapplying stun is heavily penalized to avoid wasting turns on non-stacking control effects.
    score -= WASTED_STUN_PENALTY;
  }

  /**
   * @todo: Another hardcoded influence. Re-design.
   */
  if (skill.tags.includes('shieldbreak') && target.statuses.includes('shielded')) {
    score += SHIELDBREAK_BONUS;
  }

  score += scoreLearnedWeightTerm(skillWeights, skill.skillId);

  return score;
}

/**
 * Chooses the next skill the actor should use against the current target.
 *
 * The selector always includes the basic attack and only includes active skills whose
 * cooldown is currently zero. Candidate skills are scored deterministically; when scores
 * tie, lexical ordering is used so replay output and test runs remain stable.
 *
 * This function does not mutate cooldown state or battle entities.
 *
 * @param actorActiveSkillIds - The actor's equipped active skill identifiers.
 * @param actorCooldowns - Remaining cooldown turns keyed by skill identifier.
 * @param target - Read-only snapshot of the current enemy target.
 * @param skillWeights - Learned per-skill preference weights for the actor archetype.
 * @returns The single highest-priority action candidate.
 * @throws If a candidate skill identifier has no registered definition.
 */
export function chooseAction(
  actorActiveSkillIds: readonly [string, string],
  actorCooldowns: Record<string, number>,
  target: DecisionCombatantSnapshot,
  skillWeights: ArchetypeSkillWeights = {}
): CandidateAction {
  const candidateSkillIds: string[] = [BASIC_ATTACK_SKILL_ID];

  /**
   * @see: It is worth mentioning but not implementing now for the initial MVP or aiDecision version that agents should be able to think ahead.
   *        Think ahead in the sense that they factor in future availability of other actions. Like for example, they can see that in the next
   *        turn, their high damage skill but with low-hit chance is going to be available, they might prioritize using a 'stun' skill for this
   *        turn so the next turn they can use such high-damage skill successfully.
   * 
   *        This might sound interesting but might be too complex for MVP. But leaving a note for this.
   */
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
