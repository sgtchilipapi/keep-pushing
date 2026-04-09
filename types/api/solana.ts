import type {
  SettlementBatchPayloadV2,
  SettlementSchemaVersion,
  SettlementSignatureScheme,
} from "../settlement";

export type PlayerOwnedTransactionKind =
  | "character_create"
  | "battle_settlement"
  | "player_owned_instruction";

export interface SettlementCursorExpectation {
  lastCommittedEndNonce: number;
  lastCommittedBatchId: number;
  lastCommittedStateHash: string;
  lastCommittedBattleTs: number;
  lastCommittedSeasonId: number;
}

export interface SettlementPermitDomain {
  programId: string;
  clusterId: number;
  playerAuthority: string;
  characterRootPubkey: string;
  batchHash: string;
  batchId: number;
  signatureScheme: SettlementSignatureScheme;
}

export interface SettlementRelayMetadata {
  relayRequestId?: string;
  characterId: string;
  characterRootPubkey: string;
  batchId: number;
  batchHash: string;
  startNonce: number;
  endNonce: number;
  startStateHash: string;
  endStateHash: string;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  schemaVersion: SettlementSchemaVersion;
  signatureScheme: SettlementSignatureScheme;
  expectedCursor: SettlementCursorExpectation;
  permitDomain: SettlementPermitDomain;
  continuityKey: string;
  reconciliationKey: string;
}

export interface CharacterCreationRelayMetadata {
  localCharacterId: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  seasonPolicyPubkey?: string;
  characterCreationTs?: number;
  seasonIdAtCreation?: number;
  initialUnlockedZoneId: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface PreparedPlayerOwnedTransaction {
  kind: PlayerOwnedTransactionKind;
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
  serializedTransactionBase64: string;
  messageSha256Hex: string;
  requiresPlayerSignature: true;
  serverBroadcast: true;
  characterCreationRelay?: CharacterCreationRelayMetadata;
  settlementRelay?: SettlementRelayMetadata;
}

export interface SubmittedPlayerOwnedTransaction {
  kind: PlayerOwnedTransactionKind;
  authority: string;
  feePayer: string;
  messageSha256Hex: string;
  signedTransactionBase64: string;
  signedTransactionSha256Hex: string;
  acceptedForBroadcast: true;
  characterCreationRelay?: CharacterCreationRelayMetadata;
  settlementRelay?: SettlementRelayMetadata;
}

export interface PrepareCharacterCreationTransactionRequest {
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
  serializedTransactionBase64?: string;
  localCharacterId: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  seasonPolicyPubkey?: string;
  characterCreationTs?: number;
  seasonIdAtCreation?: number;
  initialUnlockedZoneId: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface PrepareSettlementTransactionRequest {
  playerAuthority: string;
  feePayer: string;
  characterRootPubkey: string;
  payload: SettlementBatchPayloadV2;
  expectedCursor: SettlementCursorExpectation;
  permitDomain: SettlementPermitDomain;
  relayRequestId?: string;
  serializedMessageBase64: string;
  serializedTransactionBase64?: string;
}

export interface PrepareFirstSyncTransactionRequest {
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
  serializedTransactionBase64?: string;
  characterCreation: Omit<
    PrepareCharacterCreationTransactionRequest,
    | "authority"
    | "feePayer"
    | "serializedMessageBase64"
    | "serializedTransactionBase64"
  >;
  settlement: Omit<
    PrepareSettlementTransactionRequest,
    | "playerAuthority"
    | "feePayer"
    | "serializedMessageBase64"
    | "serializedTransactionBase64"
  >;
}

export interface SubmitSignedPlayerOwnedTransactionRequest {
  prepared: PreparedPlayerOwnedTransaction;
  signedMessageBase64: string;
  signedTransactionBase64: string;
}

export interface PrepareSettlementRouteRequest {
  characterId: string;
  authority: string;
  feePayer?: string;
  relayRequestId?: string;
  playerAuthorizationSignatureBase64?: string;
}

export interface SettlementPreparationBase {
  settlementBatchId: string;
  payload: SettlementBatchPayloadV2;
  expectedCursor: SettlementCursorExpectation;
  permitDomain: SettlementPermitDomain;
  playerAuthorizationMessageBase64: string;
  playerAuthorizationMessageUtf8: string;
  playerAuthorizationMessageEncoding: "utf8";
}

export interface SettlementAuthorizationPhase extends SettlementPreparationBase {
  phase: "authorize";
}

export interface SettlementPreparedPhase extends SettlementPreparationBase {
  phase: "sign_transaction";
  playerAuthorizationSignatureBase64: string;
  serverAttestationMessageBase64: string;
  preparedTransaction: PreparedPlayerOwnedTransaction;
}

export type PrepareSettlementRouteResponse =
  | SettlementAuthorizationPhase
  | SettlementPreparedPhase;

export interface SubmitSettlementRouteRequest extends SubmitSignedPlayerOwnedTransactionRequest {
  settlementBatchId: string;
}

export interface PrepareCharacterCreationRouteRequest {
  characterId: string;
  authority: string;
  feePayer?: string;
  initialUnlockedZoneId: number;
}

export interface PrepareCharacterCreationRouteResponse {
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
      chainCreationStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
      chainCreationTxSignature: string | null;
      chainCreatedAt: string | null;
      chainCreationTs: number | null;
      chainCreationSeasonId: number | null;
    };
  };
  preparedTransaction: PreparedPlayerOwnedTransaction;
}

export interface SubmitCharacterCreationRouteRequest extends SubmitSignedPlayerOwnedTransactionRequest {}

export interface SubmitCharacterCreationRouteResponse {
  characterId: string;
  chainCreationStatus: "CONFIRMED";
  transactionSignature: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreatedAt: string;
  cursor: SettlementCursorExpectation;
}

export interface PrepareFirstSyncRouteRequest {
  characterId: string;
  authority: string;
  feePayer?: string;
  playerAuthorizationSignatureBase64?: string;
}

export interface FirstSyncPreparationBase {
  payload: SettlementBatchPayloadV2;
  expectedCursor: SettlementCursorExpectation;
  permitDomain: SettlementPermitDomain;
  playerAuthorizationMessageBase64: string;
  playerAuthorizationMessageUtf8: string;
  playerAuthorizationMessageEncoding: "utf8";
}

export interface FirstSyncAuthorizationPhase extends FirstSyncPreparationBase {
  phase: "authorize";
}

export interface FirstSyncPreparedPhase extends FirstSyncPreparationBase {
  phase: "sign_transaction";
  playerAuthorizationSignatureBase64: string;
  serverAttestationMessageBase64: string;
  preparedTransaction: PreparedPlayerOwnedTransaction;
}

export type PrepareFirstSyncRouteResponse =
  | FirstSyncAuthorizationPhase
  | FirstSyncPreparedPhase;

export interface SubmitFirstSyncRouteRequest extends SubmitSignedPlayerOwnedTransactionRequest {}

export interface SubmitFirstSyncRouteResponse {
  characterId: string;
  chainCreationStatus: "CONFIRMED";
  transactionSignature: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  firstSettlementBatchId: string;
  remainingSettlementBatchIds: string[];
  chainCreatedAt: string;
  cursor: SettlementCursorExpectation;
}
