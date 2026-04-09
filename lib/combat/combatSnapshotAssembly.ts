import { getPassiveDef } from '../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../engine/battle/skillRegistry';
import { prisma, type CharacterBattleReadyRecord } from '../prisma';
import type { CombatantSnapshot } from '../../types/combat';
import type { EnemyArchetypeDef } from './enemyArchetypes';
import type { ZoneRunPlayerCarryoverState } from '../../types/zoneRun';

function toSkillTuple(ids: string[], field: string): [string, string] {
  if (ids.length !== 2) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must contain exactly 2 ids`);
  }

  return [ids[0]!, ids[1]!];
}

function assertKnownLoadout(activeSkills: [string, string], passiveSkills: [string, string]): void {
  activeSkills.forEach((skillId) => getSkillDef(skillId));
  passiveSkills.forEach((passiveId) => getPassiveDef(passiveId));
}

export async function loadCharacterBattleReadyRecord(
  characterId: string,
): Promise<CharacterBattleReadyRecord | null> {
  return prisma.character.findBattleReadyById(characterId);
}

export function buildPlayerCombatSnapshot(character: CharacterBattleReadyRecord): CombatantSnapshot {
  const activeSkillIds = toSkillTuple(character.activeSkills, 'activeSkills');
  const passiveSkillIds = toSkillTuple(character.passiveSkills, 'passiveSkills');
  assertKnownLoadout(activeSkillIds, passiveSkillIds);

  return {
    entityId: character.id,
    side: 'PLAYER',
    name: character.name,
    hp: character.hp,
    hpMax: character.hpMax,
    atk: character.atk,
    def: character.def,
    spd: character.spd,
    accuracyBP: character.accuracyBP,
    evadeBP: character.evadeBP,
    activeSkillIds,
    passiveSkillIds,
  };
}

export function buildPlayerCombatSnapshotFromCarryover(
  character: CharacterBattleReadyRecord,
  carryover: ZoneRunPlayerCarryoverState,
): CombatantSnapshot {
  const snapshot = buildPlayerCombatSnapshot(character);
  return {
    ...snapshot,
    hp: Math.min(snapshot.hpMax, Math.max(0, carryover.hp)),
  };
}

export function buildEnemyCombatSnapshot(enemyArchetype: EnemyArchetypeDef): CombatantSnapshot {
  const activeSkillIds = toSkillTuple([...enemyArchetype.snapshot.activeSkillIds], 'enemyActiveSkillIds');
  const passiveSkillIds = toSkillTuple(
    [...(enemyArchetype.snapshot.passiveSkillIds ?? [])],
    'enemyPassiveSkillIds',
  );
  assertKnownLoadout(activeSkillIds, passiveSkillIds);

  return {
    entityId: String(enemyArchetype.enemyArchetypeId),
    side: enemyArchetype.snapshot.side ?? 'ENEMY',
    name: enemyArchetype.snapshot.name ?? enemyArchetype.displayName,
    hp: enemyArchetype.snapshot.hp,
    hpMax: enemyArchetype.snapshot.hpMax,
    atk: enemyArchetype.snapshot.atk,
    def: enemyArchetype.snapshot.def,
    spd: enemyArchetype.snapshot.spd,
    accuracyBP: enemyArchetype.snapshot.accuracyBP,
    evadeBP: enemyArchetype.snapshot.evadeBP,
    activeSkillIds,
    passiveSkillIds,
  };
}
