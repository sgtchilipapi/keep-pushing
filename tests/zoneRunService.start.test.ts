jest.mock("../lib/combat/combatSnapshotAssembly", () => ({
  loadCharacterBattleReadyRecord: jest.fn(),
}));

jest.mock("../lib/combat/zoneRunTopologies", () => ({
  getLatestZoneRunTopology: jest.fn(),
}));

const prismaMock = {
  activeZoneRun: {
    findByCharacterId: jest.fn(),
    create: jest.fn(),
  },
  closedZoneRunSummary: {
    listNextSettleableForCharacter: jest.fn(),
  },
  zoneRunActionLog: {
    create: jest.fn(),
  },
  zoneRunMutationDedup: {
    findByCharacterIdAndRequestKey: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

import { loadCharacterBattleReadyRecord } from "../lib/combat/combatSnapshotAssembly";
import { startZoneRun } from "../lib/combat/zoneRunService";

describe("zoneRunService start queue enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(null);
    prismaMock.zoneRunMutationDedup.findByCharacterIdAndRequestKey.mockResolvedValue(
      null,
    );
    prismaMock.closedZoneRunSummary.listNextSettleableForCharacter.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        zoneRunId: `run-${index + 1}`,
        closedRunSequence: index + 1,
      })),
    );
  });

  it("rejects start when 10 pending settlement runs already exist", async () => {
    await expect(
      startZoneRun({
        characterId: "character-1",
        zoneId: 2,
        requestKey: "req-1",
      }),
    ).rejects.toThrow("ERR_ZONE_RUN_SETTLEMENT_QUEUE_FULL");

    expect(prismaMock.closedZoneRunSummary.listNextSettleableForCharacter).toHaveBeenCalledWith(
      "character-1",
      10,
    );
    expect(loadCharacterBattleReadyRecord).not.toHaveBeenCalled();
    expect(prismaMock.activeZoneRun.create).not.toHaveBeenCalled();
    expect(prismaMock.zoneRunMutationDedup.create).not.toHaveBeenCalled();
  });
});
