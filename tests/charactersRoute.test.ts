const serviceMock = {
  getCharacterRoster: jest.fn(),
  createPlayableCharacter: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  getCharacterRoster: serviceMock.getCharacterRoster,
  createPlayableCharacter: serviceMock.createPlayableCharacter,
}));

import { GET, POST } from "../app/api/characters/route";

describe("GET /api/characters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the roster", async () => {
    serviceMock.getCharacterRoster.mockResolvedValue({
      accountMode: "anon",
      slotsTotal: 1,
      characters: [
        {
          characterId: "character-1",
          name: "Aegis",
          classId: "soldier",
          slotIndex: 0,
          level: 1,
          syncStatus: "LOCAL_ONLY",
        },
      ],
    });

    const response = await GET(
      new Request("http://localhost/api/characters?userId=user-1"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.accountMode).toBe("anon");
    expect(json.characters[0].name).toBe("Aegis");
  });
});

describe("POST /api/characters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a playable character", async () => {
    serviceMock.createPlayableCharacter.mockResolvedValue({
      characterId: "character-1",
      userId: "user-1",
      name: "Aegis",
      classId: "soldier",
      slotIndex: 0,
      level: 1,
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
    });

    const response = await POST(
      new Request("http://localhost/api/characters", {
        method: "POST",
        body: JSON.stringify({
          userId: "user-1",
          name: "Aegis",
          classId: "soldier",
          slotIndex: 0,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.characterId).toBe("character-1");
  });
});
