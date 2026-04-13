import { getPassiveDef } from "../engine/battle/passiveRegistry";
import { getSkillDef } from "../engine/battle/skillRegistry";
import {
  CHARACTER_NAME_RESERVATION_TTL_MS,
  assertValidCharacterName,
  normalizeCharacterClassId,
  normalizeCharacterName,
  normalizeCharacterSlotIndex,
} from "./characterIdentity";
import { deriveCharacterSyncState } from "./characterSync";
import { getCharacterClassCatalogItem } from "./catalog/classes";
import { prisma } from "./prisma";
import type {
  CharacterDetailResponse,
  CharacterReadModel,
  CharacterRosterResponse,
  CharacterSyncDetailResponse,
  CreateCharacterResponse,
} from "../types/api/frontend";
import { getCurrentSeasonSummary } from "./seasonSummary";

const STARTER_ACTIVE_SKILLS = ["1001", "1002"];
const STARTER_PASSIVES = ["2001", "2002"];

export type AccountMode = "anon" | "wallet-linked";

function resolveAccountModeForUser(): AccountMode {
  return "wallet-linked";
}

function slotsTotalForAccountMode(accountMode: AccountMode): number {
  return accountMode === "wallet-linked" ? 3 : 1;
}

function mapCharacterSummary(
  character: Awaited<ReturnType<typeof prisma.character.findById>> extends infer T
    ? T extends null
      ? never
      : T
    : never,
) {
  const syncState = deriveCharacterSyncState({
    chain: null,
    latestBattleSettlementStatus: null,
    nextSettlementBatch: null,
  });

  return {
    characterId: character.id,
    name: character.name,
    classId: character.classId,
    slotIndex: character.slotIndex,
    level: character.level,
    syncStatus: syncState.syncPhase,
  };
}

