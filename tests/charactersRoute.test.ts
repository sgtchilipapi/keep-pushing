const serviceMock = {
  getCharacterRoster: jest.fn(),
  createPlayableCharacter: jest.fn(),
};
const authMock = {
  requireSession: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  getCharacterRoster: serviceMock.getCharacterRoster,
  createPlayableCharacter: serviceMock.createPlayableCharacter,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSession: authMock.requireSession,
  };
});

import { GET, POST } from "../app/api/characters/route";
import { SessionRequiredError } from "../lib/auth/requireSession";

describe("GET /api/characters", () => {
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

  it("returns the roster", async () => {
    serviceMock.getCharacterRoster.mockResolvedValue({
      accountMode: "wallet-linked",
      slotsTotal: 3,
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
      new Request("http://localhost/api/characters"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(serviceMock.getCharacterRoster).toHaveBeenCalledWith("user-1");
    expect(json.accountMode).toBe("wallet-linked");
    expect(json.characters[0].name).toBe("Aegis");
  });

  it("rejects requests without an active session", async () => {
    authMock.requireSession.mockRejectedValueOnce(new SessionRequiredError());

    const response = await GET(new Request("http://localhost/api/characters"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toMatch(/ERR_AUTH_SESSION_REQUIRED/);
    expect(serviceMock.getCharacterRoster).not.toHaveBeenCalled();
  });
});

describe("POST /api/characters", () => {
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
          name: "Aegis",
          classId: "soldier",
          slotIndex: 0,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(serviceMock.createPlayableCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        name: "Aegis",
        classId: "soldier",
        slotIndex: 0,
      }),
    );
    expect(json.characterId).toBe("character-1");
  });
});
