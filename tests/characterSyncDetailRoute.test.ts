const serviceMock = {
  getCharacterSyncDetail: jest.fn(),
};
const authMock = {
  requireSessionCharacterAccess: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  getCharacterSyncDetail: serviceMock.getCharacterSyncDetail,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSessionCharacterAccess: authMock.requireSessionCharacterAccess,
  };
});

import { GET } from "../app/api/characters/[characterId]/sync/route";

describe("GET /api/characters/:characterId/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSessionCharacterAccess.mockResolvedValue({
      user: { id: "user-1", primaryWalletAddress: "wallet-1" },
    });
  });

  it("returns the sync detail payload", async () => {
    serviceMock.getCharacterSyncDetail.mockResolvedValue({
      character: {
        characterId: "character-1",
        userId: "user-1",
        name: "Aegis",
        classId: "soldier",
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
        provisionalProgress: null,
        latestBattle: null,
        nextSettlementBatch: null,
        activeZoneRun: null,
        latestClosedZoneRun: null,
      },
      season: {
        seasonId: 1,
        seasonNumber: 1,
        seasonName: "Season 1",
        seasonStartTs: 1700000000,
        seasonEndTs: 1700600000,
        commitGraceEndTs: 1700700000,
        phase: "active",
      },
      sync: {
        mode: "first_sync",
        pendingBatchId: null,
        pendingBatchNumber: null,
        attempts: [],
      },
    });

    const response = await GET(
      new Request("http://localhost/api/characters/character-1/sync"),
      { params: { characterId: "character-1" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(serviceMock.getCharacterSyncDetail).toHaveBeenCalledWith(
      "character-1",
      "user-1",
    );
    expect(json.character.characterId).toBe("character-1");
    expect(json.sync.mode).toBe("first_sync");
  });
});
