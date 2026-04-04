import { createHash } from "node:crypto";

import type {
  CharacterCreationRelayMetadata,
  PrepareCharacterCreationTransactionRequest,
  PreparedPlayerOwnedTransaction,
  PrepareSettlementTransactionRequest,
  SettlementRelayMetadata,
  SubmittedPlayerOwnedTransaction,
  SubmitSignedPlayerOwnedTransactionRequest,
} from "../../types/api/solana";
import type { SettlementBatchPayloadV2 } from "../../types/settlement";

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function assertPlayerPaysOwnTransaction(authority: string, feePayer: string, kind: string): void {
  if (authority !== feePayer) {
    throw new Error(
      `ERR_PLAYER_MUST_PAY: ${kind} requires feePayer to match authority`,
    );
  }
}

function sha256Hex(base64Value: string): string {
  return createHash("sha256")
    .update(Buffer.from(base64Value, "base64"))
    .digest("hex");
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`,
    );
  }
}

function assertFieldMatch(
  expected: string | number,
  actual: string | number,
  field: string,
): void {
  if (expected !== actual) {
    throw new Error(
      `ERR_PLAYER_PERMIT_DOMAIN_MISMATCH: ${field} does not match the canonical settlement request`,
    );
  }
}

function buildSettlementRelayMetadata(
  request: PrepareSettlementTransactionRequest,
): SettlementRelayMetadata {
  const { payload } = request;

  assertNonEmptyString(payload.characterId, "payload.characterId");
  assertNonEmptyString(request.characterRootPubkey, "characterRootPubkey");
  assertNonEmptyString(payload.batchHash, "payload.batchHash");
  assertNonEmptyString(payload.startStateHash, "payload.startStateHash");
  assertNonEmptyString(payload.endStateHash, "payload.endStateHash");
  assertNonEmptyString(
    request.expectedCursor.lastCommittedStateHash,
    "expectedCursor.lastCommittedStateHash",
  );
  assertNonEmptyString(request.permitDomain.programId, "programId");
  assertNonEmptyString(request.permitDomain.playerAuthority, "permitDomain.playerAuthority");
  assertNonEmptyString(
    request.permitDomain.characterRootPubkey,
    "permitDomain.characterRootPubkey",
  );
  assertNonEmptyString(request.permitDomain.batchHash, "permitDomain.batchHash");

  assertCanonicalSettlementPayload(payload);
  assertInteger(request.expectedCursor.lastCommittedBattleTs, "lastCommittedBattleTs", 0);
  assertInteger(request.expectedCursor.lastCommittedSeasonId, "lastCommittedSeasonId", 0);
  assertInteger(request.expectedCursor.lastCommittedEndNonce, "lastCommittedEndNonce", 0);
  assertInteger(request.expectedCursor.lastCommittedBatchId, "lastCommittedBatchId", 0);
  assertInteger(request.permitDomain.clusterId, "clusterId", 1);
  assertInteger(request.permitDomain.batchId, "permitDomain.batchId", 1);
  assertInteger(request.permitDomain.signatureScheme, "signatureScheme", 0);

  if (payload.endNonce < payload.startNonce) {
    throw new Error(
      "ERR_INVALID_NONCE_RANGE: endNonce must be greater than or equal to startNonce",
    );
  }

  if (payload.startNonce !== request.expectedCursor.lastCommittedEndNonce + 1) {
    throw new Error(
      "ERR_BATCH_OUT_OF_ORDER: settlement startNonce must be the next oldest uncommitted nonce",
    );
  }

  if (payload.batchId !== request.expectedCursor.lastCommittedBatchId + 1) {
    throw new Error(
      "ERR_BATCH_ID_GAP: settlement batchId must be the next oldest uncommitted batch id",
    );
  }

  if (payload.startStateHash !== request.expectedCursor.lastCommittedStateHash) {
    throw new Error(
      "ERR_START_STATE_HASH_MISMATCH: settlement startStateHash must match the committed cursor",
    );
  }

  if (payload.firstBattleTs < request.expectedCursor.lastCommittedBattleTs) {
    throw new Error(
      "ERR_BATTLE_TS_REGRESSION: settlement firstBattleTs must not regress behind the committed cursor",
    );
  }

  if (payload.seasonId < request.expectedCursor.lastCommittedSeasonId) {
    throw new Error(
      "ERR_SEASON_REGRESSION: settlement seasonId must not regress behind the committed cursor",
    );
  }

  assertFieldMatch(request.playerAuthority, request.permitDomain.playerAuthority, "playerAuthority");
  assertFieldMatch(
    request.characterRootPubkey,
    request.permitDomain.characterRootPubkey,
    "characterRootPubkey",
  );
  assertFieldMatch(payload.batchHash, request.permitDomain.batchHash, "batchHash");
  assertFieldMatch(payload.batchId, request.permitDomain.batchId, "batchId");
  assertFieldMatch(payload.signatureScheme, request.permitDomain.signatureScheme, "signatureScheme");

  return {
    relayRequestId: request.relayRequestId,
    characterId: payload.characterId,
    characterRootPubkey: request.characterRootPubkey,
    batchId: payload.batchId,
    batchHash: payload.batchHash,
    startNonce: payload.startNonce,
    endNonce: payload.endNonce,
    startStateHash: payload.startStateHash,
    endStateHash: payload.endStateHash,
    firstBattleTs: payload.firstBattleTs,
    lastBattleTs: payload.lastBattleTs,
    seasonId: payload.seasonId,
    schemaVersion: payload.schemaVersion,
    signatureScheme: payload.signatureScheme,
    expectedCursor: request.expectedCursor,
    permitDomain: request.permitDomain,
    continuityKey: `${payload.characterId}:${request.expectedCursor.lastCommittedEndNonce}->${payload.endNonce}`,
    reconciliationKey: `${payload.characterId}:${payload.batchId}:${payload.batchHash}`,
  };
}

function buildCharacterCreationRelayMetadata(
  request: PrepareCharacterCreationTransactionRequest,
): CharacterCreationRelayMetadata {
  assertNonEmptyString(request.localCharacterId, "localCharacterId");
  assertNonEmptyString(request.chainCharacterIdHex, "chainCharacterIdHex");
  assertNonEmptyString(request.characterRootPubkey, "characterRootPubkey");
  assertNonEmptyString(request.recentBlockhash, "recentBlockhash");
  assertInteger(request.characterCreationTs, "characterCreationTs", 0);
  assertInteger(request.seasonIdAtCreation, "seasonIdAtCreation", 0);
  assertInteger(request.initialUnlockedZoneId, "initialUnlockedZoneId", 0);
  assertInteger(request.lastValidBlockHeight, "lastValidBlockHeight", 0);

  return {
    localCharacterId: request.localCharacterId,
    chainCharacterIdHex: request.chainCharacterIdHex,
    characterRootPubkey: request.characterRootPubkey,
    characterCreationTs: request.characterCreationTs,
    seasonIdAtCreation: request.seasonIdAtCreation,
    initialUnlockedZoneId: request.initialUnlockedZoneId,
    recentBlockhash: request.recentBlockhash,
    lastValidBlockHeight: request.lastValidBlockHeight,
  };
}

function assertCanonicalSettlementPayload(payload: SettlementBatchPayloadV2): void {
  assertInteger(payload.batchId, "payload.batchId", 1);
  assertInteger(payload.startNonce, "payload.startNonce", 1);
  assertInteger(payload.endNonce, "payload.endNonce", 1);
  assertInteger(payload.battleCount, "payload.battleCount", 1);
  assertInteger(payload.firstBattleTs, "payload.firstBattleTs", 0);
  assertInteger(payload.lastBattleTs, "payload.lastBattleTs", 0);
  assertInteger(payload.seasonId, "payload.seasonId", 0);
  assertInteger(payload.schemaVersion, "payload.schemaVersion", 2);
  assertInteger(payload.signatureScheme, "payload.signatureScheme", 0);

  if (payload.schemaVersion !== 2) {
    throw new Error(
      "ERR_UNSUPPORTED_SETTLEMENT_SCHEMA: canonical settlement preparation requires schemaVersion = 2",
    );
  }

  if (payload.signatureScheme !== 0) {
    throw new Error(
      "ERR_UNSUPPORTED_SIGNATURE_SCHEME: canonical settlement preparation requires signatureScheme = 0",
    );
  }
}

function buildPreparedTransaction(
  kind: PreparedPlayerOwnedTransaction["kind"],
  authority: string,
  feePayer: string,
  serializedMessageBase64: string,
  serializedTransactionBase64: string,
  characterCreationRelay?: CharacterCreationRelayMetadata,
  settlementRelay?: SettlementRelayMetadata,
): PreparedPlayerOwnedTransaction {
  assertNonEmptyString(authority, "authority");
  assertNonEmptyString(feePayer, "feePayer");
  assertNonEmptyString(serializedMessageBase64, "serializedMessageBase64");
  assertNonEmptyString(serializedTransactionBase64, "serializedTransactionBase64");
  assertPlayerPaysOwnTransaction(authority, feePayer, kind);

  return {
    kind,
    authority,
    feePayer,
    serializedMessageBase64,
    serializedTransactionBase64,
    messageSha256Hex: sha256Hex(serializedMessageBase64),
    requiresPlayerSignature: true,
    serverBroadcast: true,
    characterCreationRelay,
    settlementRelay,
  };
}

export function prepareCharacterCreationTransaction(
  request: PrepareCharacterCreationTransactionRequest,
): PreparedPlayerOwnedTransaction {
  const characterCreationRelay = buildCharacterCreationRelayMetadata(request);

  return buildPreparedTransaction(
    "character_create",
    request.authority,
    request.feePayer,
    request.serializedMessageBase64,
    request.serializedTransactionBase64 ?? request.serializedMessageBase64,
    characterCreationRelay,
  );
}

export function prepareSettlementTransaction(
  request: PrepareSettlementTransactionRequest,
): PreparedPlayerOwnedTransaction {
  const settlementRelay = buildSettlementRelayMetadata(request);

  return buildPreparedTransaction(
    "battle_settlement",
    request.playerAuthority,
    request.feePayer,
    request.serializedMessageBase64,
    request.serializedTransactionBase64 ?? request.serializedMessageBase64,
    undefined,
    settlementRelay,
  );
}

export function acceptSignedPlayerOwnedTransaction(
  request: SubmitSignedPlayerOwnedTransactionRequest,
): SubmittedPlayerOwnedTransaction {
  assertNonEmptyString(request.signedMessageBase64, "signedMessageBase64");
  assertNonEmptyString(request.signedTransactionBase64, "signedTransactionBase64");

  if (request.signedMessageBase64 !== request.prepared.serializedMessageBase64) {
    throw new Error(
      "ERR_SIGNED_MESSAGE_MISMATCH: signed submission does not match the prepared message bytes",
    );
  }

  return {
    kind: request.prepared.kind,
    authority: request.prepared.authority,
    feePayer: request.prepared.feePayer,
    messageSha256Hex: request.prepared.messageSha256Hex,
    signedTransactionBase64: request.signedTransactionBase64,
    signedTransactionSha256Hex: sha256Hex(request.signedTransactionBase64),
    acceptedForBroadcast: true,
    characterCreationRelay: request.prepared.characterCreationRelay,
    settlementRelay: request.prepared.settlementRelay,
  };
}
