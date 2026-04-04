import {
  Ed25519Program,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

import type { SettlementBatchPayloadV2 } from '../../types/settlement';
import {
  encodeCanonicalPlayerAuthorizationMessage,
  encodeCanonicalServerAttestationMessage,
} from './settlementCanonical';
import type { SettlementInstructionAccountEnvelope } from './runanaSettlementEnvelope';
import type { SettlementInstructionAccountRole } from './runanaSettlementEnvelope';
import {
  computeAnchorInstructionDiscriminator,
  encodeRunanaCharacterId,
  encodeRunanaHash,
  RUNANA_CLUSTER_ID_LOCALNET,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

type U64Like = number | bigint;

export interface CanonicalSettlementMessages {
  serverAttestationMessage: Uint8Array;
  playerAuthorizationMessage: Uint8Array;
}

export interface BuildCanonicalSettlementMessagesArgs {
  payload: SettlementBatchPayloadV2;
  playerAuthority: PublicKey;
  characterRoot: PublicKey;
  programId?: PublicKey;
  clusterId?: number;
}

export interface BuildApplyBattleSettlementBatchV1InstructionArgs {
  payload: SettlementBatchPayloadV2;
  instructionAccounts: readonly SettlementInstructionAccountRole[];
  programId?: PublicKey;
}

export interface BuildSettlementTransactionInstructionsArgs {
  payload: SettlementBatchPayloadV2;
  envelope: SettlementInstructionAccountEnvelope;
  playerAuthorizationSignature: Uint8Array;
  serverSigner: Keypair;
  clusterId?: number;
}

function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a safe integer >= ${minimum}`);
  }
}

function u8(value: number, field: string): Buffer {
  assertSafeInteger(value, field, 0);
  if (value > 0xff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u8`);
  }

  return Buffer.from([value]);
}

function u16(value: number, field: string): Buffer {
  assertSafeInteger(value, field, 0);
  if (value > 0xffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`);
  }

  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number, field: string): Buffer {
  assertSafeInteger(value, field, 0);
  if (value > 0xffffffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u32`);
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: U64Like, field: string): Buffer {
  const bigintValue =
    typeof value === 'bigint'
      ? value
      : (() => {
          assertSafeInteger(value, field, 0);
          return BigInt(value);
        })();

  if (bigintValue < 0n || bigintValue > 0xffffffffffffffffn) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u64`);
  }

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(bigintValue, 0);
  return buffer;
}

function concat(parts: readonly Buffer[]): Buffer {
  return Buffer.concat(parts);
}

function serializeZoneProgressDelta(payload: SettlementBatchPayloadV2): Buffer {
  return concat([
    u32(payload.zoneProgressDelta.length, 'payload.zoneProgressDelta.length'),
    ...payload.zoneProgressDelta.map((entry, index) =>
      concat([
        u16(entry.zoneId, `payload.zoneProgressDelta[${index}].zoneId`),
        u8(entry.newState, `payload.zoneProgressDelta[${index}].newState`),
      ]),
    ),
  ]);
}

function serializeEncounterHistogram(payload: SettlementBatchPayloadV2): Buffer {
  return concat([
    u32(payload.encounterHistogram.length, 'payload.encounterHistogram.length'),
    ...payload.encounterHistogram.map((entry, index) =>
      concat([
        u16(entry.zoneId, `payload.encounterHistogram[${index}].zoneId`),
        u16(
          entry.enemyArchetypeId,
          `payload.encounterHistogram[${index}].enemyArchetypeId`,
        ),
        u16(entry.count, `payload.encounterHistogram[${index}].count`),
      ]),
    ),
  ]);
}

function serializeOptionalU32(value: number | undefined): Buffer {
  if (value === undefined) {
    return Buffer.from([0]);
  }

  return concat([Buffer.from([1]), u32(value, 'payload.optionalLoadoutRevision')]);
}

function payloadToCanonicalBytes(payload: SettlementBatchPayloadV2) {
  return {
    characterId: encodeRunanaCharacterId(payload.characterId),
    batchId: payload.batchId,
    startNonce: payload.startNonce,
    endNonce: payload.endNonce,
    battleCount: payload.battleCount,
    startStateHash: encodeRunanaHash(payload.startStateHash, 'payload.startStateHash'),
    endStateHash: encodeRunanaHash(payload.endStateHash, 'payload.endStateHash'),
    zoneProgressDelta: payload.zoneProgressDelta,
    encounterHistogram: payload.encounterHistogram,
    optionalLoadoutRevision: payload.optionalLoadoutRevision,
    batchHash: encodeRunanaHash(payload.batchHash, 'payload.batchHash'),
    firstBattleTs: payload.firstBattleTs,
    lastBattleTs: payload.lastBattleTs,
    seasonId: payload.seasonId,
    schemaVersion: payload.schemaVersion,
    signatureScheme: payload.signatureScheme,
  };
}

function toSignatureBytes(signature: Uint8Array, field: string): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be exactly 64 bytes`);
  }

  return new Uint8Array(signature);
}

