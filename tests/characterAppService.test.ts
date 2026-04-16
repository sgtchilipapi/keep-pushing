const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
  character: {
    listByUserId: jest.fn(),
    create: jest.fn(),
  },
  characterNameReservation: {
    createHold: jest.fn(),
    release: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  createPlayableCharacter,
  getCharacterRoster,
} from "../lib/characterAppService";

describe("characterAppService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
  });

  it("returns an anon roster summary with one slot", async () => {
    prismaMock.character.listByUserId.mockResolvedValue([
      {
        id: "character-1",
        userId: "user-1",
        name: "Aegis",
        nameNormalized: "aegis",
        classId: "soldier",
        slotIndex: 0,
        chainBootstrapReady: true,
        level: 2,
        exp: 120,
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
      },
    ]);

    await expect(getCharacterRoster("user-1")).resolves.toEqual({
      accountMode: "anon",
      slotsTotal: 1,
      characters: [
        {
          characterId: "character-1",
          name: "Aegis",
          classId: "soldier",
          slotIndex: 0,
          level: 2,
          syncStatus: "LOCAL_ONLY",
        },
      ],
    });
  });

  it("creates a local-first playable character with reserved unique name and class", async () => {
    prismaMock.character.listByUserId.mockResolvedValue([]);
    prismaMock.characterNameReservation.createHold.mockResolvedValue({
      id: "reservation-1",
    });
    prismaMock.character.create.mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Aegis",
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

    const created = await createPlayableCharacter({
      userId: "user-1",
      name: "  Aegis  ",
      classId: "Soldier",
      slotIndex: 0,
    });

    expect(prismaMock.characterNameReservation.createHold).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        displayName: "Aegis",
        normalizedName: "aegis",
      }),
    );
    expect(prismaMock.character.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        name: "Aegis",
        nameNormalized: "aegis",
        classId: "soldier",
        slotIndex: 0,
        chainBootstrapReady: true,
        nameReservationId: "reservation-1",
      }),
    );
    expect(created.classId).toBe("soldier");
    expect(created.slotIndex).toBe(0);
  });

  it("rejects creating a second anon character once the only slot is occupied", async () => {
    prismaMock.character.listByUserId.mockResolvedValue([
      {
        id: "character-1",
        userId: "user-1",
        name: "Aegis",
        nameNormalized: "aegis",
        classId: "soldier",
        slotIndex: 0,
        chainBootstrapReady: true,
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
      },
    ]);

    await expect(
      createPlayableCharacter({
        userId: "user-1",
        name: "Nova",
        classId: "scout",
        slotIndex: 0,
      }),
    ).rejects.toThrow(/ERR_CHARACTER_SLOTS_FULL/);
    expect(prismaMock.character.create).not.toHaveBeenCalled();
  });
});
