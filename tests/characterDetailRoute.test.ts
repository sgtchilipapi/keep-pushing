const serviceMock = {
  getCharacterDetail: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  getCharacterDetail: serviceMock.getCharacterDetail,
}));

import { GET } from "../app/api/characters/[characterId]/route";

describe("GET /api/characters/:characterId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the character detail with season context", async () => {
    serviceMock.getCharacterDetail.mockResolvedValue({
      character: {
        characterId: "character-1",
        userId: "user-1",
        name: "Aegis",
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
    });

    const response = await GET(
      new Request("http://localhost/api/characters/character-1?userId=user-1"),
      { params: { characterId: "character-1" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.character.characterId).toBe("character-1");
    expect(json.season.seasonName).toBe("Season 1");
  });
});
