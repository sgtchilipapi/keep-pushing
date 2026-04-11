import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { allocateNextBattleNonce } from './combat/battleNonce';
import { normalizeCharacterName } from './characterIdentity';
import type { ZoneState } from '../types/settlement';
import type {
  ActiveZoneRunSnapshot,
  ActiveZoneRunState,
  ClosedZoneRunSummary,
  ZoneRunLastBattleSummary,
  ZoneRunPlayerCarryoverState,
  ZoneRunTerminalStatus,
} from '../types/zoneRun';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? {
        connectionString
      }
    : undefined
);

function createRowId(): string {
  return randomUUID();
}

const DEFAULT_STARTER_UNLOCKED_ZONE_ID = 1;

type CharacterCreateInput = {
  userId: string;
  name: string;
  nameNormalized: string;
  classId: string;
  slotIndex: number;
  chainBootstrapReady: boolean;
  nameReservationId?: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkills: string[];
  passiveSkills: string[];
};

export type CharacterChainCreationStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export type BattleOutcomeLedgerStatus =
  | 'AWAITING_FIRST_SYNC'
  | 'LOCAL_ONLY_ARCHIVED'
  | 'PENDING'
  | 'SEALED'
  | 'COMMITTED';
export type SettlementBatchStatus = 'SEALED' | 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
export type SettlementSubmissionAttemptStatus = 'STARTED' | 'BROADCAST' | 'CONFIRMED' | 'FAILED' | 'TIMEOUT';
export type ActiveZoneRunStateRecord = ActiveZoneRunState;
export type ZoneRunTerminalStatusRecord = ZoneRunTerminalStatus;
export type CharacterProvisionalZoneState = ZoneState;

