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
  playerAuthorizationSignature?: Uint8Array;
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

function serializeZoneProgressDelta(
  entries: NonNullable<SettlementBatchPayloadV2['runSummaries']>[number]['zoneProgressDelta'],
): Buffer {
  return concat([
    u32(entries.length, 'zoneProgressDelta.length'),
    ...entries.map((entry, index) =>
      concat([
        u16(entry.zoneId, `zoneProgressDelta[${index}].zoneId`),
        u8(entry.newState, `zoneProgressDelta[${index}].newState`),
      ]),
    ),
  ]);
}

function serializeEncounterHistogram(
  entries: NonNullable<SettlementBatchPayloadV2['runSummaries']>[number]['rewardedEncounterHistogram'],
): Buffer {
  return concat([
    u32(entries.length, 'rewardedEncounterHistogram.length'),
    ...entries.map((entry, index) =>
      concat([
        u16(
          entry.enemyArchetypeId,
          `rewardedEncounterHistogram[${index}].enemyArchetypeId`,
        ),
        u16(entry.count, `rewardedEncounterHistogram[${index}].count`),
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

function terminalStatusCode(
  value: NonNullable<SettlementBatchPayloadV2['runSummaries']>[number]['terminalStatus'],
): number {
  switch (value) {
    case 'COMPLETED':
      return 1;
    case 'FAILED':
      return 2;
    case 'ABANDONED':
      return 3;
    case 'EXPIRED':
      return 4;
    case 'SEASON_CUTOFF':
      return 5;
    default:
      throw new Error(`ERR_INVALID_TERMINAL_STATUS: unsupported terminal status ${String(value)}`);
  }
}

function serializeRunSummaries(payload: SettlementBatchPayloadV2): Buffer {
  const runSummaries = payload.runSummaries ?? [];
  return concat([
    u32(runSummaries.length, 'payload.runSummaries.length'),
    ...runSummaries.map((summary, index) =>
      concat([
        u64(summary.closedRunSequence, `payload.runSummaries[${index}].closedRunSequence`),
        u16(summary.zoneId, `payload.runSummaries[${index}].zoneId`),
        u16(summary.topologyVersion, `payload.runSummaries[${index}].topologyVersion`),
        encodeRunanaHash(summary.topologyHash, `payload.runSummaries[${index}].topologyHash`),
        u8(terminalStatusCode(summary.terminalStatus), `payload.runSummaries[${index}].terminalStatus`),
        u16(summary.rewardedBattleCount, `payload.runSummaries[${index}].rewardedBattleCount`),
        u64(summary.firstRewardedBattleTs, `payload.runSummaries[${index}].firstRewardedBattleTs`),
        u64(summary.lastRewardedBattleTs, `payload.runSummaries[${index}].lastRewardedBattleTs`),
        serializeEncounterHistogram(summary.rewardedEncounterHistogram),
        serializeZoneProgressDelta(summary.zoneProgressDelta),
      ]),
    ),
  ]);
}

function payloadToCanonicalBytes(payload: SettlementBatchPayloadV2) {
  return {
    characterId: encodeRunanaCharacterId(payload.characterId),
    batchId: payload.batchId,
    startRunSequence: payload.startRunSequence,
    endRunSequence: payload.endRunSequence,
    runSummaries: payload.runSummaries,
    battleCount: payload.battleCount,
    startStateHash: encodeRunanaHash(payload.startStateHash, 'payload.startStateHash'),
    endStateHash: encodeRunanaHash(payload.endStateHash, 'payload.endStateHash'),
    optionalLoadoutRevision: payload.optionalLoadoutRevision,
    batchHash: encodeRunanaHash(payload.batchHash, 'payload.batchHash'),
    firstBattleTs: payload.firstBattleTs,
    lastBattleTs: payload.lastBattleTs,
    seasonId: payload.seasonId,
    schemaVersion: payload.schemaVersion,
    signatureScheme: payload.signatureScheme,
  };
}

export function serializeSettlementBatchPayloadV1(payload: SettlementBatchPayloadV2): Buffer {
  const startRunSequence = payload.startRunSequence ?? payload.startNonce ?? 0;
  const endRunSequence = payload.endRunSequence ?? payload.endNonce ?? 0;
  return concat([
    encodeRunanaCharacterId(payload.characterId),
    u64(payload.batchId, 'payload.batchId'),
    u64(startRunSequence, 'payload.startRunSequence'),
    u64(endRunSequence, 'payload.endRunSequence'),
    u16(payload.battleCount, 'payload.battleCount'),
    encodeRunanaHash(payload.startStateHash, 'payload.startStateHash'),
    encodeRunanaHash(payload.endStateHash, 'payload.endStateHash'),
    serializeRunSummaries(payload),
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
  const settlementInstruction = buildApplyBattleSettlementBatchV1Instruction({
    payload: args.payload,
    instructionAccounts: args.envelope.instructionAccounts,
    programId: args.envelope.programId,
  });

  return {
    instructions: [serverAttestationInstruction, settlementInstruction],
    messages,
  };
}
