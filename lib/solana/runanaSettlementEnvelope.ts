import { type Commitment, type Connection, type PublicKey, PublicKey as SolanaPublicKey } from '@solana/web3.js';

import type { SettlementBatchPayloadV2 } from '../../types/settlement';
import {
  type CharacterRootAccountState,
  type CharacterSettlementBatchCursorAccountState,
  type CharacterStatsAccountState,
  type CharacterWorldProgressAccountState,
  type CharacterZoneProgressPageAccountState,
  decodeCharacterSettlementBatchCursorAccount,
  decodeCharacterStatsAccount,
  decodeCharacterWorldProgressAccount,
  decodeCharacterZoneProgressPageAccount,
  decodeEnemyArchetypeRegistryAccount,
  decodeProgramConfigAccount,
  decodeSeasonPolicyAccount,
  decodeZoneEnemySetAccount,
  decodeZoneRegistryAccount,
  fetchCharacterRootAccount,
  type EnemyArchetypeRegistryAccountState,
  fetchDecodedAccounts,
  type ProgramConfigAccountState,
  type SeasonPolicyAccountState,
  type SolanaAccountReader,
  type ZoneEnemySetAccountState,
  type ZoneRegistryAccountState,
  accountCharacterIdHex,
} from './runanaAccounts';
import {
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  deriveCharacterBatchCursorPda,
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
  referencedEnemyArchetypeIdsFromSettlementPayload,
  referencedZoneIdsFromSettlementPayload,
  referencedZonePageIndicesFromSettlementPayload,
  referencedZoneVersionPairsFromSettlementPayload,
  RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

export interface SettlementInstructionAccountRole {
  role: string;
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SettlementInstructionAccountEnvelope {
  programId: PublicKey;
  playerAuthority: PublicKey;
  instructionsSysvar: PublicKey;
  programConfig: ProgramConfigAccountState;
  characterRoot: CharacterRootAccountState;
  characterStats: CharacterStatsAccountState;
  characterWorldProgress: CharacterWorldProgressAccountState;
  primaryZoneProgressPage: CharacterZoneProgressPageAccountState;
  seasonPolicy: SeasonPolicyAccountState;
  characterBatchCursor: CharacterSettlementBatchCursorAccountState;
  additionalZoneProgressPages: CharacterZoneProgressPageAccountState[];
  zoneRegistries: ZoneRegistryAccountState[];
  zoneEnemySets: ZoneEnemySetAccountState[];
  enemyArchetypeRegistries: EnemyArchetypeRegistryAccountState[];
  referencedPageIndices: number[];
  referencedZoneIds: number[];
  referencedZoneVersionPairs: Array<{ zoneId: number; topologyVersion: number }>;
  referencedEnemyArchetypeIds: number[];
  instructionAccounts: SettlementInstructionAccountRole[];
  remainingAccounts: SettlementInstructionAccountRole[];
}

export interface LoadSettlementInstructionEnvelopeArgs {
  reader: SolanaAccountReader | Connection;
  payload: SettlementBatchPayloadV2;
  playerAuthority: string | PublicKey;
  characterRootPubkey?: string | PublicKey;
  commitment?: Commitment;
  programId?: PublicKey;
}

export interface BuildCanonicalSettlementInstructionAccountsArgs {
  payload: SettlementBatchPayloadV2;
  playerAuthority: string | PublicKey;
  characterRootPubkey: string | PublicKey;
  programId?: PublicKey;
}

function toPublicKey(value: string | PublicKey, field: string): PublicKey {
  try {
    return typeof value === 'string' ? new SolanaPublicKey(value) : value;
  } catch {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} was not a valid public key`);
  }
}

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

export function buildCanonicalSettlementInstructionAccounts(
  args: BuildCanonicalSettlementInstructionAccountsArgs,
): SettlementInstructionAccountRole[] {
  const programId = args.programId ?? RUNANA_PROGRAM_ID;
  const playerAuthority = toPublicKey(args.playerAuthority, 'playerAuthority');
  const characterRootPubkey = toPublicKey(args.characterRootPubkey, 'characterRootPubkey');

  const referencedPageIndices = referencedZonePageIndicesFromSettlementPayload(args.payload);
  assertCondition(
    referencedPageIndices.length > 0,
    'ERR_EMPTY_ZONE_PAGE_ENVELOPE',
    'settlement payload referenced no zone pages',
  );

  const referencedZoneIds = referencedZoneIdsFromSettlementPayload(args.payload);
  const referencedZoneVersionPairs = referencedZoneVersionPairsFromSettlementPayload(args.payload);
  const referencedEnemyArchetypeIds = referencedEnemyArchetypeIdsFromSettlementPayload(args.payload);
  const [primaryPageIndex, ...additionalPageIndices] = referencedPageIndices;

  return [
    { role: 'playerAuthority', pubkey: playerAuthority, isSigner: true, isWritable: false },
    {
      role: 'instructionsSysvar',
      pubkey: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
    {
      role: 'programConfig',
      pubkey: deriveProgramConfigPda(programId),
      isSigner: false,
      isWritable: false,
    },
    { role: 'characterRoot', pubkey: characterRootPubkey, isSigner: false, isWritable: false },
    {
      role: 'characterStats',
      pubkey: deriveCharacterStatsPda(characterRootPubkey, programId),
      isSigner: false,
      isWritable: true,
    },
    {
      role: 'characterWorldProgress',
      pubkey: deriveCharacterWorldProgressPda(characterRootPubkey, programId),
      isSigner: false,
      isWritable: true,
    },
    {
      role: 'characterZoneProgressPage',
      pubkey: deriveCharacterZoneProgressPagePda(characterRootPubkey, primaryPageIndex, programId),
      isSigner: false,
      isWritable: true,
    },
    {
      role: 'seasonPolicy',
      pubkey: deriveSeasonPolicyPda(args.payload.seasonId, programId),
      isSigner: false,
      isWritable: false,
    },
    {
      role: 'characterSettlementBatchCursor',
      pubkey: deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      isSigner: false,
      isWritable: true,
    },
    ...additionalPageIndices.map((pageIndex) => ({
      role: `additionalZoneProgressPage:${pageIndex}`,
      pubkey: deriveCharacterZoneProgressPagePda(characterRootPubkey, pageIndex, programId),
      isSigner: false,
      isWritable: true,
    })),
    ...referencedZoneVersionPairs.map(({ zoneId, topologyVersion }) => ({
      role: `zoneRegistry:${zoneId}:${topologyVersion}`,
      pubkey: deriveZoneRegistryPda(zoneId, topologyVersion, programId),
      isSigner: false,
      isWritable: false,
    })),
    ...referencedZoneVersionPairs.map(({ zoneId, topologyVersion }) => ({
      role: `zoneEnemySet:${zoneId}:${topologyVersion}`,
      pubkey: deriveZoneEnemySetPda(zoneId, topologyVersion, programId),
      isSigner: false,
      isWritable: false,
    })),
    ...referencedEnemyArchetypeIds.map((enemyArchetypeId) => ({
      role: `enemyArchetypeRegistry:${enemyArchetypeId}`,
      pubkey: deriveEnemyArchetypeRegistryPda(enemyArchetypeId, programId),
      isSigner: false,
      isWritable: false,
    })),
  ];
}

export async function loadSettlementInstructionAccountEnvelope(
  args: LoadSettlementInstructionEnvelopeArgs,
): Promise<SettlementInstructionAccountEnvelope> {
  const {
    reader,
    payload,
    commitment,
    programId = RUNANA_PROGRAM_ID,
  } = args;

  const playerAuthority = toPublicKey(args.playerAuthority, 'playerAuthority');
  const derivedCharacterRoot = deriveCharacterRootPda(playerAuthority, payload.characterId, programId);
  const characterRootPubkey = args.characterRootPubkey
    ? toPublicKey(args.characterRootPubkey, 'characterRootPubkey')
    : derivedCharacterRoot;

  assertCondition(
    characterRootPubkey.equals(derivedCharacterRoot),
    'ERR_CHARACTER_ROOT_DERIVATION_MISMATCH',
    'character root did not match the canonical PDA derivation',
  );

  const referencedPageIndices = referencedZonePageIndicesFromSettlementPayload(payload);
  assertCondition(
    referencedPageIndices.length > 0,
    'ERR_EMPTY_ZONE_PAGE_ENVELOPE',
    'settlement payload referenced no zone pages',
  );

  const referencedZoneIds = referencedZoneIdsFromSettlementPayload(payload);
  const referencedZoneVersionPairs = referencedZoneVersionPairsFromSettlementPayload(payload);
  const referencedEnemyArchetypeIds = referencedEnemyArchetypeIdsFromSettlementPayload(payload);
  const additionalPageIndices = referencedPageIndices.slice(1);
  const primaryPageIndex = referencedPageIndices[0];

  const programConfigPubkey = deriveProgramConfigPda(programId);
  const characterStatsPubkey = deriveCharacterStatsPda(characterRootPubkey, programId);
  const characterWorldProgressPubkey = deriveCharacterWorldProgressPda(characterRootPubkey, programId);
  const primaryZoneProgressPagePubkey = deriveCharacterZoneProgressPagePda(
    characterRootPubkey,
    primaryPageIndex,
    programId,
  );
  const seasonPolicyPubkey = deriveSeasonPolicyPda(payload.seasonId, programId);
  const characterBatchCursorPubkey = deriveCharacterBatchCursorPda(characterRootPubkey, programId);

  const additionalPagePubkeys = additionalPageIndices.map((pageIndex) =>
    deriveCharacterZoneProgressPagePda(characterRootPubkey, pageIndex, programId),
  );
  const zoneRegistryPubkeys = referencedZoneVersionPairs.map(({ zoneId, topologyVersion }) =>
    deriveZoneRegistryPda(zoneId, topologyVersion, programId),
  );
  const zoneEnemySetPubkeys = referencedZoneVersionPairs.map(({ zoneId, topologyVersion }) =>
    deriveZoneEnemySetPda(zoneId, topologyVersion, programId),
  );
  const enemyArchetypePubkeys = referencedEnemyArchetypeIds.map((enemyArchetypeId) =>
    deriveEnemyArchetypeRegistryPda(enemyArchetypeId, programId),
  );

  const characterRoot = await fetchCharacterRootAccount(reader, characterRootPubkey, commitment);
  assertCondition(
    characterRoot.authority.equals(playerAuthority),
    'ERR_PLAYER_AUTHORITY_MISMATCH',
    'character root authority did not match the requested player authority',
  );
  assertCondition(
    accountCharacterIdHex(characterRoot.characterId) === payload.characterId.toLowerCase(),
    'ERR_CHARACTER_ID_MISMATCH',
    'character root character_id did not match the settlement payload',
  );

  const decodedAccounts = await fetchDecodedAccounts(
    reader,
    [
      {
        pubkey: programConfigPubkey,
        accountName: 'ProgramConfigAccount',
        decoder: decodeProgramConfigAccount,
      },
      {
        pubkey: characterStatsPubkey,
        accountName: 'CharacterStatsAccount',
        decoder: decodeCharacterStatsAccount,
      },
      {
        pubkey: characterWorldProgressPubkey,
        accountName: 'CharacterWorldProgressAccount',
        decoder: decodeCharacterWorldProgressAccount,
      },
      {
        pubkey: primaryZoneProgressPagePubkey,
        accountName: 'CharacterZoneProgressPageAccount',
        decoder: decodeCharacterZoneProgressPageAccount,
      },
      {
        pubkey: seasonPolicyPubkey,
        accountName: 'SeasonPolicyAccount',
        decoder: decodeSeasonPolicyAccount,
      },
      {
        pubkey: characterBatchCursorPubkey,
        accountName: 'CharacterSettlementBatchCursorAccount',
        decoder: decodeCharacterSettlementBatchCursorAccount,
      },
      ...additionalPagePubkeys.map((pubkey) => ({
        pubkey,
        accountName: 'CharacterZoneProgressPageAccount',
        decoder: decodeCharacterZoneProgressPageAccount,
      })),
      ...zoneRegistryPubkeys.map((pubkey) => ({
        pubkey,
        accountName: 'ZoneRegistryAccount',
        decoder: decodeZoneRegistryAccount,
      })),
      ...zoneEnemySetPubkeys.map((pubkey) => ({
        pubkey,
        accountName: 'ZoneEnemySetAccount',
        decoder: decodeZoneEnemySetAccount,
      })),
      ...enemyArchetypePubkeys.map((pubkey) => ({
        pubkey,
        accountName: 'EnemyArchetypeRegistryAccount',
        decoder: decodeEnemyArchetypeRegistryAccount,
      })),
    ],
    commitment,
  );

  let offset = 0;
  const programConfig = decodedAccounts[offset] as ProgramConfigAccountState;
  offset += 1;
  const characterStats = decodedAccounts[offset] as CharacterStatsAccountState;
  offset += 1;
  const characterWorldProgress = decodedAccounts[offset] as CharacterWorldProgressAccountState;
  offset += 1;
  const primaryZoneProgressPage = decodedAccounts[offset] as CharacterZoneProgressPageAccountState;
  offset += 1;
  const seasonPolicy = decodedAccounts[offset] as SeasonPolicyAccountState;
  offset += 1;
  const characterBatchCursor = decodedAccounts[offset] as CharacterSettlementBatchCursorAccountState;
  offset += 1;
  const additionalZoneProgressPages = decodedAccounts.slice(
    offset,
    offset + additionalPagePubkeys.length,
  ) as CharacterZoneProgressPageAccountState[];
  offset += additionalPagePubkeys.length;
  const zoneRegistries = decodedAccounts.slice(
    offset,
    offset + zoneRegistryPubkeys.length,
  ) as ZoneRegistryAccountState[];
  offset += zoneRegistryPubkeys.length;
  const zoneEnemySets = decodedAccounts.slice(
    offset,
    offset + zoneEnemySetPubkeys.length,
  ) as ZoneEnemySetAccountState[];
  offset += zoneEnemySetPubkeys.length;
  const enemyArchetypeRegistries = decodedAccounts.slice(
    offset,
    offset + enemyArchetypePubkeys.length,
  ) as EnemyArchetypeRegistryAccountState[];

  assertCondition(
    seasonPolicy.seasonId === payload.seasonId,
    'ERR_SEASON_POLICY_MISMATCH',
    'loaded season policy did not match the settlement payload season id',
  );
  assertCondition(
    primaryZoneProgressPage.pageIndex === primaryPageIndex,
    'ERR_PRIMARY_ZONE_PAGE_MISMATCH',
    'primary zone progress page did not match the first referenced page index',
  );
  additionalZoneProgressPages.forEach((page, index) => {
    assertCondition(
      page.pageIndex === additionalPageIndices[index],
      'ERR_ZONE_PAGE_ORDER_MISMATCH',
      'additional zone progress page order did not match the canonical page ordering',
    );
    assertCondition(
      page.characterRoot.equals(characterRootPubkey),
      'ERR_ZONE_PAGE_CHARACTER_BINDING',
      'additional zone progress page was not bound to the expected character root',
    );
  });
  zoneRegistries.forEach((account, index) => {
    assertCondition(
      account.zoneId === referencedZoneIds[index],
      'ERR_ZONE_REGISTRY_ORDER_MISMATCH',
      'zone registry order did not match the canonical settlement ordering',
    );
  });
  zoneEnemySets.forEach((account, index) => {
    assertCondition(
      account.zoneId === referencedZoneIds[index],
      'ERR_ZONE_ENEMY_SET_ORDER_MISMATCH',
      'zone enemy set order did not match the canonical settlement ordering',
    );
  });
  enemyArchetypeRegistries.forEach((account, index) => {
    assertCondition(
      account.enemyArchetypeId === referencedEnemyArchetypeIds[index],
      'ERR_ENEMY_ARCHETYPE_ORDER_MISMATCH',
      'enemy archetype registry order did not match the canonical settlement ordering',
    );
  });

  const instructionAccounts: SettlementInstructionAccountRole[] = [
    { role: 'playerAuthority', pubkey: playerAuthority, isSigner: false, isWritable: false },
    {
      role: 'instructionsSysvar',
      pubkey: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
    { role: 'programConfig', pubkey: programConfig.pubkey, isSigner: false, isWritable: false },
    { role: 'characterRoot', pubkey: characterRoot.pubkey, isSigner: false, isWritable: false },
    { role: 'characterStats', pubkey: characterStats.pubkey, isSigner: false, isWritable: true },
    {
      role: 'characterWorldProgress',
      pubkey: characterWorldProgress.pubkey,
      isSigner: false,
      isWritable: true,
    },
    {
      role: 'characterZoneProgressPage',
      pubkey: primaryZoneProgressPage.pubkey,
      isSigner: false,
      isWritable: true,
    },
    { role: 'seasonPolicy', pubkey: seasonPolicy.pubkey, isSigner: false, isWritable: false },
    {
      role: 'characterSettlementBatchCursor',
      pubkey: characterBatchCursor.pubkey,
      isSigner: false,
      isWritable: true,
    },
    ...additionalZoneProgressPages.map((page, index) => ({
      role: `additionalZoneProgressPage:${additionalPageIndices[index]}`,
      pubkey: page.pubkey,
      isSigner: false,
      isWritable: true,
    })),
    ...zoneRegistries.map((account) => ({
      role: `zoneRegistry:${account.zoneId}`,
      pubkey: account.pubkey,
      isSigner: false,
      isWritable: false,
    })),
    ...zoneEnemySets.map((account) => ({
      role: `zoneEnemySet:${account.zoneId}`,
      pubkey: account.pubkey,
      isSigner: false,
      isWritable: false,
    })),
    ...enemyArchetypeRegistries.map((account) => ({
      role: `enemyArchetypeRegistry:${account.enemyArchetypeId}`,
      pubkey: account.pubkey,
      isSigner: false,
      isWritable: false,
    })),
  ];

  return {
    programId,
    playerAuthority,
    instructionsSysvar: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
    programConfig,
    characterRoot,
    characterStats,
    characterWorldProgress,
    primaryZoneProgressPage,
    seasonPolicy,
    characterBatchCursor,
    additionalZoneProgressPages,
    zoneRegistries,
    zoneEnemySets,
    enemyArchetypeRegistries,
    referencedPageIndices,
    referencedZoneIds,
    referencedZoneVersionPairs,
    referencedEnemyArchetypeIds,
    instructionAccounts,
    remainingAccounts: instructionAccounts.slice(9),
  };
}
