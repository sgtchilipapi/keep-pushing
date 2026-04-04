import type { PrepareFirstSyncRouteResponse, PrepareSettlementRouteResponse } from './solana';
import type { BattleResult } from '../battle';

export type ChainCreationStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export type BattleSettlementStatus =
  | 'AWAITING_FIRST_SYNC'
  | 'LOCAL_ONLY_ARCHIVED'
  | 'PENDING'
  | 'SEALED'
  | 'COMMITTED';

export type SettlementBatchStatus =
  | 'SEALED'
  | 'PREPARED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export interface CharacterReadModel {
  characterId: string;
  userId: string;
  name: string;
  level: number;
  exp: number;
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
  nextSettlementBatch: {
    settlementBatchId: string;
    batchId: number;
    startNonce: number;
    endNonce: number;
    battleCount: number;
    firstBattleTs: number;
    lastBattleTs: number;
    seasonId: number;
    status: SettlementBatchStatus;
    latestTransactionSignature: string | null;
    failureCategory: string | null;
    failureCode: string | null;
  } | null;
}

export interface CharacterQueryResponse {
  character: CharacterReadModel | null;
}

export interface AnonymousUserResponse {
  userId: string;
}

export interface CreateCharacterResponse {
  characterId: string;
  userId: string;
  name: string;
  level: number;
  stats: CharacterReadModel['stats'];
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
  settlementStatus: 'PENDING' | 'AWAITING_FIRST_SYNC';
  battleResult: BattleResult;
}

export type FirstSyncPrepareResponse = PrepareFirstSyncRouteResponse;
export type SettlementPrepareResponse = PrepareSettlementRouteResponse;
