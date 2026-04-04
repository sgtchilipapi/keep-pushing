import { getPassiveDef } from '../engine/battle/passiveRegistry';
import { getSkillDef } from '../engine/battle/skillRegistry';
import { getEnemyArchetypeDef, listEnemyArchetypeDefs } from '../lib/combat/enemyArchetypes';
import { getZoneEncounterTable, listZoneEncounterTables } from '../lib/combat/zoneEncounterTables';

describe('enemy archetype catalog', () => {
  it('locks the MVP catalog to 10 stable archetypes with ids 100..109', () => {
    const defs = listEnemyArchetypeDefs();

    expect(defs).toHaveLength(10);
    expect(defs.map((def) => def.enemyArchetypeId)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(defs.map((def) => def.displayName)).toEqual([
      'Scrap Drone',
      'Razor Hound',
      'Plated Enforcer',
      'Signal Witch',
      'Nano Leech',
      'Cloak Stalker',
      'Overclock Brute',
      'Ward Turret',
      'Protocol Knight',
      'Overseer Unit',
    ]);
  });

  it('only references real combat skills and passives', () => {
    for (const def of listEnemyArchetypeDefs()) {
      def.snapshot.activeSkillIds.forEach((skillId) => expect(getSkillDef(skillId)).toBeDefined());
      def.snapshot.passiveSkillIds?.forEach((passiveId) => expect(getPassiveDef(passiveId)).toBeDefined());
    }
  });

  it('returns defensive copies', () => {
    const first = getEnemyArchetypeDef(100);
    first.snapshot.activeSkillIds[0] = '1000';

    const second = getEnemyArchetypeDef(100);
    expect(second.snapshot.activeSkillIds).toEqual(['1001', '1003']);
  });
});

describe('zone encounter tables', () => {
  it('defines curated weighted entries for supported zones', () => {
    const tables = listZoneEncounterTables();

    expect(tables.map((table) => table.zoneId)).toEqual([1, 2, 3, 4, 5]);
    expect(tables.every((table) => table.entries.length > 0)).toBe(true);
    expect(tables.flatMap((table) => table.entries.map((entry) => entry.weight > 0))).not.toContain(false);
  });

  it('only references legal enemy archetypes and returns defensive copies', () => {
    const table = getZoneEncounterTable(1);
    table.entries[0]!.enemyArchetypeId = 109;

    const fresh = getZoneEncounterTable(1);
    expect(fresh.entries.map((entry) => entry.enemyArchetypeId)).toEqual([100, 101, 104]);
    fresh.entries.forEach((entry) => expect(getEnemyArchetypeDef(entry.enemyArchetypeId)).toBeDefined());
  });
});