async function buildCharacterReadModel(
  characterId: string,
): Promise<CharacterReadModel | null> {
  const character = await prisma.character.findById(characterId);
  if (character === null) {
    return null;
  }

  const [chainState, provisionalProgress, latestBattle, nextSettlementBatch, activeZoneRun, latestClosedZoneRun] =
    await Promise.all([
      prisma.character.findChainState(character.id),
      prisma.characterProvisionalProgress.findByCharacterId(character.id),
      prisma.battleOutcomeLedger.findLatestForCharacter(character.id),
      prisma.settlementBatch.findNextUnconfirmedForCharacter(character.id),
      prisma.activeZoneRun.findByCharacterId(character.id),
      prisma.closedZoneRunSummary.findLatestForCharacter(character.id),
    ]);

  const syncState = deriveCharacterSyncState({
    chain:
      chainState === null
        ? null
        : {
            chainCreationStatus: chainState.chainCreationStatus,
            lastReconciledBatchId: chainState.lastReconciledBatchId,
          },
    latestBattleSettlementStatus: latestBattle?.settlementStatus ?? null,
    nextSettlementBatch:
      nextSettlementBatch === null
        ? null
        : {
            batchId: nextSettlementBatch.batchId,
            status: nextSettlementBatch.status,
          },
  });

  return {
    characterId: character.id,
    userId: character.userId,
    name: character.name,
    classId: character.classId,
    slotIndex: character.slotIndex,
    chainBootstrapReady: character.chainBootstrapReady,
    level: character.level,
    exp: character.exp,
    syncPhase: syncState.syncPhase,
    battleEligible: syncState.battleEligible,
    stats: {
      hp: character.hp,
      hpMax: character.hpMax,
      atk: character.atk,
      def: character.def,
      spd: character.spd,
      accuracyBP: character.accuracyBP,
      evadeBP: character.evadeBP,
    },
    activeSkills: character.activeSkills,
    passiveSkills: character.passiveSkills,
    unlockedSkillIds: character.unlockedSkillIds,
    inventory: character.inventory,
    chain:
      chainState === null
        ? null
        : {
            playerAuthorityPubkey: chainState.playerAuthorityPubkey,
            chainCharacterIdHex: chainState.chainCharacterIdHex,
            characterRootPubkey: chainState.characterRootPubkey,
            chainCreationStatus: chainState.chainCreationStatus,
            chainCreationTxSignature: chainState.chainCreationTxSignature,
            chainCreatedAt: chainState.chainCreatedAt?.toISOString() ?? null,
            chainCreationTs: chainState.chainCreationTs,
            chainCreationSeasonId: chainState.chainCreationSeasonId,
            cursor:
              chainState.lastReconciledEndNonce === null ||
              chainState.lastReconciledStateHash === null ||
              chainState.lastReconciledBatchId === null ||
              chainState.lastReconciledBattleTs === null ||
              chainState.lastReconciledSeasonId === null
                ? null
                : {
                    lastReconciledEndNonce: chainState.lastReconciledEndNonce,
                    lastReconciledStateHash: chainState.lastReconciledStateHash,
                    lastReconciledBatchId: chainState.lastReconciledBatchId,
                    lastReconciledBattleTs: chainState.lastReconciledBattleTs,
                    lastReconciledSeasonId: chainState.lastReconciledSeasonId,
                    lastReconciledAt: chainState.lastReconciledAt?.toISOString() ?? null,
                  },
          },
    provisionalProgress:
      provisionalProgress === null
        ? null
        : {
            highestUnlockedZoneId: provisionalProgress.highestUnlockedZoneId,
            highestClearedZoneId: provisionalProgress.highestClearedZoneId,
            zoneStates: provisionalProgress.zoneStates,
          },
    latestBattle:
      latestBattle === null
        ? null
        : {
            battleId: latestBattle.battleId,
            localSequence: latestBattle.localSequence,
            battleNonce: latestBattle.battleNonce,
            battleTs: latestBattle.battleTs,
            seasonId: latestBattle.seasonId,
            zoneId: latestBattle.zoneId,
            enemyArchetypeId: latestBattle.enemyArchetypeId,
            settlementStatus: latestBattle.settlementStatus,
            sealedBatchId: latestBattle.sealedBatchId,
            committedAt: latestBattle.committedAt?.toISOString() ?? null,
          },
    nextSettlementBatch:
      nextSettlementBatch === null
        ? null
        : {
            settlementBatchId: nextSettlementBatch.id,
            batchId: nextSettlementBatch.batchId,
            startNonce: nextSettlementBatch.startNonce,
            endNonce: nextSettlementBatch.endNonce,
            battleCount: nextSettlementBatch.battleCount,
            firstBattleTs: nextSettlementBatch.firstBattleTs,
            lastBattleTs: nextSettlementBatch.lastBattleTs,
            seasonId: nextSettlementBatch.seasonId,
            status: nextSettlementBatch.status,
            latestTransactionSignature: nextSettlementBatch.latestTransactionSignature,
            failureCategory: nextSettlementBatch.failureCategory,
            failureCode: nextSettlementBatch.failureCode,
          },
    activeZoneRun:
      activeZoneRun === null
        ? null
        : {
            runId: activeZoneRun.snapshot.runId,
            zoneId: activeZoneRun.snapshot.zoneId,
            seasonId: activeZoneRun.snapshot.seasonId,
            state: activeZoneRun.snapshot.state,
            currentNodeId: activeZoneRun.snapshot.currentNodeId,
            currentSubnodeId: activeZoneRun.snapshot.currentSubnodeId,
            totalSubnodesTraversed: activeZoneRun.snapshot.totalSubnodesTraversed,
            totalSubnodesInRun: activeZoneRun.snapshot.totalSubnodesInRun,
            branchOptions: activeZoneRun.snapshot.branchOptions,
          },
    latestClosedZoneRun:
      latestClosedZoneRun === null
        ? null
        : {
            zoneRunId: latestClosedZoneRun.zoneRunId,
            characterId: latestClosedZoneRun.characterId,
            zoneId: latestClosedZoneRun.zoneId,
            seasonId: latestClosedZoneRun.seasonId,
            topologyVersion: latestClosedZoneRun.topologyVersion,
            topologyHash: latestClosedZoneRun.topologyHash,
            terminalStatus: latestClosedZoneRun.terminalStatus,
            rewardedBattleCount: latestClosedZoneRun.rewardedBattleCount,
            rewardedEncounterHistogram: latestClosedZoneRun.rewardedEncounterHistogram,
            zoneProgressDelta: latestClosedZoneRun.zoneProgressDelta,
            closedAt: latestClosedZoneRun.closedAt.toISOString(),
          },
  };
}

export async function getCharacterRoster(
  userId: string,
): Promise<CharacterRosterResponse> {
  const user = await prisma.user.findUnique(userId);
  if (user === null) {
    throw new Error("ERR_USER_NOT_FOUND: user not found");
  }

  const accountMode = resolveAccountModeForUser();
  const slotsTotal = slotsTotalForAccountMode(accountMode);
  const characters = await prisma.character.listByUserId(userId);

  return {
    accountMode,
    slotsTotal,
    characters: characters.map(mapCharacterSummary),
  };
}

export async function getCharacterDetail(
  characterId: string,
  userId?: string,
): Promise<CharacterDetailResponse> {
  const character = await buildCharacterReadModel(characterId);
  if (character === null) {
    throw new Error("ERR_CHARACTER_NOT_FOUND: character not found");
  }

  if (userId !== undefined && character.userId !== userId) {
    throw new Error("ERR_CHARACTER_NOT_FOUND: character not found");
  }

  return {
    character,
    season: getCurrentSeasonSummary(),
  };
}