export type CharacterProvisionalProgressRecord = {
  id: string;
  characterId: string;
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
  zoneStates: Record<string, CharacterProvisionalZoneState>;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCharacterProvisionalProgressInput = {
  characterId: string;
  highestUnlockedZoneId: number;
  highestClearedZoneId?: number;
  zoneStates: Record<string, CharacterProvisionalZoneState>;
};

export type UpdateCharacterProvisionalProgressInput = {
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
  zoneStates: Record<string, CharacterProvisionalZoneState>;
};

export type CharacterChainState = {
  id: string;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: number | null;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: number | null;
  lastReconciledBattleTs: number | null;
  lastReconciledSeasonId: number | null;
  lastReconciledAt: Date | null;
};

export type CharacterBattleReadyRecord = {
  id: string;
  userId: string;
  name: string;
  nameNormalized: string;
  classId: string;
  slotIndex: number;
  chainBootstrapReady: boolean;
  createdAt: Date;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: number | null;
  lastReconciledBattleTs: number | null;
  lastReconciledSeasonId: number | null;
  activeSkills: string[];
  passiveSkills: string[];
};

export type UpdateCharacterChainIdentityInput = {
  playerAuthorityPubkey: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature?: string | null;
  chainCreatedAt?: Date | null;
  chainCreationTs?: number | null;
  chainCreationSeasonId?: number | null;
};

export type CharacterNameReservationStatus =
  | 'HELD'
  | 'CONSUMED'
  | 'RELEASED'
  | 'EXPIRED';

export type CharacterNameReservationRecord = {
  id: string;
  userId: string;
  characterId: string | null;
  displayName: string;
  normalizedName: string;
  status: CharacterNameReservationStatus;
  active: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCharacterNameReservationInput = {
  userId: string;
  displayName: string;
  normalizedName: string;
  expiresAt: Date;
};

export type UpdateCharacterCursorSnapshotInput = {
  lastReconciledEndNonce: number;
  lastReconciledStateHash: string;
  lastReconciledBatchId: number;
  lastReconciledBattleTs: number;
  lastReconciledSeasonId: number;
  lastReconciledAt?: Date;
};

export type BattleOutcomeLedgerRecord = {
  id: string;
  characterId: string;
  battleId: string;
  zoneRunId?: string | null;
  localSequence: number;
  battleNonce: number | null;
  battleTs: number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDelta: unknown;
  settlementStatus: BattleOutcomeLedgerStatus;
  sealedBatchId: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBattleOutcomeLedgerInput = {
  characterId: string;
  battleId: string;
  zoneRunId?: string | null;
  localSequence: number;
  battleNonce?: number | null;
  battleTs: number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDelta: unknown;
  settlementStatus?: BattleOutcomeLedgerStatus;
};

export type BattleRecordRecord = {
  id: string;
  battleId: string;
  characterId: string;
  zoneRunId?: string | null;
  zoneId: number;
  nodeId?: string | null;
  subnodeId?: string | null;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  playerFinal?: unknown | null;
  enemyFinal?: unknown | null;
  rewardEligible?: boolean;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBattleRecordInput = {
  battleId: string;
  characterId: string;
  zoneRunId?: string | null;
  zoneId: number;
  nodeId?: string | null;
  subnodeId?: string | null;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  playerFinal?: unknown | null;
  enemyFinal?: unknown | null;
  rewardEligible?: boolean;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
};

export type CreatePersistedEncounterInput = {
  battleId: string;
  characterId: string;
  zoneRunId?: string | null;
  zoneId: number;
  nodeId?: string | null;
  subnodeId?: string | null;
  enemyArchetypeId: number;
  seed: number;
  playerInitial: unknown;
  enemyInitial: unknown;
  playerFinal?: unknown | null;
  enemyFinal?: unknown | null;
  rewardEligible?: boolean;
  winnerEntityId: string;
  roundsPlayed: number;
  events: unknown;
  battleTs: number;
  seasonId: number;
  zoneProgressDelta: unknown;
};

export type PersistedEncounterRecord = {
  battleRecord: BattleRecordRecord;
  ledger: BattleOutcomeLedgerRecord;
};

export type ActiveZoneRunRecord = {
  id: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  state: ActiveZoneRunStateRecord;
  currentNodeId: string;
  snapshot: ActiveZoneRunSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateActiveZoneRunInput = {
  id: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  state: ActiveZoneRunStateRecord;
  currentNodeId: string;
  snapshot: ActiveZoneRunSnapshot;
};

export type UpdateActiveZoneRunInput = {
  state: ActiveZoneRunStateRecord;
  currentNodeId: string;
  snapshot: ActiveZoneRunSnapshot;
};

export type ClosedZoneRunSummaryRecord = {
  id: string;
  zoneRunId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: ZoneRunTerminalStatusRecord;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: Record<string, number>;
  zoneProgressDelta: unknown;
  closedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateClosedZoneRunSummaryInput = {
  zoneRunId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: ZoneRunTerminalStatusRecord;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: Record<string, number>;
  zoneProgressDelta: unknown;
  closedAt?: Date;
};

export type ZoneRunActionLogRecord = {
  id: string;
  zoneRunId: string;
  characterId: string;
  actionType: string;
  nodeId: string | null;
  subnodeId: string | null;
  payload: unknown;
  createdAt: Date;
};

export type CreateZoneRunActionLogInput = {
  zoneRunId: string;
  characterId: string;
  actionType: string;
  nodeId?: string | null;
  subnodeId?: string | null;
  payload: unknown;
};

export type ZoneRunMutationDedupRecord = {
  id: string;
  characterId: string;
  requestKey: string;
  actionType: string;
  response: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateZoneRunMutationDedupInput = {
  characterId: string;
  requestKey: string;
  actionType: string;
  response: unknown;
};

export type CreateLocalFirstPersistedEncounterInput = CreatePersistedEncounterInput & {
  provisionalProgress: UpdateCharacterProvisionalProgressInput;
};

export type SettlementBatchRecord = {
  id: string;
  characterId: string;
  batchId: number;
  startNonce: number;
  endNonce: number;
  battleCount: number;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDelta: unknown;
  encounterHistogram: unknown;
  optionalLoadoutRevision: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  status: SettlementBatchStatus;
  failureCategory: string | null;
  failureCode: string | null;
  latestMessageSha256Hex: string | null;
  latestSignedTxSha256Hex: string | null;
  latestTransactionSignature: string | null;
  preparedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSettlementBatchInput = {
  characterId: string;
  batchId: number;
  startNonce: number;
  endNonce: number;
  battleCount: number;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDelta: unknown;
  encounterHistogram: unknown;
  optionalLoadoutRevision?: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  sealedBattleIds?: string[];
};

export type UpdateSettlementBatchStatusInput = {
  status: SettlementBatchStatus;
  failureCategory?: string | null;
  failureCode?: string | null;
  latestMessageSha256Hex?: string | null;
  latestSignedTxSha256Hex?: string | null;
  latestTransactionSignature?: string | null;
  preparedAt?: Date | null;
  submittedAt?: Date | null;
  confirmedAt?: Date | null;
  failedAt?: Date | null;
};

export type SettlementSubmissionAttemptRecord = {
  id: string;
  settlementBatchId: string;
  attemptNumber: number;
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex: string | null;
  signedTransactionSha256Hex: string | null;
  transactionSignature: string | null;
  rpcError: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date | null;
};

export type CreateSettlementSubmissionAttemptInput = {
  settlementBatchId: string;
  attemptNumber: number;
  status?: SettlementSubmissionAttemptStatus;
  messageSha256Hex?: string | null;
  signedTransactionSha256Hex?: string | null;
  transactionSignature?: string | null;
  rpcError?: string | null;
  submittedAt?: Date | null;
  resolvedAt?: Date | null;
};

export type UpdateSettlementSubmissionAttemptInput = {
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex?: string | null;
  signedTransactionSha256Hex?: string | null;
  transactionSignature?: string | null;
  rpcError?: string | null;
  submittedAt?: Date | null;
  resolvedAt?: Date | null;
};

export type RebasedBattleNonceAssignment = {
  id: string;
  battleNonce: number;
};

type CharacterChainStateRow = {
  id: string;
  playerAuthorityPubkey: string | null;
  chainCharacterIdHex: string | null;
  characterRootPubkey: string | null;
  chainCreationStatus: CharacterChainCreationStatus;
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: string | number | null;
  chainCreationSeasonId: number | null;
  lastReconciledEndNonce: string | number | null;
  lastReconciledStateHash: string | null;
  lastReconciledBatchId: string | number | null;
  lastReconciledBattleTs: string | number | null;
  lastReconciledSeasonId: number | null;
  lastReconciledAt: Date | null;
};

type CharacterProvisionalProgressRow = {
  id: string;
  characterId: string;
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
  zoneStatesJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type CharacterNameReservationRow = {
  id: string;
  userId: string;
  characterId: string | null;
  displayName: string;
  normalizedName: string;
  status: CharacterNameReservationStatus;
  active: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type BattleOutcomeLedgerRow = {
  id: string;
  characterId: string;
  battleId: string;
  zoneRunId: string | null;
  localSequence: string | number;
  battleNonce: string | number | null;
  battleTs: string | number;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  zoneProgressDeltaJson: unknown;
  settlementStatus: BattleOutcomeLedgerStatus;
  sealedBatchId: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type BattleRecordRow = {
  id: string;
  battleId: string;
  characterId: string;
  zoneRunId: string | null;
  zoneId: number;
  nodeId: string | null;
  subnodeId: string | null;
  enemyArchetypeId: number;
  seed: number;
  playerInitialJson: unknown;
  enemyInitialJson: unknown;
  playerFinalJson: unknown | null;
  enemyFinalJson: unknown | null;
  rewardEligible: boolean;
  winnerEntityId: string;
  roundsPlayed: number;
  eventsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ActiveZoneRunRow = {
  id: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  state: ActiveZoneRunStateRecord;
  currentNodeId: string;
  stateJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ClosedZoneRunSummaryRow = {
  id: string;
  zoneRunId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: ZoneRunTerminalStatusRecord;
  rewardedBattleCount: number;
  rewardedEncounterHistogramJson: unknown;
  zoneProgressDeltaJson: unknown;
  closedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ZoneRunActionLogRow = {
  id: string;
  zoneRunId: string;
  characterId: string;
  actionType: string;
  nodeId: string | null;
  subnodeId: string | null;
  payloadJson: unknown;
  createdAt: Date;
};

type ZoneRunMutationDedupRow = {
  id: string;
  characterId: string;
  requestKey: string;
  actionType: string;
  responseJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type SettlementBatchRow = {
  id: string;
  characterId: string;
  batchId: string | number;
  startNonce: string | number;
  endNonce: string | number;
  battleCount: number;
  firstBattleTs: string | number;
  lastBattleTs: string | number;
  seasonId: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDeltaJson: unknown;
  encounterHistogramJson: unknown;
  optionalLoadoutRevision: number | null;
  batchHash: string;
  schemaVersion: number;
  signatureScheme: number;
  status: SettlementBatchStatus;
  failureCategory: string | null;
  failureCode: string | null;
  latestMessageSha256Hex: string | null;
  latestSignedTxSha256Hex: string | null;
  latestTransactionSignature: string | null;
  preparedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SettlementSubmissionAttemptRow = {
  id: string;
  settlementBatchId: string;
  attemptNumber: number;
  status: SettlementSubmissionAttemptStatus;
  messageSha256Hex: string | null;
  signedTransactionSha256Hex: string | null;
  transactionSignature: string | null;
  rpcError: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date | null;
};

function parseNullableSafeInteger(value: string | number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`ERR_INVALID_DB_INTEGER: ${field} was not a safe integer`);
  }

  return parsed;
}

function parseRequiredSafeInteger(value: string | number, field: string): number {
  const parsed = parseNullableSafeInteger(value, field);
  if (parsed === null) {
    throw new Error(`ERR_MISSING_DB_INTEGER: ${field} was unexpectedly null`);
  }

  return parsed;
}

function mapCharacterChainState(row: CharacterChainStateRow): CharacterChainState {
  return {
    id: row.id,
    playerAuthorityPubkey: row.playerAuthorityPubkey,
    chainCharacterIdHex: row.chainCharacterIdHex,
    characterRootPubkey: row.characterRootPubkey,
    chainCreationStatus: row.chainCreationStatus,
    chainCreationTxSignature: row.chainCreationTxSignature,
    chainCreatedAt: row.chainCreatedAt,
    chainCreationTs: parseNullableSafeInteger(row.chainCreationTs, 'chainCreationTs'),
    chainCreationSeasonId: row.chainCreationSeasonId,
    lastReconciledEndNonce: parseNullableSafeInteger(row.lastReconciledEndNonce, 'lastReconciledEndNonce'),
    lastReconciledStateHash: row.lastReconciledStateHash,
    lastReconciledBatchId: parseNullableSafeInteger(row.lastReconciledBatchId, 'lastReconciledBatchId'),
    lastReconciledBattleTs: parseNullableSafeInteger(row.lastReconciledBattleTs, 'lastReconciledBattleTs'),
    lastReconciledSeasonId: row.lastReconciledSeasonId,
    lastReconciledAt: row.lastReconciledAt
  };
}

function parseCharacterZoneStates(value: unknown): Record<string, CharacterProvisionalZoneState> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('ERR_INVALID_ZONE_STATES: zoneStatesJson must be a plain object');
  }

  const out: Record<string, CharacterProvisionalZoneState> = {};
  for (const [zoneId, zoneState] of Object.entries(value)) {
    if (!/^\d+$/.test(zoneId)) {
      throw new Error('ERR_INVALID_ZONE_STATES: zone state keys must be numeric strings');
    }
    if (zoneState !== 0 && zoneState !== 1 && zoneState !== 2) {
      throw new Error(`ERR_INVALID_ZONE_STATES: zone ${zoneId} must be 0, 1, or 2`);
    }
    out[zoneId] = zoneState;
  }

  return out;
}

function mapCharacterProvisionalProgress(
  row: CharacterProvisionalProgressRow
): CharacterProvisionalProgressRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    highestUnlockedZoneId: row.highestUnlockedZoneId,
    highestClearedZoneId: row.highestClearedZoneId,
    zoneStates: parseCharacterZoneStates(row.zoneStatesJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapCharacterNameReservation(
  row: CharacterNameReservationRow
): CharacterNameReservationRecord {
  return {
    id: row.id,
    userId: row.userId,
    characterId: row.characterId,
    displayName: row.displayName,
    normalizedName: row.normalizedName,
    status: row.status,
    active: row.active,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapBattleOutcomeLedger(row: BattleOutcomeLedgerRow): BattleOutcomeLedgerRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    battleId: row.battleId,
    zoneRunId: row.zoneRunId,
    localSequence: parseRequiredSafeInteger(row.localSequence, 'localSequence'),
    battleNonce: parseNullableSafeInteger(row.battleNonce, 'battleNonce'),
    battleTs: parseRequiredSafeInteger(row.battleTs, 'battleTs'),
    seasonId: row.seasonId,
    zoneId: row.zoneId,
    enemyArchetypeId: row.enemyArchetypeId,
    zoneProgressDelta: row.zoneProgressDeltaJson,
    settlementStatus: row.settlementStatus,
    sealedBatchId: row.sealedBatchId,
    committedAt: row.committedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapBattleRecord(row: BattleRecordRow): BattleRecordRecord {
  return {
    id: row.id,
    battleId: row.battleId,
    characterId: row.characterId,
    zoneRunId: row.zoneRunId,
    zoneId: row.zoneId,
    nodeId: row.nodeId,
    subnodeId: row.subnodeId,
    enemyArchetypeId: row.enemyArchetypeId,
    seed: row.seed,
    playerInitial: row.playerInitialJson,
    enemyInitial: row.enemyInitialJson,
    playerFinal: row.playerFinalJson,
    enemyFinal: row.enemyFinalJson,
    rewardEligible: row.rewardEligible,
    winnerEntityId: row.winnerEntityId,
    roundsPlayed: row.roundsPlayed,
    events: row.eventsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapActiveZoneRun(row: ActiveZoneRunRow): ActiveZoneRunRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    zoneId: row.zoneId,
    seasonId: row.seasonId,
    topologyVersion: row.topologyVersion,
    topologyHash: row.topologyHash,
    state: row.state,
    currentNodeId: row.currentNodeId,
    snapshot: row.stateJson as ActiveZoneRunSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapClosedZoneRunSummary(row: ClosedZoneRunSummaryRow): ClosedZoneRunSummaryRecord {
  return {
    id: row.id,
    zoneRunId: row.zoneRunId,
    characterId: row.characterId,
    zoneId: row.zoneId,
    seasonId: row.seasonId,
    topologyVersion: row.topologyVersion,
    topologyHash: row.topologyHash,
    terminalStatus: row.terminalStatus,
    rewardedBattleCount: row.rewardedBattleCount,
    rewardedEncounterHistogram: row.rewardedEncounterHistogramJson as Record<string, number>,
    zoneProgressDelta: row.zoneProgressDeltaJson,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapZoneRunActionLog(row: ZoneRunActionLogRow): ZoneRunActionLogRecord {
  return {
    id: row.id,
    zoneRunId: row.zoneRunId,
    characterId: row.characterId,
    actionType: row.actionType,
    nodeId: row.nodeId,
    subnodeId: row.subnodeId,
    payload: row.payloadJson,
    createdAt: row.createdAt,
  };
}

function mapZoneRunMutationDedup(row: ZoneRunMutationDedupRow): ZoneRunMutationDedupRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    requestKey: row.requestKey,
    actionType: row.actionType,
    response: row.responseJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function insertPersistedEncounter(
  client: PoolClient,
  input: CreatePersistedEncounterInput & { localSequence: number; battleNonce: number }
): Promise<PersistedEncounterRecord> {
  const battleRecordResult = await client.query<BattleRecordRow>(
    `INSERT INTO "BattleRecord"
      (
        id,
        "battleId",
        "characterId",
        "zoneRunId",
        "zoneId",
        "nodeId",
        "subnodeId",
        "enemyArchetypeId",
        seed,
        "playerInitialJson",
        "enemyInitialJson",
        "playerFinalJson",
        "enemyFinalJson",
        "rewardEligible",
        "winnerEntityId",
        "roundsPlayed",
        "eventsJson",
        "updatedAt"
      )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17::jsonb,$18)
    RETURNING
      id,
      "battleId",
      "characterId",
      "zoneRunId",
      "zoneId",
      "nodeId",
      "subnodeId",
      "enemyArchetypeId",
      seed,
      "playerInitialJson",
      "enemyInitialJson",
      "playerFinalJson",
      "enemyFinalJson",
      "rewardEligible",
      "winnerEntityId",
      "roundsPlayed",
      "eventsJson",
      "createdAt",
      "updatedAt"`,
    [
      createRowId(),
      input.battleId,
      input.characterId,
      input.zoneRunId ?? null,
      input.zoneId,
      input.nodeId ?? null,
      input.subnodeId ?? null,
      input.enemyArchetypeId,
      input.seed,
      JSON.stringify(input.playerInitial),
      JSON.stringify(input.enemyInitial),
      JSON.stringify(input.playerFinal ?? null),
      JSON.stringify(input.enemyFinal ?? null),
      input.rewardEligible ?? true,
      input.winnerEntityId,
      input.roundsPlayed,
      JSON.stringify(input.events),
      new Date()
    ]
  );

  const ledgerResult = await client.query<BattleOutcomeLedgerRow>(
    `INSERT INTO "BattleOutcomeLedger"
      (
        id,
        "characterId",
        "battleId",
        "zoneRunId",
        "localSequence",
        "battleNonce",
        "battleTs",
        "seasonId",
        "zoneId",
        "enemyArchetypeId",
        "zoneProgressDeltaJson",
        "updatedAt"
      )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
    RETURNING
      id,
      "characterId",
      "battleId",
      "zoneRunId",
      "localSequence",
      "battleNonce",
      "battleTs",
      "seasonId",
      "zoneId",
      "enemyArchetypeId",
      "zoneProgressDeltaJson",
      "settlementStatus",
      "sealedBatchId",
      "committedAt",
      "createdAt",
      "updatedAt"`,
    [
      createRowId(),
      input.characterId,
      input.battleId,
      input.zoneRunId ?? null,
      input.localSequence,
      input.battleNonce,
      input.battleTs,
      input.seasonId,
      input.zoneId,
      input.enemyArchetypeId,
      JSON.stringify(input.zoneProgressDelta),
      new Date()
    ]
  );

  return {
    battleRecord: mapBattleRecord(battleRecordResult.rows[0]),
    ledger: mapBattleOutcomeLedger(ledgerResult.rows[0])
  };
}

function mapSettlementBatch(row: SettlementBatchRow): SettlementBatchRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    batchId: parseRequiredSafeInteger(row.batchId, 'batchId'),
    startNonce: parseRequiredSafeInteger(row.startNonce, 'startNonce'),
    endNonce: parseRequiredSafeInteger(row.endNonce, 'endNonce'),
    battleCount: row.battleCount,
    firstBattleTs: parseRequiredSafeInteger(row.firstBattleTs, 'firstBattleTs'),
    lastBattleTs: parseRequiredSafeInteger(row.lastBattleTs, 'lastBattleTs'),
    seasonId: row.seasonId,
    startStateHash: row.startStateHash,
    endStateHash: row.endStateHash,
    zoneProgressDelta: row.zoneProgressDeltaJson,
    encounterHistogram: row.encounterHistogramJson,
    optionalLoadoutRevision: row.optionalLoadoutRevision,
    batchHash: row.batchHash,
    schemaVersion: row.schemaVersion,
    signatureScheme: row.signatureScheme,
    status: row.status,
    failureCategory: row.failureCategory,
    failureCode: row.failureCode,
    latestMessageSha256Hex: row.latestMessageSha256Hex,
    latestSignedTxSha256Hex: row.latestSignedTxSha256Hex,
    latestTransactionSignature: row.latestTransactionSignature,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSettlementSubmissionAttempt(row: SettlementSubmissionAttemptRow): SettlementSubmissionAttemptRecord {
  return {
    id: row.id,
    settlementBatchId: row.settlementBatchId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    messageSha256Hex: row.messageSha256Hex,
    signedTransactionSha256Hex: row.signedTransactionSha256Hex,
    transactionSignature: row.transactionSignature,
    rpcError: row.rpcError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt
  };
}

export const prisma = {
  user: {
    async create() {
      const result = await pool.query<{ id: string }>(
        'INSERT INTO "User" (id, "updatedAt") VALUES ($1, $2) RETURNING id',
        [createRowId(), new Date()],
      );
      return result.rows[0];
    },
    async findUnique(id: string) {
      const result = await pool.query<{ id: string }>('SELECT id FROM "User" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    }
  },
  characterNameReservation: {
    async createHold(input: CreateCharacterNameReservationInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query<CharacterNameReservationRow>(
          `UPDATE "CharacterNameReservation"
          SET status = 'EXPIRED', active = false, "releasedAt" = $2, "updatedAt" = $2
          WHERE "normalizedName" = $1 AND active = true AND "expiresAt" <= $2`,
          [input.normalizedName, new Date()]
        );

        const existingCharacter = await client.query<{ id: string }>(
          'SELECT id FROM "Character" WHERE "nameNormalized" = $1 LIMIT 1',
          [input.normalizedName]
        );
        if (existingCharacter.rows[0] !== undefined) {
          throw new Error('ERR_CHARACTER_NAME_TAKEN: character name is already taken');
        }

        const existingHold = await client.query<CharacterNameReservationRow>(
          `SELECT
            id,
            "userId",
            "characterId",
            "displayName",
            "normalizedName",
            status,
            active,
            "expiresAt",
            "consumedAt",
            "releasedAt",
            "createdAt",
            "updatedAt"
          FROM "CharacterNameReservation"
          WHERE "normalizedName" = $1 AND active = true
          LIMIT 1`,
          [input.normalizedName]
        );

        if (existingHold.rows[0] !== undefined) {
          const hold = existingHold.rows[0];
          if (hold.userId !== input.userId) {
            throw new Error('ERR_CHARACTER_NAME_TAKEN: character name is already taken');
          }

          const updated = await client.query<CharacterNameReservationRow>(
            `UPDATE "CharacterNameReservation"
            SET
              "displayName" = $2,
              "expiresAt" = $3,
              status = 'HELD',
              active = true,
              "releasedAt" = NULL,
              "updatedAt" = $4
            WHERE id = $1
            RETURNING
              id,
              "userId",
              "characterId",
              "displayName",
              "normalizedName",
              status,
              active,
              "expiresAt",
              "consumedAt",
              "releasedAt",
              "createdAt",
              "updatedAt"`,
            [hold.id, input.displayName, input.expiresAt, new Date()]
          );

          await client.query('COMMIT');
          return mapCharacterNameReservation(updated.rows[0]);
        }

        const inserted = await client.query<CharacterNameReservationRow>(
          `INSERT INTO "CharacterNameReservation"
            (
              id,
              "userId",
              "displayName",
              "normalizedName",
              "expiresAt",
              "updatedAt"
            )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            "userId",
            "characterId",
            "displayName",
            "normalizedName",
            status,
            active,
            "expiresAt",
            "consumedAt",
            "releasedAt",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            input.userId,
            input.displayName,
            input.normalizedName,
            input.expiresAt,
            new Date(),
          ]
        );

        await client.query('COMMIT');
        return mapCharacterNameReservation(inserted.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: unknown }).code === '23505'
        ) {
          throw new Error('ERR_CHARACTER_NAME_TAKEN: character name is already taken');
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async release(id: string, status: Exclude<CharacterNameReservationStatus, 'HELD' | 'CONSUMED'> = 'RELEASED') {
      const result = await pool.query<CharacterNameReservationRow>(
        `UPDATE "CharacterNameReservation"
        SET
          status = $2,
          active = false,
          "releasedAt" = $3,
          "updatedAt" = $3
        WHERE id = $1
        RETURNING
          id,
          "userId",
          "characterId",
          "displayName",
          "normalizedName",
          status,
          active,
          "expiresAt",
          "consumedAt",
          "releasedAt",
          "createdAt",
          "updatedAt"`,
        [id, status, new Date()]
      );
      return result.rows[0] ? mapCharacterNameReservation(result.rows[0]) : null;
    },
  },
  character: {
    async create(input: CharacterCreateInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (input.nameReservationId !== undefined) {
          const reservation = await client.query<CharacterNameReservationRow>(
            `SELECT
              id,
              "userId",
              "characterId",
              "displayName",
              "normalizedName",
              status,
              active,
              "expiresAt",
              "consumedAt",
              "releasedAt",
              "createdAt",
              "updatedAt"
            FROM "CharacterNameReservation"
            WHERE id = $1
            FOR UPDATE`,
            [input.nameReservationId]
          );
          const activeReservation = reservation.rows[0];
          if (
            activeReservation === undefined ||
            activeReservation.active !== true ||
            activeReservation.userId !== input.userId ||
            activeReservation.normalizedName !== input.nameNormalized
          ) {
            throw new Error('ERR_CHARACTER_NAME_RESERVATION_INVALID: character name reservation is invalid');
          }
          if (activeReservation.expiresAt.getTime() <= Date.now()) {
            throw new Error('ERR_CHARACTER_NAME_RESERVATION_EXPIRED: character name reservation has expired');
          }
        }

        const existingName = await client.query<{ id: string }>(
          'SELECT id FROM "Character" WHERE "nameNormalized" = $1 LIMIT 1',
          [input.nameNormalized]
        );
        if (existingName.rows[0] !== undefined) {
          throw new Error('ERR_CHARACTER_NAME_TAKEN: character name is already taken');
        }

        const characterId = createRowId();
        const updatedAt = new Date();
        const characterResult = await client.query<{
          id: string;
          userId: string;
          name: string;
          nameNormalized: string;
          classId: string;
          slotIndex: number;
          chainBootstrapReady: boolean;
          level: number;
          exp: number;
          hp: number;
          hpMax: number;
          atk: number;
          def: number;
          spd: number;
          accuracyBP: number;
          evadeBP: number;
          createdAt: Date;
        }>(
          `INSERT INTO "Character"
            (
              id,
              "userId",
              "name",
              "nameNormalized",
              "classId",
              "slotIndex",
              "chainBootstrapReady",
              "hp",
              "hpMax",
              "atk",
              "def",
              "spd",
              "accuracyBP",
              "evadeBP",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING
            id,
            "userId",
            name,
            "nameNormalized",
            "classId",
            "slotIndex",
            "chainBootstrapReady",
            level,
            exp,
            hp,
            "hpMax",
            atk,
            def,
            spd,
            "accuracyBP",
            "evadeBP",
            "createdAt"`,
          [
            characterId,
            input.userId,
            input.name,
            input.nameNormalized,
            input.classId,
            input.slotIndex,
            input.chainBootstrapReady,
            input.hp,
            input.hpMax,
            input.atk,
            input.def,
            input.spd,
            input.accuracyBP,
            input.evadeBP,
            updatedAt,
          ]
        );
        const character = characterResult.rows[0];
        await client.query(
          `INSERT INTO "CharacterProvisionalProgress"
            (
              id,
              "characterId",
              "highestUnlockedZoneId",
              "highestClearedZoneId",
              "zoneStatesJson",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
          [
            createRowId(),
            character.id,
            DEFAULT_STARTER_UNLOCKED_ZONE_ID,
            0,
            JSON.stringify({
              [String(DEFAULT_STARTER_UNLOCKED_ZONE_ID)]: 1
            }),
            updatedAt
          ]
        );

        for (let index = 0; index < input.activeSkills.length; index += 1) {
          const skillId = input.activeSkills[index];
          await client.query(
            'INSERT INTO "SkillUnlock" (id, "characterId", "skillId") VALUES ($1, $2, $3)',
            [createRowId(), character.id, skillId]
          );
          await client.query(
            'INSERT INTO "EquippedSkill" (id, "characterId", slot, "skillId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), character.id, index, skillId, updatedAt]
          );
        }

        for (let index = 0; index < input.passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" (id, "characterId", slot, "passiveId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), character.id, index, input.passiveSkills[index], updatedAt]
          );
        }

        if (input.nameReservationId !== undefined) {
          await client.query(
            `UPDATE "CharacterNameReservation"
            SET
              "characterId" = $2,
              status = 'CONSUMED',
              active = false,
              "consumedAt" = $3,
              "updatedAt" = $3
            WHERE id = $1`,
            [input.nameReservationId, character.id, updatedAt]
          );
        }

        await client.query('COMMIT');
        return character;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findByUserId(userId: string) {
      const characterResult = await pool.query(
        `SELECT
          id,
          "userId",
          name,
          "nameNormalized",
          "classId",
          "slotIndex",
          "chainBootstrapReady",
          level,
          exp,
          hp,
          "hpMax",
          atk,
          def,
          spd,
          "accuracyBP",
          "evadeBP"
        FROM "Character"
        WHERE "userId" = $1
        ORDER BY "slotIndex" ASC, "createdAt" ASC
        LIMIT 1`,
        [userId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives, unlocks, inventory] = await Promise.all([
        pool.query('SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "skillId" FROM "SkillUnlock" WHERE "characterId" = $1 ORDER BY "unlockedAt" ASC', [
          character.id
        ]),
        pool.query('SELECT "itemId", quantity FROM "InventoryItem" WHERE "characterId" = $1 ORDER BY "itemId" ASC', [
          character.id
        ])
      ]);

      return {
        ...character,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId),
        unlockedSkillIds: unlocks.rows.map((row) => row.skillId),
        inventory: inventory.rows
      };
    },
    async findById(characterId: string) {
      const characterResult = await pool.query(
        `SELECT
          id,
          "userId",
          name,
          "nameNormalized",
          "classId",
          "slotIndex",
          "chainBootstrapReady",
          level,
          exp,
          hp,
          "hpMax",
          atk,
          def,
          spd,
          "accuracyBP",
          "evadeBP"
        FROM "Character"
        WHERE id = $1
        LIMIT 1`,
        [characterId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives, unlocks, inventory] = await Promise.all([
        pool.query('SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "skillId" FROM "SkillUnlock" WHERE "characterId" = $1 ORDER BY "unlockedAt" ASC', [
          character.id
        ]),
        pool.query('SELECT "itemId", quantity FROM "InventoryItem" WHERE "characterId" = $1 ORDER BY "itemId" ASC', [
          character.id
        ])
      ]);

      return {
        ...character,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId),
        unlockedSkillIds: unlocks.rows.map((row) => row.skillId),
        inventory: inventory.rows
      };
    },
    async findUnique(id: string) {
      const result = await pool.query('SELECT id FROM "Character" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    },
    async findByNormalizedName(normalizedName: string) {
      const result = await pool.query<{ id: string }>(
        'SELECT id FROM "Character" WHERE "nameNormalized" = $1 LIMIT 1',
        [normalizeCharacterName(normalizedName)]
      );
      return result.rows[0] ?? null;
    },
    async findBattleReadyById(characterId: string): Promise<CharacterBattleReadyRecord | null> {
      const characterResult = await pool.query<{
        id: string;
        userId: string;
        name: string;
        nameNormalized: string;
        classId: string;
        slotIndex: number;
        chainBootstrapReady: boolean;
        createdAt: Date;
        hp: number;
        hpMax: number;
        atk: number;
        def: number;
        spd: number;
        accuracyBP: number;
        evadeBP: number;
        playerAuthorityPubkey: string | null;
        chainCharacterIdHex: string | null;
        characterRootPubkey: string | null;
        chainCreationStatus: CharacterChainCreationStatus;
        chainCreationSeasonId: number | null;
        lastReconciledEndNonce: string | number | null;
        lastReconciledStateHash: string | null;
        lastReconciledBatchId: string | number | null;
        lastReconciledBattleTs: string | number | null;
        lastReconciledSeasonId: number | null;
      }>(
        `SELECT
          id,
          "userId",
          name,
          "nameNormalized",
          "classId",
          "slotIndex",
          "chainBootstrapReady",
          "createdAt",
          hp,
          "hpMax",
          atk,
          def,
          spd,
          "accuracyBP",
          "evadeBP",
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId"
        FROM "Character"
        WHERE id = $1
        LIMIT 1`,
        [characterId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives] = await Promise.all([
        pool.query<{ skillId: string }>(
          'SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC',
          [character.id]
        ),
        pool.query<{ passiveId: string }>(
          'SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC',
          [character.id]
        )
      ]);

      return {
        id: character.id,
        userId: character.userId,
        name: character.name,
        nameNormalized: character.nameNormalized,
        classId: character.classId,
        slotIndex: character.slotIndex,
        chainBootstrapReady: character.chainBootstrapReady,
        createdAt: character.createdAt,
        hp: character.hp,
        hpMax: character.hpMax,
        atk: character.atk,
        def: character.def,
        spd: character.spd,
        accuracyBP: character.accuracyBP,
        evadeBP: character.evadeBP,
        playerAuthorityPubkey: character.playerAuthorityPubkey,
        chainCharacterIdHex: character.chainCharacterIdHex,
        characterRootPubkey: character.characterRootPubkey,
        chainCreationStatus: character.chainCreationStatus,
        chainCreationSeasonId: character.chainCreationSeasonId,
        lastReconciledEndNonce: parseNullableSafeInteger(
          character.lastReconciledEndNonce,
          'lastReconciledEndNonce'
        ),
        lastReconciledStateHash: character.lastReconciledStateHash,
        lastReconciledBatchId: parseNullableSafeInteger(
          character.lastReconciledBatchId,
          'lastReconciledBatchId'
        ),
        lastReconciledBattleTs: parseNullableSafeInteger(
          character.lastReconciledBattleTs,
          'lastReconciledBattleTs'
        ),
        lastReconciledSeasonId: character.lastReconciledSeasonId,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId)
      };
    },
    async updateEquip(characterId: string, activeSkills: string[], passiveSkills: string[]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM "EquippedSkill" WHERE "characterId" = $1', [characterId]);
        await client.query('DELETE FROM "EquippedPassive" WHERE "characterId" = $1', [characterId]);

        for (let index = 0; index < activeSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedSkill" (id, "characterId", slot, "skillId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), characterId, index, activeSkills[index], new Date()]
          );
        }
        for (let index = 0; index < passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" (id, "characterId", slot, "passiveId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
            [createRowId(), characterId, index, passiveSkills[index], new Date()]
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async updateChainIdentity(characterId: string, input: UpdateCharacterChainIdentityInput) {
      const result = await pool.query<CharacterChainStateRow>(
        `UPDATE "Character"
        SET
          "playerAuthorityPubkey" = $2,
          "chainCharacterIdHex" = $3,
          "characterRootPubkey" = $4,
          "chainCreationStatus" = $5,
          "chainCreationTxSignature" = $6,
          "chainCreatedAt" = $7,
          "chainCreationTs" = $8,
          "chainCreationSeasonId" = $9
        WHERE id = $1
        RETURNING
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"`,
        [
          characterId,
          input.playerAuthorityPubkey,
          input.chainCharacterIdHex,
          input.characterRootPubkey,
          input.chainCreationStatus,
          input.chainCreationTxSignature ?? null,
          input.chainCreatedAt ?? null,
          input.chainCreationTs ?? null,
          input.chainCreationSeasonId ?? null
        ]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    },
    async updateCursorSnapshot(characterId: string, input: UpdateCharacterCursorSnapshotInput) {
      const result = await pool.query<CharacterChainStateRow>(
        `UPDATE "Character"
        SET
          "lastReconciledEndNonce" = $2,
          "lastReconciledStateHash" = $3,
          "lastReconciledBatchId" = $4,
          "lastReconciledBattleTs" = $5,
          "lastReconciledSeasonId" = $6,
          "lastReconciledAt" = $7
        WHERE id = $1
        RETURNING
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"`,
        [
          characterId,
          input.lastReconciledEndNonce,
          input.lastReconciledStateHash,
          input.lastReconciledBatchId,
          input.lastReconciledBattleTs,
          input.lastReconciledSeasonId,
          input.lastReconciledAt ?? new Date()
        ]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    },
    async findChainState(characterId: string) {
      const result = await pool.query<CharacterChainStateRow>(
        `SELECT
          id,
          "playerAuthorityPubkey",
          "chainCharacterIdHex",
          "characterRootPubkey",
          "chainCreationStatus",
          "chainCreationTxSignature",
          "chainCreatedAt",
          "chainCreationTs",
          "chainCreationSeasonId",
          "lastReconciledEndNonce",
          "lastReconciledStateHash",
          "lastReconciledBatchId",
          "lastReconciledBattleTs",
          "lastReconciledSeasonId",
          "lastReconciledAt"
        FROM "Character"
        WHERE id = $1
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapCharacterChainState(result.rows[0]) : null;
    }
  },
  characterProvisionalProgress: {
    async create(input: CreateCharacterProvisionalProgressInput) {
      const result = await pool.query<CharacterProvisionalProgressRow>(
        `INSERT INTO "CharacterProvisionalProgress"
          (
            id,
            "characterId",
            "highestUnlockedZoneId",
            "highestClearedZoneId",
            "zoneStatesJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        RETURNING
          id,
          "characterId",
          "highestUnlockedZoneId",
          "highestClearedZoneId",
          "zoneStatesJson",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.characterId,
          input.highestUnlockedZoneId,
          input.highestClearedZoneId ?? 0,
          JSON.stringify(input.zoneStates),
          new Date()
        ]
      );

      return mapCharacterProvisionalProgress(result.rows[0]);
    },
    async findByCharacterId(characterId: string) {
      const result = await pool.query<CharacterProvisionalProgressRow>(
        `SELECT
          id,
          "characterId",
          "highestUnlockedZoneId",
          "highestClearedZoneId",
          "zoneStatesJson",
          "createdAt",
          "updatedAt"
        FROM "CharacterProvisionalProgress"
        WHERE "characterId" = $1
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapCharacterProvisionalProgress(result.rows[0]) : null;
    },
    async updateByCharacterId(characterId: string, input: UpdateCharacterProvisionalProgressInput) {
      const result = await pool.query<CharacterProvisionalProgressRow>(
        `UPDATE "CharacterProvisionalProgress"
        SET
          "highestUnlockedZoneId" = $2,
          "highestClearedZoneId" = $3,
          "zoneStatesJson" = $4::jsonb,
          "updatedAt" = $5
        WHERE "characterId" = $1
        RETURNING
          id,
          "characterId",
          "highestUnlockedZoneId",
          "highestClearedZoneId",
          "zoneStatesJson",
          "createdAt",
          "updatedAt"`,
        [
          characterId,
          input.highestUnlockedZoneId,
          input.highestClearedZoneId,
          JSON.stringify(input.zoneStates),
          new Date()
        ]
      );

      return result.rows[0] ? mapCharacterProvisionalProgress(result.rows[0]) : null;
    }
  },
  activeZoneRun: {
    async create(input: CreateActiveZoneRunInput) {
      const result = await pool.query<ActiveZoneRunRow>(
        `INSERT INTO "ActiveZoneRun"
          (
            id,
            "characterId",
            "zoneId",
            "seasonId",
            "topologyVersion",
            "topologyHash",
            "state",
            "currentNodeId",
            "stateJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        RETURNING
          id,
          "characterId",
          "zoneId",
          "seasonId",
          "topologyVersion",
          "topologyHash",
          "state",
          "currentNodeId",
          "stateJson",
          "createdAt",
          "updatedAt"`,
        [
          input.id,
          input.characterId,
          input.zoneId,
          input.seasonId,
          input.topologyVersion,
          input.topologyHash,
          input.state,
          input.currentNodeId,
          JSON.stringify(input.snapshot),
          new Date(),
        ],
      );

      return mapActiveZoneRun(result.rows[0]);
    },
    async findByCharacterId(characterId: string) {
      const result = await pool.query<ActiveZoneRunRow>(
        `SELECT
          id,
          "characterId",
          "zoneId",
          "seasonId",
          "topologyVersion",
          "topologyHash",
          "state",
          "currentNodeId",
          "stateJson",
          "createdAt",
          "updatedAt"
        FROM "ActiveZoneRun"
        WHERE "characterId" = $1
        LIMIT 1`,
        [characterId],
      );

      return result.rows[0] ? mapActiveZoneRun(result.rows[0]) : null;
    },
    async updateByCharacterId(characterId: string, input: UpdateActiveZoneRunInput) {
      const result = await pool.query<ActiveZoneRunRow>(
        `UPDATE "ActiveZoneRun"
        SET
          "state" = $2,
          "currentNodeId" = $3,
          "stateJson" = $4::jsonb,
          "updatedAt" = $5
        WHERE "characterId" = $1
        RETURNING
          id,
          "characterId",
          "zoneId",
          "seasonId",
          "topologyVersion",
          "topologyHash",
          "state",
          "currentNodeId",
          "stateJson",
          "createdAt",
          "updatedAt"`,
        [characterId, input.state, input.currentNodeId, JSON.stringify(input.snapshot), new Date()],
      );

      return result.rows[0] ? mapActiveZoneRun(result.rows[0]) : null;
    },
    async closeWithSummary(args: {
      characterId: string;
      summary: CreateClosedZoneRunSummaryInput;
      provisionalProgress?: UpdateCharacterProvisionalProgressInput | null;
    }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const closedSummaryResult = await client.query<ClosedZoneRunSummaryRow>(
          `INSERT INTO "ClosedZoneRunSummary"
            (
              id,
              "zoneRunId",
              "characterId",
              "zoneId",
              "seasonId",
              "topologyVersion",
              "topologyHash",
              "terminalStatus",
              "rewardedBattleCount",
              "rewardedEncounterHistogramJson",
              "zoneProgressDeltaJson",
              "closedAt",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)
          RETURNING
            id,
            "zoneRunId",
            "characterId",
            "zoneId",
            "seasonId",
            "topologyVersion",
            "topologyHash",
            "terminalStatus",
            "rewardedBattleCount",
            "rewardedEncounterHistogramJson",
            "zoneProgressDeltaJson",
            "closedAt",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            args.summary.zoneRunId,
            args.summary.characterId,
            args.summary.zoneId,
            args.summary.seasonId,
            args.summary.topologyVersion,
            args.summary.topologyHash,
            args.summary.terminalStatus,
            args.summary.rewardedBattleCount,
            JSON.stringify(args.summary.rewardedEncounterHistogram),
            JSON.stringify(args.summary.zoneProgressDelta),
            args.summary.closedAt ?? new Date(),
            new Date(),
          ],
        );

        if (args.provisionalProgress !== undefined && args.provisionalProgress !== null) {
          await client.query(
            `UPDATE "CharacterProvisionalProgress"
            SET
              "highestUnlockedZoneId" = $2,
              "highestClearedZoneId" = $3,
              "zoneStatesJson" = $4::jsonb,
              "updatedAt" = $5
            WHERE "characterId" = $1`,
            [
              args.characterId,
              args.provisionalProgress.highestUnlockedZoneId,
              args.provisionalProgress.highestClearedZoneId,
              JSON.stringify(args.provisionalProgress.zoneStates),
              new Date(),
            ],
          );
        }

        await client.query(
          `DELETE FROM "ActiveZoneRun"
          WHERE "characterId" = $1`,
          [args.characterId],
        );

        await client.query('COMMIT');
        return mapClosedZoneRunSummary(closedSummaryResult.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  },
  closedZoneRunSummary: {
    async findLatestForCharacter(characterId: string) {
      const result = await pool.query<ClosedZoneRunSummaryRow>(
        `SELECT
          id,
          "zoneRunId",
          "characterId",
          "zoneId",
          "seasonId",
          "topologyVersion",
          "topologyHash",
          "terminalStatus",
          "rewardedBattleCount",
          "rewardedEncounterHistogramJson",
          "zoneProgressDeltaJson",
          "closedAt",
          "createdAt",
          "updatedAt"
        FROM "ClosedZoneRunSummary"
        WHERE "characterId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 1`,
        [characterId],
      );

      return result.rows[0] ? mapClosedZoneRunSummary(result.rows[0]) : null;
    },
  },
  zoneRunActionLog: {
    async create(input: CreateZoneRunActionLogInput) {
      const result = await pool.query<ZoneRunActionLogRow>(
        `INSERT INTO "ZoneRunActionLog"
          (
            id,
            "zoneRunId",
            "characterId",
            "actionType",
            "nodeId",
            "subnodeId",
            "payloadJson"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        RETURNING
          id,
          "zoneRunId",
          "characterId",
          "actionType",
          "nodeId",
          "subnodeId",
          "payloadJson",
          "createdAt"`,
        [
          createRowId(),
          input.zoneRunId,
          input.characterId,
          input.actionType,
          input.nodeId ?? null,
          input.subnodeId ?? null,
          JSON.stringify(input.payload),
        ],
      );

      return mapZoneRunActionLog(result.rows[0]);
    },
  },
  zoneRunMutationDedup: {
    async findByCharacterIdAndRequestKey(characterId: string, requestKey: string) {
      const result = await pool.query<ZoneRunMutationDedupRow>(
        `SELECT
          id,
          "characterId",
          "requestKey",
          "actionType",
          "responseJson",
          "createdAt",
          "updatedAt"
        FROM "ZoneRunMutationDedup"
        WHERE "characterId" = $1
          AND "requestKey" = $2
        LIMIT 1`,
        [characterId, requestKey],
      );

      return result.rows[0] ? mapZoneRunMutationDedup(result.rows[0]) : null;
    },
    async create(input: CreateZoneRunMutationDedupInput) {
      const result = await pool.query<ZoneRunMutationDedupRow>(
        `INSERT INTO "ZoneRunMutationDedup"
          (
            id,
            "characterId",
            "requestKey",
            "actionType",
            "responseJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        RETURNING
          id,
          "characterId",
          "requestKey",
          "actionType",
          "responseJson",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.characterId,
          input.requestKey,
          input.actionType,
          JSON.stringify(input.response),
          new Date(),
        ],
      );

      return mapZoneRunMutationDedup(result.rows[0]);
    },
  },
  battleRecord: {
    async create(input: CreateBattleRecordInput) {
      const result = await pool.query<BattleRecordRow>(
        `INSERT INTO "BattleRecord"
          (
            id,
            "battleId",
            "characterId",
            "zoneRunId",
            "zoneId",
            "nodeId",
            "subnodeId",
            "enemyArchetypeId",
            seed,
            "playerInitialJson",
            "enemyInitialJson",
            "playerFinalJson",
            "enemyFinalJson",
            "rewardEligible",
            "winnerEntityId",
            "roundsPlayed",
            "eventsJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17::jsonb,$18)
        RETURNING
          id,
          "battleId",
          "characterId",
          "zoneRunId",
          "zoneId",
          "nodeId",
          "subnodeId",
          "enemyArchetypeId",
          seed,
          "playerInitialJson",
          "enemyInitialJson",
          "playerFinalJson",
          "enemyFinalJson",
          "rewardEligible",
          "winnerEntityId",
          "roundsPlayed",
          "eventsJson",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.battleId,
          input.characterId,
          input.zoneRunId ?? null,
          input.zoneId,
          input.nodeId ?? null,
          input.subnodeId ?? null,
          input.enemyArchetypeId,
          input.seed,
          JSON.stringify(input.playerInitial),
          JSON.stringify(input.enemyInitial),
          JSON.stringify(input.playerFinal ?? null),
          JSON.stringify(input.enemyFinal ?? null),
          input.rewardEligible ?? true,
          input.winnerEntityId,
          input.roundsPlayed,
          JSON.stringify(input.events),
          new Date()
        ]
      );

      return mapBattleRecord(result.rows[0]);
    },
    async findByBattleId(battleId: string) {
      const result = await pool.query<BattleRecordRow>(
        `SELECT
          id,
          "battleId",
          "characterId",
          "zoneRunId",
          "zoneId",
          "nodeId",
          "subnodeId",
          "enemyArchetypeId",
          seed,
          "playerInitialJson",
          "enemyInitialJson",
          "playerFinalJson",
          "enemyFinalJson",
          "rewardEligible",
          "winnerEntityId",
          "roundsPlayed",
          "eventsJson",
          "createdAt",
          "updatedAt"
        FROM "BattleRecord"
        WHERE "battleId" = $1
        LIMIT 1`,
        [battleId]
      );

      return result.rows[0] ? mapBattleRecord(result.rows[0]) : null;
    },
    async allocateNonceAndCreateWithSettlementLedger(
      input: CreatePersistedEncounterInput
    ): Promise<PersistedEncounterRecord> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const lockedCharacterResult = await client.query<{
          lastReconciledEndNonce: string | number | null;
        }>(
          `SELECT "lastReconciledEndNonce"
          FROM "Character"
          WHERE id = $1
          FOR UPDATE`,
          [input.characterId]
        );
        const lockedCharacter = lockedCharacterResult.rows[0];
        if (lockedCharacter === undefined) {
          throw new Error(`ERR_CHARACTER_NOT_FOUND: character ${input.characterId} was not found`);
        }

        const latestLocalBattleResult = await client.query<{ battleNonce: string | number }>(
          `SELECT "battleNonce"
          FROM "BattleOutcomeLedger"
          WHERE "characterId" = $1 AND "battleNonce" IS NOT NULL
          ORDER BY "battleNonce" DESC NULLS LAST
          LIMIT 1`,
          [input.characterId]
        );
        const latestLocalBattle = latestLocalBattleResult.rows[0];
        if (lockedCharacter.lastReconciledEndNonce === null) {
          throw new Error(
            `ERR_CHARACTER_CURSOR_UNAVAILABLE: character ${input.characterId} is missing lastReconciledEndNonce`
          );
        }
        const battleNonce = allocateNextBattleNonce({
          latestLocalBattleNonce: latestLocalBattle
            ? parseRequiredSafeInteger(latestLocalBattle.battleNonce, 'battleNonce')
            : null,
          lastReconciledEndNonce: parseRequiredSafeInteger(lockedCharacter.lastReconciledEndNonce, 'lastReconciledEndNonce')
        });

        const persisted = await insertPersistedEncounter(client, {
          ...input,
          localSequence: battleNonce,
          battleNonce
        });

        await client.query('COMMIT');

        return persisted;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async createWithSettlementLedger(
      input: CreatePersistedEncounterInput & { battleNonce: number }
    ): Promise<PersistedEncounterRecord> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const persisted = await insertPersistedEncounter(client, {
          ...input,
          localSequence: input.battleNonce
        });

        await client.query('COMMIT');

        return persisted;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async createAwaitingFirstSyncWithProgress(
      input: CreateLocalFirstPersistedEncounterInput
    ): Promise<PersistedEncounterRecord> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const lockedCharacterResult = await client.query<{ id: string }>(
          `SELECT id
          FROM "Character"
          WHERE id = $1
          FOR UPDATE`,
          [input.characterId]
        );
        if (lockedCharacterResult.rows[0] === undefined) {
          throw new Error(`ERR_CHARACTER_NOT_FOUND: character ${input.characterId} was not found`);
        }

        const lockedProgressResult = await client.query<{ id: string }>(
          `SELECT id
          FROM "CharacterProvisionalProgress"
          WHERE "characterId" = $1
          FOR UPDATE`,
          [input.characterId]
        );
        if (lockedProgressResult.rows[0] === undefined) {
          throw new Error(
            `ERR_CHARACTER_PROVISIONAL_PROGRESS_NOT_FOUND: character ${input.characterId} is missing provisional progress`,
          );
        }

        const latestLocalSequenceResult = await client.query<{ localSequence: string | number }>(
          `SELECT "localSequence"
          FROM "BattleOutcomeLedger"
          WHERE "characterId" = $1
          ORDER BY "localSequence" DESC
          LIMIT 1`,
          [input.characterId]
        );
        const latestLocalSequence = latestLocalSequenceResult.rows[0]
          ? parseRequiredSafeInteger(latestLocalSequenceResult.rows[0].localSequence, 'localSequence')
          : 0;

        const persisted = await insertPersistedEncounter(client, {
          ...input,
          localSequence: latestLocalSequence + 1,
          battleNonce: latestLocalSequence + 1,
        });

        const ledgerResult = await client.query<BattleOutcomeLedgerRow>(
          `UPDATE "BattleOutcomeLedger"
          SET
            "battleNonce" = NULL,
            "settlementStatus" = 'AWAITING_FIRST_SYNC',
            "updatedAt" = $2
          WHERE id = $1
          RETURNING
            id,
            "characterId",
            "battleId",
            "zoneRunId",
            "localSequence",
            "battleNonce",
            "battleTs",
            "seasonId",
            "zoneId",
            "enemyArchetypeId",
            "zoneProgressDeltaJson",
            "settlementStatus",
            "sealedBatchId",
            "committedAt",
            "createdAt",
            "updatedAt"`,
          [persisted.ledger.id, new Date()]
        );

        await client.query(
          `UPDATE "CharacterProvisionalProgress"
          SET
            "highestUnlockedZoneId" = $2,
            "highestClearedZoneId" = $3,
            "zoneStatesJson" = $4::jsonb,
            "updatedAt" = $5
          WHERE "characterId" = $1`,
          [
            input.characterId,
            input.provisionalProgress.highestUnlockedZoneId,
            input.provisionalProgress.highestClearedZoneId,
            JSON.stringify(input.provisionalProgress.zoneStates),
            new Date(),
          ]
        );

        await client.query('COMMIT');

        return {
          battleRecord: persisted.battleRecord,
          ledger: mapBattleOutcomeLedger(ledgerResult.rows[0]),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async createAwaitingFirstSync(
      input: CreatePersistedEncounterInput
    ): Promise<PersistedEncounterRecord> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const lockedCharacterResult = await client.query<{ id: string }>(
          `SELECT id
          FROM "Character"
          WHERE id = $1
          FOR UPDATE`,
          [input.characterId]
        );
        if (lockedCharacterResult.rows[0] === undefined) {
          throw new Error(`ERR_CHARACTER_NOT_FOUND: character ${input.characterId} was not found`);
        }

        const latestLocalSequenceResult = await client.query<{ localSequence: string | number }>(
          `SELECT "localSequence"
          FROM "BattleOutcomeLedger"
          WHERE "characterId" = $1
          ORDER BY "localSequence" DESC
          LIMIT 1`,
          [input.characterId]
        );
        const latestLocalSequence = latestLocalSequenceResult.rows[0]
          ? parseRequiredSafeInteger(latestLocalSequenceResult.rows[0].localSequence, 'localSequence')
          : 0;

        const persisted = await insertPersistedEncounter(client, {
          ...input,
          localSequence: latestLocalSequence + 1,
          battleNonce: latestLocalSequence + 1,
        });

        const ledgerResult = await client.query<BattleOutcomeLedgerRow>(
          `UPDATE "BattleOutcomeLedger"
          SET
            "battleNonce" = NULL,
            "settlementStatus" = 'AWAITING_FIRST_SYNC',
            "updatedAt" = $2
          WHERE id = $1
          RETURNING
            id,
            "characterId",
            "battleId",
            "zoneRunId",
            "localSequence",
            "battleNonce",
            "battleTs",
            "seasonId",
            "zoneId",
            "enemyArchetypeId",
            "zoneProgressDeltaJson",
            "settlementStatus",
            "sealedBatchId",
            "committedAt",
            "createdAt",
            "updatedAt"`,
          [persisted.ledger.id, new Date()]
        );

        await client.query('COMMIT');

        return {
          battleRecord: persisted.battleRecord,
          ledger: mapBattleOutcomeLedger(ledgerResult.rows[0]),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  },
  battleOutcomeLedger: {
    async create(input: CreateBattleOutcomeLedgerInput) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `INSERT INTO "BattleOutcomeLedger"
          (
            id,
            "characterId",
            "battleId",
            "zoneRunId",
            "localSequence",
            "battleNonce",
            "battleTs",
            "seasonId",
            "zoneId",
            "enemyArchetypeId",
            "settlementStatus",
            "zoneProgressDeltaJson",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
        RETURNING
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"`,
        [
          createRowId(),
          input.characterId,
          input.battleId,
          input.zoneRunId ?? null,
          input.localSequence,
          input.battleNonce ?? null,
          input.battleTs,
          input.seasonId,
          input.zoneId,
          input.enemyArchetypeId,
          input.settlementStatus ?? 'PENDING',
          JSON.stringify(input.zoneProgressDelta),
          new Date()
        ]
      );

      return mapBattleOutcomeLedger(result.rows[0]);
    },
    async listNextPendingForCharacter(characterId: string, limit: number) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1 AND "settlementStatus" = 'PENDING'
        ORDER BY "battleNonce" ASC
        LIMIT $2`,
        [characterId, limit]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    },
    async findLatestForCharacter(characterId: string) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1
        ORDER BY "localSequence" DESC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapBattleOutcomeLedger(result.rows[0]) : null;
    },
    async findEarliestForCharacter(characterId: string) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1
        ORDER BY "localSequence" ASC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapBattleOutcomeLedger(result.rows[0]) : null;
    },
    async listAwaitingFirstSyncForCharacter(characterId: string, limit: number) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `SELECT
          id,
          "characterId",
          "battleId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1 AND "settlementStatus" = 'AWAITING_FIRST_SYNC'
        ORDER BY "localSequence" ASC
        LIMIT $2`,
        [characterId, limit]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    },
    async findLatestLocalSequenceForCharacter(characterId: string) {
      const result = await pool.query<{ localSequence: string | number }>(
        `SELECT "localSequence"
        FROM "BattleOutcomeLedger"
        WHERE "characterId" = $1
        ORDER BY "localSequence" DESC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0]
        ? parseRequiredSafeInteger(result.rows[0].localSequence, 'localSequence')
        : null;
    },
    async rebaseAwaitingFirstSyncBattleNonces(
      characterId: string,
      assignments: RebasedBattleNonceAssignment[],
    ) {
      if (assignments.length === 0) {
        return [] satisfies BattleOutcomeLedgerRecord[];
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated: BattleOutcomeLedgerRecord[] = [];

        for (const assignment of assignments) {
          const result = await client.query<BattleOutcomeLedgerRow>(
            `UPDATE "BattleOutcomeLedger"
            SET
              "battleNonce" = $2,
              "updatedAt" = $3
            WHERE id = $1 AND "characterId" = $4 AND "settlementStatus" = 'AWAITING_FIRST_SYNC'
            RETURNING
              id,
              "characterId",
              "battleId",
              "zoneRunId",
              "localSequence",
              "battleNonce",
              "battleTs",
              "seasonId",
              "zoneId",
              "enemyArchetypeId",
              "zoneProgressDeltaJson",
              "settlementStatus",
              "sealedBatchId",
              "committedAt",
              "createdAt",
              "updatedAt"`,
            [assignment.id, assignment.battleNonce, new Date(), characterId],
          );

          if (result.rows[0] === undefined) {
            throw new Error(
              `ERR_BATTLE_REBASE_NOT_FOUND: could not update awaiting-first-sync battle ${assignment.id}`,
            );
          }
          updated.push(mapBattleOutcomeLedger(result.rows[0]));
        }

        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async markArchivedLocalOnly(ids: string[]) {
      if (ids.length === 0) {
        return [] satisfies BattleOutcomeLedgerRecord[];
      }

      const result = await pool.query<BattleOutcomeLedgerRow>(
        `UPDATE "BattleOutcomeLedger"
        SET
          "battleNonce" = NULL,
          "settlementStatus" = 'LOCAL_ONLY_ARCHIVED',
          "updatedAt" = $2
        WHERE id = ANY($1::text[])
        RETURNING
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"`,
        [ids, new Date()]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    },
    async markCommittedForBatch(sealedBatchId: string, committedAt = new Date()) {
      const result = await pool.query<BattleOutcomeLedgerRow>(
        `UPDATE "BattleOutcomeLedger"
        SET
          "settlementStatus" = 'COMMITTED',
          "committedAt" = $2
        WHERE "sealedBatchId" = $1
        RETURNING
          id,
          "characterId",
          "battleId",
          "zoneRunId",
          "localSequence",
          "battleNonce",
          "battleTs",
          "seasonId",
          "zoneId",
          "enemyArchetypeId",
          "zoneProgressDeltaJson",
          "settlementStatus",
          "sealedBatchId",
          "committedAt",
          "createdAt",
          "updatedAt"`,
        [sealedBatchId, committedAt]
      );

      return result.rows.map(mapBattleOutcomeLedger);
    }
  },
  settlementBatch: {
    async createSealed(input: CreateSettlementBatchInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const batchResult = await client.query<SettlementBatchRow>(
          `INSERT INTO "SettlementBatch"
            (
              id,
              "characterId",
              "batchId",
              "startNonce",
              "endNonce",
              "battleCount",
              "firstBattleTs",
              "lastBattleTs",
              "seasonId",
              "startStateHash",
              "endStateHash",
              "zoneProgressDeltaJson",
              "encounterHistogramJson",
              "optionalLoadoutRevision",
              "batchHash",
              "schemaVersion",
              "signatureScheme",
              "updatedAt"
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)
          RETURNING
            id,
            "characterId",
            "batchId",
            "startNonce",
            "endNonce",
            "battleCount",
            "firstBattleTs",
            "lastBattleTs",
            "seasonId",
            "startStateHash",
            "endStateHash",
            "zoneProgressDeltaJson",
            "encounterHistogramJson",
            "optionalLoadoutRevision",
            "batchHash",
            "schemaVersion",
            "signatureScheme",
            "status",
            "failureCategory",
            "failureCode",
            "latestMessageSha256Hex",
            "latestSignedTxSha256Hex",
            "latestTransactionSignature",
            "preparedAt",
            "submittedAt",
            "confirmedAt",
            "failedAt",
            "createdAt",
            "updatedAt"`,
          [
            createRowId(),
            input.characterId,
            input.batchId,
            input.startNonce,
            input.endNonce,
            input.battleCount,
            input.firstBattleTs,
            input.lastBattleTs,
            input.seasonId,
            input.startStateHash,
            input.endStateHash,
            JSON.stringify(input.zoneProgressDelta),
            JSON.stringify(input.encounterHistogram),
            input.optionalLoadoutRevision ?? null,
            input.batchHash,
            input.schemaVersion,
            input.signatureScheme,
            new Date()
          ]
        );

        const batch = batchResult.rows[0];

        if ((input.sealedBattleIds?.length ?? 0) > 0) {
          const sealResult = await client.query(
            `UPDATE "BattleOutcomeLedger"
            SET
              "settlementStatus" = 'SEALED',
              "sealedBatchId" = $1
            WHERE "id" = ANY($2::text[]) AND "characterId" = $3`,
            [batch.id, input.sealedBattleIds, input.characterId]
          );

          if (sealResult.rowCount !== input.sealedBattleIds?.length) {
            throw new Error('ERR_BATTLE_LEDGER_SEAL_MISMATCH: failed to seal the expected battle ledger rows');
          }
        }

        await client.query('COMMIT');
        return mapSettlementBatch(batch);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findById(id: string) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE id = $1
        LIMIT 1`,
        [id]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    },
    async findByCharacterAndBatchId(characterId: string, batchId: number) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE "characterId" = $1 AND "batchId" = $2
        LIMIT 1`,
        [characterId, batchId]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    },
    async findNextUnconfirmedForCharacter(characterId: string) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE "characterId" = $1 AND "status" <> 'CONFIRMED'
        ORDER BY "batchId" ASC
        LIMIT 1`,
        [characterId]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    },
    async listUnconfirmed(limit?: number) {
      const result = await pool.query<SettlementBatchRow>(
        `SELECT
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"
        FROM "SettlementBatch"
        WHERE "status" <> 'CONFIRMED'
        ORDER BY "characterId" ASC, "batchId" ASC
        ${limit === undefined ? '' : 'LIMIT $1'}`,
        limit === undefined ? [] : [limit]
      );

      return result.rows.map(mapSettlementBatch);
    },
    async updateStatus(id: string, input: UpdateSettlementBatchStatusInput) {
      const result = await pool.query<SettlementBatchRow>(
        `UPDATE "SettlementBatch"
        SET
          "status" = $2,
          "failureCategory" = $3,
          "failureCode" = $4,
          "latestMessageSha256Hex" = $5,
          "latestSignedTxSha256Hex" = $6,
          "latestTransactionSignature" = $7,
          "preparedAt" = $8,
          "submittedAt" = $9,
          "confirmedAt" = $10,
          "failedAt" = $11
        WHERE id = $1
        RETURNING
          id,
          "characterId",
          "batchId",
          "startNonce",
          "endNonce",
          "battleCount",
          "firstBattleTs",
          "lastBattleTs",
          "seasonId",
          "startStateHash",
          "endStateHash",
          "zoneProgressDeltaJson",
          "encounterHistogramJson",
          "optionalLoadoutRevision",
          "batchHash",
          "schemaVersion",
          "signatureScheme",
          "status",
          "failureCategory",
          "failureCode",
          "latestMessageSha256Hex",
          "latestSignedTxSha256Hex",
          "latestTransactionSignature",
          "preparedAt",
          "submittedAt",
          "confirmedAt",
          "failedAt",
          "createdAt",
          "updatedAt"`,
        [
          id,
          input.status,
          input.failureCategory ?? null,
          input.failureCode ?? null,
          input.latestMessageSha256Hex ?? null,
          input.latestSignedTxSha256Hex ?? null,
          input.latestTransactionSignature ?? null,
          input.preparedAt ?? null,
          input.submittedAt ?? null,
          input.confirmedAt ?? null,
          input.failedAt ?? null
        ]
      );

      return result.rows[0] ? mapSettlementBatch(result.rows[0]) : null;
    }
  },
  settlementSubmissionAttempt: {
    async create(input: CreateSettlementSubmissionAttemptInput) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `INSERT INTO "SettlementSubmissionAttempt"
          (
            id,
            "settlementBatchId",
            "attemptNumber",
            "status",
            "messageSha256Hex",
            "signedTransactionSha256Hex",
            "transactionSignature",
            "rpcError",
            "submittedAt",
            "resolvedAt",
            "updatedAt"
          )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"`,
        [
          createRowId(),
          input.settlementBatchId,
          input.attemptNumber,
          input.status ?? 'STARTED',
          input.messageSha256Hex ?? null,
          input.signedTransactionSha256Hex ?? null,
          input.transactionSignature ?? null,
          input.rpcError ?? null,
          input.submittedAt ?? null,
          input.resolvedAt ?? null,
          new Date()
        ]
      );

      return mapSettlementSubmissionAttempt(result.rows[0]);
    },
    async listByBatch(settlementBatchId: string) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `SELECT
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"
        FROM "SettlementSubmissionAttempt"
        WHERE "settlementBatchId" = $1
        ORDER BY "attemptNumber" ASC`,
        [settlementBatchId]
      );

      return result.rows.map(mapSettlementSubmissionAttempt);
    },
    async update(id: string, input: UpdateSettlementSubmissionAttemptInput) {
      const result = await pool.query<SettlementSubmissionAttemptRow>(
        `UPDATE "SettlementSubmissionAttempt"
        SET
          "status" = $2,
          "messageSha256Hex" = $3,
          "signedTransactionSha256Hex" = $4,
          "transactionSignature" = $5,
          "rpcError" = $6,
          "submittedAt" = $7,
          "resolvedAt" = $8
        WHERE id = $1
        RETURNING
          id,
          "settlementBatchId",
          "attemptNumber",
          "status",
          "messageSha256Hex",
          "signedTransactionSha256Hex",
          "transactionSignature",
          "rpcError",
          "createdAt",
          "updatedAt",
          "submittedAt",
          "resolvedAt"`,
        [
          id,
          input.status,
          input.messageSha256Hex ?? null,
          input.signedTransactionSha256Hex ?? null,
          input.transactionSignature ?? null,
          input.rpcError ?? null,
          input.submittedAt ?? null,
          input.resolvedAt ?? null,
        ]
      );

      return result.rows[0] ? mapSettlementSubmissionAttempt(result.rows[0]) : null;
    }
  }
};
