jest.mock("../engine/battle/skillRegistry", () => ({
  getSkillDef: jest.fn(() => ({})),
}));

jest.mock("../engine/battle/passiveRegistry", () => ({
  getPassiveDef: jest.fn(() => ({})),
}));

const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
  characterNameReservation: {
    createHold: jest.fn(),
    release: jest.fn(),
  },
  character: {
    create: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

import { POST } from "../app/api/character/create/route";

describe("POST /api/character/create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.characterNameReservation.createHold.mockResolvedValue({
      id: "reservation-1",
    });
    prismaMock.character.create.mockResolvedValue({
      id: "character-1",
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

  it("creates a character with reserved name, normalized class, and slot", async () => {
    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
          userId: "user-1",
          name: "  Alpha   One ",
          classId: "Soldier",
          slotIndex: 0,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(prismaMock.characterNameReservation.createHold).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        displayName: "Alpha One",
        normalizedName: "alpha one",
      }),
    );
    expect(prismaMock.character.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alpha One",
        nameNormalized: "alpha one",
        classId: "soldier",
        slotIndex: 0,
        chainBootstrapReady: true,
        nameReservationId: "reservation-1",
      }),
    );
    expect(json.classId).toBe("soldier");
    expect(json.slotIndex).toBe(0);
  });

  it("rejects invalid names before reserving", async () => {
    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
          userId: "user-1",
          name: "!!",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/ERR_CHARACTER_NAME_/);
    expect(prismaMock.characterNameReservation.createHold).not.toHaveBeenCalled();
  });

  it("releases the reservation when creation fails after reserving", async () => {
    prismaMock.character.create.mockRejectedValueOnce(
      new Error("ERR_SLOT_TAKEN: slot already occupied"),
    );

    const response = await POST(
      new Request("http://localhost/api/character/create", {
        method: "POST",
        body: JSON.stringify({
          userId: "user-1",
          name: "Alpha One",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("ERR_SLOT_TAKEN: slot already occupied");
    expect(prismaMock.characterNameReservation.release).toHaveBeenCalledWith(
      "reservation-1",
    );
  });
});