export async function getCharacterSyncDetail(
  characterId: string,
  userId?: string,
): Promise<CharacterSyncDetailResponse> {
  const detail = await getCharacterDetail(characterId, userId);
  const attempts =
    detail.character.nextSettlementBatch === null
      ? []
      : await prisma.settlementSubmissionAttempt.listByBatch(
          detail.character.nextSettlementBatch.settlementBatchId,
        );
  const mode =
    detail.character.syncPhase === "LOCAL_ONLY" ||
    detail.character.syncPhase === "CREATING_ON_CHAIN" ||
    detail.character.syncPhase === "FAILED"
      ? "first_sync"
      : detail.character.nextSettlementBatch !== null
        ? "settlement"
        : null;

  return {
    character: detail.character,
    season: detail.season,
    sync: {
      mode,
      pendingBatchId: detail.character.nextSettlementBatch?.settlementBatchId ?? null,
      pendingBatchNumber: detail.character.nextSettlementBatch?.batchId ?? null,
      attempts: attempts.map((attempt) => ({
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        transactionSignature: attempt.transactionSignature,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
        rpcError: attempt.rpcError,
      })),
    },
  };
}

export async function getFirstCharacterDetailForUser(
  userId: string,
): Promise<CharacterReadModel | null> {
  const roster = await getCharacterRoster(userId);
  const first = roster.characters[0];
  if (first === undefined) {
    return null;
  }

  const detail = await getCharacterDetail(first.characterId, userId);
  return detail.character;
}

export async function createPlayableCharacter(input: {
  userId: string;
  name: string;
  classId?: string;
  slotIndex?: number;
}): Promise<CreateCharacterResponse> {
  const user = await prisma.user.findUnique(input.userId);
  if (user === null) {
    throw new Error("ERR_USER_NOT_FOUND: user not found");
  }

  const accountMode = resolveAccountModeForUser();
  const slotsTotal = slotsTotalForAccountMode(accountMode);
  const slotIndex = normalizeCharacterSlotIndex(input.slotIndex);
  if (slotIndex >= slotsTotal) {
    throw new Error("ERR_CHARACTER_SLOT_FORBIDDEN: slot is not available for this account");
  }

  const existingCharacters = await prisma.character.listByUserId(input.userId);
  if (existingCharacters.length >= slotsTotal) {
    throw new Error("ERR_CHARACTER_SLOTS_FULL: no free character slots remain");
  }
  if (existingCharacters.some((character) => character.slotIndex === slotIndex)) {
    throw new Error("ERR_CHARACTER_SLOT_TAKEN: slot is already occupied");
  }

  const name = assertValidCharacterName(input.name);
  const classId = normalizeCharacterClassId(input.classId);
  if (getCharacterClassCatalogItem(classId)?.enabled !== true) {
    throw new Error("ERR_CHARACTER_CLASS_DISABLED: class is not enabled");
  }

  const reservation = await prisma.characterNameReservation.createHold({
    userId: input.userId,
    displayName: name,
    normalizedName: normalizeCharacterName(name),
    expiresAt: new Date(Date.now() + CHARACTER_NAME_RESERVATION_TTL_MS),
  });

  try {
    const character = await prisma.character.create({
      userId: input.userId,
      name,
      nameNormalized: normalizeCharacterName(name),
      classId,
      slotIndex,
      chainBootstrapReady: true,
      nameReservationId: reservation.id,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      activeSkills: STARTER_ACTIVE_SKILLS,
      passiveSkills: STARTER_PASSIVES,
    });

    STARTER_ACTIVE_SKILLS.forEach((skillId) => getSkillDef(skillId));
    STARTER_PASSIVES.forEach((passiveId) => getPassiveDef(passiveId));

    return {
      characterId: character.id,
      userId: character.userId,
      name: character.name,
      classId: character.classId,
      slotIndex: character.slotIndex,
      level: character.level,
      stats: {
        hp: character.hp,
        hpMax: character.hpMax,
        atk: character.atk,
        def: character.def,
        spd: character.spd,
        accuracyBP: character.accuracyBP,
        evadeBP: character.evadeBP,
      },
      activeSkills: STARTER_ACTIVE_SKILLS,
      passiveSkills: STARTER_PASSIVES,
      unlockedSkillIds: STARTER_ACTIVE_SKILLS,
    };
  } catch (error) {
    await prisma.characterNameReservation.release(reservation.id);
    throw error;
  }
}
