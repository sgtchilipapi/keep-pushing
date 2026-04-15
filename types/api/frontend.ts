import type { PrepareSettlementRouteResponse } from "./solana";
import type { BattleResult } from "../battle";
import type { ActiveZoneRunState, ClosedZoneRunSummary } from "../zoneRun";

export type ChainCreationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED";

export type CharacterSyncPhase =
  | "LOCAL_ONLY"
  | "CREATING_ON_CHAIN"
  | "INITIAL_SETTLEMENT_REQUIRED"
  | "SYNCED"
  | "SETTLEMENT_PENDING"
  | "FAILED";

export type BattleSettlementStatus =
  | "AWAITING_FIRST_SYNC"
  | "LOCAL_ONLY_ARCHIVED"
  | "PENDING"
  | "SEALED"
  | "COMMITTED";

export type AccountMode = "anon" | "wallet-linked";
export type SeasonPhase = "active" | "grace" | "ended";
export type RunShareStatus = "PENDING" | "SYNCED" | "EXPIRED";

export interface CharacterReadModel {
  characterId: string;
  userId: string;
  name: string;
  classId?: string;
  slotIndex?: number;
  chainBootstrapReady?: boolean;
  level: number;
  exp: number;
  syncPhase: CharacterSyncPhase;
  battleEligible: boolean;
  stats: {
    hp: number;
    hpMax: number;
    atk: number;
    def: number;
    spd: number;
    accuracyBP: number;
    evadeBP: number;
  };
  activeSkills: string[];
  passiveSkills: string[];
  unlockedSkillIds: string[];
  inventory: unknown[];
  chain: {
    playerAuthorityPubkey: string | null;
    chainCharacterIdHex: string | null;
    characterRootPubkey: string | null;
    chainCreationStatus: ChainCreationStatus;
    chainCreationTxSignature: string | null;
    chainCreatedAt: string | null;
    chainCreationTs: number | null;
    chainCreationSeasonId: number | null;
    cursor: {
      lastReconciledEndNonce: number;
      lastReconciledStateHash: string;
      lastReconciledBatchId: number;
      lastReconciledBattleTs: number;
      lastReconciledSeasonId: number;
      lastReconciledAt: string | null;
    } | null;
  } | null;
  provisionalProgress: {
    highestUnlockedZoneId: number;
    highestClearedZoneId: number;
    zoneStates: Record<string, number>;
  } | null;
  latestBattle: {
    battleId: string;
    localSequence: number;
    battleNonce: number | null;
    battleTs: number;
    seasonId: number;
    zoneId: number;
    enemyArchetypeId: number;
    settlementStatus: BattleSettlementStatus;
    sealedBatchId: string | null;
    committedAt: string | null;
  } | null;
  nextPendingSettlementRun?: {
    zoneRunId: string;
    closedRunSequence: number;
    zoneId: number;
    seasonId: number;
    rewardedBattleCount: number;
    closedAt: string;
  } | null;
  pendingSettlementRunCount?: number;
  activeZoneRun?: {
    runId: string;
    zoneId: number;
    seasonId: number;
    state: ActiveZoneRunState;
    currentNodeId: string;
    currentSubnodeId: string | null;
    totalSubnodesTraversed: number;
    totalSubnodesInRun: number;
    branchOptions: string[];
  } | null;
  latestClosedZoneRun?: ClosedZoneRunSummary | null;
}

export interface CharacterQueryResponse {
  character: CharacterReadModel | null;
}

export interface CharacterRosterItem {
  characterId: string;
  name: string;
  classId: string;
  slotIndex: number;
  level: number;
  syncStatus: CharacterSyncPhase;
}

export interface CharacterRosterResponse {
  accountMode: AccountMode;
  slotsTotal: number;
  characters: CharacterRosterItem[];
}

export interface CurrentSeasonResponse {
  seasonId: number;
  seasonNumber: number;
  seasonName: string;
  seasonStartTs: number;
  seasonEndTs: number;
  commitGraceEndTs: number;
  phase: SeasonPhase;
}

export interface CharacterClassCatalogItem {
  classId: string;
  displayName: string;
  description: string;
  artKey: string;
  enabled: boolean;
}

export interface CharacterClassesResponse {
  classes: CharacterClassCatalogItem[];
}

export interface CharacterDetailResponse {
  character: CharacterReadModel;
  season: CurrentSeasonResponse;
}

export interface SyncAttemptItem {
  attemptId: string;
  attemptNumber: number;
  status: string;
  transactionSignature: string | null;
  submittedAt: string | null;
  resolvedAt: string | null;
  rpcError: string | null;
}

export interface CharacterSyncDetailResponse {
  character: CharacterReadModel;
  season: CurrentSeasonResponse;
  sync: {
    mode: "first_sync" | "settlement" | null;
    pendingBatchId?: string | null;
    pendingBatchNumber?: number | null;
    pendingRunSettlementId?: string | null;
    pendingRunSequence?: number | null;
    pendingRunCount?: number;
    attempts: SyncAttemptItem[];
  };
}

export interface RunResultBattleItem {
  battleId: string;
  enemyArchetypeId: number;
  enemyName: string;
  nodeId: string | null;
  subnodeId: string | null;
  rewardEligible: boolean;
  winnerEntityId: string;
  roundsPlayed: number;
  settlementStatus: BattleSettlementStatus | null;
  committedAt: string | null;
  battleTs: number | null;
  createdAt: string;
}

export interface RunResultReadModel {
  runId: string;
  characterId: string;
  characterName: string;
  classId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: string;
  shareStatus: RunShareStatus;
  shareStatusLabel: string;
  shareStatusDetail: string;
  battleCount: number;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: Record<string, number>;
  zoneProgressDelta: unknown;
  closedAt: string | null;
  resultUrl: string;
  shareUrl: string;
  battles: RunResultBattleItem[];
}

export interface RunResultResponse {
  run: RunResultReadModel;
}

export interface RunShareResponse {
  runId: string;
  shareUrl: string;
  resultUrl: string;
  shareText: string;
  shareStatus: RunShareStatus;
}

export interface AnonymousUserResponse {
  userId: string;
  accountMode?: AccountMode;
}

export interface CreateCharacterResponse {
  characterId: string;
  userId: string;
  name: string;
  classId?: string;
  slotIndex?: number;
  level: number;
  stats: CharacterReadModel["stats"];
  activeSkills: string[];
  passiveSkills: string[];
  unlockedSkillIds: string[];
}

export interface EncounterResponse {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  battleNonce: number;
  seasonId: number;
  battleTs: number;
  settlementStatus: "PENDING" | "AWAITING_FIRST_SYNC";
  battleResult: BattleResult;
}

export type SettlementPrepareResponse = PrepareSettlementRouteResponse;
