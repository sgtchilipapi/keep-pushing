import { createHash } from 'node:crypto';

import { Keypair, type AccountInfo, PublicKey } from '@solana/web3.js';

import { loadSettlementInstructionAccountEnvelope } from '../lib/solana/runanaSettlementEnvelope';
import {
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
  deriveRunanaCharacterAccounts,
  encodeRunanaCharacterId,
  referencedEnemyArchetypeIdsFromSettlementPayload,
  referencedZoneIdsFromSettlementPayload,
  referencedZonePageIndicesFromSettlementPayload,
  RUNANA_PROGRAM_ID,
} from '../lib/solana/runanaProgram';
import type { SolanaAccountReader } from '../lib/solana/runanaAccounts';
import type { SettlementBatchPayloadV2 } from '../types/settlement';

function accountDiscriminator(accountName: string): Buffer {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
}

function u8(value: number): Buffer {
  return Buffer.from([value]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function bool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

function vecU16(values: number[]): Buffer {
  return Buffer.concat([u32(values.length), ...values.map((value) => u16(value))]);
}

function accountInfo(data: Buffer): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1,
    owner: RUNANA_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function programConfigData(args: {
  adminAuthority: PublicKey;
  trustedServerSigner: PublicKey;
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  updatedAtSlot: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('ProgramConfigAccount'),
    u8(1),
    u8(255),
    args.adminAuthority.toBuffer(),
    args.trustedServerSigner.toBuffer(),
    bool(args.settlementPaused),
    u16(args.maxBattlesPerBatch),
    u16(args.maxHistogramEntriesPerBatch),
    u64(args.updatedAtSlot),
  ]);
}

function characterRootData(args: {
  authority: PublicKey;
  characterId: Buffer;
  characterCreationTs: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterRootAccount'),
    u8(1),
    u8(254),
    args.authority.toBuffer(),
    args.characterId,
    u64(args.characterCreationTs),
  ]);
}

function characterStatsData(args: {
  characterRoot: PublicKey;
  level: number;
  totalExp: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterStatsAccount'),
    u8(1),
    u8(253),
    args.characterRoot.toBuffer(),
    u16(args.level),
    u64(args.totalExp),
  ]);
}

function characterWorldProgressData(args: {
  characterRoot: PublicKey;
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterWorldProgressAccount'),
    u8(1),
    u8(252),
    args.characterRoot.toBuffer(),
    u16(args.highestUnlockedZoneId),
    u16(args.highestClearedZoneId),
  ]);
}

function characterZoneProgressPageData(args: {
  characterRoot: PublicKey;
  pageIndex: number;
  zoneStates: number[];
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterZoneProgressPageAccount'),
    u8(1),
    u8(251),
    args.characterRoot.toBuffer(),
    u16(args.pageIndex),
    Buffer.from(args.zoneStates),
  ]);
}

function seasonPolicyData(args: {
  seasonId: number;
  seasonStartTs: bigint;
  seasonEndTs: bigint;
  commitGraceEndTs: bigint;
  updatedAtSlot: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('SeasonPolicyAccount'),
    u8(1),
    u8(250),
    u32(args.seasonId),
    u64(args.seasonStartTs),
    u64(args.seasonEndTs),
    u64(args.commitGraceEndTs),
    u64(args.updatedAtSlot),
  ]);
}

function characterCursorData(args: {
  characterRoot: PublicKey;
  lastCommittedEndNonce: bigint;
  lastCommittedStateHash: Buffer;
  lastCommittedBatchId: bigint;
  lastCommittedBattleTs: bigint;
  lastCommittedSeasonId: number;
  updatedAtSlot: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterSettlementBatchCursorAccount'),
    u8(1),
    u8(249),
    args.characterRoot.toBuffer(),
    u64(args.lastCommittedEndNonce),
    args.lastCommittedStateHash,
    u64(args.lastCommittedBatchId),
    u64(args.lastCommittedBattleTs),
    u32(args.lastCommittedSeasonId),
    u64(args.updatedAtSlot),
  ]);
}

function zoneRegistryData(args: {
  zoneId: number;
  expMultiplierNum: number;
  expMultiplierDen: number;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('ZoneRegistryAccount'),
    u8(1),
    u8(248),
    u16(args.zoneId),
    u16(args.expMultiplierNum),
    u16(args.expMultiplierDen),
  ]);
}

function zoneEnemySetData(args: {
  zoneId: number;
  allowedEnemyArchetypeIds: number[];
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('ZoneEnemySetAccount'),
    u8(1),
    u8(247),
    u16(args.zoneId),
    vecU16(args.allowedEnemyArchetypeIds),
  ]);
}

function enemyArchetypeData(args: {
  enemyArchetypeId: number;
  expRewardBase: number;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('EnemyArchetypeRegistryAccount'),
    u8(1),
    u8(246),
    u16(args.enemyArchetypeId),
    u32(args.expRewardBase),
  ]);
}

class FakeSolanaReader implements SolanaAccountReader {
  private readonly accounts = new Map<string, AccountInfo<Buffer>>();

