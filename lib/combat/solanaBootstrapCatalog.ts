import {
  getEnabledClassRegistrySeedEntries,
} from "../catalog/classes";
import { listEnemyArchetypeDefs } from "./enemyArchetypes";
import { listZoneRunTopologies } from "./zoneRunTopologies";

export interface BootstrapZoneRegistryEntry {
  zoneId: number;
  topologyVersion: number;
  totalSubnodeCount: number;
  topologyHash: string;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface BootstrapZoneEnemyRuleEntry {
  enemyArchetypeId: number;
  maxPerRun: number;
}

export interface BootstrapZoneEnemySetEntry {
  zoneId: number;
  topologyVersion: number;
  enemyRules: BootstrapZoneEnemyRuleEntry[];
}

export interface BootstrapEnemyArchetypeEntry {
  enemyArchetypeId: number;
  expRewardBase: number;
}

export interface BootstrapClassRegistryEntry {
  classId: string;
  compactId: number;
  enabled: boolean;
}

function zoneVersionKey(zoneId: number, topologyVersion: number): string {
  return `${zoneId}:${topologyVersion}`;
}

export function listSharedBootstrapZoneRegistries(): BootstrapZoneRegistryEntry[] {
  return listZoneRunTopologies()
    .map((topology) => ({
      zoneId: topology.zoneId,
      topologyVersion: topology.topologyVersion,
      totalSubnodeCount: topology.totalSubnodeCount,
      topologyHash: topology.topologyHash,
      expMultiplierNum: 1,
      expMultiplierDen: 1,
    }))
    .sort(
      (left, right) =>
        left.zoneId - right.zoneId ||
        left.topologyVersion - right.topologyVersion,
    );
}

export function mergeZoneRegistryDefaults(
  overrides: BootstrapZoneRegistryEntry[],
): BootstrapZoneRegistryEntry[] {
  const merged = new Map<string, BootstrapZoneRegistryEntry>();

  for (const entry of listSharedBootstrapZoneRegistries()) {
    merged.set(zoneVersionKey(entry.zoneId, entry.topologyVersion), entry);
  }
  for (const entry of overrides) {
    merged.set(zoneVersionKey(entry.zoneId, entry.topologyVersion), entry);
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.zoneId - right.zoneId ||
      left.topologyVersion - right.topologyVersion,
  );
}

export function listSharedBootstrapZoneEnemySets(): BootstrapZoneEnemySetEntry[] {
  return listZoneRunTopologies()
    .map((topology) => ({
      zoneId: topology.zoneId,
      topologyVersion: topology.topologyVersion,
      enemyRules: topology.enemyRules.map((rule) => ({ ...rule })),
    }))
    .sort(
      (left, right) =>
        left.zoneId - right.zoneId ||
        left.topologyVersion - right.topologyVersion,
    );
}

export function listSharedBootstrapEnemyArchetypes(): BootstrapEnemyArchetypeEntry[] {
  return listEnemyArchetypeDefs()
    .map((def) => ({
      enemyArchetypeId: def.enemyArchetypeId,
      expRewardBase: def.expRewardBase,
    }))
    .sort((left, right) => left.enemyArchetypeId - right.enemyArchetypeId);
}

export function listSharedBootstrapClassRegistries(): BootstrapClassRegistryEntry[] {
  return getEnabledClassRegistrySeedEntries().sort(
    (left, right) => left.compactId - right.compactId,
  );
}
