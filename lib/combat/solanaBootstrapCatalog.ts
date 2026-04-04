import { listEnemyArchetypeDefs } from './enemyArchetypes';
import { listZoneEncounterTables } from './zoneEncounterTables';

export interface BootstrapZoneRegistryEntry {
  zoneId: number;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface BootstrapZoneEnemySetEntry {
  zoneId: number;
  allowedEnemyArchetypeIds: number[];
}

export interface BootstrapEnemyArchetypeEntry {
  enemyArchetypeId: number;
  expRewardBase: number;
}

export function listSharedBootstrapZoneRegistries(): BootstrapZoneRegistryEntry[] {
  return listZoneEncounterTables().map((table) => ({
    zoneId: table.zoneId,
    expMultiplierNum: 1,
    expMultiplierDen: 1,
  }));
}

export function mergeZoneRegistryDefaults(
  overrides: BootstrapZoneRegistryEntry[],
): BootstrapZoneRegistryEntry[] {
  const merged = new Map<number, BootstrapZoneRegistryEntry>();

  for (const entry of listSharedBootstrapZoneRegistries()) {
    merged.set(entry.zoneId, entry);
  }
  for (const entry of overrides) {
    merged.set(entry.zoneId, entry);
  }

  return [...merged.values()].sort((left, right) => left.zoneId - right.zoneId);
}

export function listSharedBootstrapZoneEnemySets(): BootstrapZoneEnemySetEntry[] {
  return listZoneEncounterTables()
    .map((table) => ({
      zoneId: table.zoneId,
      allowedEnemyArchetypeIds: table.entries.map((entry) => entry.enemyArchetypeId),
    }))
    .sort((left, right) => left.zoneId - right.zoneId);
}

export function listSharedBootstrapEnemyArchetypes(): BootstrapEnemyArchetypeEntry[] {
  return listEnemyArchetypeDefs()
    .map((def) => ({
      enemyArchetypeId: def.enemyArchetypeId,
      expRewardBase: def.expRewardBase,
    }))
    .sort((left, right) => left.enemyArchetypeId - right.enemyArchetypeId);
}
