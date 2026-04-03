import { createHash } from "node:crypto";

import type {
  PrepareCharacterCreationTransactionRequest,
  PreparedPlayerOwnedTransaction,
  PrepareSettlementTransactionRequest,
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

function buildPreparedTransaction(
  kind: PreparedPlayerOwnedTransaction["kind"],
  authority: string,
  feePayer: string,
  serializedMessageBase64: string,
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
  assertNonEmptyString(request.characterId, "characterId");
  if (!Number.isInteger(request.batchId) || request.batchId < 0) {
    throw new Error("ERR_INVALID_BATCH_ID: batchId must be a non-negative integer");
  }

  return buildPreparedTransaction(
    "battle_settlement",
    request.playerAuthority,
    request.feePayer,
    request.serializedMessageBase64,
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
  };
}
