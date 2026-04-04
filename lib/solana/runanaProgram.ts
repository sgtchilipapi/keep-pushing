import { createHash } from 'node:crypto';

import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';

import type { SettlementBatchPayloadV2 } from '../../types/settlement';

export const RUNANA_PROGRAM_ID = new PublicKey('CaUejpPZoNjFmSrkfbazrjBUXE8FK1c2Hoz64NFsTfLm');
export const RUNANA_CLUSTER_ID_LOCALNET = 1;
export const RUNANA_ZONE_PAGE_WIDTH = 256;
export const RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY = SYSVAR_INSTRUCTIONS_PUBKEY;

const PROGRAM_CONFIG_SEED = 'program_config';
const CHARACTER_SEED = 'character';
const CHARACTER_STATS_SEED = 'character_stats';
const CHARACTER_WORLD_PROGRESS_SEED = 'character_world_progress';
const CHARACTER_ZONE_PROGRESS_SEED = 'character_zone_progress';
const CHARACTER_BATCH_CURSOR_SEED = 'character_batch_cursor';
const ZONE_REGISTRY_SEED = 'zone_registry';
const ZONE_ENEMY_SET_SEED = 'zone_enemy_set';
const ENEMY_ARCHETYPE_SEED = 'enemy_archetype';
const SEASON_POLICY_SEED = 'season_policy';

export interface RunanaProgramDerivedAccounts {
  programConfig: PublicKey;
  characterRoot: PublicKey;
  characterStats: PublicKey;
  characterWorldProgress: PublicKey;
  characterBatchCursor: PublicKey;
}

function u16Bytes(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`);
  }

  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function normalizeFixedHex(value: string, field: string, expectedBytes: number): Buffer {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length !== expectedBytes * 2) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be ${expectedBytes} bytes encoded as hex`,
    );
  }

  return Buffer.from(normalized, 'hex');
}

export function encodeRunanaCharacterId(characterIdHex: string): Buffer {
  return normalizeFixedHex(characterIdHex, 'characterId', 16);
}

export function encodeRunanaHash(hashHex: string, field: string): Buffer {
  return normalizeFixedHex(hashHex, field, 32);
}

export function deriveProgramConfigPda(programId = RUNANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(PROGRAM_CONFIG_SEED)], programId)[0];
}

export function deriveCharacterRootPda(
  authority: PublicKey,
  characterIdHex: string,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CHARACTER_SEED), authority.toBuffer(), encodeRunanaCharacterId(characterIdHex)],
    programId,
  )[0];
}

export function deriveCharacterStatsPda(
  characterRoot: PublicKey,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CHARACTER_STATS_SEED), characterRoot.toBuffer()],
    programId,
  )[0];
}

export function deriveCharacterWorldProgressPda(
  characterRoot: PublicKey,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CHARACTER_WORLD_PROGRESS_SEED), characterRoot.toBuffer()],
    programId,
  )[0];
}

export function deriveCharacterZoneProgressPagePda(
  characterRoot: PublicKey,
  pageIndex: number,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(CHARACTER_ZONE_PROGRESS_SEED),
      characterRoot.toBuffer(),
      u16Bytes(pageIndex, 'pageIndex'),
    ],
    programId,
  )[0];
}

export function deriveCharacterBatchCursorPda(
  characterRoot: PublicKey,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CHARACTER_BATCH_CURSOR_SEED), characterRoot.toBuffer()],
    programId,
  )[0];
}

export function deriveSeasonPolicyPda(
  seasonId: number,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  const buffer = Buffer.alloc(4);
  if (!Number.isInteger(seasonId) || seasonId < 0 || seasonId > 0xffffffff) {
    throw new Error('ERR_INVALID_SEASON_ID: seasonId must fit in u32');
  }
  buffer.writeUInt32LE(seasonId, 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEASON_POLICY_SEED), buffer],
    programId,
  )[0];
}

export function deriveZoneRegistryPda(zoneId: number, programId = RUNANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZONE_REGISTRY_SEED), u16Bytes(zoneId, 'zoneId')],
    programId,
  )[0];
}

export function deriveZoneEnemySetPda(zoneId: number, programId = RUNANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZONE_ENEMY_SET_SEED), u16Bytes(zoneId, 'zoneId')],
    programId,
  )[0];
}

export function deriveEnemyArchetypeRegistryPda(
  enemyArchetypeId: number,
  programId = RUNANA_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ENEMY_ARCHETYPE_SEED), u16Bytes(enemyArchetypeId, 'enemyArchetypeId')],
    programId,
  )[0];
}

export function deriveRunanaCharacterAccounts(
  authority: PublicKey,
  characterIdHex: string,
  programId = RUNANA_PROGRAM_ID,
): RunanaProgramDerivedAccounts {
  const characterRoot = deriveCharacterRootPda(authority, characterIdHex, programId);

  return {
    programConfig: deriveProgramConfigPda(programId),
    characterRoot,
    characterStats: deriveCharacterStatsPda(characterRoot, programId),
    characterWorldProgress: deriveCharacterWorldProgressPda(characterRoot, programId),
    characterBatchCursor: deriveCharacterBatchCursorPda(characterRoot, programId),
  };
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function referencedZoneIdsFromSettlementPayload(payload: SettlementBatchPayloadV2): number[] {
  return sortedUnique(payload.encounterHistogram.map((entry) => entry.zoneId));
}

export function referencedEnemyArchetypeIdsFromSettlementPayload(
  payload: SettlementBatchPayloadV2,
): number[] {
  return sortedUnique(payload.encounterHistogram.map((entry) => entry.enemyArchetypeId));
}

export function referencedZonePageIndicesFromSettlementPayload(
  payload: SettlementBatchPayloadV2,
): number[] {
  return sortedUnique([
    ...payload.encounterHistogram.map((entry) => Math.floor(entry.zoneId / RUNANA_ZONE_PAGE_WIDTH)),
    ...payload.zoneProgressDelta.map((entry) => Math.floor(entry.zoneId / RUNANA_ZONE_PAGE_WIDTH)),
  ]);
}

export function computeAnchorAccountDiscriminator(accountName: string): Buffer {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
}

export function computeAnchorInstructionDiscriminator(instructionName: string): Buffer {
  return createHash('sha256')
    .update(`global:${instructionName}`)
    .digest()
    .subarray(0, 8);
}
