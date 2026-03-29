import { applyBattleSettlementBatchV1 } from "../lib/solana/settlementBatchValidation";
import { ApplyBattleSettlementBatchV1Payload, SettlementValidationContext, ZoneState } from "../types/settlement";

function buildContext(overrides?: Partial<SettlementValidationContext>): SettlementValidationContext {
  const baseZoneStates = new Map<number, ZoneState>([
    [1, 1],
    [2, 0],
  ]);

  return {
    currentSlot: 10_000,
    playerAuthority: "player-1",
    serverSigner: "server-1",
    characterRoot: {
      characterId: "char-1",
      authority: "player-1",
      level: 1,
      exp: 90,
    },
    characterStats: {
      lastRecalcSlot: 9_000,
    },
    characterWorldProgress: {
      highestMainZoneUnlocked: 1,
      highestMainZoneCleared: 0,
      updatedAtSlot: 9_000,
    },
    zoneStates: baseZoneStates,
    loadout: {
      loadoutRevision: 7,
    },
    cursor: {
      lastCommittedEndNonce: 0,
      lastCommittedStateHash: "genesis",
      lastCommittedBatchId: 0,
      updatedAtSlot: 9_000,
    },
    programConfig: {
      settlementPaused: false,
      maxBattlesPerBatch: 32,
      maxHistogramEntriesPerBatch: 64,
      trustedServerSigners: ["server-1"],
    },
    zoneRegistry: new Map([
      [1, { zoneId: 1 }],
      [2, { zoneId: 2 }],
    ]),
    zoneEnemySet: new Map([
      [1, new Set([10])],
      [2, new Set([20])],
    ]),
    enemyArchetypes: new Map([
      [10, { enemyArchetypeId: 10, expCapPerEncounter: 30 }],
      [20, { enemyArchetypeId: 20, expCapPerEncounter: 50 }],
    ]),
    ...overrides,
  };
}

function buildPayload(overrides?: Partial<ApplyBattleSettlementBatchV1Payload>): ApplyBattleSettlementBatchV1Payload {
  return {
    characterId: "char-1",
    batchId: 1,
    startNonce: 1,
    endNonce: 2,
    battleCount: 2,
    startStateHash: "genesis",
    endStateHash: "hash-1",
    expDelta: 60,
    zoneProgressDelta: [{ zoneId: 2, newState: 1 }],
    encounterHistogram: [
      { zoneId: 1, enemyArchetypeId: 10, count: 1 },
      { zoneId: 2, enemyArchetypeId: 20, count: 1 },
    ],
    optionalLoadoutRevision: 7,
    batchHash: "batch-hash",
    attestationSlot: 9_995,
    attestationExpirySlot: 10_100,
    signatureScheme: 0,
    ...overrides,
  };
}

describe("applyBattleSettlementBatchV1", () => {
  it("applies a valid batch and updates cursor/state", () => {
    const context = buildContext();
    const payload = buildPayload();

    const result = applyBattleSettlementBatchV1(payload, context);

    expect(result.cursor.lastCommittedEndNonce).toBe(2);
    expect(result.cursor.lastCommittedBatchId).toBe(1);
    expect(result.cursor.lastCommittedStateHash).toBe("hash-1");
    expect(result.characterRoot.level).toBe(2);
    expect(result.characterRoot.exp).toBe(50);
    expect(result.characterStats.lastRecalcSlot).toBe(10_000);
    expect(result.zoneStates.get(2)).toBe(1);
    expect(result.characterWorldProgress.highestMainZoneUnlocked).toBe(2);
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

  it("rejects exp inflation beyond histogram-derived cap", () => {
    const context = buildContext();
    const payload = buildPayload({ expDelta: 1000 });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_EXP_OVER_CAP/);
  });

  it("rejects out-of-order batch submission", () => {
    const context = buildContext();
    const payload = buildPayload({ startNonce: 2, endNonce: 3 });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_NONCE_GAP/);
  });

  it("rejects locked->cleared when zone policy does not allow it", () => {
    const context = buildContext();
    const payload = buildPayload({
      zoneProgressDelta: [{ zoneId: 2, newState: 2 }],
    });

    expect(() => applyBattleSettlementBatchV1(payload, context)).toThrow(/ERR_ZONE_INVALID_TRANSITION/);
  });
});
