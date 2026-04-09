const prismaMock = {
  character: {
    findByUserId: jest.fn(),
    findChainState: jest.fn(),
  },
  characterProvisionalProgress: {
    findByCharacterId: jest.fn(),
  },
  battleOutcomeLedger: {
    findLatestForCharacter: jest.fn(),
  },
  settlementBatch: {
    findNextUnconfirmedForCharacter: jest.fn(),
  },
  activeZoneRun: {
    findByCharacterId: jest.fn(),
  },
  closedZoneRunSummary: {
    findLatestForCharacter: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

import { GET } from "../app/api/character/route";

describe("GET /api/character", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the character with chain and sync details", async () => {
    prismaMock.character.findByUserId.mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      level: 1,
      exp: 0,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
      unlockedSkillIds: ["1001", "1002"],
      inventory: [],
    });
    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: "authority",
      chainCharacterIdHex: "11".repeat(16),
      characterRootPubkey: "root",
      chainCreationStatus: "PENDING",
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: 1700000000,
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.characterProvisionalProgress.findByCharacterId.mockResolvedValue(
      {
        characterId: "character-1",
        highestUnlockedZoneId: 2,
        highestClearedZoneId: 1,
        zoneStates: { "1": 2, "2": 1 },
      },
    );
    prismaMock.battleOutcomeLedger.findLatestForCharacter.mockResolvedValue({
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
    });
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(
      {
        id: "batch-1",
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
    );
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(null);
    prismaMock.closedZoneRunSummary.findLatestForCharacter.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/character?userId=user-1"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.character.characterId).toBe("character-1");
    expect(json.character.chain.chainCreationStatus).toBe("PENDING");
    expect(json.character.syncPhase).toBe("CREATING_ON_CHAIN");
    expect(json.character.battleEligible).toBe(false);
    expect(json.character.provisionalProgress.highestUnlockedZoneId).toBe(2);
    expect(json.character.latestBattle.settlementStatus).toBe(
      "AWAITING_FIRST_SYNC",
    );
    expect(json.character.nextSettlementBatch.batchId).toBe(1);
    expect(json.character.activeZoneRun).toBeNull();
    expect(json.character.latestClosedZoneRun).toBeNull();
  });

  it("returns null when the user has no character", async () => {
    prismaMock.character.findByUserId.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/character?userId=user-1"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ character: null });
    expect(prismaMock.character.findChainState).not.toHaveBeenCalled();
  });

  it("keeps local-only characters battle eligible while backlog waits for first sync settlement", async () => {
    prismaMock.character.findByUserId.mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      level: 1,
      exp: 0,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
      unlockedSkillIds: ["1001", "1002"],
      inventory: [],
    });
    prismaMock.character.findChainState.mockResolvedValue(null);
    prismaMock.characterProvisionalProgress.findByCharacterId.mockResolvedValue(
      {
        characterId: "character-1",
        highestUnlockedZoneId: 2,
        highestClearedZoneId: 1,
        zoneStates: { "1": 2, "2": 1 },
      },
    );
    prismaMock.battleOutcomeLedger.findLatestForCharacter.mockResolvedValue({
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
    });
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(
      null,
    );
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(null);
    prismaMock.closedZoneRunSummary.findLatestForCharacter.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/character?userId=user-1"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.character.syncPhase).toBe("LOCAL_ONLY");
    expect(json.character.battleEligible).toBe(true);
    expect(json.character.latestBattle.settlementStatus).toBe(
      "AWAITING_FIRST_SYNC",
    );
  });
});
