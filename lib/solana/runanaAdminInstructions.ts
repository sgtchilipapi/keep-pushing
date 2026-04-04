import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

import {
  computeAnchorInstructionDiscriminator,
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

const RUNANA_MAX_ZONE_ENEMY_SET_MEMBERS = 64;

type U64Like = number | bigint;

function u16(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`);
  }

  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
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
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(
              `ERR_INVALID_${field.toUpperCase()}: ${field} must be a safe integer or bigint >= 0`,
            );
          }

          return BigInt(value);
        })();

  if (bigintValue < 0n || bigintValue > 0xffffffffffffffffn) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u64`);
  }

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(bigintValue, 0);
  return buffer;
}

function bool(value: boolean, field: string): Buffer {
  if (typeof value !== 'boolean') {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be boolean`);
  }

  return Buffer.from([value ? 1 : 0]);
}

function sortedStrictAscendingU16Vector(values: number[], field: string): Buffer {
  if (!Array.isArray(values)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an array`);
  }

  if (values.length > RUNANA_MAX_ZONE_ENEMY_SET_MEMBERS) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} exceeds ${RUNANA_MAX_ZONE_ENEMY_SET_MEMBERS} entries`,
    );
  }

  const encoded = values.map((value, index) => {
    if (index > 0 && values[index - 1] >= value) {
      throw new Error(
        `ERR_INVALID_${field.toUpperCase()}: ${field} must be strictly increasing without duplicates`,
      );
    }

    return u16(value, `${field}[${index}]`);
  });

  return Buffer.concat([u32(values.length, `${field}.length`), ...encoded]);
}

function instructionData(instructionName: string, serializedArgs: Buffer): Buffer {
  return Buffer.concat([
    computeAnchorInstructionDiscriminator(instructionName),
    serializedArgs,
  ]);
}

function instruction(
  programId: PublicKey,
  keys: AccountMeta[],
  name: string,
  args: Buffer,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: instructionData(name, args),
  });
}

export interface InitializeProgramConfigArgs {
  trustedServerSigner: PublicKey;
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
}

export interface InitializeZoneRegistryArgs {
  zoneId: number;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface InitializeZoneEnemySetArgs {
  zoneId: number;
  allowedEnemyArchetypeIds: number[];
}

export interface UpdateZoneEnemySetArgs {
  zoneId: number;
  allowedEnemyArchetypeIds: number[];
}

export interface InitializeEnemyArchetypeRegistryArgs {
  enemyArchetypeId: number;
  expRewardBase: number;
}

export interface InitializeSeasonPolicyArgs {
  seasonId: number;
  seasonStartTs: U64Like;
  seasonEndTs: U64Like;
  commitGraceEndTs: U64Like;
}

interface InitializeAdminAccountInput {
  payer: PublicKey;
  adminAuthority: PublicKey;
  programId?: PublicKey;
}

interface UpdateAdminAccountInput {
  adminAuthority: PublicKey;
  programId?: PublicKey;
}

export function serializeInitializeProgramConfigArgs(args: InitializeProgramConfigArgs): Buffer {
  return Buffer.concat([
    args.trustedServerSigner.toBuffer(),
    bool(args.settlementPaused, 'settlementPaused'),
    u16(args.maxBattlesPerBatch, 'maxBattlesPerBatch'),
    u16(args.maxHistogramEntriesPerBatch, 'maxHistogramEntriesPerBatch'),
  ]);
}

export function serializeInitializeZoneRegistryArgs(args: InitializeZoneRegistryArgs): Buffer {
  return Buffer.concat([
    u16(args.zoneId, 'zoneId'),
    u16(args.expMultiplierNum, 'expMultiplierNum'),
    u16(args.expMultiplierDen, 'expMultiplierDen'),
  ]);
}

export function serializeInitializeZoneEnemySetArgs(args: InitializeZoneEnemySetArgs): Buffer {
  return Buffer.concat([
    u16(args.zoneId, 'zoneId'),
    sortedStrictAscendingU16Vector(args.allowedEnemyArchetypeIds, 'allowedEnemyArchetypeIds'),
  ]);
}

export function serializeUpdateZoneEnemySetArgs(args: UpdateZoneEnemySetArgs): Buffer {
  return serializeInitializeZoneEnemySetArgs(args);
}

export function serializeInitializeEnemyArchetypeRegistryArgs(
  args: InitializeEnemyArchetypeRegistryArgs,
): Buffer {
  return Buffer.concat([
    u16(args.enemyArchetypeId, 'enemyArchetypeId'),
    u32(args.expRewardBase, 'expRewardBase'),
  ]);
}

export function serializeInitializeSeasonPolicyArgs(args: InitializeSeasonPolicyArgs): Buffer {
  return Buffer.concat([
    u32(args.seasonId, 'seasonId'),
    u64(args.seasonStartTs, 'seasonStartTs'),
    u64(args.seasonEndTs, 'seasonEndTs'),
    u64(args.commitGraceEndTs, 'commitGraceEndTs'),
  ]);
}

export function buildInitializeProgramConfigInstruction(
  input: InitializeAdminAccountInput & InitializeProgramConfigArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_program_config',
    serializeInitializeProgramConfigArgs(input),
  );
}

export function buildInitializeZoneRegistryInstruction(
  input: InitializeAdminAccountInput & InitializeZoneRegistryArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const zoneRegistry = deriveZoneRegistryPda(input.zoneId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: zoneRegistry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_zone_registry',
    serializeInitializeZoneRegistryArgs(input),
  );
}

export function buildInitializeZoneEnemySetInstruction(
  input: InitializeAdminAccountInput & InitializeZoneEnemySetArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const zoneEnemySet = deriveZoneEnemySetPda(input.zoneId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: zoneEnemySet, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_zone_enemy_set',
    serializeInitializeZoneEnemySetArgs(input),
  );
}

export function buildUpdateZoneEnemySetInstruction(
  input: UpdateAdminAccountInput & UpdateZoneEnemySetArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const zoneEnemySet = deriveZoneEnemySetPda(input.zoneId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: zoneEnemySet, isSigner: false, isWritable: true },
    ],
    'update_zone_enemy_set',
    serializeUpdateZoneEnemySetArgs(input),
  );
}

export function buildInitializeEnemyArchetypeRegistryInstruction(
  input: InitializeAdminAccountInput & InitializeEnemyArchetypeRegistryArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const enemyArchetypeRegistry = deriveEnemyArchetypeRegistryPda(
    input.enemyArchetypeId,
    programId,
  );

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: enemyArchetypeRegistry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_enemy_archetype_registry',
    serializeInitializeEnemyArchetypeRegistryArgs(input),
  );
}

export function buildInitializeSeasonPolicyInstruction(
  input: InitializeAdminAccountInput & InitializeSeasonPolicyArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const seasonPolicy = deriveSeasonPolicyPda(input.seasonId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: seasonPolicy, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_season_policy',
    serializeInitializeSeasonPolicyArgs(input),
  );
}
