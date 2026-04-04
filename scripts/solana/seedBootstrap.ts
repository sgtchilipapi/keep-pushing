import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';

import {
  buildInitializeEnemyArchetypeRegistryInstruction,
  buildInitializeProgramConfigInstruction,
  buildInitializeSeasonPolicyInstruction,
  buildInitializeZoneEnemySetInstruction,
  buildInitializeZoneRegistryInstruction,
  buildUpdateZoneEnemySetInstruction,
  type InitializeEnemyArchetypeRegistryArgs,
  type InitializeProgramConfigArgs,
  type InitializeSeasonPolicyArgs,
  type InitializeZoneEnemySetArgs,
  type InitializeZoneRegistryArgs,
} from '../../lib/solana/runanaAdminInstructions';
import {
  createRunanaConnection,
  loadRunanaBootstrapAuthorities,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from '../../lib/solana/runanaClient';
import {
  decodeEnemyArchetypeRegistryAccount,
  decodeProgramConfigAccount,
  decodeSeasonPolicyAccount,
  decodeZoneEnemySetAccount,
  decodeZoneRegistryAccount,
} from '../../lib/solana/runanaAccounts';
import {
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
} from '../../lib/solana/runanaProgram';
import {
  listSharedBootstrapEnemyArchetypes,
  listSharedBootstrapZoneEnemySets,
  mergeZoneRegistryDefaults,
} from '../../lib/combat/solanaBootstrapCatalog';

interface BootstrapConfigFile {
  programConfig: {
    trustedServerSigner: string;
    settlementPaused: boolean;
    maxBattlesPerBatch: number;
    maxHistogramEntriesPerBatch: number;
  };
  seasons?: Array<{
    seasonId: number;
    seasonStartTs: number;
    seasonEndTs: number;
    commitGraceEndTs: number;
  }>;
  zoneRegistries?: Array<{
    zoneId: number;
    expMultiplierNum: number;
    expMultiplierDen: number;
  }>;
  zoneEnemySets?: Array<{
    zoneId: number;
    allowedEnemyArchetypeIds: number[];
  }>;
  enemyArchetypes?: Array<{
    enemyArchetypeId: number;
    expRewardBase: number;
  }>;
}

interface CliOptions {
  configPath: string;
  dryRun: boolean;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/solana/seedBootstrap.ts --config <path> [--dry-run]',
    '',
    'Environment:',
    '  RUNANA_ADMIN_KEYPAIR_PATH  required admin signer JSON path',
    '  RUNANA_PAYER_KEYPAIR_PATH  optional fee payer JSON path; defaults to admin keypair',
    '  RUNANA_SOLANA_RPC_URL      optional RPC URL; defaults to http://127.0.0.1:8899',
    '  RUNANA_SOLANA_COMMITMENT   optional processed|confirmed|finalized',
    '  RUNANA_PROGRAM_ID          optional program override',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an object`);
  }

  return value;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a non-empty string`);
  }

  return value.trim();
}

function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be boolean`);
  }

  return value;
}

function expectInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`);
  }

  return value as number;
}

function expectIntegerArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an array`);
  }

  return value.map((entry, index) => expectInteger(entry, `${field}[${index}]`, 0));
}

function expectOptionalArray<T>(
  value: unknown,
  field: string,
  decoder: (entry: unknown, index: number) => T,
): T[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an array`);
  }

  return value.map(decoder);
}

function parseCliArgs(argv: string[]): CliOptions {
  let configPath = process.env.RUNANA_BOOTSTRAP_CONFIG_PATH?.trim() ?? '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--config') {
      configPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--help') {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`ERR_UNKNOWN_ARGUMENT: unsupported argument ${arg}`);
  }

  if (!configPath) {
    throw new Error('ERR_MISSING_CONFIG_PATH: provide --config <path> or RUNANA_BOOTSTRAP_CONFIG_PATH');
  }

  return {
    configPath,
    dryRun,
  };
}

