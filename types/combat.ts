export type EntitySide = "PLAYER" | "ENEMY";

export interface CombatantSnapshot {
  // Migration note: entity identifiers are canonical string IDs.
  // Numeric IDs from legacy payloads are no longer part of the shared contract.
  entityId: string;
  // Engine ignores these metadata fields; they remain optional for callers.
  side?: EntitySide;
  name?: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  // Migration note: initiative is runtime-derived in the battle engine and is
  // intentionally excluded from the shared input snapshot contract.
  accuracyBP: number;
  evadeBP: number;
  activeSkillIds: [string, string];
  passiveSkillIds?: [string, string];
}

export interface StatusDef {
  id: string;
  name: string;
  durationTurns: number;
  tags: string[];
}

export interface ActiveStatus {
  statusId: string;
  sourceEntityId: string;
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
