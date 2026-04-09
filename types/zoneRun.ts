import type { BattleResult } from "./battle";

export type ActiveZoneRunState =
  | "TRAVERSING"
  | "AWAITING_BRANCH"
  | "POST_BATTLE_PAUSE";

export type ZoneRunTerminalStatus =
  | "COMPLETED"
  | "FAILED"
  | "ABANDONED"
  | "EXPIRED"
  | "SEASON_CUTOFF";

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
  currentSubnodeId: string | null;
  currentSubnodeOrdinal: number;
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

export interface ZoneRunActionResponse {
  activeRun: ActiveZoneRunSnapshot | null;
  closedRunSummary: ClosedZoneRunSummary | null;
  battle: ZoneRunLastBattleSummary | null;
}
