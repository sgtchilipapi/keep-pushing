jest.mock("../engine/battle/battleEngine", () => ({
  generateBattleSeed: jest.fn(),
  simulateBattle: jest.fn(),
}));

jest.mock("../lib/combat/combatSnapshotAssembly", () => ({
  loadCharacterBattleReadyRecord: jest.fn(),
  buildPlayerCombatSnapshotFromCarryover: jest.fn(),
  buildEnemyCombatSnapshot: jest.fn(),
}));

jest.mock("../lib/combat/zoneRunTopologies", () => ({
  getLatestZoneRunTopology: jest.fn(),
  getZoneRunTopology: jest.fn(),
  getZoneNode: jest.fn(),
}));

const prismaMock = {
  activeZoneRun: {
    findByCharacterId: jest.fn(),
    closeWithSummary: jest.fn(),
  },
  zoneRunActionLog: {
    create: jest.fn(),
  },
  characterProvisionalProgress: {
    findByCharacterId: jest.fn(),
  },
  battleRecord: {
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

import {
  generateBattleSeed,
  simulateBattle,
} from "../engine/battle/battleEngine";
import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshotFromCarryover,
  loadCharacterBattleReadyRecord,
} from "../lib/combat/combatSnapshotAssembly";
import {
  getZoneNode,
  getZoneRunTopology,
} from "../lib/combat/zoneRunTopologies";
import { fetchSeasonPolicyAccount } from "../lib/solana/runanaAccounts";
import {
  abandonZoneRun,
  advanceZoneRunSubnode,
} from "../lib/combat/zoneRunService";

function buildActiveRunRecord(): any {
  return {
    id: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 7,
    topologyHash: "hash-7",
    state: "TRAVERSING",
    currentNodeId: "node-a",
    snapshot: {
      runId: "run-1",
      characterId: "character-1",
      zoneId: 2,
      seasonId: 1,
      topologyVersion: 7,
      topologyHash: "hash-7",
      state: "TRAVERSING",
      currentNodeId: "node-a",
      currentSubnodeId: "node-a-s1",
      currentSubnodeOrdinal: 1,
      totalSubnodesTraversed: 0,
      totalSubnodesInRun: 1,
      branchOptions: [],
      enemyAppearanceCounts: {},
      playerCarryover: {
        hp: 1000,
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

function buildClosedRecord(terminalStatus: "FAILED" | "ABANDONED"): any {
  return {
    id: "closed-1",
    zoneRunId: "run-1",
    characterId: "character-1",
    zoneId: 2,
    seasonId: 1,
    topologyVersion: 7,
    topologyHash: "hash-7",
    terminalStatus,
    rewardedBattleCount: 0,
    rewardedEncounterHistogram: {},
    zoneProgressDelta: [],
    closedAt: new Date("2026-04-10T10:00:00.000Z"),
    createdAt: new Date("2026-04-10T10:00:00.000Z"),
    updatedAt: new Date("2026-04-10T10:00:00.000Z"),
  };
}

describe("zoneRunService terminal closure behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_900_000_000),
    });
    prismaMock.characterProvisionalProgress.findByCharacterId.mockResolvedValue({
      id: "progress-1",
      characterId: "character-1",
      highestUnlockedZoneId: 2,
      highestClearedZoneId: 1,
      zoneStates: { "1": 2, "2": 1 },
      createdAt: new Date("2026-04-10T09:00:00.000Z"),
      updatedAt: new Date("2026-04-10T09:00:00.000Z"),
    });
    (getZoneRunTopology as jest.Mock).mockReturnValue({
      zoneId: 2,
      topologyVersion: 7,
      startNodeId: "node-a",
      terminalNodeIds: ["node-a"],
      enemyRules: [{ enemyArchetypeId: 101, maxPerRun: 1 }],
      nodes: [
        {
          nodeId: "node-a",
          subnodes: [{ subnodeId: "node-a-s1", combatChanceBP: 10000 }],
          enemyPool: [{ enemyArchetypeId: 101, weight: 1 }],
          nextNodeIds: [],
        },
      ],
      topologyHash: "hash-7",
      totalSubnodeCount: 1,
    });
    (getZoneNode as jest.Mock).mockImplementation((topology, nodeId) => {
      const node = topology.nodes.find(
        (candidate: { nodeId: string }) => candidate.nodeId === nodeId,
      );
      if (node === undefined) {
        throw new Error(`ERR_UNKNOWN_ZONE_NODE: ${nodeId}`);
      }
      return node;
    });
  });

  it("closes a run as failed after a combat loss and keeps progression empty", async () => {
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(
      buildActiveRunRecord(),
    );
    prismaMock.activeZoneRun.closeWithSummary.mockResolvedValue(
      buildClosedRecord("FAILED"),
    );
    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      createdAt: new Date("2026-04-10T09:00:00.000Z"),
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: null,
      chainCharacterIdHex: null,
      characterRootPubkey: null,
      chainCreationStatus: "NOT_STARTED",
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      activeSkills: ["1001"],
      passiveSkills: ["2001"],
    });
    (generateBattleSeed as jest.Mock).mockReturnValue(77);
    (buildPlayerCombatSnapshotFromCarryover as jest.Mock).mockReturnValue({
      entityId: "character-1",
    });
    (buildEnemyCombatSnapshot as jest.Mock).mockReturnValue({
      entityId: "enemy-101",
    });
    (simulateBattle as jest.Mock).mockReturnValue({
      battleId: "battle-1",
      seed: 77,
      playerInitial: { entityId: "character-1" },
      enemyInitial: { entityId: "enemy-101" },
      playerFinal: {
        entityId: "character-1",
        hp: 0,
        hpMax: 1200,
        atk: 120,
        def: 70,
        spd: 100,
        accuracyBP: 8000,
        evadeBP: 1200,
        activeSkillIds: ["1001"],
        passiveSkillIds: ["2001"],
        initiative: 0,
        cooldowns: {},
        statuses: {},
      },
      enemyFinal: {
        entityId: "enemy-101",
        hp: 100,
        hpMax: 100,
        atk: 50,
        def: 30,
        spd: 40,
        accuracyBP: 8000,
        evadeBP: 500,
        activeSkillIds: ["1001"],
        passiveSkillIds: [],
        initiative: 0,
        cooldowns: {},
        statuses: {},
      },
      events: [{ type: "ROUND_START", round: 1 }],
      winnerEntityId: "enemy-101",
      roundsPlayed: 2,
    });

    const result = await advanceZoneRunSubnode(
      { characterId: "character-1" },
      {
        now: () => new Date("2023-11-14T22:13:20.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ACTIVE_SEASON_ID: "1",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
        },
      },
    );

    expect(getZoneRunTopology).toHaveBeenCalledWith(2, 7);
    expect(prismaMock.battleRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneRunId: "run-1",
        zoneId: 2,
        nodeId: "node-a",
        subnodeId: "node-a-s1",
        enemyArchetypeId: 101,
        rewardEligible: false,
      }),
    );
    expect(prismaMock.activeZoneRun.closeWithSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        summary: expect.objectContaining({
          zoneRunId: "run-1",
          terminalStatus: "FAILED",
          zoneProgressDelta: [],
        }),
        provisionalProgress: null,
      }),
    );
    expect(result).toMatchObject({
      activeRun: null,
      closedRunSummary: {
        zoneRunId: "run-1",
        terminalStatus: "FAILED",
        zoneProgressDelta: [],
      },
      battle: {
        battleId: expect.any(String),
        enemyArchetypeId: 101,
        rewarded: false,
      },
    });
  });

  it("closes a run as abandoned without adding progression", async () => {
    const activeRun = buildActiveRunRecord();
    activeRun.snapshot.state = "POST_BATTLE_PAUSE";
    activeRun.snapshot.lastBattle = {
      battleId: "battle-prev",
      enemyArchetypeId: 101,
      nodeId: "node-a",
      subnodeId: "node-a-s1",
      rewarded: true,
      battleResult: {
        battleId: "battle-prev",
        seed: 33,
        playerInitial: { entityId: "character-1" },
        enemyInitial: { entityId: "enemy-101" },
        playerFinal: {
          entityId: "character-1",
          hp: 600,
          hpMax: 1200,
          atk: 120,
          def: 70,
          spd: 100,
          accuracyBP: 8000,
          evadeBP: 1200,
          activeSkillIds: ["1001"],
          passiveSkillIds: ["2001"],
          initiative: 0,
          cooldowns: {},
          statuses: {},
        },
        enemyFinal: {
          entityId: "enemy-101",
          hp: 0,
          hpMax: 100,
          atk: 50,
          def: 30,
          spd: 40,
          accuracyBP: 8000,
          evadeBP: 500,
          activeSkillIds: ["1001"],
          passiveSkillIds: [],
          initiative: 0,
          cooldowns: {},
          statuses: {},
        },
        events: [],
        winnerEntityId: "character-1",
        roundsPlayed: 1,
      },
    };
    prismaMock.activeZoneRun.findByCharacterId.mockResolvedValue(activeRun);
    prismaMock.activeZoneRun.closeWithSummary.mockResolvedValue(
      buildClosedRecord("ABANDONED"),
    );

    const result = await abandonZoneRun(
      { characterId: "character-1" },
      {
        now: () => new Date("2023-11-14T22:13:20.000Z"),
        env: {
          NODE_ENV: "test",
          RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS: "600",
        },
      },
    );

    expect(prismaMock.zoneRunActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneRunId: "run-1",
        actionType: "ABANDON",
      }),
    );
    expect(prismaMock.activeZoneRun.closeWithSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        summary: expect.objectContaining({
          zoneRunId: "run-1",
          terminalStatus: "ABANDONED",
          zoneProgressDelta: [],
        }),
        provisionalProgress: null,
      }),
    );
    expect(result).toMatchObject({
      activeRun: null,
      closedRunSummary: {
        zoneRunId: "run-1",
        terminalStatus: "ABANDONED",
        zoneProgressDelta: [],
      },
      battle: {
        battleId: "battle-prev",
        rewarded: true,
      },
    });
  });
});
