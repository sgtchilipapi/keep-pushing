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

export type CharacterCreateV1ResponseEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message?: string; retryable?: boolean; details?: unknown } };