export function serializeSettlementBatchPayloadV1(payload: SettlementBatchPayloadV2): Buffer {
  return concat([
    encodeRunanaCharacterId(payload.characterId),
    u64(payload.batchId, 'payload.batchId'),
    u64(payload.startNonce, 'payload.startNonce'),
    u64(payload.endNonce, 'payload.endNonce'),
    u16(payload.battleCount, 'payload.battleCount'),
    encodeRunanaHash(payload.startStateHash, 'payload.startStateHash'),
    encodeRunanaHash(payload.endStateHash, 'payload.endStateHash'),
    serializeZoneProgressDelta(payload),
    serializeEncounterHistogram(payload),
    serializeOptionalU32(payload.optionalLoadoutRevision),
    encodeRunanaHash(payload.batchHash, 'payload.batchHash'),
    u64(payload.firstBattleTs, 'payload.firstBattleTs'),
    u64(payload.lastBattleTs, 'payload.lastBattleTs'),
    u32(payload.seasonId, 'payload.seasonId'),
    u16(payload.schemaVersion, 'payload.schemaVersion'),
    u8(payload.signatureScheme, 'payload.signatureScheme'),
  ]);
}

export function serializeApplyBattleSettlementBatchV1Args(
  payload: SettlementBatchPayloadV2,
): Buffer {
  return serializeSettlementBatchPayloadV1(payload);
}

export function buildCanonicalSettlementMessages(
  args: BuildCanonicalSettlementMessagesArgs,
): CanonicalSettlementMessages {
  const canonicalPayload = payloadToCanonicalBytes(args.payload);
  const programId = args.programId ?? RUNANA_PROGRAM_ID;
  const clusterId = args.clusterId ?? RUNANA_CLUSTER_ID_LOCALNET;

  return {
    serverAttestationMessage: encodeCanonicalServerAttestationMessage({
      programId: programId.toBytes(),
      clusterId,
      characterRootPubkey: args.characterRoot.toBytes(),
      payload: canonicalPayload,
    }),
    playerAuthorizationMessage: encodeCanonicalPlayerAuthorizationMessage({
      programId: programId.toBytes(),
      clusterId,
      playerAuthorityPubkey: args.playerAuthority.toBytes(),
      characterRootPubkey: args.characterRoot.toBytes(),
      batchHash: canonicalPayload.batchHash,
      batchId: canonicalPayload.batchId,
      signatureScheme: canonicalPayload.signatureScheme,
    }),
  };
}

export function buildApplyBattleSettlementBatchV1Instruction(
  args: BuildApplyBattleSettlementBatchV1InstructionArgs,
): TransactionInstruction {
  const programId = args.programId ?? RUNANA_PROGRAM_ID;

  return new TransactionInstruction({
    programId,
    keys: args.instructionAccounts.map((account) => ({
      pubkey: account.pubkey,
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: concat([
      computeAnchorInstructionDiscriminator('apply_battle_settlement_batch_v1'),
      serializeApplyBattleSettlementBatchV1Args(args.payload),
    ]),
  });
}

export function buildSettlementTransactionInstructions(
  args: BuildSettlementTransactionInstructionsArgs,
): {
  instructions: TransactionInstruction[];
  messages: CanonicalSettlementMessages;
} {
  const clusterId = args.clusterId ?? RUNANA_CLUSTER_ID_LOCALNET;
  if (!args.serverSigner.publicKey.equals(args.envelope.programConfig.trustedServerSigner)) {
    throw new Error(
      'ERR_UNTRUSTED_SERVER_SIGNER_KEYPAIR: server signer keypair did not match program config',
    );
  }

  const messages = buildCanonicalSettlementMessages({
    payload: args.payload,
    playerAuthority: args.envelope.playerAuthority,
    characterRoot: args.envelope.characterRoot.pubkey,
    programId: args.envelope.programId,
    clusterId,
  });

  const serverAttestationInstruction = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: args.serverSigner.secretKey,
    message: messages.serverAttestationMessage,
  });
  const playerAuthorizationInstruction = Ed25519Program.createInstructionWithPublicKey({
    publicKey: args.envelope.playerAuthority.toBytes(),
    message: messages.playerAuthorizationMessage,
    signature: toSignatureBytes(
      args.playerAuthorizationSignature,
      'playerAuthorizationSignature',
    ),
  });
  const settlementInstruction = buildApplyBattleSettlementBatchV1Instruction({
    payload: args.payload,
    instructionAccounts: args.envelope.instructionAccounts,
    programId: args.envelope.programId,
  });

  return {
    instructions: [
      serverAttestationInstruction,
      playerAuthorizationInstruction,
      settlementInstruction,
    ],
    messages,
  };
}
