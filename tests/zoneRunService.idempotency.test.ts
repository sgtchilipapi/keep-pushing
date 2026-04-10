const prismaMock = {
  activeZoneRun: {
    findByCharacterId: jest.fn(),
    closeWithSummary: jest.fn(),
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
import { abandonZoneRun } from "../lib/combat/zoneRunService";

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
        hp: 900,
        hpMax: 1200,
        cooldowns: {},
        statuses: {},
      },
      lastBattle: {
        battleId: "battle-prev",
        enemyArchetypeId: 101,
        nodeId: "z2-exit",
        subnodeId: "z2-exit-s1",
        rewarded: true,
        battleResult: {
          battleId: "battle-prev",
          seed: 12,
          playerInitial: { entityId: "character-1" },
          enemyInitial: { entityId: "enemy-101" },
          playerFinal: null,
          enemyFinal: null,
          events: [],
          winnerEntityId: "character-1",
          roundsPlayed: 1,
        },
      },
    },
    createdAt: new Date("2026-04-10T09:30:00.000Z"),
    updatedAt: new Date("2026-04-10T09:59:30.000Z"),
  };
}

function buildClosedSummary(): any {
  return {
    id: "closed-1",
    zoneRunId: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 1,
    topologyHash: "hash-1",
    terminalStatus: "ABANDONED",
    rewardedBattleCount: 1,
    rewardedEncounterHistogram: { "101": 1 },
    zoneProgressDelta: [],
    closedAt: new Date("2026-04-10T10:00:00.000Z"),
    createdAt: new Date("2026-04-10T10:00:00.000Z"),
    updatedAt: new Date("2026-04-10T10:00:00.000Z"),
  };
}

describe("zoneRunService idempotent mutations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_900_000_000),
    });
  });

  it("replays the stored response for a repeated request key", async () => {
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(buildActiveRunRecord());
    prismaMock.activeZoneRun.closeWithSummary.mockResolvedValue(buildClosedSummary());
    prismaMock.zoneRunMutationDedup.findByCharacterIdAndRequestKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "dedup-1",
        characterId: "character-1",
        requestKey: "req-1",
        actionType: "ABANDON",
        response: {
          activeRun: null,
          closedRunSummary: {
            zoneRunId: "run-1",
            characterId: "character-1",
            zoneId: 2,
            seasonId: 1,
            topologyVersion: 1,
            topologyHash: "hash-1",
            terminalStatus: "ABANDONED",
            rewardedBattleCount: 1,
            rewardedEncounterHistogram: { "101": 1 },
            zoneProgressDelta: [],
            closedAt: "2026-04-10T10:00:00.000Z",
          },
          battle: {
            battleId: "battle-prev",
            enemyArchetypeId: 101,
            nodeId: "z2-exit",
            subnodeId: "z2-exit-s1",
            rewarded: true,
            battleResult: {
              battleId: "battle-prev",
              seed: 12,
              playerInitial: { entityId: "character-1" },
              enemyInitial: { entityId: "enemy-101" },
              playerFinal: null,
              enemyFinal: null,
              events: [],
              winnerEntityId: "character-1",
              roundsPlayed: 1,
            },
          },
        },
        createdAt: new Date("2026-04-10T10:00:00.000Z"),
        updatedAt: new Date("2026-04-10T10:00:00.000Z"),
      });
    prismaMock.zoneRunMutationDedup.create.mockResolvedValue({
      id: "dedup-1",
    });

    const first = await abandonZoneRun(
      { characterId: "character-1", requestKey: "req-1" },
      {
        now: () => new Date("2023-11-14T22:13:20.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
        },
      },
    );
    const second = await abandonZoneRun(
      { characterId: "character-1", requestKey: "req-1" },
      {
        now: () => new Date("2023-11-14T22:13:25.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
        },
      },
    );

    expect(first.closedRunSummary?.terminalStatus).toBe("ABANDONED");
    expect(second).toEqual(first);
    expect(prismaMock.zoneRunActionLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.activeZoneRun.closeWithSummary).toHaveBeenCalledTimes(1);
    expect(prismaMock.zoneRunMutationDedup.create).toHaveBeenCalledTimes(1);
  });
});
