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
import { getActiveZoneRun } from "../lib/combat/zoneRunService";

function buildActiveRunRecord(updatedAt: string) {
  return {
    id: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 1,
    topologyHash: "hash-1",
    state: "TRAVERSING",
    currentNodeId: "z2-entry",
    snapshot: {
      runId: "run-1",
      characterId: "character-1",
      zoneId: 2,
      seasonId: 1,
      topologyVersion: 1,
      topologyHash: "hash-1",
      state: "TRAVERSING",
      currentNodeId: "z2-entry",
      currentSubnodeId: "z2-entry-s1",
      currentSubnodeOrdinal: 1,
      totalSubnodesTraversed: 0,
      totalSubnodesInRun: 8,
      branchOptions: [],
      enemyAppearanceCounts: { "101": 1 },
      playerCarryover: {
        hp: 1000,
        hpMax: 1200,
        cooldowns: {},
        statuses: {},
      },
      lastBattle: null,
    },
    createdAt: new Date("2026-04-10T09:30:00.000Z"),
    updatedAt: new Date(updatedAt),
  };
}

function buildClosedRecord(terminalStatus: "EXPIRED" | "SEASON_CUTOFF") {
  return {
    id: "closed-1",
    zoneRunId: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 1,
    topologyHash: "hash-1",
    terminalStatus,
    rewardedBattleCount: 1,
    rewardedEncounterHistogram: { "101": 1 },
    zoneProgressDelta: [],
    closedAt: new Date("2026-04-10T10:00:00.000Z"),
    createdAt: new Date("2026-04-10T10:00:00.000Z"),
    updatedAt: new Date("2026-04-10T10:00:00.000Z"),
  };
}

describe("zoneRunService auto-close behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("auto-closes an idle run as expired", async () => {
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(
      buildActiveRunRecord("2026-04-10T09:58:00.000Z"),
    );
    prismaMock.activeZoneRun.closeWithSummary.mockResolvedValue(
      buildClosedRecord("EXPIRED"),
    );

    const result = await getActiveZoneRun(
      { characterId: "character-1" },
      {
        now: () => new Date("2026-04-10T10:00:01.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "60",
        },
      },
    );

    expect(result).toMatchObject({
      activeRun: null,
      closedRunSummary: {
        zoneRunId: "run-1",
        terminalStatus: "EXPIRED",
        rewardedBattleCount: 1,
      },
      battle: null,
    });
    expect(prismaMock.zoneRunActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneRunId: "run-1",
        actionType: "EXPIRE",
      }),
    );
    expect(prismaMock.activeZoneRun.closeWithSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        summary: expect.objectContaining({
          zoneRunId: "run-1",
          terminalStatus: "EXPIRED",
          zoneProgressDelta: [],
        }),
        provisionalProgress: null,
      }),
    );
    expect(fetchSeasonPolicyAccount).not.toHaveBeenCalled();
  });

  it("auto-closes an active run when its bound season has ended", async () => {
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(
      buildActiveRunRecord("2026-04-10T09:59:45.000Z"),
    );
    prismaMock.activeZoneRun.closeWithSummary.mockResolvedValue(
      buildClosedRecord("SEASON_CUTOFF"),
    );
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_700_000_010),
    });

    const result = await getActiveZoneRun(
      { characterId: "character-1" },
      {
        now: () => new Date("2023-11-14T22:13:31.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
        },
      },
    );

    expect(result).toMatchObject({
      activeRun: null,
      closedRunSummary: {
        zoneRunId: "run-1",
        terminalStatus: "SEASON_CUTOFF",
        rewardedBattleCount: 1,
      },
      battle: null,
    });
    expect(fetchSeasonPolicyAccount).toHaveBeenCalledTimes(1);
    expect(prismaMock.zoneRunActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneRunId: "run-1",
        actionType: "SEASON_CUTOFF",
      }),
    );
    expect(prismaMock.activeZoneRun.closeWithSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        summary: expect.objectContaining({
          zoneRunId: "run-1",
          terminalStatus: "SEASON_CUTOFF",
          zoneProgressDelta: [],
        }),
        provisionalProgress: null,
      }),
    );
  });
});
