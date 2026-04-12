import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

import {
  computeAnchorInstructionDiscriminator,
  deriveClassRegistryPda,
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

const RUNANA_MAX_ZONE_ENEMY_RULES = 64;

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

function fixedHash32(value: string, field: string): Buffer {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a 32-byte hex string`);
  }
  return Buffer.from(normalized, 'hex');
}

function sortedStrictEnemyRuleVector(
  values: ZoneEnemyRuleEntry[],
  field: string,
): Buffer {
  if (!Array.isArray(values)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an array`);
  }

  if (values.length > RUNANA_MAX_ZONE_ENEMY_RULES) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} exceeds ${RUNANA_MAX_ZONE_ENEMY_RULES} entries`,
    );
  }

  const encoded = values.map((value, index) => {
    if (
      !Number.isInteger(value.enemyArchetypeId) ||
      value.enemyArchetypeId < 0 ||
      value.enemyArchetypeId > 0xffff
    ) {
      throw new Error(
        `ERR_INVALID_${field.toUpperCase()}: ${field}[${index}].enemyArchetypeId must fit in u16`,
      );
    }
    if (!Number.isInteger(value.maxPerRun) || value.maxPerRun <= 0 || value.maxPerRun > 0xffff) {
      throw new Error(
        `ERR_INVALID_${field.toUpperCase()}: ${field}[${index}].maxPerRun must fit in u16 and be > 0`,
      );
    }
    if (index > 0 && values[index - 1]!.enemyArchetypeId >= value.enemyArchetypeId) {
      throw new Error(
        `ERR_INVALID_${field.toUpperCase()}: ${field} must be strictly increasing without duplicates`,
      );
    }

    return Buffer.concat([
      u16(value.enemyArchetypeId, `${field}[${index}].enemyArchetypeId`),
      u16(value.maxPerRun, `${field}[${index}].maxPerRun`),
    ]);
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

export interface ZoneEnemyRuleEntry {
  enemyArchetypeId: number;
  maxPerRun: number;
}

export interface InitializeProgramConfigArgs {
  trustedServerSigner: PublicKey;
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxRunsPerBatch: number;
  maxHistogramEntriesPerBatch: number;
}

export interface InitializeZoneRegistryArgs {
  zoneId: number;
  topologyVersion: number;
  totalSubnodeCount: number;
  topologyHash: string;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface InitializeZoneEnemySetArgs {
  zoneId: number;
  topologyVersion: number;
  enemyRules: ZoneEnemyRuleEntry[];
}

export interface UpdateZoneEnemySetArgs {
  zoneId: number;
  topologyVersion: number;
  enemyRules: ZoneEnemyRuleEntry[];
}

export interface InitializeClassRegistryArgs {
  classId: number;
  enabled: boolean;
}

export interface UpdateClassRegistryArgs {
  classId: number;
  enabled: boolean;
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
    u16(args.maxRunsPerBatch, 'maxRunsPerBatch'),
    u16(args.maxHistogramEntriesPerBatch, 'maxHistogramEntriesPerBatch'),
  ]);
}

export function serializeInitializeZoneRegistryArgs(args: InitializeZoneRegistryArgs): Buffer {
  return Buffer.concat([
    u16(args.zoneId, 'zoneId'),
    u16(args.topologyVersion, 'topologyVersion'),
    u16(args.totalSubnodeCount, 'totalSubnodeCount'),
    fixedHash32(args.topologyHash, 'topologyHash'),
    u16(args.expMultiplierNum, 'expMultiplierNum'),
    u16(args.expMultiplierDen, 'expMultiplierDen'),
  ]);
}

export function serializeInitializeZoneEnemySetArgs(args: InitializeZoneEnemySetArgs): Buffer {
  return Buffer.concat([
    u16(args.zoneId, 'zoneId'),
    u16(args.topologyVersion, 'topologyVersion'),
    sortedStrictEnemyRuleVector(args.enemyRules, 'enemyRules'),
  ]);
}

export function serializeUpdateZoneEnemySetArgs(args: UpdateZoneEnemySetArgs): Buffer {
  return serializeInitializeZoneEnemySetArgs(args);
}

export function serializeInitializeClassRegistryArgs(args: InitializeClassRegistryArgs): Buffer {
  return Buffer.concat([
    u16(args.classId, 'classId'),
    bool(args.enabled, 'enabled'),
  ]);
}

export function serializeUpdateClassRegistryArgs(args: UpdateClassRegistryArgs): Buffer {
  return serializeInitializeClassRegistryArgs(args);
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
  const zoneRegistry = deriveZoneRegistryPda(
    input.zoneId,
    input.topologyVersion,
    programId,
  );

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
  const zoneEnemySet = deriveZoneEnemySetPda(
    input.zoneId,
    input.topologyVersion,
    programId,
  );

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
  const zoneEnemySet = deriveZoneEnemySetPda(
    input.zoneId,
    input.topologyVersion,
    programId,
  );

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

export function buildInitializeClassRegistryInstruction(
  input: InitializeAdminAccountInput & InitializeClassRegistryArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const classRegistry = deriveClassRegistryPda(input.classId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: classRegistry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    'initialize_class_registry',
    serializeInitializeClassRegistryArgs(input),
  );
}

export function buildUpdateClassRegistryInstruction(
  input: UpdateAdminAccountInput & UpdateClassRegistryArgs,
): TransactionInstruction {
  const programId = input.programId ?? RUNANA_PROGRAM_ID;
  const programConfig = deriveProgramConfigPda(programId);
  const classRegistry = deriveClassRegistryPda(input.classId, programId);

  return instruction(
    programId,
    [
      { pubkey: input.adminAuthority, isSigner: true, isWritable: false },
      { pubkey: programConfig, isSigner: false, isWritable: false },
      { pubkey: classRegistry, isSigner: false, isWritable: true },
    ],
    'update_class_registry',
    serializeUpdateClassRegistryArgs(input),
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
