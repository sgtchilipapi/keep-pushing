import type { CharacterReadModel } from "../types/api/frontend";
import {
  resolveEffectiveSeason,
  resolvePassiveNames,
  resolveSkillNames,
  resolveSyncPanelState,
} from "../components/game/uiModel";

function buildCharacter(
  overrides: Partial<CharacterReadModel> = {},
): CharacterReadModel {
  return {
    characterId: "character-1",
    userId: "user-1",
    name: "Rookie",
    level: 1,
    exp: 0,
    syncPhase: "LOCAL_ONLY",
    battleEligible: true,
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
    inventory: [],
    chain: {
      playerAuthorityPubkey: null,
      chainCharacterIdHex: null,
      characterRootPubkey: null,
      chainCreationStatus: "NOT_STARTED",
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
      cursor: null,
    },
    provisionalProgress: {
      highestUnlockedZoneId: 1,
      highestClearedZoneId: 0,
      zoneStates: { "1": 1 },
    },
    latestBattle: null,
    ...overrides,
  };
}

describe("game ui model helpers", () => {
  it("resolves skill and passive ids to display names with fallback to raw ids", () => {
    expect(resolveSkillNames(["1001", "9999"])).toEqual([
      "Volt Strike",
      "9999",
    ]);
    expect(resolvePassiveNames(["2001", "9999"])).toEqual([
      "Eagle Eye",
      "9999",
    ]);
  });

  it("uses the documented effective season precedence", () => {
    const character = buildCharacter({
      nextPendingSettlementRun: {
        zoneRunId: "run-7",
        closedRunSequence: 7,
        zoneId: 1,
        seasonId: 5,
        rewardedBattleCount: 1,
        closedAt: "2026-04-05T00:00:00.000Z",
      },
      chain: {
        playerAuthorityPubkey: null,
        chainCharacterIdHex: null,
        characterRootPubkey: null,
        chainCreationStatus: "CONFIRMED",
        chainCreationTxSignature: null,
        chainCreatedAt: null,
        chainCreationTs: 1,
        chainCreationSeasonId: 4,
        cursor: {
          lastReconciledEndNonce: 1,
          lastReconciledStateHash: "abc",
          lastReconciledBatchId: 1,
          lastReconciledBattleTs: 10,
          lastReconciledSeasonId: 3,
          lastReconciledAt: null,
        },
      },
      latestBattle: {
        battleId: "battle-1",
        localSequence: 1,
        battleNonce: 1,
        battleTs: 10,
        seasonId: 2,
        zoneId: 1,
        enemyArchetypeId: 100,
        settlementStatus: "PENDING",
        sealedBatchId: null,
        committedAt: null,
      },
    });

    expect(resolveEffectiveSeason(character)).toBe(5);
  });

  it("reports local-only sync when the character has not been created on chain yet", () => {
    const state = resolveSyncPanelState(
      buildCharacter({
        syncPhase: "LOCAL_ONLY",
      }),
    );

    expect(state).toEqual({
      season: null,
      statusLabel: "LOCAL ONLY",
      statusTone: "neutral",
      syncMode: "create",
    });
  });

  it("reports confirmed when no further settlement is pending", () => {
    const state = resolveSyncPanelState(
      buildCharacter({
        syncPhase: "SYNCED",
        chain: {
          playerAuthorityPubkey: "wallet",
          chainCharacterIdHex: "chain-id",
          characterRootPubkey: "root",
          chainCreationStatus: "CONFIRMED",
          chainCreationTxSignature: "sig",
          chainCreatedAt: "2026-04-05T00:00:00.000Z",
          chainCreationTs: 1,
          chainCreationSeasonId: 1,
          cursor: {
            lastReconciledEndNonce: 1,
            lastReconciledStateHash: "abc",
            lastReconciledBatchId: 1,
            lastReconciledBattleTs: 10,
            lastReconciledSeasonId: 1,
            lastReconciledAt: null,
          },
        },
      }),
    );

    expect(state).toEqual({
      season: 1,
      statusLabel: "CONFIRMED",
      statusTone: "success",
      syncMode: null,
    });
  });

  it("keeps sync available while chain creation is reserved or already submitted", () => {
    const state = resolveSyncPanelState(
      buildCharacter({
        syncPhase: "CREATING_ON_CHAIN",
        battleEligible: false,
        chain: {
          playerAuthorityPubkey: "wallet",
          chainCharacterIdHex: "chain-id",
          characterRootPubkey: "root",
          chainCreationStatus: "SUBMITTED",
          chainCreationTxSignature: "sig",
          chainCreatedAt: null,
          chainCreationTs: null,
          chainCreationSeasonId: null,
          cursor: null,
        },
      }),
    );

    expect(state).toEqual({
      season: null,
      statusLabel: "CREATING",
      statusTone: "info",
      syncMode: "create",
    });
  });

  it("reports pending settlement after confirmation when a pending run exists", () => {
    const state = resolveSyncPanelState(
      buildCharacter({
        syncPhase: "INITIAL_SETTLEMENT_REQUIRED",
        battleEligible: false,
        chain: {
          playerAuthorityPubkey: "wallet",
          chainCharacterIdHex: "chain-id",
          characterRootPubkey: "root",
          chainCreationStatus: "CONFIRMED",
          chainCreationTxSignature: "sig",
          chainCreatedAt: "2026-04-05T00:00:00.000Z",
          chainCreationTs: 1,
          chainCreationSeasonId: 1,
          cursor: {
            lastReconciledEndNonce: 1,
            lastReconciledStateHash: "abc",
            lastReconciledBatchId: 1,
            lastReconciledBattleTs: 10,
            lastReconciledSeasonId: 1,
            lastReconciledAt: null,
          },
        },
        nextPendingSettlementRun: {
          zoneRunId: "run-2",
          closedRunSequence: 2,
          zoneId: 1,
          seasonId: 2,
          rewardedBattleCount: 1,
          closedAt: "2026-04-05T00:00:00.000Z",
        },
      }),
    );

    expect(state).toEqual({
      season: 2,
      statusLabel: "FIRST BATCH REQUIRED",
      statusTone: "warning",
      syncMode: "settlement",
    });
  });

  it("reports pending settlement after confirmation when the latest battle is still pending", () => {
    const state = resolveSyncPanelState(
      buildCharacter({
        syncPhase: "SETTLEMENT_PENDING",
        chain: {
          playerAuthorityPubkey: "wallet",
          chainCharacterIdHex: "chain-id",
          characterRootPubkey: "root",
          chainCreationStatus: "CONFIRMED",
          chainCreationTxSignature: "sig",
          chainCreatedAt: "2026-04-05T00:00:00.000Z",
          chainCreationTs: 1,
          chainCreationSeasonId: 1,
          cursor: {
            lastReconciledEndNonce: 1,
            lastReconciledStateHash: "abc",
            lastReconciledBatchId: 1,
            lastReconciledBattleTs: 10,
            lastReconciledSeasonId: 1,
            lastReconciledAt: null,
          },
        },
        latestBattle: {
          battleId: "battle-2",
          localSequence: 2,
          battleNonce: 2,
          battleTs: 12,
          seasonId: 2,
          zoneId: 1,
          enemyArchetypeId: 101,
          settlementStatus: "PENDING",
          sealedBatchId: null,
          committedAt: null,
        },
      }),
    );

    expect(state).toEqual({
      season: 2,
      statusLabel: "PENDING",
      statusTone: "warning",
      syncMode: "settlement",
    });
  });
});
