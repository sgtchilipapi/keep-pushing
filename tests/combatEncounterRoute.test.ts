jest.mock("../lib/combat/realEncounter", () => ({
  executeRealEncounter: jest.fn(),
}));
const authMock = {
  requireSessionCharacterAccess: jest.fn(),
};
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSessionCharacterAccess: authMock.requireSessionCharacterAccess,
  };
});

import { POST } from "../app/api/combat/encounter/route";
import { executeRealEncounter } from "../lib/combat/realEncounter";

async function postEncounter(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/combat/encounter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/combat/encounter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSessionCharacterAccess.mockResolvedValue({
      user: { id: "user-1", primaryWalletAddress: "wallet-1" },
    });
  });

  it("returns the persisted real encounter payload", async () => {
    (executeRealEncounter as jest.Mock).mockResolvedValue({
      battleId: "battle-1",
      characterId: "character-1",
      zoneId: 2,
      enemyArchetypeId: 100,
      seed: 77,
      battleNonce: 5,
      seasonId: 1,
      battleTs: 1_700_000_100,
      settlementStatus: "PENDING",
      battleResult: {
        battleId: "battle-1",
        seed: 77,
        playerInitial: { entityId: "character-1" },
        enemyInitial: { entityId: "100" },
        events: [],
        winnerEntityId: "character-1",
        roundsPlayed: 3,
      },
    });

    const response = await postEncounter({
      characterId: "character-1",
      zoneId: 2,
    });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(authMock.requireSessionCharacterAccess).toHaveBeenCalledWith(
      expect.any(Request),
      "character-1",
    );
    expect(executeRealEncounter).toHaveBeenCalledWith({
      characterId: "character-1",
      zoneId: 2,
    });
    expect(json.characterId).toBe("character-1");
    expect(json.seed).toBe(77);
    expect(json.settlementStatus).toBe("PENDING");
  });

  it("passes through local-first backlog encounters", async () => {
    (executeRealEncounter as jest.Mock).mockResolvedValue({
      battleId: "battle-2",
      characterId: "character-1",
      zoneId: 2,
      enemyArchetypeId: 100,
      seed: 88,
      battleNonce: 6,
      seasonId: 1,
      battleTs: 1_700_000_101,
      settlementStatus: "AWAITING_FIRST_SYNC",
      battleResult: {
        battleId: "battle-2",
        seed: 88,
        playerInitial: { entityId: "character-1" },
        enemyInitial: { entityId: "100" },
        events: [],
        winnerEntityId: "character-1",
        roundsPlayed: 3,
      },
    });

    const response = await postEncounter({
      characterId: "character-1",
      zoneId: 2,
    });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.settlementStatus).toBe("AWAITING_FIRST_SYNC");
  });

  it("rejects malformed payloads before hitting the service", async () => {
    const response = await postEncounter({
      characterId: "",
      zoneId: "2",
    });

    expect(response.status).toBe(400);
    expect(executeRealEncounter).not.toHaveBeenCalled();
  });

  it("maps service domain errors to conflict responses", async () => {
    (executeRealEncounter as jest.Mock).mockRejectedValue(
      new Error(
        "ERR_INITIAL_SETTLEMENT_REQUIRED: initial settlement required before new battles",
      ),
    );

    const response = await postEncounter({
      characterId: "character-1",
      zoneId: 2,
    });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toMatch(/ERR_INITIAL_SETTLEMENT_REQUIRED/);
  });
});
