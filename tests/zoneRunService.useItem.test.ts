const prismaMock = {
  activeZoneRun: {
    findByCharacterId: jest.fn(),
    closeWithSummary: jest.fn(),
  },
  zoneRunActionLog: {
    create: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

jest.mock("../lib/solana/runanaAccounts", () => ({
  fetchSeasonPolicyAccount: jest.fn(),
  fetchCharacterWorldProgressAccount: jest.fn(),
}));

jest.mock("../lib/solana/runanaClient", () => ({
  createRunanaConnection: jest.fn(() => ({})),
  resolveRunanaCommitment: jest.fn(() => "confirmed"),
  resolveRunanaProgramId: jest.fn(() => "program-id"),
}));

jest.mock("../lib/solana/runanaProgram", () => ({
  deriveSeasonPolicyPda: jest.fn(() => "season-policy-pda"),
  deriveCharacterWorldProgressPda: jest.fn(() => "world-progress-pda"),
}));

import { fetchSeasonPolicyAccount } from "../lib/solana/runanaAccounts";
import { useZoneRunConsumableItem } from "../lib/combat/zoneRunService";

function buildActiveRunRecord(): any {
  return {
    id: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 1,
    topologyHash: "hash-1",
    state: "POST_BATTLE_PAUSE",
    currentNodeId: "z2-exit",
    snapshot: {
      runId: "run-1",
      characterId: "character-1",
      zoneId: 2,
      seasonId: 1,
      topologyVersion: 1,
      topologyHash: "hash-1",
      state: "POST_BATTLE_PAUSE",
      currentNodeId: "z2-exit",
      currentSubnodeId: "z2-exit-s1",
      currentSubnodeOrdinal: 1,
      totalSubnodesTraversed: 4,
      totalSubnodesInRun: 8,
      branchOptions: [],
      enemyAppearanceCounts: { "101": 1 },
      playerCarryover: {
        hp: 950,
        hpMax: 1200,
        cooldowns: {},
        statuses: {},
      },
      lastBattle: null,
    },
    createdAt: new Date("2026-04-10T09:30:00.000Z"),
    updatedAt: new Date("2026-04-10T09:59:30.000Z"),
  };
}

describe("zoneRunService consumable item rejection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(buildActiveRunRecord());
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_900_000_000),
    });
  });

  it("rejects consumable item use while a run is active", async () => {
    await expect(
      useZoneRunConsumableItem(
        { characterId: "character-1", itemId: "potion" },
        {
          now: () => new Date("2023-11-14T22:13:20.000Z"),
          env: {
            NODE_ENV: "test",
            RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
          },
        },
      ),
    ).rejects.toThrow(
      "ERR_ZONE_RUN_ITEMS_UNSUPPORTED: consumable item potion is not supported during zone runs",
    );
  });
});