  set(pubkey: PublicKey, info: AccountInfo<Buffer>): void {
    this.accounts.set(pubkey.toBase58(), info);
  }

  async getAccountInfo(pubkey: PublicKey): Promise<AccountInfo<Buffer> | null> {
    return this.accounts.get(pubkey.toBase58()) ?? null;
  }

  async getMultipleAccountsInfo(pubkeys: PublicKey[]): Promise<Array<AccountInfo<Buffer> | null>> {
    return pubkeys.map((pubkey) => this.accounts.get(pubkey.toBase58()) ?? null);
  }
}

describe('runana chain read layer', () => {
  it('derives canonical referenced ids and character PDAs', () => {
    const authority = Keypair.generate().publicKey;
    const characterId = '00112233445566778899aabbccddeeff';
    const payload: SettlementBatchPayloadV2 = {
      characterId,
      batchId: 1,
      startNonce: 1,
      endNonce: 3,
      battleCount: 3,
      startStateHash: '11'.repeat(32),
      endStateHash: '22'.repeat(32),
      zoneProgressDelta: [
        { zoneId: 300, newState: 1 },
        { zoneId: 1, newState: 2 },
      ],
      encounterHistogram: [
        { zoneId: 300, enemyArchetypeId: 20, count: 1 },
        { zoneId: 1, enemyArchetypeId: 10, count: 2 },
      ],
      batchHash: '33'.repeat(32),
      firstBattleTs: 100,
      lastBattleTs: 120,
      seasonId: 7,
      schemaVersion: 2,
      signatureScheme: 0,
    };

    expect(referencedZonePageIndicesFromSettlementPayload(payload)).toEqual([0, 1]);
    expect(referencedZoneIdsFromSettlementPayload(payload)).toEqual([1, 300]);
    expect(referencedEnemyArchetypeIdsFromSettlementPayload(payload)).toEqual([10, 20]);

    const derived = deriveRunanaCharacterAccounts(authority, characterId);
    expect(derived.programConfig.toBase58()).toBe(deriveProgramConfigPda().toBase58());
    expect(derived.characterRoot.toBase58()).toBe(
      deriveCharacterRootPda(authority, characterId).toBase58(),
    );
    expect(derived.characterStats.toBase58()).toBe(
      deriveCharacterStatsPda(derived.characterRoot).toBase58(),
    );
    expect(derived.characterWorldProgress.toBase58()).toBe(
      deriveCharacterWorldProgressPda(derived.characterRoot).toBase58(),
    );
    expect(derived.characterBatchCursor.toBase58()).toBe(
      deriveCharacterBatchCursorPda(derived.characterRoot).toBase58(),
    );
  });

  it('loads the full settlement account envelope in canonical instruction order', async () => {
    const authority = Keypair.generate().publicKey;
    const adminAuthority = Keypair.generate().publicKey;
    const trustedServerSigner = Keypair.generate().publicKey;
    const characterIdHex = '00112233445566778899aabbccddeeff';
    const characterId = encodeRunanaCharacterId(characterIdHex);
    const payload: SettlementBatchPayloadV2 = {
      characterId: characterIdHex,
      batchId: 1,
      startNonce: 1,
      endNonce: 3,
      battleCount: 3,
      startStateHash: '11'.repeat(32),
      endStateHash: '22'.repeat(32),
      zoneProgressDelta: [
        { zoneId: 300, newState: 1 },
        { zoneId: 1, newState: 2 },
      ],
      encounterHistogram: [
        { zoneId: 300, enemyArchetypeId: 20, count: 1 },
        { zoneId: 1, enemyArchetypeId: 10, count: 2 },
      ],
      batchHash: '33'.repeat(32),
      firstBattleTs: 101,
      lastBattleTs: 121,
      seasonId: 7,
      schemaVersion: 2,
      signatureScheme: 0,
    };

    const characterRoot = deriveCharacterRootPda(authority, characterIdHex);
    const reader = new FakeSolanaReader();
    const programConfig = deriveProgramConfigPda();
    const characterStats = deriveCharacterStatsPda(characterRoot);
    const characterWorldProgress = deriveCharacterWorldProgressPda(characterRoot);
    const primaryPage = deriveCharacterZoneProgressPagePda(characterRoot, 0);
    const additionalPage = deriveCharacterZoneProgressPagePda(characterRoot, 1);
    const seasonPolicy = deriveSeasonPolicyPda(payload.seasonId);
    const cursor = deriveCharacterBatchCursorPda(characterRoot);
    const zoneRegistry1 = deriveZoneRegistryPda(1);
    const zoneRegistry300 = deriveZoneRegistryPda(300);
    const zoneEnemySet1 = deriveZoneEnemySetPda(1);
    const zoneEnemySet300 = deriveZoneEnemySetPda(300);
    const enemy10 = deriveEnemyArchetypeRegistryPda(10);
    const enemy20 = deriveEnemyArchetypeRegistryPda(20);

    const page0States = new Array(256).fill(0);
    page0States[1] = 1;
    const page1States = new Array(256).fill(0);
    page1States[44] = 1;

    reader.set(
      programConfig,
      accountInfo(
        programConfigData({
          adminAuthority,
          trustedServerSigner,
          settlementPaused: false,
          maxBattlesPerBatch: 32,
          maxHistogramEntriesPerBatch: 64,
          updatedAtSlot: 5n,
        }),
      ),
    );
    reader.set(
      characterRoot,
      accountInfo(
        characterRootData({
          authority,
          characterId,
          characterCreationTs: 100n,
        }),
      ),
    );
    reader.set(
      characterStats,
      accountInfo(
        characterStatsData({
          characterRoot,
          level: 1,
          totalExp: 0n,
        }),
      ),
    );
    reader.set(
      characterWorldProgress,
      accountInfo(
        characterWorldProgressData({
          characterRoot,
          highestUnlockedZoneId: 300,
          highestClearedZoneId: 1,
        }),
      ),
    );
    reader.set(
      primaryPage,
      accountInfo(
        characterZoneProgressPageData({
          characterRoot,
          pageIndex: 0,
          zoneStates: page0States,
        }),
      ),
    );
    reader.set(
      additionalPage,
      accountInfo(
        characterZoneProgressPageData({
          characterRoot,
          pageIndex: 1,
          zoneStates: page1States,
        }),
      ),
    );
    reader.set(
      seasonPolicy,
      accountInfo(
        seasonPolicyData({
          seasonId: 7,
          seasonStartTs: 50n,
          seasonEndTs: 500n,
          commitGraceEndTs: 600n,
          updatedAtSlot: 10n,
        }),
      ),
    );
    reader.set(
      cursor,
      accountInfo(
        characterCursorData({
          characterRoot,
          lastCommittedEndNonce: 0n,
          lastCommittedStateHash: Buffer.from('aa'.repeat(32), 'hex'),
          lastCommittedBatchId: 0n,
          lastCommittedBattleTs: 100n,
          lastCommittedSeasonId: 7,
          updatedAtSlot: 11n,
        }),
      ),
    );
    reader.set(
      zoneRegistry1,
      accountInfo(
        zoneRegistryData({
          zoneId: 1,
          expMultiplierNum: 1,
          expMultiplierDen: 1,
        }),
      ),
    );
    reader.set(
      zoneRegistry300,
      accountInfo(
        zoneRegistryData({
          zoneId: 300,
          expMultiplierNum: 2,
          expMultiplierDen: 1,
        }),
      ),
    );
    reader.set(
      zoneEnemySet1,
      accountInfo(
        zoneEnemySetData({
          zoneId: 1,
          allowedEnemyArchetypeIds: [10],
        }),
      ),
    );
    reader.set(
      zoneEnemySet300,
      accountInfo(
        zoneEnemySetData({
          zoneId: 300,
          allowedEnemyArchetypeIds: [20],
        }),
      ),
    );
    reader.set(
      enemy10,
      accountInfo(
        enemyArchetypeData({
          enemyArchetypeId: 10,
          expRewardBase: 12,
        }),
      ),
    );
    reader.set(
      enemy20,
      accountInfo(
        enemyArchetypeData({
          enemyArchetypeId: 20,
          expRewardBase: 20,
        }),
      ),
    );

    const envelope = await loadSettlementInstructionAccountEnvelope({
      reader,
      payload,
      playerAuthority: authority,
    });

    expect(envelope.referencedPageIndices).toEqual([0, 1]);
    expect(envelope.referencedZoneIds).toEqual([1, 300]);
    expect(envelope.referencedEnemyArchetypeIds).toEqual([10, 20]);
    expect(envelope.characterRoot.pubkey.toBase58()).toBe(characterRoot.toBase58());
    expect(envelope.primaryZoneProgressPage.pageIndex).toBe(0);
    expect(envelope.additionalZoneProgressPages.map((page) => page.pageIndex)).toEqual([1]);
    expect(envelope.zoneRegistries.map((account) => account.zoneId)).toEqual([1, 300]);
    expect(envelope.zoneEnemySets.map((account) => account.zoneId)).toEqual([1, 300]);
    expect(envelope.enemyArchetypeRegistries.map((account) => account.enemyArchetypeId)).toEqual([
      10,
      20,
    ]);
    expect(envelope.instructionAccounts.map((account) => account.role)).toEqual([
      'playerAuthority',
      'instructionsSysvar',
      'programConfig',
      'characterRoot',
      'characterStats',
      'characterWorldProgress',
      'characterZoneProgressPage',
      'seasonPolicy',
      'characterSettlementBatchCursor',
      'additionalZoneProgressPage:1',
      'zoneRegistry:1',
      'zoneRegistry:300',
      'zoneEnemySet:1',
      'zoneEnemySet:300',
      'enemyArchetypeRegistry:10',
      'enemyArchetypeRegistry:20',
    ]);
    expect(envelope.remainingAccounts.map((account) => account.pubkey.toBase58())).toEqual([
      additionalPage.toBase58(),
      zoneRegistry1.toBase58(),
      zoneRegistry300.toBase58(),
      zoneEnemySet1.toBase58(),
      zoneEnemySet300.toBase58(),
      enemy10.toBase58(),
      enemy20.toBase58(),
    ]);
  });
});
