import { createHash, randomUUID } from "node:crypto";

import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";

import {
  generateBattleSeed,
  simulateBattle,
} from "../../engine/battle/battleEngine";
import type { ActiveStatuses } from "../../engine/battle/resolveStatus";
import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshotFromCarryover,
  loadCharacterBattleReadyRecord,
} from "./combatSnapshotAssembly";
import {
  applyPauseSkillToCarryover,
  applyTraversalTickToCarryover,
  buildCarryoverFromBattleFinal,
  buildInitialZoneRunCarryover,
} from "./zoneRunCarryover";
import { getEnemyArchetypeDef } from "./enemyArchetypes";
import { prisma, type CharacterBattleReadyRecord, type CharacterProvisionalProgressRecord, type UpdateCharacterProvisionalProgressInput } from "../prisma";
import { deriveCharacterSyncState } from "../characterSync";
import {
  fetchCharacterWorldProgressAccount,
  fetchSeasonPolicyAccount,
} from "../solana/runanaAccounts";
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from "../solana/runanaClient";
import {
  deriveCharacterWorldProgressPda,
  deriveSeasonPolicyPda,
} from "../solana/runanaProgram";
import type {
  ActiveZoneRunSnapshot,
  ActiveZoneRunState,
  ClosedZoneRunSummary,
  ZoneRunActionResponse,
  ZoneRunLastBattleSummary,
  ZoneRunPlayerCarryoverState,
  ZoneRunTerminalStatus,
} from "../../types/zoneRun";
import type { ZoneProgressDeltaEntry } from "../../types/settlement";
import {
  getLatestZoneRunTopology,
  getZoneNode,
  getZoneRunTopology,
  type ZoneNodeDef,
  type ZoneRunTopology,
} from "./zoneRunTopologies";

type InternalActiveZoneRunSnapshot = ActiveZoneRunSnapshot & {
  resumeState?: ActiveZoneRunState | "COMPLETE";
};

export interface ZoneRunServiceDependencies {
  connection?: Pick<Connection, "getAccountInfo">;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export interface StartZoneRunInput {
  characterId: string;
  zoneId: number;
  requestKey: string;
}

export interface ZoneRunBranchInput {
  characterId: string;
  nextNodeId: string;
  requestKey: string;
}

export interface ZoneRunCharacterInput {
  characterId: string;
  requestKey?: string;
}

export interface ZoneRunPauseSkillInput {
  characterId: string;
  skillId: string;
  requestKey: string;
}

export interface ZoneRunUseItemInput {
  characterId: string;
  itemId: string;
}

type ZoneRunMutationActionType =
  | "START"
  | "CHOOSE_BRANCH"
  | "ADVANCE"
  | "USE_PAUSE_SKILL"
  | "CONTINUE"
  | "ABANDON";

function currentUnixTimestamp(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function statusForMissingFinals(): never {
  throw new Error("ERR_BATTLE_FINAL_STATE_UNAVAILABLE: battle engine did not return final combat snapshots");
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`);
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} must not be empty`);
  }
}

function cloneSnapshot(snapshot: InternalActiveZoneRunSnapshot): InternalActiveZoneRunSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as InternalActiveZoneRunSnapshot;
}

function toExternalClosedSummary(input: {
  zoneRunId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: ZoneRunTerminalStatus;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: Record<string, number>;
  zoneProgressDelta: unknown;
  closedAt: Date;
}): ClosedZoneRunSummary {
  return {
    zoneRunId: input.zoneRunId,
    characterId: input.characterId,
    zoneId: input.zoneId,
    seasonId: input.seasonId,
    topologyVersion: input.topologyVersion,
    topologyHash: input.topologyHash,
    terminalStatus: input.terminalStatus,
    rewardedBattleCount: input.rewardedBattleCount,
    rewardedEncounterHistogram: { ...input.rewardedEncounterHistogram },
    zoneProgressDelta: input.zoneProgressDelta,
    closedAt: input.closedAt.toISOString(),
  };
}

function hashToInt(parts: string[], maximumExclusive: number): number {
  const digest = createHash("sha256").update(parts.join("|")).digest();
  const value = digest.readUInt32LE(0);
  return value % maximumExclusive;
}

function hashRollBp(parts: string[]): number {
  return hashToInt(parts, 10000) + 1;
}

function toBattleStatuses(
  carryover: ZoneRunPlayerCarryoverState,
): ActiveStatuses {
  return Object.fromEntries(
    Object.entries(carryover.statuses).map(([statusId, value]) => [
      statusId,
      {
        sourceId: value.sourceId,
        remainingTurns: value.remainingTurns,
      },
    ]),
  ) as ActiveStatuses;
}

function resolveConfiguredActiveSeasonId(args: {
  env: NodeJS.ProcessEnv;
  fallbackSeasonId: number | null;
  chainCreationSeasonId: number | null;
}): number {
  const configured =
    args.env.RUNANA_ACTIVE_SEASON_ID?.trim() ??
    args.env.RUNANA_SEASON_ID?.trim() ??
    undefined;
  const candidate =
    configured === undefined || configured.length === 0
      ? (args.fallbackSeasonId ?? args.chainCreationSeasonId)
      : Number(configured);

  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    throw new Error(
      "ERR_ACTIVE_SEASON_UNRESOLVED: configure RUNANA_ACTIVE_SEASON_ID or ensure the character has a reconciled season id",
    );
  }

  return candidate as number;
}

function resolveZoneRunIdleTimeoutSeconds(env: NodeJS.ProcessEnv): number {
  const raw = env.RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS?.trim();
  if (raw === undefined || raw.length === 0) {
    return 30 * 60;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      "ERR_ZONE_RUN_IDLE_TIMEOUT_INVALID: RUNANA_ZONE_RUN_IDLE_TIMEOUT_SECONDS must be an integer >= 0",
    );
  }

  return parsed;
}

