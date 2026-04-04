import { XorShift32 } from '../../engine/rng/xorshift32';
import { getEnemyArchetypeDef, type EnemyArchetypeDef } from './enemyArchetypes';
import { getZoneEncounterTable } from './zoneEncounterTables';

export interface SelectedEncounter {
  zoneId: number;
  seed: number;
  totalWeight: number;
  roll: number;
  enemyArchetypeId: number;
  enemyArchetype: EnemyArchetypeDef;
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`);
  }
}

export function selectEncounterForZone(zoneId: number, seed: number): SelectedEncounter {
  assertInteger(zoneId, 'zoneId', 0);
  assertInteger(seed, 'seed');

  const table = getZoneEncounterTable(zoneId);
  const totalWeight = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  const rng = new XorShift32(seed);
  const roll = rng.nextInt(1, totalWeight);

  let remaining = roll;
  for (const entry of table.entries) {
    remaining -= entry.weight;
    if (remaining <= 0) {
      return {
        zoneId,
        seed,
        totalWeight,
        roll,
        enemyArchetypeId: entry.enemyArchetypeId,
        enemyArchetype: getEnemyArchetypeDef(entry.enemyArchetypeId),
      };
    }
  }

  throw new Error(`ERR_ENCOUNTER_SELECTION_FAILED: zone ${zoneId} roll ${roll} did not resolve`);
}
