const serviceMock = {
  createPlayableCharacter: jest.fn(),
};
const authMock = {
  requireSession: jest.fn(),
};

jest.mock("../lib/characterAppService", () => ({
  createPlayableCharacter: serviceMock.createPlayableCharacter,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSession: authMock.requireSession,
  };
});

import { POST } from "../app/api/character/create/route";

describe("POST /api/character/create", () => {
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
    serviceMock.createPlayableCharacter.mockResolvedValue({
      characterId: "character-1",
      userId: "user-1",
      name: "Alpha One",
      classId: "soldier",
      slotIndex: 0,
      level: 1,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
    });
  });

  it("creates a character through the app service", async () => {
    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
          name: "  Alpha   One ",
          classId: "Soldier",
          slotIndex: 0,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(serviceMock.createPlayableCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        name: "  Alpha   One ",
        classId: "Soldier",
        slotIndex: 0,
      }),
    );
    expect(json.classId).toBe("soldier");
    expect(json.slotIndex).toBe(0);
  });

  it("rejects malformed payloads before calling the service", async () => {
    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/name is required/i);
    expect(serviceMock.createPlayableCharacter).not.toHaveBeenCalled();
  });

  it("maps character service conflicts to 409", async () => {
    serviceMock.createPlayableCharacter.mockRejectedValueOnce(
      new Error("ERR_CHARACTER_SLOT_TAKEN: slot already occupied"),
    );

    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
          name: "Alpha One",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe("ERR_CHARACTER_SLOT_TAKEN: slot already occupied");
  });
});
