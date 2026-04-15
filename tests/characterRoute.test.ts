const serviceMock = {
  getFirstCharacterDetailForUser: jest.fn(),
};
const authMock = {
  requireSession: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  getFirstCharacterDetailForUser: serviceMock.getFirstCharacterDetailForUser,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSession: authMock.requireSession,
  };
});

import { GET } from "../app/api/character/route";

describe("GET /api/character", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSession.mockResolvedValue({
      session: {
        id: "session-1",
        userId: "user-1",
        walletAddress: "wallet-1",
        expiresAt: new Date("2026-05-01T00:00:00.000Z"),
        revokedAt: null,
      },
      user: {
        id: "user-1",
        primaryWalletAddress: "wallet-1",
      },
    });
  });

  it("returns the character with chain and sync details", async () => {
    serviceMock.getFirstCharacterDetailForUser.mockResolvedValue({
      characterId: "character-1",
      userId: "user-1",
      name: "Rookie",
      classId: "soldier",
      slotIndex: 0,
      chainBootstrapReady: true,
      level: 1,
      exp: 0,
      syncPhase: "CREATING_ON_CHAIN",
      battleEligible: false,
      hp: 1200,
      stats: {
        hp: 1200,
        hpMax: 1200,
        atk: 120,
        def: 70,
        spd: 100,
        accuracyBP: 8000,
        evadeBP: 1200,
      },
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
      unlockedSkillIds: ["1001", "1002"],
      inventory: [],
      chain: {
        playerAuthorityPubkey: "authority",
        chainCharacterIdHex: "11".repeat(16),
        characterRootPubkey: "root",
        chainCreationStatus: "PENDING",
        chainCreationTxSignature: null,
        chainCreatedAt: null,
        chainCreationTs: 1700000000,
        chainCreationSeasonId: 1,
        cursor: null,
      },
      provisionalProgress: {
        highestUnlockedZoneId: 2,
        highestClearedZoneId: 1,
        zoneStates: { "1": 2, "2": 1 },
      },
      latestBattle: {
        battleId: "battle-1",
        localSequence: 3,
        battleNonce: null,
        battleTs: 1700000100,
        seasonId: 1,
        zoneId: 2,
        enemyArchetypeId: 104,
        settlementStatus: "AWAITING_FIRST_SYNC",
        sealedBatchId: null,
        committedAt: null,
      },
      nextSettlementBatch: {
        settlementBatchId: "batch-1",
        batchId: 1,
        startNonce: 1,
        endNonce: 3,
        battleCount: 3,
        firstBattleTs: 1700000001,
        lastBattleTs: 1700000100,
        seasonId: 1,
        status: "SEALED",
        latestTransactionSignature: null,
        failureCategory: null,
        failureCode: null,
      },
      nextPendingSettlementRun: {
        zoneRunId: "run-1",
        closedRunSequence: 8,
        zoneId: 2,
        seasonId: 1,
        rewardedBattleCount: 3,
        closedAt: "2026-04-13T00:00:00.000Z",
      },
      pendingSettlementRunCount: 4,
      activeZoneRun: null,
      latestClosedZoneRun: null,
    });

    const response = await GET(
      new Request("http://localhost/api/character"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(serviceMock.getFirstCharacterDetailForUser).toHaveBeenCalledWith(
      "user-1",
    );
    expect(json.character.characterId).toBe("character-1");
    expect(json.character.chain.chainCreationStatus).toBe("PENDING");
    expect(json.character.syncPhase).toBe("CREATING_ON_CHAIN");
    expect(json.character.battleEligible).toBe(false);
    expect(json.character.provisionalProgress.highestUnlockedZoneId).toBe(2);
    expect(json.character.latestBattle.settlementStatus).toBe(
      "AWAITING_FIRST_SYNC",
    );
    expect(json.character.nextPendingSettlementRun.closedRunSequence).toBe(8);
    expect(json.character.pendingSettlementRunCount).toBe(4);
    expect(json.character.activeZoneRun).toBeNull();
    expect(json.character.latestClosedZoneRun).toBeNull();
  });

  it("returns null when the user has no character", async () => {
    serviceMock.getFirstCharacterDetailForUser.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/character"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ character: null });
  });

  it("keeps local-only characters battle eligible while backlog waits for first sync settlement", async () => {
    serviceMock.getFirstCharacterDetailForUser.mockResolvedValue({
      characterId: "character-1",
      userId: "user-1",
      name: "Rookie",
      classId: "soldier",
      slotIndex: 0,
      chainBootstrapReady: true,
      level: 1,
      exp: 0,
      syncPhase: "LOCAL_ONLY",
      battleEligible: true,
      stats: {
        hp: 1200,
        hpMax: 1200,
        atk: 120,
        def: 70,
        spd: 100,
        accuracyBP: 8000,
        evadeBP: 1200,
      },
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
      unlockedSkillIds: ["1001", "1002"],
      inventory: [],
      chain: null,
      provisionalProgress: {
        highestUnlockedZoneId: 2,
        highestClearedZoneId: 1,
        zoneStates: { "1": 2, "2": 1 },
      },
      latestBattle: {
        battleId: "battle-1",
        localSequence: 1,
        battleNonce: null,
        battleTs: 1700000100,
        seasonId: 1,
        zoneId: 2,
        enemyArchetypeId: 104,
        settlementStatus: "AWAITING_FIRST_SYNC",
        sealedBatchId: null,
        committedAt: null,
      },
      nextSettlementBatch: null,
      nextPendingSettlementRun: {
        zoneRunId: "run-1",
        closedRunSequence: 1,
        zoneId: 2,
        seasonId: 1,
        rewardedBattleCount: 1,
        closedAt: "2026-04-13T00:00:00.000Z",
      },
      pendingSettlementRunCount: 1,
      activeZoneRun: null,
      latestClosedZoneRun: null,
    });

    const response = await GET(
      new Request("http://localhost/api/character"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.character.syncPhase).toBe("LOCAL_ONLY");
    expect(json.character.battleEligible).toBe(true);
    expect(json.character.latestBattle.settlementStatus).toBe(
      "AWAITING_FIRST_SYNC",
    );
    expect(json.character.nextPendingSettlementRun.zoneRunId).toBe("run-1");
    expect(json.character.pendingSettlementRunCount).toBe(1);
  });
});
