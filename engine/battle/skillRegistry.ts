export type SkillTag = 'execute';

export type SkillDef = {
  skillId: string;
  basePower: number;
  accuracyModBP: number;
  cooldownTurns: number;
  tags: SkillTag[];
  executeThresholdBP?: number;
};

export const BASIC_ATTACK_SKILL_ID = 'BASIC_ATTACK';

const BASIC_ATTACK: SkillDef = {
  skillId: BASIC_ATTACK_SKILL_ID,
  basePower: 100,
  accuracyModBP: 0,
  cooldownTurns: 0,
  tags: []
};

const VOLT_STRIKE: SkillDef = {
  skillId: 'VOLT_STRIKE',
  basePower: 170,
  accuracyModBP: 0,
  cooldownTurns: 2,
  tags: []
};

const FINISHING_BLOW: SkillDef = {
  skillId: 'FINISHING_BLOW',
  basePower: 140,
  accuracyModBP: 300,
  cooldownTurns: 3,
  tags: ['execute'],
  executeThresholdBP: 3000
};

const SKILL_REGISTRY: Record<string, SkillDef> = {
  [BASIC_ATTACK.skillId]: BASIC_ATTACK,
  [VOLT_STRIKE.skillId]: VOLT_STRIKE,
  [FINISHING_BLOW.skillId]: FINISHING_BLOW
};

export function getSkillDef(skillId: string): SkillDef {
  const skill = SKILL_REGISTRY[skillId];
  if (skill === undefined) {
    throw new Error(`Unknown skillId: ${skillId}`);
  }

  return skill;
}