async function assertBattleEligibleForConfirmedCharacter(
  character: CharacterBattleReadyRecord,
): Promise<void> {
  const [latestBattle, nextSettlementBatch] = await Promise.all([
    prisma.battleOutcomeLedger.findLatestForCharacter(character.id),
    prisma.settlementBatch.findNextUnconfirmedForCharacter(character.id),
  ]);

  const syncState = deriveCharacterSyncState({
    chain: {
      chainCreationStatus: character.chainCreationStatus,
      lastReconciledBatchId: character.lastReconciledBatchId,
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

  if (!syncState.battleEligible) {
    throw new Error(
      "ERR_INITIAL_SETTLEMENT_REQUIRED: initial settlement required before new battles",
    );
  }
}

function isConfirmedEncounterCharacter(character: CharacterBattleReadyRecord): boolean {
  return (
    character.chainCreationStatus === "CONFIRMED" &&
    character.characterRootPubkey !== null &&
    character.lastReconciledEndNonce !== null &&
    character.lastReconciledStateHash !== null &&
    character.lastReconciledBatchId !== null &&
    character.lastReconciledBattleTs !== null &&
    character.lastReconciledSeasonId !== null
  );
}

function assertConfirmedCharacterEncounterReady(character: CharacterBattleReadyRecord): void {
  if (character.chainCreationStatus !== "CONFIRMED") {
    throw new Error(
      "ERR_CHARACTER_NOT_CONFIRMED: character must be chain-confirmed before encounters",
    );
  }

  if (
    character.characterRootPubkey === null ||
    character.lastReconciledEndNonce === null ||
    character.lastReconciledStateHash === null ||
    character.lastReconciledBatchId === null ||
    character.lastReconciledBattleTs === null ||
    character.lastReconciledSeasonId === null
  ) {
    throw new Error(
      "ERR_CHARACTER_CURSOR_UNAVAILABLE: character is missing the reconciled settlement cursor required for encounters",
    );
  }
}

async function resolveAccessContext(
  character: CharacterBattleReadyRecord,
  deps: ZoneRunServiceDependencies,
): Promise<{
  seasonId: number;
  highestUnlockedZoneId: number;
  provisionalProgress: CharacterProvisionalProgressRecord | null;
}> {
  const now = (deps.now ?? (() => new Date()))();
  const battleTs = currentUnixTimestamp(now);
  const env = deps.env ?? process.env;
  const connection = deps.connection ?? createRunanaConnection(env);
  const commitment = deps.commitment ?? resolveRunanaCommitment(env);
  const programId = deps.programId ?? resolveRunanaProgramId(env);
  const provisionalProgress =
    await prisma.characterProvisionalProgress.findByCharacterId(character.id);

  const seasonId = resolveConfiguredActiveSeasonId({
    env,
    fallbackSeasonId: character.lastReconciledSeasonId,
    chainCreationSeasonId: character.chainCreationSeasonId,
  });
  const seasonPolicy = await fetchSeasonPolicyAccount(
    connection as Connection,
    deriveSeasonPolicyPda(seasonId, programId),
    commitment,
  );
  const seasonStartTs = Number(seasonPolicy.seasonStartTs);
  const seasonEndTs = Number(seasonPolicy.seasonEndTs);
  if (battleTs < seasonStartTs || battleTs > seasonEndTs) {
    throw new Error(
      "ERR_SEASON_NOT_ACTIVE: configured encounter season is outside its active battle window",
    );
  }

  if (isConfirmedEncounterCharacter(character)) {
    assertConfirmedCharacterEncounterReady(character);
    await assertBattleEligibleForConfirmedCharacter(character);
    const characterRootPubkey = new PublicKey(character.characterRootPubkey!);
    const worldProgress = await fetchCharacterWorldProgressAccount(
      connection as Connection,
      deriveCharacterWorldProgressPda(characterRootPubkey, programId),
      commitment,
    );

    return {
      seasonId,
      highestUnlockedZoneId: worldProgress.highestUnlockedZoneId,
      provisionalProgress,
    };
  }

  if (provisionalProgress === null) {
    throw new Error(
      `ERR_CHARACTER_PROVISIONAL_PROGRESS_NOT_FOUND: character ${character.id} is missing provisional progress`,
    );
  }

  return {
    seasonId,
    highestUnlockedZoneId: provisionalProgress.highestUnlockedZoneId,
    provisionalProgress,
  };
}

function buildInitialSnapshot(args: {
  runId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topology: ZoneRunTopology;
  character: CharacterBattleReadyRecord;
}): InternalActiveZoneRunSnapshot {
  const startNode = getZoneNode(args.topology, args.topology.startNodeId);
  const firstSubnode = startNode.subnodes[0] ?? null;
  if (firstSubnode === null) {
    throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: zone ${args.zoneId} start node has no subnodes`);
  }

  return {
    runId: args.runId,
    characterId: args.characterId,
    zoneId: args.zoneId,
    seasonId: args.seasonId,
    topologyVersion: args.topology.topologyVersion,
    topologyHash: args.topology.topologyHash,
    state: "TRAVERSING",
    currentNodeId: startNode.nodeId,
    currentSubnodeId: firstSubnode.subnodeId,
    currentSubnodeOrdinal: 1,
    totalSubnodesTraversed: 0,
    totalSubnodesInRun: args.topology.totalSubnodeCount,
    branchOptions: [],
    enemyAppearanceCounts: {},
    playerCarryover: buildInitialZoneRunCarryover(args.character.hpMax),
    lastBattle: null,
  };
}

function resolveNodeProgressAfterTraversal(
  snapshot: InternalActiveZoneRunSnapshot,
  topology: ZoneRunTopology,
): {
  snapshot: InternalActiveZoneRunSnapshot;
  completeRun: boolean;
} {
  const next = cloneSnapshot(snapshot);
  const currentNode = getZoneNode(topology, next.currentNodeId);
  const consumedSubnodeIndex = currentNode.subnodes.findIndex(
    (subnode) => subnode.subnodeId === next.currentSubnodeId,
  );
  if (consumedSubnodeIndex < 0) {
    throw new Error(`ERR_ZONE_RUN_STATE_INVALID: current subnode ${next.currentSubnodeId} is not part of ${currentNode.nodeId}`);
  }

  next.totalSubnodesTraversed += 1;
  const nextSubnode = currentNode.subnodes[consumedSubnodeIndex + 1] ?? null;
  if (nextSubnode !== null) {
    next.currentSubnodeId = nextSubnode.subnodeId;
    next.currentSubnodeOrdinal = consumedSubnodeIndex + 2;
    next.branchOptions = [];
    next.resumeState = undefined;
    return {
      snapshot: next,
      completeRun: false,
    };
  }

  next.currentSubnodeId = null;
  next.currentSubnodeOrdinal = currentNode.subnodes.length;
  if (topology.terminalNodeIds.includes(currentNode.nodeId)) {
    next.branchOptions = [];
    next.resumeState = "COMPLETE";
    return {
      snapshot: next,
      completeRun: true,
    };
  }

  if (currentNode.nextNodeIds.length === 1) {
    const onlyNextNode = getZoneNode(topology, currentNode.nextNodeIds[0]!);
    next.currentNodeId = onlyNextNode.nodeId;
    next.currentSubnodeId = onlyNextNode.subnodes[0]?.subnodeId ?? null;
    next.currentSubnodeOrdinal = next.currentSubnodeId === null ? 0 : 1;
    next.branchOptions = [];
    next.resumeState = undefined;
    return {
      snapshot: next,
      completeRun: false,
    };
  }

  next.branchOptions = [...currentNode.nextNodeIds];
  next.resumeState = undefined;
  return {
    snapshot: next,
    completeRun: false,
  };
}

function resolveCombatTriggered(snapshot: InternalActiveZoneRunSnapshot): boolean {
  if (snapshot.currentSubnodeId === null) {
    throw new Error("ERR_ZONE_RUN_STATE_INVALID: cannot resolve combat without an active subnode");
  }

  const topology = getZoneRunTopology(snapshot.zoneId, snapshot.topologyVersion);
  const subnode = getZoneNode(topology, snapshot.currentNodeId).subnodes.find(
    (candidate) => candidate.subnodeId === snapshot.currentSubnodeId,
  );
  if (subnode === undefined) {
    throw new Error(`ERR_ZONE_RUN_STATE_INVALID: missing subnode ${snapshot.currentSubnodeId}`);
  }

  return hashRollBp([snapshot.runId, snapshot.currentNodeId, snapshot.currentSubnodeId, "combat"]) <= subnode.combatChanceBP;
}

function selectEnemyArchetypeForSubnode(args: {
  snapshot: InternalActiveZoneRunSnapshot;
  topology: ZoneRunTopology;
  node: ZoneNodeDef;
}): number | null {
  if (args.snapshot.currentSubnodeId === null) {
    return null;
  }

  const counts = args.snapshot.enemyAppearanceCounts;
  const maxByEnemyId = new Map(
    args.topology.enemyRules.map((entry) => [String(entry.enemyArchetypeId), entry.maxPerRun] as const),
  );
  const legalPool = args.node.enemyPool.filter((entry) => {
    const currentCount = counts[String(entry.enemyArchetypeId)] ?? 0;
    const maxPerRun = maxByEnemyId.get(String(entry.enemyArchetypeId)) ?? 0;
    return currentCount < maxPerRun;
  });
  if (legalPool.length === 0) {
    return null;
  }

  const totalWeight = legalPool.reduce((sum, entry) => sum + entry.weight, 0);
  let remaining = hashToInt(
    [args.snapshot.runId, args.snapshot.currentNodeId, args.snapshot.currentSubnodeId, "enemy"],
    totalWeight,
  ) + 1;

  for (const entry of legalPool) {
    remaining -= entry.weight;
    if (remaining <= 0) {
      return entry.enemyArchetypeId;
    }
  }

  return legalPool[legalPool.length - 1]?.enemyArchetypeId ?? null;
}

function computeZoneProgressUpdateForSuccess(
  progress: CharacterProvisionalProgressRecord,
  zoneId: number,
): UpdateCharacterProvisionalProgressInput & { zoneProgressDelta: ZoneProgressDeltaEntry[] } {
  const zoneStates: Record<string, 0 | 1 | 2> = { ...progress.zoneStates };
  const zoneProgressDelta: ZoneProgressDeltaEntry[] = [];
  let highestUnlockedZoneId = progress.highestUnlockedZoneId;
  let highestClearedZoneId = progress.highestClearedZoneId;

  const currentZoneKey = String(zoneId);
  if ((zoneStates[currentZoneKey] ?? 1) < 2) {
    zoneStates[currentZoneKey] = 2;
    zoneProgressDelta.push({ zoneId, newState: 2 });
  }
  highestClearedZoneId = Math.max(highestClearedZoneId, zoneId);

  const nextZoneId = zoneId + 1;
  try {
    getLatestZoneRunTopology(nextZoneId);
    const nextZoneKey = String(nextZoneId);
    if ((zoneStates[nextZoneKey] ?? 0) === 0) {
      zoneStates[nextZoneKey] = 1;
      zoneProgressDelta.push({ zoneId: nextZoneId, newState: 1 });
      highestUnlockedZoneId = Math.max(highestUnlockedZoneId, nextZoneId);
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("ERR_UNKNOWN_ZONE_ID")) {
      throw error;
    }
  }

  zoneProgressDelta.sort((left, right) => left.zoneId - right.zoneId);
  return {
    highestUnlockedZoneId,
    highestClearedZoneId,
    zoneStates,
    zoneProgressDelta,
  };
}

async function persistWinningBattle(args: {
  snapshot: InternalActiveZoneRunSnapshot;
  character: CharacterBattleReadyRecord;
  nodeId: string;
  subnodeId: string;
  enemyArchetypeId: number;
  battleId: string;
  seed: number;
  battleTs: number;
  battleResult: ZoneRunLastBattleSummary["battleResult"];
}) {
  if (isConfirmedEncounterCharacter(args.character)) {
    return prisma.battleRecord.allocateNonceAndCreateWithSettlementLedger({
      battleId: args.battleId,
      characterId: args.character.id,
      zoneRunId: args.snapshot.runId,
      zoneId: args.snapshot.zoneId,
      nodeId: args.nodeId,
      subnodeId: args.subnodeId,
      enemyArchetypeId: args.enemyArchetypeId,
      seed: args.seed,
      playerInitial: args.battleResult.playerInitial,
      enemyInitial: args.battleResult.enemyInitial,
      playerFinal: args.battleResult.playerFinal ?? null,
      enemyFinal: args.battleResult.enemyFinal ?? null,
      rewardEligible: true,
      winnerEntityId: args.battleResult.winnerEntityId,
      roundsPlayed: args.battleResult.roundsPlayed,
      events: args.battleResult.events,
      battleTs: args.battleTs,
      seasonId: args.snapshot.seasonId,
      zoneProgressDelta: [],
    });
  }

  return prisma.battleRecord.createAwaitingFirstSync({
    battleId: args.battleId,
    characterId: args.character.id,
    zoneRunId: args.snapshot.runId,
    zoneId: args.snapshot.zoneId,
    nodeId: args.nodeId,
    subnodeId: args.subnodeId,
    enemyArchetypeId: args.enemyArchetypeId,
    seed: args.seed,
    playerInitial: args.battleResult.playerInitial,
    enemyInitial: args.battleResult.enemyInitial,
    playerFinal: args.battleResult.playerFinal ?? null,
    enemyFinal: args.battleResult.enemyFinal ?? null,
    rewardEligible: true,
    winnerEntityId: args.battleResult.winnerEntityId,
    roundsPlayed: args.battleResult.roundsPlayed,
    events: args.battleResult.events,
    battleTs: args.battleTs,
    seasonId: args.snapshot.seasonId,
    zoneProgressDelta: [],
  });
}

async function persistLosingBattle(args: {
  snapshot: InternalActiveZoneRunSnapshot;
  character: CharacterBattleReadyRecord;
  nodeId: string;
  subnodeId: string;
  enemyArchetypeId: number;
  battleId: string;
  seed: number;
  battleResult: ZoneRunLastBattleSummary["battleResult"];
}) {
  return prisma.battleRecord.create({
    battleId: args.battleId,
    characterId: args.character.id,
    zoneRunId: args.snapshot.runId,
    zoneId: args.snapshot.zoneId,
    nodeId: args.nodeId,
    subnodeId: args.subnodeId,
    enemyArchetypeId: args.enemyArchetypeId,
    seed: args.seed,
    playerInitial: args.battleResult.playerInitial,
    enemyInitial: args.battleResult.enemyInitial,
    playerFinal: args.battleResult.playerFinal ?? null,
    enemyFinal: args.battleResult.enemyFinal ?? null,
    rewardEligible: false,
    winnerEntityId: args.battleResult.winnerEntityId,
    roundsPlayed: args.battleResult.roundsPlayed,
    events: args.battleResult.events,
  });
}

function buildActionResponse(args: {
  snapshot: InternalActiveZoneRunSnapshot | null;
  closedRunSummary?: ClosedZoneRunSummary | null;
  battle?: ZoneRunLastBattleSummary | null;
}): ZoneRunActionResponse {
  const activeRun =
    args.snapshot === null
      ? null
      : (() => {
          const { resumeState: _resumeState, ...publicSnapshot } = args.snapshot;
          return publicSnapshot;
        })();

  return {
    activeRun,
    closedRunSummary: args.closedRunSummary ?? null,
    battle: args.battle ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function withZoneRunMutationIdempotency(args: {
  characterId: string;
  requestKey: string;
  actionType: ZoneRunMutationActionType;
  execute: () => Promise<ZoneRunActionResponse>;
}): Promise<ZoneRunActionResponse> {
  assertNonEmptyString(args.requestKey, "requestKey");

  const existing = await prisma.zoneRunMutationDedup.findByCharacterIdAndRequestKey(
    args.characterId,
    args.requestKey,
  );
  if (existing !== null) {
    if (existing.actionType !== args.actionType) {
      throw new Error(
        `ERR_ZONE_RUN_IDEMPOTENCY_KEY_REUSED: request key ${args.requestKey} was already used for ${existing.actionType}`,
      );
    }
    return existing.response as ZoneRunActionResponse;
  }

  const result = await args.execute();

  try {
    await prisma.zoneRunMutationDedup.create({
      characterId: args.characterId,
      requestKey: args.requestKey,
      actionType: args.actionType,
      response: result,
    });
    return result;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const replay = await prisma.zoneRunMutationDedup.findByCharacterIdAndRequestKey(
      args.characterId,
      args.requestKey,
    );
    if (replay === null) {
      throw error;
    }
    if (replay.actionType !== args.actionType) {
      throw new Error(
        `ERR_ZONE_RUN_IDEMPOTENCY_KEY_REUSED: request key ${args.requestKey} was already used for ${replay.actionType}`,
      );
    }
    return replay.response as ZoneRunActionResponse;
  }
}

async function closeRun(args: {
  snapshot: InternalActiveZoneRunSnapshot;
  terminalStatus: ZoneRunTerminalStatus;
  zoneProgressDelta: unknown;
  provisionalProgressUpdate?: UpdateCharacterProvisionalProgressInput | null;
}): Promise<ClosedZoneRunSummary> {
  const closedRecord = await prisma.activeZoneRun.closeWithSummary({
    characterId: args.snapshot.characterId,
    summary: {
      zoneRunId: args.snapshot.runId,
      characterId: args.snapshot.characterId,
      zoneId: args.snapshot.zoneId,
      seasonId: args.snapshot.seasonId,
      topologyVersion: args.snapshot.topologyVersion,
      topologyHash: args.snapshot.topologyHash,
      terminalStatus: args.terminalStatus,
      rewardedBattleCount: Object.values(args.snapshot.enemyAppearanceCounts).reduce((sum, count) => sum + count, 0),
      rewardedEncounterHistogram: args.snapshot.enemyAppearanceCounts,
      zoneProgressDelta: args.zoneProgressDelta,
    },
    provisionalProgress: args.provisionalProgressUpdate,
  });

  return toExternalClosedSummary({
    zoneRunId: closedRecord.zoneRunId,
    characterId: closedRecord.characterId,
    zoneId: closedRecord.zoneId,
    seasonId: closedRecord.seasonId,
    topologyVersion: closedRecord.topologyVersion,
    topologyHash: closedRecord.topologyHash,
    terminalStatus: closedRecord.terminalStatus,
    rewardedBattleCount: closedRecord.rewardedBattleCount,
    rewardedEncounterHistogram: closedRecord.rewardedEncounterHistogram,
    zoneProgressDelta: closedRecord.zoneProgressDelta,
    closedAt: closedRecord.closedAt,
  });
}

async function loadActiveRunRecord(characterId: string) {
  const activeRun = await prisma.activeZoneRun.findByCharacterId(characterId);
  if (activeRun === null) {
    throw new Error(`ERR_ACTIVE_ZONE_RUN_NOT_FOUND: character ${characterId} has no active zone run`);
  }

  return activeRun;
}

async function maybeAutoCloseActiveRun(
  activeRun: Awaited<ReturnType<typeof prisma.activeZoneRun.findByCharacterId>>,
  deps: ZoneRunServiceDependencies,
): Promise<ClosedZoneRunSummary | null> {
  if (activeRun === null) {
    return null;
  }

  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const nowTs = currentUnixTimestamp(now);
  const idleTimeoutSeconds = resolveZoneRunIdleTimeoutSeconds(env);
  const updatedAtTs = currentUnixTimestamp(activeRun.updatedAt);
  const snapshot = activeRun.snapshot as InternalActiveZoneRunSnapshot;

  if (nowTs - updatedAtTs > idleTimeoutSeconds) {
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "EXPIRE",
      nodeId: snapshot.currentNodeId,
      subnodeId: snapshot.currentSubnodeId,
      payload: {
        idleTimeoutSeconds,
        lastUpdatedAt: activeRun.updatedAt.toISOString(),
        closedAt: now.toISOString(),
      },
    });

    return closeRun({
      snapshot,
      terminalStatus: "EXPIRED",
      zoneProgressDelta: [],
      provisionalProgressUpdate: null,
    });
  }

  const connection = deps.connection ?? createRunanaConnection(env);
  const commitment = deps.commitment ?? resolveRunanaCommitment(env);
  const programId = deps.programId ?? resolveRunanaProgramId(env);
  const seasonPolicy = await fetchSeasonPolicyAccount(
    connection as Connection,
    deriveSeasonPolicyPda(snapshot.seasonId, programId),
    commitment,
  );
  const seasonEndTs = Number(seasonPolicy.seasonEndTs);

  if (nowTs > seasonEndTs) {
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "SEASON_CUTOFF",
      nodeId: snapshot.currentNodeId,
      subnodeId: snapshot.currentSubnodeId,
      payload: {
        seasonId: snapshot.seasonId,
        seasonEndTs,
        closedAt: now.toISOString(),
      },
    });

    return closeRun({
      snapshot,
      terminalStatus: "SEASON_CUTOFF",
      zoneProgressDelta: [],
      provisionalProgressUpdate: null,
    });
  }

  return null;
}

async function loadActiveSnapshot(
  characterId: string,
  deps: ZoneRunServiceDependencies = {},
): Promise<{
  snapshot: InternalActiveZoneRunSnapshot | null;
  closedRunSummary: ClosedZoneRunSummary | null;
}> {
  const activeRun = await loadActiveRunRecord(characterId);
  const closedRunSummary = await maybeAutoCloseActiveRun(activeRun, deps);
  if (closedRunSummary !== null) {
    return {
      snapshot: null,
      closedRunSummary,
    };
  }

  return {
    snapshot: activeRun.snapshot as InternalActiveZoneRunSnapshot,
    closedRunSummary: null,
  };
}

async function startZoneRunInternal(
  input: StartZoneRunInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  assertInteger(input.zoneId, "zoneId", 1);

  const existing = await prisma.activeZoneRun.findByCharacterId(input.characterId);
  if (existing !== null) {
    const autoClosed = await maybeAutoCloseActiveRun(existing, deps);
    if (autoClosed === null) {
      throw new Error(
        `ERR_ACTIVE_ZONE_RUN_EXISTS: character ${input.characterId} already has an active zone run`,
      );
    }
  }

  const character = await loadCharacterBattleReadyRecord(input.characterId);
  if (character === null) {
    throw new Error("ERR_CHARACTER_NOT_FOUND: character was not found");
  }

  const topology = getLatestZoneRunTopology(input.zoneId);
  const { seasonId, highestUnlockedZoneId } = await resolveAccessContext(character, deps);
  if (input.zoneId > highestUnlockedZoneId) {
    throw new Error(
      `ERR_ZONE_LOCKED: zone ${input.zoneId} is not unlocked for the character (highest unlocked ${highestUnlockedZoneId})`,
    );
  }

  const runId = randomUUID();
  const snapshot = buildInitialSnapshot({
    runId,
    characterId: input.characterId,
    zoneId: input.zoneId,
    seasonId,
    topology,
    character,
  });

  await prisma.activeZoneRun.create({
    id: runId,
    characterId: input.characterId,
    zoneId: input.zoneId,
    seasonId,
    topologyVersion: topology.topologyVersion,
    topologyHash: topology.topologyHash,
    state: snapshot.state,
    currentNodeId: snapshot.currentNodeId,
    snapshot,
  });
  await prisma.zoneRunActionLog.create({
    zoneRunId: runId,
    characterId: input.characterId,
    actionType: "START",
    nodeId: snapshot.currentNodeId,
    subnodeId: snapshot.currentSubnodeId,
    payload: { zoneId: input.zoneId, seasonId },
  });

  return buildActionResponse({ snapshot });
}

export async function startZoneRun(
  input: StartZoneRunInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey,
    actionType: "START",
    execute: () => startZoneRunInternal(input, deps),
  });
}

export async function getActiveZoneRun(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  return buildActionResponse({ snapshot, closedRunSummary });
}

async function chooseZoneRunBranchInternal(
  input: ZoneRunBranchInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  if (snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary });
  }
  if (snapshot.state !== "AWAITING_BRANCH") {
    throw new Error("ERR_ZONE_RUN_BRANCH_NOT_EXPECTED: run is not waiting for a branch choice");
  }
  if (!snapshot.branchOptions.includes(input.nextNodeId)) {
    throw new Error(`ERR_ZONE_RUN_BRANCH_INVALID: node ${input.nextNodeId} is not a legal branch`);
  }

  const topology = getZoneRunTopology(snapshot.zoneId, snapshot.topologyVersion);
  const nextNode = getZoneNode(topology, input.nextNodeId);
  const nextSnapshot = cloneSnapshot(snapshot);
  nextSnapshot.currentNodeId = nextNode.nodeId;
  nextSnapshot.currentSubnodeId = nextNode.subnodes[0]?.subnodeId ?? null;
  nextSnapshot.currentSubnodeOrdinal = nextSnapshot.currentSubnodeId === null ? 0 : 1;
  nextSnapshot.state = "TRAVERSING";
  nextSnapshot.branchOptions = [];

  await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
    state: nextSnapshot.state,
    currentNodeId: nextSnapshot.currentNodeId,
    snapshot: nextSnapshot,
  });
  await prisma.zoneRunActionLog.create({
    zoneRunId: nextSnapshot.runId,
    characterId: nextSnapshot.characterId,
    actionType: "CHOOSE_BRANCH",
    nodeId: input.nextNodeId,
    payload: { nextNodeId: input.nextNodeId },
  });

  return buildActionResponse({ snapshot: nextSnapshot });
}

export async function chooseZoneRunBranch(
  input: ZoneRunBranchInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey,
    actionType: "CHOOSE_BRANCH",
    execute: () => chooseZoneRunBranchInternal(input, deps),
  });
}

async function advanceZoneRunSubnodeInternal(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const active = await loadActiveSnapshot(input.characterId, deps);
  if (active.snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary: active.closedRunSummary });
  }
  const snapshot = active.snapshot;
  if (snapshot.state !== "TRAVERSING" || snapshot.currentSubnodeId === null) {
    throw new Error("ERR_ZONE_RUN_ADVANCE_INVALID: run is not ready to advance a subnode");
  }

  const character = await loadCharacterBattleReadyRecord(input.characterId);
  if (character === null) {
    throw new Error("ERR_CHARACTER_NOT_FOUND: character was not found");
  }

  await resolveAccessContext(character, deps);

  const topology = getZoneRunTopology(snapshot.zoneId, snapshot.topologyVersion);
  const node = getZoneNode(topology, snapshot.currentNodeId);
  const nodeId = node.nodeId;
  const subnodeId = snapshot.currentSubnodeId;

  if (!resolveCombatTriggered(snapshot)) {
    const progressed = resolveNodeProgressAfterTraversal(snapshot, topology);
    progressed.snapshot.playerCarryover = applyTraversalTickToCarryover(progressed.snapshot.playerCarryover);
    progressed.snapshot.state = progressed.completeRun
      ? "POST_BATTLE_PAUSE"
      : progressed.snapshot.branchOptions.length > 0
        ? "AWAITING_BRANCH"
        : "TRAVERSING";
    progressed.snapshot.resumeState = progressed.completeRun ? "COMPLETE" : undefined;
    if (progressed.completeRun) {
      await prisma.zoneRunActionLog.create({
        zoneRunId: snapshot.runId,
        characterId: snapshot.characterId,
        actionType: "ADVANCE_NO_COMBAT_COMPLETE",
        nodeId,
        subnodeId,
        payload: { completeRun: true },
      });
      const provisionalProgress = await prisma.characterProvisionalProgress.findByCharacterId(character.id);
      const progressUpdate = provisionalProgress === null
        ? null
        : computeZoneProgressUpdateForSuccess(provisionalProgress, snapshot.zoneId);
      const closedSummary = await closeRun({
        snapshot: progressed.snapshot,
        terminalStatus: "COMPLETED",
        zoneProgressDelta: progressUpdate?.zoneProgressDelta ?? [],
        provisionalProgressUpdate: isConfirmedEncounterCharacter(character)
          ? null
          : progressUpdate === null
            ? null
            : {
                highestUnlockedZoneId: progressUpdate.highestUnlockedZoneId,
                highestClearedZoneId: progressUpdate.highestClearedZoneId,
                zoneStates: progressUpdate.zoneStates,
              },
      });
      return buildActionResponse({
        snapshot: null,
        closedRunSummary: closedSummary,
      });
    }

    await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
      state: progressed.snapshot.state,
      currentNodeId: progressed.snapshot.currentNodeId,
      snapshot: progressed.snapshot,
    });
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "ADVANCE_NO_COMBAT",
      nodeId,
      subnodeId,
      payload: { nextNodeId: progressed.snapshot.currentNodeId, nextSubnodeId: progressed.snapshot.currentSubnodeId },
    });
    return buildActionResponse({ snapshot: progressed.snapshot });
  }

  const enemyArchetypeId = selectEnemyArchetypeForSubnode({
    snapshot,
    topology,
    node,
  });
  if (enemyArchetypeId === null) {
    const progressed = resolveNodeProgressAfterTraversal(snapshot, topology);
    progressed.snapshot.playerCarryover = applyTraversalTickToCarryover(progressed.snapshot.playerCarryover);
    progressed.snapshot.state = progressed.completeRun
      ? "POST_BATTLE_PAUSE"
      : progressed.snapshot.branchOptions.length > 0
        ? "AWAITING_BRANCH"
        : "TRAVERSING";
    progressed.snapshot.resumeState = progressed.completeRun ? "COMPLETE" : undefined;
    if (progressed.completeRun) {
      await prisma.zoneRunActionLog.create({
        zoneRunId: snapshot.runId,
        characterId: snapshot.characterId,
        actionType: "ADVANCE_CAP_DEGRADED_COMPLETE",
        nodeId,
        subnodeId,
        payload: { reason: "NO_LEGAL_ENEMY_REMAINING" },
      });
      const provisionalProgress = await prisma.characterProvisionalProgress.findByCharacterId(character.id);
      const progressUpdate = provisionalProgress === null
        ? null
        : computeZoneProgressUpdateForSuccess(provisionalProgress, snapshot.zoneId);
      const closedSummary = await closeRun({
        snapshot: progressed.snapshot,
        terminalStatus: "COMPLETED",
        zoneProgressDelta: progressUpdate?.zoneProgressDelta ?? [],
        provisionalProgressUpdate: isConfirmedEncounterCharacter(character)
          ? null
          : progressUpdate === null
            ? null
            : {
                highestUnlockedZoneId: progressUpdate.highestUnlockedZoneId,
                highestClearedZoneId: progressUpdate.highestClearedZoneId,
                zoneStates: progressUpdate.zoneStates,
              },
      });
      return buildActionResponse({
        snapshot: null,
        closedRunSummary: closedSummary,
      });
    }
    await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
      state: progressed.snapshot.state,
      currentNodeId: progressed.snapshot.currentNodeId,
      snapshot: progressed.snapshot,
    });
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "ADVANCE_CAP_DEGRADED",
      nodeId,
      subnodeId,
      payload: { reason: "NO_LEGAL_ENEMY_REMAINING" },
    });
    return buildActionResponse({ snapshot: progressed.snapshot });
  }

  const battleId = randomUUID();
  const seed = generateBattleSeed();
  const playerInitial = buildPlayerCombatSnapshotFromCarryover(character, snapshot.playerCarryover);
  const enemyInitial = buildEnemyCombatSnapshot(getEnemyArchetypeDef(enemyArchetypeId));
  const battleResult = simulateBattle({
    battleId,
    seed,
    playerInitial,
    enemyInitial,
    playerInitialCooldowns: snapshot.playerCarryover.cooldowns,
    playerInitialStatuses: toBattleStatuses(snapshot.playerCarryover),
  });
  const playerFinal = battleResult.playerFinal ?? statusForMissingFinals();
  const enemyFinal = battleResult.enemyFinal ?? statusForMissingFinals();
  const lastBattle: ZoneRunLastBattleSummary = {
    battleId,
    enemyArchetypeId,
    nodeId,
    subnodeId,
    rewarded: battleResult.winnerEntityId === character.id,
    battleResult: {
      ...battleResult,
      playerFinal,
      enemyFinal,
    },
  };
  const battleTs = currentUnixTimestamp((deps.now ?? (() => new Date()))());

  if (battleResult.winnerEntityId !== character.id) {
    await persistLosingBattle({
      snapshot,
      character,
      nodeId,
      subnodeId,
      enemyArchetypeId,
      battleId,
      seed,
      battleResult: lastBattle.battleResult,
    });
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "ADVANCE_COMBAT_LOSS",
      nodeId,
      subnodeId,
      payload: { battleId, enemyArchetypeId },
    });
    const closedSummary = await closeRun({
      snapshot,
      terminalStatus: "FAILED",
      zoneProgressDelta: [],
      provisionalProgressUpdate: null,
    });
    return buildActionResponse({
      snapshot: null,
      closedRunSummary: closedSummary,
      battle: lastBattle,
    });
  }

  await persistWinningBattle({
    snapshot,
    character,
    nodeId,
    subnodeId,
    enemyArchetypeId,
    battleId,
    seed,
    battleTs,
    battleResult: lastBattle.battleResult,
  });

  const progressed = resolveNodeProgressAfterTraversal(snapshot, topology);
  progressed.snapshot.enemyAppearanceCounts[String(enemyArchetypeId)] =
    (progressed.snapshot.enemyAppearanceCounts[String(enemyArchetypeId)] ?? 0) + 1;
  progressed.snapshot.playerCarryover = applyTraversalTickToCarryover(
    buildCarryoverFromBattleFinal(playerFinal),
  );
  progressed.snapshot.lastBattle = lastBattle;
  progressed.snapshot.state = "POST_BATTLE_PAUSE";
  progressed.snapshot.resumeState = progressed.completeRun
    ? "COMPLETE"
    : progressed.snapshot.branchOptions.length > 0
      ? "AWAITING_BRANCH"
      : "TRAVERSING";

  await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
    state: progressed.snapshot.state,
    currentNodeId: progressed.snapshot.currentNodeId,
    snapshot: progressed.snapshot,
  });
  await prisma.zoneRunActionLog.create({
    zoneRunId: snapshot.runId,
    characterId: snapshot.characterId,
    actionType: "ADVANCE_COMBAT_WIN",
    nodeId,
    subnodeId,
    payload: { battleId, enemyArchetypeId },
  });

  return buildActionResponse({
    snapshot: progressed.snapshot,
    battle: lastBattle,
  });
}

export async function advanceZoneRunSubnode(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey ?? "",
    actionType: "ADVANCE",
    execute: () => advanceZoneRunSubnodeInternal(input, deps),
  });
}

async function useZoneRunPauseSkillInternal(
  input: ZoneRunPauseSkillInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  if (snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary });
  }
  if (snapshot.state !== "POST_BATTLE_PAUSE") {
    throw new Error("ERR_ZONE_RUN_PAUSE_SKILL_INVALID: pause skill can only be used after combat");
  }
  const character = await loadCharacterBattleReadyRecord(input.characterId);
  if (character === null) {
    throw new Error("ERR_CHARACTER_NOT_FOUND: character was not found");
  }
  if (!character.activeSkills.includes(input.skillId)) {
    throw new Error(`ERR_ZONE_RUN_SKILL_NOT_EQUIPPED: skill ${input.skillId} is not equipped on the character`);
  }

  const nextSnapshot = cloneSnapshot(snapshot);
  nextSnapshot.playerCarryover = applyPauseSkillToCarryover({
    carryover: nextSnapshot.playerCarryover,
    skillId: input.skillId,
    sourceId: nextSnapshot.characterId,
  });

  await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
    state: nextSnapshot.state,
    currentNodeId: nextSnapshot.currentNodeId,
    snapshot: nextSnapshot,
  });
  await prisma.zoneRunActionLog.create({
    zoneRunId: nextSnapshot.runId,
    characterId: nextSnapshot.characterId,
    actionType: "USE_PAUSE_SKILL",
    nodeId: nextSnapshot.currentNodeId,
    subnodeId: nextSnapshot.currentSubnodeId,
    payload: { skillId: input.skillId },
  });

  return buildActionResponse({ snapshot: nextSnapshot });
}

export async function useZoneRunPauseSkill(
  input: ZoneRunPauseSkillInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey,
    actionType: "USE_PAUSE_SKILL",
    execute: () => useZoneRunPauseSkillInternal(input, deps),
  });
}

async function continueZoneRunAfterBattleInternal(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  if (snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary });
  }
  if (snapshot.state !== "POST_BATTLE_PAUSE") {
    throw new Error("ERR_ZONE_RUN_CONTINUE_INVALID: run is not paused after battle");
  }

  if (snapshot.resumeState === "COMPLETE") {
    const character = await loadCharacterBattleReadyRecord(input.characterId);
    if (character === null) {
      throw new Error("ERR_CHARACTER_NOT_FOUND: character was not found");
    }
    await prisma.zoneRunActionLog.create({
      zoneRunId: snapshot.runId,
      characterId: snapshot.characterId,
      actionType: "CONTINUE_AND_COMPLETE",
      nodeId: snapshot.currentNodeId,
      payload: {},
    });
    const provisionalProgress = await prisma.characterProvisionalProgress.findByCharacterId(character.id);
    const progressUpdate = provisionalProgress === null
      ? null
      : computeZoneProgressUpdateForSuccess(provisionalProgress, snapshot.zoneId);
    const closedSummary = await closeRun({
      snapshot,
      terminalStatus: "COMPLETED",
      zoneProgressDelta: progressUpdate?.zoneProgressDelta ?? [],
      provisionalProgressUpdate: isConfirmedEncounterCharacter(character)
        ? null
        : progressUpdate === null
          ? null
          : {
              highestUnlockedZoneId: progressUpdate.highestUnlockedZoneId,
              highestClearedZoneId: progressUpdate.highestClearedZoneId,
              zoneStates: progressUpdate.zoneStates,
            },
    });
    return buildActionResponse({
      snapshot: null,
      closedRunSummary: closedSummary,
      battle: snapshot.lastBattle,
    });
  }

  const nextState = snapshot.resumeState ?? "TRAVERSING";
  const nextSnapshot = cloneSnapshot(snapshot);
  nextSnapshot.state = nextState;
  nextSnapshot.resumeState = undefined;

  await prisma.activeZoneRun.updateByCharacterId(input.characterId, {
    state: nextSnapshot.state,
    currentNodeId: nextSnapshot.currentNodeId,
    snapshot: nextSnapshot,
  });
  await prisma.zoneRunActionLog.create({
    zoneRunId: nextSnapshot.runId,
    characterId: nextSnapshot.characterId,
    actionType: "CONTINUE_AFTER_BATTLE",
    nodeId: nextSnapshot.currentNodeId,
    subnodeId: nextSnapshot.currentSubnodeId,
    payload: { nextState },
  });

  return buildActionResponse({ snapshot: nextSnapshot });
}

export async function continueZoneRunAfterBattle(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey ?? "",
    actionType: "CONTINUE",
    execute: () => continueZoneRunAfterBattleInternal(input, deps),
  });
}

async function abandonZoneRunInternal(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  if (snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary });
  }
  await prisma.zoneRunActionLog.create({
    zoneRunId: snapshot.runId,
    characterId: snapshot.characterId,
    actionType: "ABANDON",
    nodeId: snapshot.currentNodeId,
    subnodeId: snapshot.currentSubnodeId,
    payload: {},
  });
  const closedSummary = await closeRun({
    snapshot,
    terminalStatus: "ABANDONED",
    zoneProgressDelta: [],
    provisionalProgressUpdate: null,
  });

  return buildActionResponse({
    snapshot: null,
    closedRunSummary: closedSummary,
    battle: snapshot.lastBattle,
  });
}

export async function abandonZoneRun(
  input: ZoneRunCharacterInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  return withZoneRunMutationIdempotency({
    characterId: input.characterId,
    requestKey: input.requestKey ?? "",
    actionType: "ABANDON",
    execute: () => abandonZoneRunInternal(input, deps),
  });
}

export async function useZoneRunConsumableItem(
  input: ZoneRunUseItemInput,
  deps: ZoneRunServiceDependencies = {},
): Promise<ZoneRunActionResponse> {
  const { snapshot, closedRunSummary } = await loadActiveSnapshot(input.characterId, deps);
  if (snapshot === null) {
    return buildActionResponse({ snapshot: null, closedRunSummary });
  }

  throw new Error(
    `ERR_ZONE_RUN_ITEMS_UNSUPPORTED: consumable item ${input.itemId} is not supported during zone runs`,
  );
}
