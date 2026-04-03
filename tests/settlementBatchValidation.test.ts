import { applyBattleSettlementBatchV1 } from "../lib/solana/settlementBatchValidation";
import { SettlementBatchPayloadV2, SettlementValidationContext, ZoneState } from "../types/settlement";

function buildContext(overrides?: Partial<SettlementValidationContext>): SettlementValidationContext {
  const baseZoneStates = new Map<number, ZoneState>([
    [1, 1],
    [2, 0],
  ]);

  return {
    currentUnixTimestamp: 1_700_000_500,
    currentSlot: 10_000,
    playerAuthority: "player-1",
    serverSigner: "server-1",
    characterRoot: {
      characterId: "char-1",
      authority: "player-1",
      characterCreationTs: 1_700_000_000,
    },
    characterStats: {
      level: 1,
      totalExp: 90,
    },
    characterWorldProgress: {
      highestUnlockedZoneId: 1,
      highestClearedZoneId: 0,
    },
    zoneStates: baseZoneStates,
    cursor: {
      lastCommittedEndNonce: 0,
      lastCommittedStateHash: "genesis",
      lastCommittedBatchId: 0,
      lastCommittedBattleTs: 1_700_000_010,
      lastCommittedSeasonId: 4,
      updatedAtSlot: 9_000,
    },
    programConfig: {
      settlementPaused: false,
      maxBattlesPerBatch: 32,
      maxHistogramEntriesPerBatch: 64,
      trustedServerSigner: "server-1",
    },
    seasonPolicy: {
      seasonId: 4,
      seasonStartTs: 1_700_000_000,
      seasonEndTs: 1_700_000_400,
      commitGraceEndTs: 1_700_000_900,
    },
    zoneRegistry: new Map([
      [1, { zoneId: 1, expMultiplierNum: 1, expMultiplierDen: 1 }],
      [2, { zoneId: 2, expMultiplierNum: 2, expMultiplierDen: 1 }],
    ]),
    zoneEnemySet: new Map([
      [1, new Set([10])],
      [2, new Set([20])],
    ]),
    enemyArchetypes: new Map([
      [10, { enemyArchetypeId: 10, expRewardBase: 30 }],
      [20, { enemyArchetypeId: 20, expRewardBase: 25 }],
    ]),
    ...overrides,
  };
}

function buildPayload(overrides?: Partial<SettlementBatchPayloadV2>): SettlementBatchPayloadV2 {
  return {
    characterId: "char-1",
    batchId: 1,
    startNonce: 1,
    endNonce: 2,
    battleCount: 2,
    startStateHash: "genesis",
    endStateHash: "hash-1",
    zoneProgressDelta: [{ zoneId: 2, newState: 1 }],
    encounterHistogram: [
      { zoneId: 1, enemyArchetypeId: 10, count: 1 },
      { zoneId: 2, enemyArchetypeId: 20, count: 1 },
    ],
    optionalLoadoutRevision: 7,
    batchHash: "batch-hash",
    firstBattleTs: 1_700_000_020,
    lastBattleTs: 1_700_000_080,
    seasonId: 4,
    schemaVersion: 2,
    signatureScheme: 0,
    ...overrides,
  };
}

describe("applyBattleSettlementBatchV1", () => {
  it("applies a valid canonical batch and updates cursor/state", () => {
    const context = buildContext();
    const payload = buildPayload();

    const result = applyBattleSettlementBatchV1(payload, context);

    expect(result.cursor.lastCommittedEndNonce).toBe(2);
    expect(result.cursor.lastCommittedBatchId).toBe(1);
    expect(result.cursor.lastCommittedStateHash).toBe("hash-1");
    expect(result.cursor.lastCommittedBattleTs).toBe(1_700_000_080);
    expect(result.cursor.lastCommittedSeasonId).toBe(4);
    expect(result.characterStats.totalExp).toBe(170);
    expect(result.zoneStates.get(2)).toBe(1);
    expect(result.characterWorldProgress.highestUnlockedZoneId).toBe(2);
  });

  it("rejects duplicate histogram pairs", () => {
    const context = buildContext();
    const payload = buildPayload({
      encounterHistogram: [
        { zoneId: 1, enemyArchetypeId: 10, count: 1 },
        { zoneId: 1, enemyArchetypeId: 10, count: 1 },
      ],
    });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_HISTOGRAM_DUPLICATE/);
  });

  it("rejects out-of-order batch submission", () => {
    const context = buildContext();
    const payload = buildPayload({ startNonce: 2, endNonce: 3 });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_NONCE_GAP/);
  });

  it("rejects invalid zone transitions", () => {
    const context = buildContext();
    const payload = buildPayload({
      zoneProgressDelta: [{ zoneId: 2, newState: 2 }],
    });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_INVALID_ZONE_DELTA/);
  });

  it("rejects batches outside the throughput cap", () => {
    const context = buildContext();
    const payload = buildPayload({
      endNonce: 21,
      battleCount: 21,
      encounterHistogram: [{ zoneId: 1, enemyArchetypeId: 10, count: 21 }],
      lastBattleTs: 1_700_000_020,
    });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_THROUGHPUT_EXCEEDED/);
  });

  it("rejects settlement after grace expiry", () => {
    const context = buildContext({
      currentUnixTimestamp: 1_700_000_901,
    });
    const payload = buildPayload();

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_SEASON_WINDOW_CLOSED/);
  });
});
