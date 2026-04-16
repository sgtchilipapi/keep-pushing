import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import type {
  RunEncounterCountEntry,
  SettlementRunSummary,
  SettlementSignatureScheme,
} from "../../types/settlement";

type BytesLike = Uint8Array | readonly number[];

export interface SettlementBatchPayloadBytesV2 {
  characterId: BytesLike;
  batchId: number;
  startRunSequence?: number;
  endRunSequence?: number;
  runSummaries?: readonly SettlementRunSummary[];
  startNonce?: number;
  endNonce?: number;
  battleCount: number;
  startStateHash: BytesLike;
  endStateHash: BytesLike;
  optionalLoadoutRevision?: number;
  batchHash: BytesLike;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  schemaVersion: number;
  signatureScheme: SettlementSignatureScheme;
}

export type SettlementBatchPayloadPreimageBytesV2 = Omit<
  SettlementBatchPayloadBytesV2,
  "batchHash"
>;

export type SettlementEndStateHashPreimageBytesV2 = Omit<
  SettlementBatchPayloadPreimageBytesV2,
  "endStateHash"
>;

export interface CanonicalServerAttestationMessageArgs {
  programId: BytesLike;
  clusterId: number;
  characterRootPubkey: BytesLike;
  payload: SettlementBatchPayloadBytesV2;
}

export interface CanonicalPlayerAuthorizationMessageArgs {
  programId: BytesLike;
  clusterId: number;
  playerAuthorityPubkey: BytesLike;
  characterRootPubkey: BytesLike;
  batchHash: BytesLike;
  batchId: number;
  signatureScheme: SettlementSignatureScheme;
}

export interface CanonicalPlayerAuthorizationTextArgs {
  programId: BytesLike;
  clusterId: number;
  playerAuthorityPubkey: BytesLike;
  characterRootPubkey: BytesLike;
  batchHash: BytesLike;
  batchId: number;
  signatureScheme: 1;
}

function toBytes(value: BytesLike, field: string, expectedLength?: number): Uint8Array {
  const bytes = value instanceof Uint8Array ? new Uint8Array(value) : Uint8Array.from(value);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be exactly ${expectedLength} bytes`,
    );
  }
  return bytes;
}

function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be a safe integer >= ${minimum}`,
    );
  }
}

