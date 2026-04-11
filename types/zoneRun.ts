import type { BattleResult } from "./battle";
import {
  type ZoneRunTerminalStatusValue,
  ZONE_RUN_TERMINAL_STATUSES,
  isZoneRunTerminalStatus,
} from "../lib/combat/zoneRunSkillMetadata";

export type ActiveZoneRunState =
  | "TRAVERSING"
  | "AWAITING_BRANCH"
  | "POST_BATTLE_PAUSE";

export type ZoneRunTerminalStatus = ZoneRunTerminalStatusValue;
export { ZONE_RUN_TERMINAL_STATUSES, isZoneRunTerminalStatus };

export interface ZoneRunStatusEffectState {
  sourceId: string;
  remainingTurns: number;
}

export interface ZoneRunPlayerCarryoverState {
  hp: number;
  hpMax: number;
  cooldowns: Record<string, number>;
  statuses: Record<string, ZoneRunStatusEffectState>;
}

export interface ZoneRunLastBattleSummary {
  battleId: string;
  enemyArchetypeId: number;
  nodeId: string;
  subnodeId: string;
  rewarded: boolean;
  battleResult: BattleResult;
}

export interface ActiveZoneRunSnapshot {
  runId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  state: ActiveZoneRunState;
  currentNodeId: string;
  enteredNodeIds: string[];
  currentSubnodeId: string | null;
  currentSubnodeOrdinal: number;
  lastConsumedNodeId: string | null;
  lastConsumedSubnodeId: string | null;
  lastConsumedSubnodeOrdinal: number;
  totalSubnodesTraversed: number;
  totalSubnodesInRun: number;
  branchOptions: string[];
  enemyAppearanceCounts: Record<string, number>;
  playerCarryover: ZoneRunPlayerCarryoverState;
  lastBattle: ZoneRunLastBattleSummary | null;
}

export interface ClosedZoneRunSummary {
  zoneRunId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: ZoneRunTerminalStatus;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: Record<string, number>;
  zoneProgressDelta: unknown;
  closedAt: string;
}

export interface ZoneRunTopologyNodePreview {
  nodeId: string;
  subnodes: Array<{
    subnodeId: string;
    combatChanceBP: number;
  }>;
  nextNodeIds: string[];
  enemyArchetypes: Array<{
    enemyArchetypeId: number;
    displayName: string;
  }>;
}

export interface ZoneRunTopologyPreview {
  zoneId: number;
  topologyVersion: number;
  topologyHash: string;
  startNodeId: string;
  terminalNodeIds: string[];
  totalSubnodeCount: number;
  enemyRules: Array<{
    enemyArchetypeId: number;
    displayName: string;
    maxPerRun: number;
  }>;
  nodes: ZoneRunTopologyNodePreview[];
}

export interface ZoneRunActionResponse {
  activeRun: ActiveZoneRunSnapshot | null;
  closedRunSummary: ClosedZoneRunSummary | null;
  battle: ZoneRunLastBattleSummary | null;
}

export interface ZoneRunTopologyResponse {
  topology: ZoneRunTopologyPreview;
}
