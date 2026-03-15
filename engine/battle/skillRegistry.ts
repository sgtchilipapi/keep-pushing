import type { StatusId } from './statuses/statusRegistry';

/**
 * Tags that encode special runtime handling for a skill.
 *
 * These tags drive downstream combat logic such as execute checks,
 * stun application behavior, and shield-breaking interactions.
 */
export type SkillTag = 'execute' | 'stun' | 'shieldbreak';

/**
 * Canonical skill definition consumed by battle resolution systems.
 *
 * Each entry describes immutable tuning values for power, accuracy,
 * cooldown behavior, and optional status or execute semantics.
 */
export type SkillDef = {
  skillId: string;
  skillName: string;
  basePower: number;
  accuracyModBP: number;
  cooldownTurns: number;
  tags: SkillTag[];
  executeThresholdBP?: number;
  appliesStatusIds?: StatusId[];
  selfAppliesStatusIds?: StatusId[];
};

/**
 * Stable identifier for the default attack skill.
 *
 * This constant is used by systems that need a guaranteed fallback
 * action when no specialized skill is selected.
 */
export const BASIC_ATTACK_SKILL_ID = '1000';
export const VOLT_STRIKE_SKILL_ID = '1001';
export const FINISHING_BLOW_SKILL_ID = '1002';

const BASIC_ATTACK: SkillDef = {
  skillId: BASIC_ATTACK_SKILL_ID,
  skillName: 'Basic Attack',
  basePower: 100,
  accuracyModBP: 0,
  cooldownTurns: 0,
  tags: [],
  appliesStatusIds: [],
  selfAppliesStatusIds: []
};

const VOLT_STRIKE: SkillDef = {
  skillId: VOLT_STRIKE_SKILL_ID,
  skillName: 'Volt Strike',
  basePower: 170,
  accuracyModBP: 0,
  cooldownTurns: 2,
  tags: ['shieldbreak'],
  appliesStatusIds: ['broken_armor', 'overheated'],
  selfAppliesStatusIds: ['shielded']
};

const FINISHING_BLOW: SkillDef = {
  skillId: FINISHING_BLOW_SKILL_ID,
  skillName: 'Finishing Blow',
  basePower: 140,
  accuracyModBP: 300,
  cooldownTurns: 3,
  tags: ['execute', 'stun'],
  executeThresholdBP: 3000,
  appliesStatusIds: ['stunned'],
  selfAppliesStatusIds: ['recovering']
};

const SKILL_REGISTRY: Record<string, SkillDef> = {
  [BASIC_ATTACK.skillId]: BASIC_ATTACK,
  [VOLT_STRIKE.skillId]: VOLT_STRIKE,
  [FINISHING_BLOW.skillId]: FINISHING_BLOW
};

export const ALL_SKILL_IDS = Object.keys(SKILL_REGISTRY).sort();

/**
 * Resolves a skill definition by its identifier.
 *
 * The registry is assumed to contain all valid skill IDs used by the
 * combat pipeline. A missing entry indicates an invalid or out-of-sync
 * skill reference and is treated as a hard error.
 *
 * @param skillId - Unique skill identifier to resolve from the registry.
 * @returns The immutable skill definition associated with the provided ID.
 * @throws Error if the skill identifier is unknown.
 */
export function getSkillDef(skillId: string): SkillDef {
  const skill = SKILL_REGISTRY[skillId];
  if (skill === undefined) {
    throw new Error(`Unknown skillId: ${skillId}`);
  }

  return skill;
}