function decodeBootstrapConfig(raw: unknown): BootstrapConfigFile {
  const root = expectRecord(raw, 'bootstrapConfig');
  const programConfig = expectRecord(root.programConfig, 'programConfig');

  return {
    programConfig: {
      trustedServerSigner: expectString(
        programConfig.trustedServerSigner,
        'programConfig.trustedServerSigner',
      ),
      settlementPaused: expectBoolean(programConfig.settlementPaused, 'programConfig.settlementPaused'),
      maxBattlesPerBatch: expectInteger(
        programConfig.maxBattlesPerBatch,
        'programConfig.maxBattlesPerBatch',
        0,
      ),
      maxHistogramEntriesPerBatch: expectInteger(
        programConfig.maxHistogramEntriesPerBatch,
        'programConfig.maxHistogramEntriesPerBatch',
        0,
      ),
    },
    seasons: expectOptionalArray(root.seasons, 'seasons', (entry, index) => {
      const item = expectRecord(entry, `seasons[${index}]`);
      return {
        seasonId: expectInteger(item.seasonId, `seasons[${index}].seasonId`, 0),
        seasonStartTs: expectInteger(item.seasonStartTs, `seasons[${index}].seasonStartTs`, 0),
        seasonEndTs: expectInteger(item.seasonEndTs, `seasons[${index}].seasonEndTs`, 0),
        commitGraceEndTs: expectInteger(
          item.commitGraceEndTs,
          `seasons[${index}].commitGraceEndTs`,
          0,
        ),
      };
    }),
    zoneRegistries: expectOptionalArray(root.zoneRegistries, 'zoneRegistries', (entry, index) => {
      const item = expectRecord(entry, `zoneRegistries[${index}]`);
      return {
        zoneId: expectInteger(item.zoneId, `zoneRegistries[${index}].zoneId`, 0),
        expMultiplierNum: expectInteger(
          item.expMultiplierNum,
          `zoneRegistries[${index}].expMultiplierNum`,
          0,
        ),
        expMultiplierDen: expectInteger(
          item.expMultiplierDen,
          `zoneRegistries[${index}].expMultiplierDen`,
          1,
        ),
      };
    }),
    zoneEnemySets: expectOptionalArray(root.zoneEnemySets, 'zoneEnemySets', (entry, index) => {
      const item = expectRecord(entry, `zoneEnemySets[${index}]`);
      return {
        zoneId: expectInteger(item.zoneId, `zoneEnemySets[${index}].zoneId`, 0),
        allowedEnemyArchetypeIds: expectIntegerArray(
          item.allowedEnemyArchetypeIds,
          `zoneEnemySets[${index}].allowedEnemyArchetypeIds`,
        ),
      };
    }),
    enemyArchetypes: expectOptionalArray(root.enemyArchetypes, 'enemyArchetypes', (entry, index) => {
      const item = expectRecord(entry, `enemyArchetypes[${index}]`);
      return {
        enemyArchetypeId: expectInteger(
          item.enemyArchetypeId,
          `enemyArchetypes[${index}].enemyArchetypeId`,
          0,
        ),
        expRewardBase: expectInteger(item.expRewardBase, `enemyArchetypes[${index}].expRewardBase`, 0),
      };
    }),
  };
}

function loadBootstrapConfig(configPath: string): BootstrapConfigFile {
  const resolvedPath = resolve(process.cwd(), configPath);
  const decoded = decodeBootstrapConfig(JSON.parse(readFileSync(resolvedPath, 'utf8')) as unknown);

  return {
    ...decoded,
    zoneRegistries: mergeZoneRegistryDefaults(decoded.zoneRegistries ?? []),
    zoneEnemySets: listSharedBootstrapZoneEnemySets(),
    enemyArchetypes: listSharedBootstrapEnemyArchetypes(),
  };
}

function assertUniqueIds<T>(values: T[], getId: (value: T) => number, field: string): void {
  const seen = new Set<number>();
  for (const value of values) {
    const id = getId(value);
    if (seen.has(id)) {
      throw new Error(`ERR_DUPLICATE_${field.toUpperCase()}: duplicate ${field} id ${id}`);
    }
    seen.add(id);
  }
}

