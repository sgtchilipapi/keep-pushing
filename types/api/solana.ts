export type PlayerOwnedTransactionKind =
  | "character_create"
  | "battle_settlement"
  | "player_owned_instruction";

export interface PreparedPlayerOwnedTransaction {
  kind: PlayerOwnedTransactionKind;
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
  messageSha256Hex: string;
  requiresPlayerSignature: true;
  serverBroadcast: true;
}

export interface SubmittedPlayerOwnedTransaction {
  kind: PlayerOwnedTransactionKind;
  authority: string;
  feePayer: string;
  messageSha256Hex: string;
  signedTransactionBase64: string;
  signedTransactionSha256Hex: string;
  acceptedForBroadcast: true;
}

export interface PrepareCharacterCreationTransactionRequest {
  authority: string;
  feePayer: string;
  serializedMessageBase64: string;
}

export interface PrepareSettlementTransactionRequest {
  playerAuthority: string;
  feePayer: string;
  characterId: string;
  batchId: number;
  serializedMessageBase64: string;
}

export interface SubmitSignedPlayerOwnedTransactionRequest {
  prepared: PreparedPlayerOwnedTransaction;
  signedMessageBase64: string;
  signedTransactionBase64: string;
}
