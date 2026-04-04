import { getEnemyArchetypeDef } from './enemyArchetypes';

export interface ZoneEncounterWeight {
  enemyArchetypeId: number;
  weight: number;
}

export interface ZoneEncounterTable {
  zoneId: number;
  entries: ZoneEncounterWeight[];
}

const ZONE_ENCOUNTER_TABLES: ZoneEncounterTable[] = [
  {
    zoneId: 1,
    entries: [
      { enemyArchetypeId: 100, weight: 50 },
      { enemyArchetypeId: 101, weight: 30 },
      { enemyArchetypeId: 104, weight: 20 },
    ],
  },
  {
    zoneId: 2,
    entries: [
      { enemyArchetypeId: 101, weight: 30 },
      { enemyArchetypeId: 102, weight: 35 },
      { enemyArchetypeId: 103, weight: 20 },
      { enemyArchetypeId: 104, weight: 15 },
    ],
  },
  {
    zoneId: 3,
    entries: [
      { enemyArchetypeId: 102, weight: 30 },
      { enemyArchetypeId: 103, weight: 25 },
      { enemyArchetypeId: 105, weight: 25 },
      { enemyArchetypeId: 107, weight: 20 },
    ],
  },
  {
    zoneId: 4,
    entries: [
      { enemyArchetypeId: 103, weight: 20 },
      { enemyArchetypeId: 105, weight: 25 },
      { enemyArchetypeId: 106, weight: 30 },
      { enemyArchetypeId: 107, weight: 25 },
    ],
  },
  {
    zoneId: 5,
    entries: [
      { enemyArchetypeId: 104, weight: 15 },
      { enemyArchetypeId: 106, weight: 30 },
      { enemyArchetypeId: 108, weight: 30 },
      { enemyArchetypeId: 109, weight: 25 },
    ],
  },
];

function cloneTable(table: ZoneEncounterTable): ZoneEncounterTable {
  return {
    zoneId: table.zoneId,
    entries: table.entries.map((entry) => ({ ...entry })),
  };
}

function assertEncounterTableIntegrity(tables: ZoneEncounterTable[]): void {
  const seenZoneIds = new Set<number>();

  for (const table of tables) {
    if (!Number.isInteger(table.zoneId) || table.zoneId < 0) {
      throw new Error('ERR_INVALID_ZONE_ID: zone encounter tables require integer zone ids >= 0');
    }
    if (seenZoneIds.has(table.zoneId)) {
      throw new Error(`ERR_DUPLICATE_ZONE_ENCOUNTER_TABLE: ${table.zoneId}`);
    }
    if (table.entries.length === 0) {
      throw new Error(`ERR_EMPTY_ZONE_ENCOUNTER_TABLE: zone ${table.zoneId} has no entries`);
    }

    const seenEnemyIds = new Set<number>();
    for (const entry of table.entries) {
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        throw new Error(
          `ERR_INVALID_ZONE_ENCOUNTER_WEIGHT: zone ${table.zoneId} includes non-positive weight`,
        );
      }
      if (seenEnemyIds.has(entry.enemyArchetypeId)) {
        throw new Error(
          `ERR_DUPLICATE_ZONE_ENCOUNTER_ENTRY: zone ${table.zoneId} duplicates enemy ${entry.enemyArchetypeId}`,
        );
      }

      getEnemyArchetypeDef(entry.enemyArchetypeId);
      seenEnemyIds.add(entry.enemyArchetypeId);
    }

    seenZoneIds.add(table.zoneId);
  }
}

assertEncounterTableIntegrity(ZONE_ENCOUNTER_TABLES);

const ZONE_TABLE_BY_ID = new Map(ZONE_ENCOUNTER_TABLES.map((table) => [table.zoneId, table] as const));

export function listZoneEncounterTables(): ZoneEncounterTable[] {
  return ZONE_ENCOUNTER_TABLES.map(cloneTable);
}

export function getZoneEncounterTable(zoneId: number): ZoneEncounterTable {
  const table = ZONE_TABLE_BY_ID.get(zoneId);
  if (table === undefined) {
    throw new Error(`ERR_UNKNOWN_ZONE_ID: ${zoneId}`);
  }

  return cloneTable(table);
}