function u8(value: number, field: string): Uint8Array {
  assertSafeInteger(value, field, 0);
  if (value > 0xff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u8`);
  }
  return Uint8Array.of(value);
}

function u16(value: number, field: string): Uint8Array {
  assertSafeInteger(value, field, 0);
  if (value > 0xffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`);
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number, field: string): Uint8Array {
  assertSafeInteger(value, field, 0);
  if (value > 0xffffffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u32`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64(value: number, field: string): Uint8Array {
  assertSafeInteger(value, field, 0);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function encodeBase64Url(bytes: BytesLike): string {
  return Buffer.from(toBytes(bytes, "bytes"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeZoneProgressDelta(entries: SettlementRunSummary["zoneProgressDelta"]): Uint8Array {
  const parts: Uint8Array[] = [u32(entries.length, "zoneProgressDelta.length")];

  for (const entry of entries) {
    parts.push(u16(entry.zoneId, "zoneProgressDelta.zoneId"));
    parts.push(u8(entry.newState, "zoneProgressDelta.newState"));
  }

  return concatBytes(parts);
}

function encodeRunEncounterHistogram(entries: readonly RunEncounterCountEntry[]): Uint8Array {
  const parts: Uint8Array[] = [u32(entries.length, "encounterHistogram.length")];

  for (const entry of entries) {
    parts.push(u16(entry.enemyArchetypeId, "encounterHistogram.enemyArchetypeId"));
    parts.push(u16(entry.count, "encounterHistogram.count"));
  }

  return concatBytes(parts);
}

function encodeOptionalU32(value: number | undefined): Uint8Array {
  if (value === undefined) {
    return Uint8Array.of(0);
  }

  return concatBytes([Uint8Array.of(1), u32(value, "optionalLoadoutRevision")]);
}

function terminalStatusCode(status: SettlementRunSummary["terminalStatus"]): number {
  switch (status) {
    case "COMPLETED":
      return 1;
    case "FAILED":
      return 2;
    case "ABANDONED":
      return 3;
    case "EXPIRED":
      return 4;
    case "SEASON_CUTOFF":
      return 5;
    default:
      throw new Error(`ERR_INVALID_TERMINAL_STATUS: unsupported terminal status ${String(status)}`);
  }
}

function encodeTopologyHash(value: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length !== 64) {
    throw new Error("ERR_INVALID_TOPOLOGY_HASH: topologyHash must be a 32-byte hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function encodeRunSummaries(entries: readonly SettlementRunSummary[] = []): Uint8Array {
  const parts: Uint8Array[] = [u32(entries.length, "runSummaries.length")];

  for (const entry of entries) {
    parts.push(u64(entry.closedRunSequence, "runSummary.closedRunSequence"));
    parts.push(u16(entry.zoneId, "runSummary.zoneId"));
    parts.push(u16(entry.topologyVersion, "runSummary.topologyVersion"));
    parts.push(encodeTopologyHash(entry.topologyHash));
    parts.push(u8(terminalStatusCode(entry.terminalStatus), "runSummary.terminalStatus"));
    parts.push(u16(entry.rewardedBattleCount, "runSummary.rewardedBattleCount"));
    parts.push(u64(entry.firstRewardedBattleTs, "runSummary.firstRewardedBattleTs"));
    parts.push(u64(entry.lastRewardedBattleTs, "runSummary.lastRewardedBattleTs"));
    parts.push(encodeRunEncounterHistogram(entry.rewardedEncounterHistogram));
    parts.push(encodeZoneProgressDelta(entry.zoneProgressDelta));
  }

  return concatBytes(parts);
}

export function encodeSettlementBatchPayloadPreimageV2(
  payload: SettlementBatchPayloadPreimageBytesV2,
): Uint8Array {
  return concatBytes([
    toBytes(payload.characterId, "characterId", 16),
    u64(payload.batchId, "batchId"),
    u64(payload.startRunSequence ?? payload.startNonce ?? 0, "startRunSequence"),
    u64(payload.endRunSequence ?? payload.endNonce ?? 0, "endRunSequence"),
    u16(payload.battleCount, "battleCount"),
    u64(payload.firstBattleTs, "firstBattleTs"),
    u64(payload.lastBattleTs, "lastBattleTs"),
    u32(payload.seasonId, "seasonId"),
    toBytes(payload.startStateHash, "startStateHash", 32),
    toBytes(payload.endStateHash, "endStateHash", 32),
    encodeRunSummaries(payload.runSummaries),
    encodeOptionalU32(payload.optionalLoadoutRevision),
    u16(payload.schemaVersion, "schemaVersion"),
    u8(payload.signatureScheme, "signatureScheme"),
  ]);
}

export function encodeSettlementEndStateHashPreimageV2(
  payload: SettlementEndStateHashPreimageBytesV2,
): Uint8Array {
  // The backend freezes this chain-only rule because the current program
  // persists end_state_hash but does not derive it independently.
  return concatBytes([
    toBytes(payload.characterId, "characterId", 16),
    u64(payload.batchId, "batchId"),
    u64(payload.startRunSequence ?? payload.startNonce ?? 0, "startRunSequence"),
    u64(payload.endRunSequence ?? payload.endNonce ?? 0, "endRunSequence"),
    u16(payload.battleCount, "battleCount"),
    u64(payload.firstBattleTs, "firstBattleTs"),
    u64(payload.lastBattleTs, "lastBattleTs"),
    u32(payload.seasonId, "seasonId"),
    toBytes(payload.startStateHash, "startStateHash", 32),
    encodeRunSummaries(payload.runSummaries),
    encodeOptionalU32(payload.optionalLoadoutRevision),
    u16(payload.schemaVersion, "schemaVersion"),
    u8(payload.signatureScheme, "signatureScheme"),
  ]);
}

export function encodeCanonicalServerAttestationMessage(
  args: CanonicalServerAttestationMessageArgs,
): Uint8Array {
  const payload = args.payload;

  return concatBytes([
    toBytes(args.programId, "programId", 32),
    u8(args.clusterId, "clusterId"),
    toBytes(args.characterRootPubkey, "characterRootPubkey", 32),
    toBytes(payload.characterId, "characterId", 16),
    u64(payload.batchId, "batchId"),
    u64(payload.startRunSequence ?? payload.startNonce ?? 0, "startRunSequence"),
    u64(payload.endRunSequence ?? payload.endNonce ?? 0, "endRunSequence"),
    u16(payload.battleCount, "battleCount"),
    u64(payload.firstBattleTs, "firstBattleTs"),
    u64(payload.lastBattleTs, "lastBattleTs"),
    u32(payload.seasonId, "seasonId"),
    toBytes(payload.startStateHash, "startStateHash", 32),
    toBytes(payload.endStateHash, "endStateHash", 32),
    encodeRunSummaries(payload.runSummaries),
    encodeOptionalU32(payload.optionalLoadoutRevision),
    toBytes(payload.batchHash, "batchHash", 32),
    u16(payload.schemaVersion, "schemaVersion"),
    u8(payload.signatureScheme, "signatureScheme"),
  ]);
}

export function encodeCanonicalPlayerAuthorizationMessage(
  args: CanonicalPlayerAuthorizationMessageArgs,
): Uint8Array {
  if (args.signatureScheme === 1) {
    return utf8Bytes(
      buildCanonicalPlayerAuthorizationMessageText({
        programId: args.programId,
        clusterId: args.clusterId,
        playerAuthorityPubkey: args.playerAuthorityPubkey,
        characterRootPubkey: args.characterRootPubkey,
        batchHash: args.batchHash,
        batchId: args.batchId,
        signatureScheme: 1,
      }),
    );
  }

  return concatBytes([
    toBytes(args.programId, "programId", 32),
    u8(args.clusterId, "clusterId"),
    toBytes(args.playerAuthorityPubkey, "playerAuthorityPubkey", 32),
    toBytes(args.characterRootPubkey, "characterRootPubkey", 32),
    toBytes(args.batchHash, "batchHash", 32),
    u64(args.batchId, "batchId"),
    u8(args.signatureScheme, "signatureScheme"),
  ]);
}

export function buildCanonicalPlayerAuthorizationMessageText(
  args: CanonicalPlayerAuthorizationTextArgs,
): string {
  return [
    "RUNANA",
    "settlement",
    String(args.signatureScheme),
    String(args.clusterId),
    new PublicKey(toBytes(args.programId, "programId", 32)).toBase58(),
    new PublicKey(toBytes(args.playerAuthorityPubkey, "playerAuthorityPubkey", 32)).toBase58(),
    new PublicKey(toBytes(args.characterRootPubkey, "characterRootPubkey", 32)).toBase58(),
    String(args.batchId),
    encodeBase64Url(args.batchHash),
  ].join("|");
}

export function encodeHexLower(bytes: BytesLike): string {
  return Buffer.from(toBytes(bytes, "bytes")).toString("hex");
}

export function sha256Bytes(bytes: BytesLike): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(Buffer.from(bytes)).digest());
}

export function computeSettlementBatchHash(payload: SettlementBatchPayloadPreimageBytesV2): Uint8Array {
  return sha256Bytes(encodeSettlementBatchPayloadPreimageV2(payload));
}

export function computeSettlementBatchHashHex(payload: SettlementBatchPayloadPreimageBytesV2): string {
  return encodeHexLower(computeSettlementBatchHash(payload));
}

export function computeCanonicalEndStateHash(
  payload: SettlementEndStateHashPreimageBytesV2,
): Uint8Array {
  return sha256Bytes(encodeSettlementEndStateHashPreimageV2(payload));
}

export function computeCanonicalEndStateHashHex(
  payload: SettlementEndStateHashPreimageBytesV2,
): string {
  return encodeHexLower(computeCanonicalEndStateHash(payload));
}
