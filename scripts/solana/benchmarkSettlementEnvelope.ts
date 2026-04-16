import { createHash } from "node:crypto";

import { Keypair, type AccountInfo, type PublicKey } from "@solana/web3.js";

import type { SolanaAccountReader } from "../../lib/solana/runanaAccounts";
import { loadSettlementInstructionAccountEnvelope } from "../../lib/solana/runanaSettlementEnvelope";
import { buildApplyBattleSettlementBatchV1Instruction } from "../../lib/solana/runanaSettlementInstructions";
import {
  RUNANA_PROGRAM_ID,
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
  encodeRunanaCharacterId,
} from "../../lib/solana/runanaProgram";
import type { SettlementBatchPayloadV2 } from "../../types/settlement";

const MAX_RUNS_PER_BATCH = 4;
const MAX_HISTOGRAM_ROWS_PER_BATCH = 8;
const TOPOLOGY_VERSION = 1;

function discriminator(accountName: string): Buffer {
  return createHash("sha256")
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

function fixedAscii16(value: string): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.write(value, "ascii");
  return buffer;
}

function vecEnemyRules(
  rules: Array<{ enemyArchetypeId: number; maxPerRun: number }>,
): Buffer {
  return Buffer.concat([
    u32(rules.length),
    ...rules.map((rule) =>
      Buffer.concat([u16(rule.enemyArchetypeId), u16(rule.maxPerRun)]),
    ),
  ]);
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

class FakeReader implements SolanaAccountReader {
  private readonly accounts = new Map<string, AccountInfo<Buffer>>();

  set(pubkey: PublicKey, info: AccountInfo<Buffer>): void {
    this.accounts.set(pubkey.toBase58(), info);
  }

  async getAccountInfo(pubkey: PublicKey): Promise<AccountInfo<Buffer> | null> {
    return this.accounts.get(pubkey.toBase58()) ?? null;
  }

  async getMultipleAccountsInfo(
    pubkeys: PublicKey[],
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    return pubkeys.map((pubkey) => this.accounts.get(pubkey.toBase58()) ?? null);
  }
}

function programConfigData(args: {
  adminAuthority: PublicKey;
  trustedServerSigner: PublicKey;
}): Buffer {
  return Buffer.concat([
    discriminator("ProgramConfigAccount"),
    u8(1),
    u8(255),
    args.adminAuthority.toBuffer(),
    args.trustedServerSigner.toBuffer(),
    bool(false),
    u16(8),
    u16(MAX_RUNS_PER_BATCH),
    u16(MAX_HISTOGRAM_ROWS_PER_BATCH),
    u64(1n),
  ]);
}

function characterRootData(args: {
  authority: PublicKey;
  characterId: Buffer;
}): Buffer {
  return Buffer.concat([
    discriminator("CharacterRootAccount"),
    u8(1),
    u8(254),
    args.authority.toBuffer(),
    args.characterId,
    u64(1_700_000_000n),
    u16(1),
    fixedAscii16("Benchmark"),
  ]);
}

function characterStatsData(characterRoot: PublicKey): Buffer {
  return Buffer.concat([
    discriminator("CharacterStatsAccount"),
    u8(1),
    u8(253),
    characterRoot.toBuffer(),
    u16(7),
    u64(2_500n),
  ]);
}

function characterWorldProgressData(characterRoot: PublicKey): Buffer {
  return Buffer.concat([
    discriminator("CharacterWorldProgressAccount"),
    u8(1),
    u8(252),
    characterRoot.toBuffer(),
    u16(5),
    u16(4),
  ]);
}

function zonePageData(args: {
  characterRoot: PublicKey;
  pageIndex: number;
  unlockedZones: number[];
}): Buffer {
  const zoneStates = Buffer.alloc(256);
  for (const zoneId of args.unlockedZones) {
    zoneStates[zoneId % 256] = 1;
  }
  return Buffer.concat([
    discriminator("CharacterZoneProgressPageAccount"),
    u8(1),
    u8(251),
    args.characterRoot.toBuffer(),
    u16(args.pageIndex),
    zoneStates,
  ]);
}

function seasonPolicyData(): Buffer {
  return Buffer.concat([
    discriminator("SeasonPolicyAccount"),
    u8(1),
    u8(250),
    u32(4),
    u64(1_700_000_000n),
    u64(1_800_000_000n),
    u64(1_800_086_400n),
    u64(1n),
  ]);
}

function characterCursorData(characterRoot: PublicKey): Buffer {
  return Buffer.concat([
    discriminator("CharacterSettlementBatchCursorAccount"),
    u8(1),
    u8(249),
    characterRoot.toBuffer(),
    u64(8n),
    Buffer.from("11".repeat(32), "hex"),
    u64(2n),
    u64(1_700_000_500n),
    u32(4),
    u64(1n),
  ]);
}

function zoneRegistryData(args: {
  zoneId: number;
  totalSubnodeCount: number;
  topologyHash: string;
}): Buffer {
  return Buffer.concat([
    discriminator("ZoneRegistryAccount"),
    u8(1),
    u8(248),
    u16(args.zoneId),
    u16(TOPOLOGY_VERSION),
    u16(args.totalSubnodeCount),
    Buffer.from(args.topologyHash, "hex"),
    u16(1),
    u16(1),
  ]);
}

function zoneEnemySetData(args: {
  zoneId: number;
  enemyRules: Array<{ enemyArchetypeId: number; maxPerRun: number }>;
}): Buffer {
  return Buffer.concat([
    discriminator("ZoneEnemySetAccount"),
    u8(1),
    u8(247),
    u16(args.zoneId),
    u16(TOPOLOGY_VERSION),
    vecEnemyRules(args.enemyRules),
  ]);
}

function enemyArchetypeData(enemyArchetypeId: number): Buffer {
  return Buffer.concat([
    discriminator("EnemyArchetypeRegistryAccount"),
    u8(1),
    u8(246),
    u16(enemyArchetypeId),
    u32(50),
  ]);
}

function buildWorstCasePayload(characterIdHex: string): SettlementBatchPayloadV2 {
  const enemyIds = [201, 202, 203, 204, 205, 206, 207, 208];
  const runSummaries = Array.from({ length: MAX_RUNS_PER_BATCH }, (_, index) => {
    const zoneId = index + 1;
    const firstEnemy = enemyIds[index * 2]!;
    const secondEnemy = enemyIds[index * 2 + 1]!;
    return {
      closedRunSequence: index + 10,
      zoneId,
      topologyVersion: TOPOLOGY_VERSION,
      topologyHash: `${50 + index}`.repeat(32),
      terminalStatus: "COMPLETED" as const,
      rewardedBattleCount: 2,
      rewardedEncounterHistogram: [
        { enemyArchetypeId: firstEnemy, count: 1 },
        { enemyArchetypeId: secondEnemy, count: 1 },
      ],
      zoneProgressDelta: [{ zoneId: zoneId + 1, newState: 1 as const }],
      firstRewardedBattleTs: 1_700_001_000 + index * 10,
      lastRewardedBattleTs: 1_700_001_005 + index * 10,
    };
  });

  return {
    characterId: characterIdHex,
    batchId: 3,
    startRunSequence: runSummaries[0]!.closedRunSequence,
    endRunSequence: runSummaries[runSummaries.length - 1]!.closedRunSequence,
    runSummaries,
    startNonce: 9,
    endNonce: 16,
    battleCount: 8,
    startStateHash: "11".repeat(32),
    endStateHash: "22".repeat(32),
    zoneProgressDelta: runSummaries.flatMap((summary) => summary.zoneProgressDelta),
    encounterHistogram: runSummaries.flatMap((summary) =>
      summary.rewardedEncounterHistogram.map((entry) => ({
        zoneId: summary.zoneId,
        enemyArchetypeId: entry.enemyArchetypeId,
        count: entry.count,
      })),
    ),
    optionalLoadoutRevision: undefined,
    batchHash: "33".repeat(32),
    firstBattleTs: runSummaries[0]!.firstRewardedBattleTs,
    lastBattleTs: runSummaries[runSummaries.length - 1]!.lastRewardedBattleTs,
    seasonId: 4,
    schemaVersion: 2,
    signatureScheme: 1,
  };
}

async function main(): Promise<void> {
  const adminAuthority = Keypair.generate().publicKey;
  const trustedServerSigner = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const characterIdHex = "00112233445566778899aabbccddeeff";
  const characterId = encodeRunanaCharacterId(characterIdHex);
  const payload = buildWorstCasePayload(characterIdHex);
  const characterRoot = deriveCharacterRootPda(authority, characterIdHex);
  const reader = new FakeReader();

  reader.set(
    deriveProgramConfigPda(),
    accountInfo(programConfigData({ adminAuthority, trustedServerSigner })),
  );
  reader.set(
    characterRoot,
    accountInfo(characterRootData({ authority, characterId })),
  );
  reader.set(
    deriveCharacterStatsPda(characterRoot),
    accountInfo(characterStatsData(characterRoot)),
  );
  reader.set(
    deriveCharacterWorldProgressPda(characterRoot),
    accountInfo(characterWorldProgressData(characterRoot)),
  );
  reader.set(
    deriveCharacterZoneProgressPagePda(characterRoot, 0),
    accountInfo(zonePageData({ characterRoot, pageIndex: 0, unlockedZones: [1, 2, 3, 4, 5] })),
  );
  reader.set(
    deriveSeasonPolicyPda(payload.seasonId),
    accountInfo(seasonPolicyData()),
  );
  reader.set(
    deriveCharacterBatchCursorPda(characterRoot),
    accountInfo(characterCursorData(characterRoot)),
  );

  for (const summary of payload.runSummaries ?? []) {
    reader.set(
      deriveZoneRegistryPda(summary.zoneId, summary.topologyVersion),
      accountInfo(
        zoneRegistryData({
          zoneId: summary.zoneId,
          totalSubnodeCount: 6,
          topologyHash: summary.topologyHash,
        }),
      ),
    );
    reader.set(
      deriveZoneEnemySetPda(summary.zoneId, summary.topologyVersion),
      accountInfo(
        zoneEnemySetData({
          zoneId: summary.zoneId,
          enemyRules: summary.rewardedEncounterHistogram.map((entry) => ({
            enemyArchetypeId: entry.enemyArchetypeId,
            maxPerRun: 2,
          })),
        }),
      ),
    );
    for (const entry of summary.rewardedEncounterHistogram) {
      reader.set(
        deriveEnemyArchetypeRegistryPda(entry.enemyArchetypeId),
        accountInfo(enemyArchetypeData(entry.enemyArchetypeId)),
      );
    }
  }

  const envelopeStart = performance.now();
  const envelope = await loadSettlementInstructionAccountEnvelope({
    reader,
    payload,
    playerAuthority: authority,
  });
  const envelopeMs = performance.now() - envelopeStart;

  const instructionStart = performance.now();
  const instruction = buildApplyBattleSettlementBatchV1Instruction({
    payload,
    instructionAccounts: envelope.instructionAccounts,
  });
  const instructionMs = performance.now() - instructionStart;

  const result = {
    maxRunsPerBatch: MAX_RUNS_PER_BATCH,
    totalHistogramRows: payload.encounterHistogram.length,
    instructionAccountCount: envelope.instructionAccounts.length,
    remainingAccountCount: envelope.remainingAccounts.length,
    instructionDataBytes: instruction.data.length,
    envelopeLoadMs: Number(envelopeMs.toFixed(3)),
    instructionBuildMs: Number(instructionMs.toFixed(3)),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
