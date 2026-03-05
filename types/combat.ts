export type EntitySide = "PLAYER" | "ENEMY";

export interface CombatantSnapshot {
  entityId: number;
  side: EntitySide;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  initiative: number;
  accuracyBP: number;
  evadeBP: number;
}

export interface StatusDef {
  id: string;
  name: string;
  durationTurns: number;
  tags: string[];
}

export interface ActiveStatus {
  statusId: string;
  sourceEntityId: number;
  remainingTurns: number;
}

export interface SkillDef {
  id: string;
  name: string;
  cooldownTurns: number;
  basePower: number;
  accuracyModBP: number;
  tags: string[];
  statusEffects: StatusDef[];
}

export interface SkillLoadout {
  basicAttack: SkillDef;
  activeSkill1: SkillDef;
  activeSkill2: SkillDef;
}
