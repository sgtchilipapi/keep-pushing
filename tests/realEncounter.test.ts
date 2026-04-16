jest.mock("../lib/combat/combatSnapshotAssembly", () => ({
  loadCharacterBattleReadyRecord: jest.fn(),
  buildPlayerCombatSnapshot: jest.fn(),
  buildEnemyCombatSnapshot: jest.fn(),
}));

jest.mock("../lib/combat/encounterSelection", () => ({
  selectEncounterForZone: jest.fn(),
}));

jest.mock("../engine/battle/battleEngine", () => ({
  generateBattleSeed: jest.fn(),
  simulateBattle: jest.fn(),
}));

const prismaMock = {
  battleRecord: {
    allocateNonceAndCreateWithSettlementLedger: jest.fn(),
    createAwaitingFirstSyncWithProgress: jest.fn(),
  },
  battleOutcomeLedger: {
    findLatestForCharacter: jest.fn(),
  },
  characterProvisionalProgress: {
    findByCharacterId: jest.fn(),
  },
  settlementBatch: {
    findNextUnconfirmedForCharacter: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

jest.mock("../lib/solana/runanaAccounts", () => ({
  fetchCharacterWorldProgressAccount: jest.fn(),
  fetchSeasonPolicyAccount: jest.fn(),
}));

jest.mock("../lib/solana/runanaClient", () => ({
  createRunanaConnection: jest.fn(() => ({})),
  resolveRunanaCommitment: jest.fn(() => "confirmed"),
  resolveRunanaProgramId: jest.fn(() => "program-id"),
}));

jest.mock("../lib/solana/runanaProgram", () => ({
  deriveCharacterWorldProgressPda: jest.fn(() => "world-progress-pda"),
  deriveSeasonPolicyPda: jest.fn(() => "season-policy-pda"),
}));

import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshot,
  loadCharacterBattleReadyRecord,
} from "../lib/combat/combatSnapshotAssembly";
import {
  generateBattleSeed,
  simulateBattle,
} from "../engine/battle/battleEngine";
import { selectEncounterForZone } from "../lib/combat/encounterSelection";
import {
  fetchCharacterWorldProgressAccount,
  fetchSeasonPolicyAccount,
} from "../lib/solana/runanaAccounts";
import { executeRealEncounter } from "../lib/combat/realEncounter";

describe("executeRealEncounter", () => {
  const encounterEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    RUNANA_ACTIVE_SEASON_ID: "1",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: "authority",
      chainCharacterIdHex: "11".repeat(16),
      characterRootPubkey: "11111111111111111111111111111111",
      chainCreationStatus: "CONFIRMED",
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: 4,
      lastReconciledStateHash: "22".repeat(32),
      lastReconciledBatchId: 1,
      lastReconciledBattleTs: 1000,
      lastReconciledSeasonId: 1,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
    });
    (fetchCharacterWorldProgressAccount as jest.Mock).mockResolvedValue({
      highestUnlockedZoneId: 3,
    });
    (fetchSeasonPolicyAccount as jest.Mock).mockResolvedValue({
      seasonId: 1,
      seasonStartTs: BigInt(1_700_000_000),
      seasonEndTs: BigInt(1_700_200_000),
    });
    (selectEncounterForZone as jest.Mock).mockReturnValue({
      enemyArchetypeId: 100,
      enemyArchetype: {
        enemyArchetypeId: 100,
        displayName: "Scrap Drone",
        snapshot: {},
      },
    });
    (generateBattleSeed as jest.Mock).mockReturnValue(77);
    (buildPlayerCombatSnapshot as jest.Mock).mockReturnValue({
      entityId: "character-1",
      activeSkillIds: ["1001", "1002"],
    });
    (buildEnemyCombatSnapshot as jest.Mock).mockReturnValue({
      entityId: "100",
      activeSkillIds: ["1001", "1003"],
    });
    (simulateBattle as jest.Mock).mockReturnValue({
      battleId: "battle-1",
      seed: 77,
      playerInitial: { entityId: "character-1" },
      enemyInitial: { entityId: "100" },
      events: [{ type: "ROUND_START", round: 1 }],
      winnerEntityId: "character-1",
      roundsPlayed: 3,
    });
    prismaMock.battleRecord.allocateNonceAndCreateWithSettlementLedger.mockResolvedValue(
      {
        ledger: {
          battleId: "battle-1",
          characterId: "character-1",
          zoneId: 2,
          enemyArchetypeId: 100,
          localSequence: 5,
          battleNonce: 5,
          seasonId: 1,
          battleTs: 1_700_000_100,
        },
      },
    );
    prismaMock.characterProvisionalProgress.findByCharacterId.mockResolvedValue(
      {
        id: "progress-1",
        characterId: "character-1",
        highestUnlockedZoneId: 2,
        highestClearedZoneId: 1,
        zoneStates: { "1": 2, "2": 1 },
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
      },
    );
    prismaMock.battleRecord.createAwaitingFirstSyncWithProgress.mockResolvedValue(
      {
        ledger: {
          battleId: "battle-1",
          characterId: "character-1",
          zoneId: 2,
          enemyArchetypeId: 100,
          localSequence: 5,
          battleNonce: null,
          seasonId: 1,
          battleTs: 1_700_000_100,
        },
      },
    );
    prismaMock.battleOutcomeLedger.findLatestForCharacter.mockResolvedValue(
      null,
    );
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(
      null,
    );
  });

  it("executes a confirmed real encounter and persists a pending settlement row", async () => {
    const result = await executeRealEncounter(
      {
        characterId: "character-1",
        zoneId: 2,
      },
      {
        now: () => new Date("2023-11-14T22:15:00.000Z"),
        env: encounterEnv,
      },
    );

    expect(generateBattleSeed).toHaveBeenCalledTimes(1);
    expect(selectEncounterForZone).toHaveBeenCalledWith(2, 77);
    expect(
      prismaMock.battleRecord.allocateNonceAndCreateWithSettlementLedger,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        zoneId: 2,
        enemyArchetypeId: 100,
        seasonId: 1,
        zoneProgressDelta: [],
      }),
    );
    expect(result).toMatchObject({
      characterId: "character-1",
      zoneId: 2,
      enemyArchetypeId: 100,
      seed: 77,
      battleNonce: 5,
      seasonId: 1,
      settlementStatus: "PENDING",
    });
    expect(
      prismaMock.battleRecord.createAwaitingFirstSyncWithProgress,
    ).not.toHaveBeenCalled();
  });

  it("delegates nonce allocation to the transactional persistence helper", async () => {
    await executeRealEncounter(
      {
        characterId: "character-1",
        zoneId: 2,
      },
      {
        now: () => new Date("2023-11-14T22:15:00.000Z"),
        env: encounterEnv,
      },
    );

    expect(
      prismaMock.battleRecord.allocateNonceAndCreateWithSettlementLedger,
    ).toHaveBeenCalledWith(
      expect.not.objectContaining({
        battleNonce: expect.anything(),
      }),
    );
  });

  it("persists local-first encounters before the character is chain-confirmed", async () => {
    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
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
      chainCreationStatus: "PENDING",
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
    });

    await expect(
      executeRealEncounter(
        {
          characterId: "character-1",
          zoneId: 2,
        },
        {
          now: () => new Date("2023-11-14T22:15:00.000Z"),
          env: encounterEnv,
        },
      ),
    ).resolves.toMatchObject({
      characterId: "character-1",
      zoneId: 2,
      settlementStatus: "AWAITING_FIRST_SYNC",
      battleNonce: 5,
    });
    expect(
      prismaMock.battleRecord.createAwaitingFirstSyncWithProgress,
    ).toHaveBeenCalledTimes(1);
    expect(
      prismaMock.battleRecord.allocateNonceAndCreateWithSettlementLedger,
    ).not.toHaveBeenCalled();
  });

  it("rejects locked zones", async () => {
    (fetchCharacterWorldProgressAccount as jest.Mock).mockResolvedValue({
      highestUnlockedZoneId: 1,
    });

    await expect(
      executeRealEncounter(
        {
          characterId: "character-1",
          zoneId: 2,
        },
        {
          now: () => new Date("2023-11-14T22:15:00.000Z"),
          env: encounterEnv,
        },
      ),
    ).rejects.toThrow(/ERR_ZONE_LOCKED/);
  });

  it("rejects new encounters while the initial settlement is still required", async () => {
    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: "authority",
      chainCharacterIdHex: "11".repeat(16),
      characterRootPubkey: "11111111111111111111111111111111",
      chainCreationStatus: "CONFIRMED",
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: 0,
      lastReconciledStateHash: "22".repeat(32),
      lastReconciledBatchId: 0,
      lastReconciledBattleTs: 1000,
      lastReconciledSeasonId: 1,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
    });
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(
      {
        id: "batch-1",
        batchId: 1,
        status: "SEALED",
      },
    );

    await expect(
      executeRealEncounter(
        {
          characterId: "character-1",
          zoneId: 2,
        },
        {
          now: () => new Date("2023-11-14T22:15:00.000Z"),
          env: encounterEnv,
        },
      ),
    ).rejects.toThrow(/ERR_INITIAL_SETTLEMENT_REQUIRED/);
  });

  it("rejects characters missing the reconciled cursor required for encounters", async () => {
    (loadCharacterBattleReadyRecord as jest.Mock).mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: "authority",
      chainCharacterIdHex: "11".repeat(16),
      characterRootPubkey: "11111111111111111111111111111111",
      chainCreationStatus: "CONFIRMED",
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      activeSkills: ["1001", "1002"],
      passiveSkills: ["2001", "2002"],
    });

    await expect(
      executeRealEncounter(
        {
          characterId: "character-1",
          zoneId: 2,
        },
        {
          now: () => new Date("2023-11-14T22:15:00.000Z"),
          env: encounterEnv,
        },
      ),
    ).rejects.toThrow(/ERR_CHARACTER_CURSOR_UNAVAILABLE/);
  });
});
