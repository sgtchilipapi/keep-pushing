import { createHash } from "node:crypto";

import type {
  PrepareCharacterCreationTransactionRequest,
  PreparedPlayerOwnedTransaction,
  PrepareSettlementTransactionRequest,
  SettlementRelayMetadata,
  SubmittedPlayerOwnedTransaction,
  SubmitSignedPlayerOwnedTransactionRequest,
} from "../../types/api/solana";

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
  assertNonEmptyString(request.characterId, "characterId");
  assertNonEmptyString(request.characterRootPubkey, "characterRootPubkey");
  assertNonEmptyString(request.batchHash, "batchHash");
  assertNonEmptyString(request.startStateHash, "startStateHash");
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

  assertInteger(request.batchId, "batchId", 1);
  assertInteger(request.startNonce, "startNonce", 1);
  assertInteger(request.endNonce, "endNonce", 1);
  assertInteger(request.expectedCursor.lastCommittedEndNonce, "lastCommittedEndNonce", 0);
  assertInteger(request.expectedCursor.lastCommittedBatchId, "lastCommittedBatchId", 0);
  assertInteger(request.permitDomain.clusterId, "clusterId", 1);
  assertInteger(request.permitDomain.batchId, "permitDomain.batchId", 1);
  assertInteger(request.permitDomain.signatureScheme, "signatureScheme", 0);

  if (request.endNonce < request.startNonce) {
    throw new Error(
      "ERR_INVALID_NONCE_RANGE: endNonce must be greater than or equal to startNonce",
    );
  }

  if (request.startNonce !== request.expectedCursor.lastCommittedEndNonce + 1) {
    throw new Error(
      "ERR_BATCH_OUT_OF_ORDER: settlement startNonce must be the next oldest uncommitted nonce",
    );
  }

  if (request.batchId !== request.expectedCursor.lastCommittedBatchId + 1) {
    throw new Error(
      "ERR_BATCH_ID_GAP: settlement batchId must be the next oldest uncommitted batch id",
    );
  }

  if (request.startStateHash !== request.expectedCursor.lastCommittedStateHash) {
    throw new Error(
      "ERR_START_STATE_HASH_MISMATCH: settlement startStateHash must match the committed cursor",
    );
  }

  assertFieldMatch(request.playerAuthority, request.permitDomain.playerAuthority, "playerAuthority");
  assertFieldMatch(
    request.characterRootPubkey,
    request.permitDomain.characterRootPubkey,
    "characterRootPubkey",
  );
  assertFieldMatch(request.batchHash, request.permitDomain.batchHash, "batchHash");
  assertFieldMatch(request.batchId, request.permitDomain.batchId, "batchId");

  return {
    relayRequestId: request.relayRequestId,
    characterId: request.characterId,
    characterRootPubkey: request.characterRootPubkey,
    batchId: request.batchId,
    batchHash: request.batchHash,
    startNonce: request.startNonce,
    endNonce: request.endNonce,
    startStateHash: request.startStateHash,
    expectedCursor: request.expectedCursor,
    permitDomain: request.permitDomain,
    continuityKey: `${request.characterId}:${request.expectedCursor.lastCommittedEndNonce}->${request.endNonce}`,
    reconciliationKey: `${request.characterId}:${request.batchId}:${request.batchHash}`,
  };
}

function buildPreparedTransaction(
  kind: PreparedPlayerOwnedTransaction["kind"],
  authority: string,
  feePayer: string,
  serializedMessageBase64: string,
  settlementRelay?: SettlementRelayMetadata,
): PreparedPlayerOwnedTransaction {
  assertNonEmptyString(authority, "authority");
  assertNonEmptyString(feePayer, "feePayer");
  assertNonEmptyString(serializedMessageBase64, "serializedMessageBase64");
  assertPlayerPaysOwnTransaction(authority, feePayer, kind);

  return {
    kind,
    authority,
    feePayer,
    serializedMessageBase64,
    messageSha256Hex: sha256Hex(serializedMessageBase64),
    requiresPlayerSignature: true,
    serverBroadcast: true,
    settlementRelay,
  };
}

export function prepareCharacterCreationTransaction(
  request: PrepareCharacterCreationTransactionRequest,
): PreparedPlayerOwnedTransaction {
  return buildPreparedTransaction(
    "character_create",
    request.authority,
    request.feePayer,
    request.serializedMessageBase64,
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
    settlementRelay: request.prepared.settlementRelay,
  };
}
