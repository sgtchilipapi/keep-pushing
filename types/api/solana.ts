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

export interface PreparedPlayerOwnedTransaction {
  kind: PlayerOwnedTransactionKind;
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
  messageSha256Hex: string;
  requiresPlayerSignature: true;
  serverBroadcast: true;
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
  settlementRelay?: SettlementRelayMetadata;
}

export interface PrepareCharacterCreationTransactionRequest {
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
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
}

export interface SubmitSignedPlayerOwnedTransactionRequest {
  prepared: PreparedPlayerOwnedTransaction;
  signedMessageBase64: string;
  signedTransactionBase64: string;
}