function sortById<T>(values: T[], getId: (value: T) => number): T[] {
  return [...values].sort((left, right) => getId(left) - getId(right));
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sendInstruction(args: {
  label: string;
  dryRun: boolean;
  payer: ReturnType<typeof loadRunanaBootstrapAuthorities>['payer'];
  admin: ReturnType<typeof loadRunanaBootstrapAuthorities>['admin'];
  instruction: Transaction['instructions'][number];
}) {
  if (args.dryRun) {
    console.log(`[dry-run] ${args.label}`);
    return;
  }

  const connection = createRunanaConnection();
  const commitment = resolveRunanaCommitment();
  const transaction = new Transaction().add(args.instruction);
  transaction.feePayer = args.payer.publicKey;

  const signers = [args.payer, args.admin].filter(
    (signer, index, collection) =>
      index === collection.findIndex((candidate) => candidate.publicKey.equals(signer.publicKey)),
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, signers, {
    commitment,
    preflightCommitment: commitment,
  });

  console.log(`${args.label}: ${signature}`);
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = loadBootstrapConfig(cli.configPath);
  const connection = createRunanaConnection();
  const commitment = resolveRunanaCommitment();
  const authorities = loadRunanaBootstrapAuthorities();
  const programId = resolveRunanaProgramId();
  const programConfigPubkey = deriveProgramConfigPda(programId);

  assertUniqueIds(config.seasons ?? [], (value) => value.seasonId, 'season');
  assertUniqueIds(config.zoneRegistries ?? [], (value) => value.zoneId, 'zoneRegistry');
  assertUniqueIds(config.zoneEnemySets ?? [], (value) => value.zoneId, 'zoneEnemySet');
  assertUniqueIds(config.enemyArchetypes ?? [], (value) => value.enemyArchetypeId, 'enemyArchetype');

  console.log(`rpc=${connection.rpcEndpoint}`);
  console.log(`commitment=${commitment}`);
  console.log(`programId=${programId.toBase58()}`);
  console.log(`admin=${authorities.admin.publicKey.toBase58()} payer=${authorities.payer.publicKey.toBase58()}`);

  const desiredProgramConfig: InitializeProgramConfigArgs = {
    trustedServerSigner: new PublicKey(config.programConfig.trustedServerSigner),
    settlementPaused: config.programConfig.settlementPaused,
    maxBattlesPerBatch: config.programConfig.maxBattlesPerBatch,
    maxHistogramEntriesPerBatch: config.programConfig.maxHistogramEntriesPerBatch,
  };

  const existingProgramConfigInfo = await connection.getAccountInfo(programConfigPubkey, commitment);
  if (existingProgramConfigInfo === null) {
    await sendInstruction({
      label: `initialize_program_config ${programConfigPubkey.toBase58()}`,
      dryRun: cli.dryRun,
      payer: authorities.payer,
      admin: authorities.admin,
      instruction: buildInitializeProgramConfigInstruction({
        payer: authorities.payer.publicKey,
        adminAuthority: authorities.admin.publicKey,
        programId,
        ...desiredProgramConfig,
      }),
    });
  } else {
    const decoded = decodeProgramConfigAccount(programConfigPubkey, existingProgramConfigInfo);
    if (!decoded.adminAuthority.equals(authorities.admin.publicKey)) {
      throw new Error(
        `ERR_PROGRAM_CONFIG_ADMIN_MISMATCH: chain admin ${decoded.adminAuthority.toBase58()} does not match provided admin signer ${authorities.admin.publicKey.toBase58()}`,
      );
    }

    const matches =
      decoded.trustedServerSigner.equals(desiredProgramConfig.trustedServerSigner) &&
      decoded.settlementPaused === desiredProgramConfig.settlementPaused &&
      decoded.maxBattlesPerBatch === desiredProgramConfig.maxBattlesPerBatch &&
      decoded.maxHistogramEntriesPerBatch === desiredProgramConfig.maxHistogramEntriesPerBatch;

    if (!matches) {
      throw new Error(
        'ERR_PROGRAM_CONFIG_EXISTS_WITH_DIFFERENT_VALUES: existing program config does not match the requested seed values',
      );
    }

    console.log(`skip initialize_program_config ${programConfigPubkey.toBase58()} already matches`);
  }

  for (const zoneRegistry of sortById(config.zoneRegistries ?? [], (value) => value.zoneId)) {
    const pubkey = deriveZoneRegistryPda(zoneRegistry.zoneId, programId);
    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
    if (accountInfo === null) {
      await sendInstruction({
        label: `initialize_zone_registry zone=${zoneRegistry.zoneId} ${pubkey.toBase58()}`,
        dryRun: cli.dryRun,
        payer: authorities.payer,
        admin: authorities.admin,
        instruction: buildInitializeZoneRegistryInstruction({
          payer: authorities.payer.publicKey,
          adminAuthority: authorities.admin.publicKey,
          programId,
          ...(zoneRegistry satisfies InitializeZoneRegistryArgs),
        }),
      });
      continue;
    }

    const decoded = decodeZoneRegistryAccount(pubkey, accountInfo);
    const matches =
      decoded.zoneId === zoneRegistry.zoneId &&
      decoded.expMultiplierNum === zoneRegistry.expMultiplierNum &&
      decoded.expMultiplierDen === zoneRegistry.expMultiplierDen;

    if (!matches) {
      throw new Error(
        `ERR_ZONE_REGISTRY_EXISTS_WITH_DIFFERENT_VALUES: zone ${zoneRegistry.zoneId} already exists with different values`,
      );
    }

    console.log(`skip initialize_zone_registry zone=${zoneRegistry.zoneId} already matches`);
  }

  for (const enemyArchetype of sortById(
    config.enemyArchetypes ?? [],
    (value) => value.enemyArchetypeId,
  )) {
    const pubkey = deriveEnemyArchetypeRegistryPda(enemyArchetype.enemyArchetypeId, programId);
    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
    if (accountInfo === null) {
      await sendInstruction({
        label: `initialize_enemy_archetype_registry enemy=${enemyArchetype.enemyArchetypeId} ${pubkey.toBase58()}`,
        dryRun: cli.dryRun,
        payer: authorities.payer,
        admin: authorities.admin,
        instruction: buildInitializeEnemyArchetypeRegistryInstruction({
          payer: authorities.payer.publicKey,
          adminAuthority: authorities.admin.publicKey,
          programId,
          ...(enemyArchetype satisfies InitializeEnemyArchetypeRegistryArgs),
        }),
      });
      continue;
    }

    const decoded = decodeEnemyArchetypeRegistryAccount(pubkey, accountInfo);
    const matches =
      decoded.enemyArchetypeId === enemyArchetype.enemyArchetypeId &&
      decoded.expRewardBase === enemyArchetype.expRewardBase;

    if (!matches) {
      throw new Error(
        `ERR_ENEMY_ARCHETYPE_EXISTS_WITH_DIFFERENT_VALUES: enemy archetype ${enemyArchetype.enemyArchetypeId} already exists with different values`,
      );
    }

    console.log(
      `skip initialize_enemy_archetype_registry enemy=${enemyArchetype.enemyArchetypeId} already matches`,
    );
  }

  for (const zoneEnemySet of sortById(config.zoneEnemySets ?? [], (value) => value.zoneId)) {
    const desired: InitializeZoneEnemySetArgs = {
      zoneId: zoneEnemySet.zoneId,
      allowedEnemyArchetypeIds: zoneEnemySet.allowedEnemyArchetypeIds,
    };
    const pubkey = deriveZoneEnemySetPda(zoneEnemySet.zoneId, programId);
    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
    if (accountInfo === null) {
      await sendInstruction({
        label: `initialize_zone_enemy_set zone=${zoneEnemySet.zoneId} ${pubkey.toBase58()}`,
        dryRun: cli.dryRun,
        payer: authorities.payer,
        admin: authorities.admin,
        instruction: buildInitializeZoneEnemySetInstruction({
          payer: authorities.payer.publicKey,
          adminAuthority: authorities.admin.publicKey,
          programId,
          ...desired,
        }),
      });
      continue;
    }

    const decoded = decodeZoneEnemySetAccount(pubkey, accountInfo);
    if (sameNumbers(decoded.allowedEnemyArchetypeIds, desired.allowedEnemyArchetypeIds)) {
      console.log(`skip update_zone_enemy_set zone=${zoneEnemySet.zoneId} already matches`);
      continue;
    }

    await sendInstruction({
      label: `update_zone_enemy_set zone=${zoneEnemySet.zoneId} ${pubkey.toBase58()}`,
      dryRun: cli.dryRun,
      payer: authorities.payer,
      admin: authorities.admin,
      instruction: buildUpdateZoneEnemySetInstruction({
        adminAuthority: authorities.admin.publicKey,
        programId,
        zoneId: desired.zoneId,
        allowedEnemyArchetypeIds: desired.allowedEnemyArchetypeIds,
      }),
    });
  }

  for (const season of sortById(config.seasons ?? [], (value) => value.seasonId)) {
    const desired: InitializeSeasonPolicyArgs = {
      seasonId: season.seasonId,
      seasonStartTs: season.seasonStartTs,
      seasonEndTs: season.seasonEndTs,
      commitGraceEndTs: season.commitGraceEndTs,
    };
    const pubkey = deriveSeasonPolicyPda(season.seasonId, programId);
    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
    if (accountInfo === null) {
      await sendInstruction({
        label: `initialize_season_policy season=${season.seasonId} ${pubkey.toBase58()}`,
        dryRun: cli.dryRun,
        payer: authorities.payer,
        admin: authorities.admin,
        instruction: buildInitializeSeasonPolicyInstruction({
          payer: authorities.payer.publicKey,
          adminAuthority: authorities.admin.publicKey,
          programId,
          ...desired,
        }),
      });
      continue;
    }

    const decoded = decodeSeasonPolicyAccount(pubkey, accountInfo);
    const matches =
      decoded.seasonId === season.seasonId &&
      decoded.seasonStartTs === BigInt(season.seasonStartTs) &&
      decoded.seasonEndTs === BigInt(season.seasonEndTs) &&
      decoded.commitGraceEndTs === BigInt(season.commitGraceEndTs);

    if (!matches) {
      throw new Error(
        `ERR_SEASON_POLICY_EXISTS_WITH_DIFFERENT_VALUES: season ${season.seasonId} already exists with different values`,
      );
    }

    console.log(`skip initialize_season_policy season=${season.seasonId} already matches`);
  }

  console.log('bootstrap seeding complete');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
