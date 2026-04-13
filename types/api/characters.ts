import type {
  PreparedPlayerOwnedTransaction,
} from './solana';

export interface CharacterCreateV1PrepareRequest {
  characterId: string;
  initialUnlockedZoneId: number;
}

export interface CharacterCreateV1PrepareData {
  phase: 'sign_transaction' | 'submitted';
  character: {
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
    chain: {
      playerAuthorityPubkey: string;
      chainCharacterIdHex: string;
      characterRootPubkey: string;
      chainCreationStatus: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
      chainCreationTxSignature: string | null;
      chainCreatedAt: string | null;
      chainCreationTs: number | null;
      chainCreationSeasonId: number | null;
    };
  };
  preparedTransaction?: PreparedPlayerOwnedTransaction;
  transactionSignature?: string | null;
}

export interface CharacterCreateV1FinalizeRequest {
  prepared: PreparedPlayerOwnedTransaction;
  signedMessageBase64: string;
  signedTransactionBase64: string;
}

export interface CharacterCreateV1FinalizeData {
  characterId: string;
  chainCreationStatus: 'CONFIRMED';
  transactionSignature: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreatedAt: string;
  cursor: {
    lastCommittedEndNonce: number;
    lastCommittedStateHash: string;
    lastCommittedBatchId: number;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
}

export interface CharacterFirstSyncV1PrepareRequest {
  characterId: string;
}

export interface CharacterFirstSyncV1PrepareData {
  phase: 'authorize' | 'sign_transaction';
  payload: {
    characterId: string;
    batchId: number;
    startNonce: number;
    endNonce: number;
    battleCount: number;
    startStateHash: string;
    endStateHash: string;
    zoneProgressDelta: unknown[];
    encounterHistogram: unknown[];
    batchHash: string;
    firstBattleTs: number;
    lastBattleTs: number;
    seasonId: number;
    schemaVersion: number;
    signatureScheme: number;
  };
  expectedCursor: {
    lastCommittedEndNonce: number;
    lastCommittedBatchId: number;
    lastCommittedStateHash: string;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
  permitDomain: {
    programId: string;
    clusterId: number;
    playerAuthority: string;
    characterRootPubkey: string;
    batchHash: string;
    batchId: number;
    signatureScheme: number;
  };
  playerAuthorizationMessageBase64: string;
  playerAuthorizationMessageUtf8: string;
  playerAuthorizationMessageEncoding: 'utf8';
  playerAuthorizationSignatureBase64?: string;
  serverAttestationMessageBase64?: string;
  preparedTransaction?: PreparedPlayerOwnedTransaction;
}

export interface CharacterFirstSyncV1FinalizeRequest {
  prepared: PreparedPlayerOwnedTransaction;
  transactionSignature: string;
}

export interface CharacterFirstSyncV1FinalizeData {
  phase: 'submitted' | 'confirmed';
  characterId: string;
  chainCreationStatus: 'SUBMITTED' | 'CONFIRMED';
  transactionSignature: string;
  firstSettlementBatchId: string;
  remainingSettlementBatchIds: string[];
  chainCharacterIdHex?: string;
  characterRootPubkey?: string;
  chainCreatedAt?: string;
  cursor?: {
    lastCommittedEndNonce: number;
    lastCommittedStateHash: string;
    lastCommittedBatchId: number;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
}

export type CharacterCreateV1ResponseEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message?: string; retryable?: boolean; details?: unknown } };
