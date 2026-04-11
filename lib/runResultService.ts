import { getEnemyArchetypeDef } from "./combat/enemyArchetypes";
import { prisma } from "./prisma";
import type {
  BattleSettlementStatus,
  RunResultReadModel,
  RunShareResponse,
  RunShareStatus,
} from "../types/api/frontend";
import type { ActiveZoneRunState } from "../types/zoneRun";

type ActiveRunPreviewSnapshot = {
  runId: string;
  characterId: string;
  zoneId: number;
  seasonId: number;
  topologyVersion: number;
  topologyHash: string;
  state: ActiveZoneRunState;
  currentNodeId: string;
  totalSubnodesTraversed: number;
  totalSubnodesInRun: number;
};

function isPendingCompletionSnapshot(
  snapshot: ActiveRunPreviewSnapshot,
): boolean {
  return (
    snapshot.state === "POST_BATTLE_PAUSE" &&
    snapshot.totalSubnodesTraversed >= snapshot.totalSubnodesInRun
  );
}

function resolveShareState(args: {
  terminalStatus: string;
  closedAt: string | null;
  battleStatuses: Array<BattleSettlementStatus | null>;
}): {
  shareStatus: RunShareStatus;
  shareStatusLabel: string;
  shareStatusDetail: string;
} {
  const unresolved = args.closedAt === null
    || args.battleStatuses.some((status) => status !== null && status !== "COMMITTED");

  if (
    unresolved &&
    (args.terminalStatus === "EXPIRED" || args.terminalStatus === "SEASON_CUTOFF")
  ) {
    return {
      shareStatus: "EXPIRED",
      shareStatusLabel: "Expired",
      shareStatusDetail: "Expired, not synced",
    };
  }

  if (unresolved) {
    return {
      shareStatus: "PENDING",
      shareStatusLabel: "Pending",
      shareStatusDetail:
        args.closedAt === null
          ? "Run complete. Exit the pause to finalize the result."
          : "Pending sync",
    };
  }

  return {
    shareStatus: "SYNCED",
    shareStatusLabel: "Synced",
    shareStatusDetail: "Synced to chain",
  };
}

export async function getRunResult(runId: string): Promise<RunResultReadModel> {
  const [closedRun, activeRun, battleRecords, ledgers] = await Promise.all([
    prisma.closedZoneRunSummary.findByRunId(runId),
    prisma.activeZoneRun.findByRunId(runId),
    prisma.battleRecord.listByZoneRunId(runId),
    prisma.battleOutcomeLedger.listByZoneRunId(runId),
  ]);

  const effectiveCharacterId =
    closedRun?.characterId ?? activeRun?.characterId ?? null;
  if (effectiveCharacterId === null) {
    throw new Error("ERR_RUN_NOT_FOUND: run was not found");
  }

  const character = await prisma.character.findById(effectiveCharacterId);
  if (character === null) {
    throw new Error("ERR_RUN_NOT_FOUND: character was not found");
  }

  const activeSnapshot = (activeRun?.snapshot ?? null) as ActiveRunPreviewSnapshot | null;
  const pendingCompletion =
    closedRun === null &&
    activeSnapshot !== null &&
    isPendingCompletionSnapshot(activeSnapshot);
  if (closedRun === null && !pendingCompletion) {
    throw new Error("ERR_RUN_NOT_FOUND: run result is not available");
  }

  const ledgerByBattleId = new Map(
    ledgers.map((ledger) => [ledger.battleId, ledger] as const),
  );
  const battles = battleRecords.map((battle) => {
    const ledger = ledgerByBattleId.get(battle.battleId) ?? null;
    return {
      battleId: battle.battleId,
      enemyArchetypeId: battle.enemyArchetypeId,
      enemyName: getEnemyArchetypeDef(battle.enemyArchetypeId).displayName,
      nodeId: battle.nodeId ?? null,
      subnodeId: battle.subnodeId ?? null,
      rewardEligible: battle.rewardEligible ?? true,
      winnerEntityId: battle.winnerEntityId,
      roundsPlayed: battle.roundsPlayed,
      settlementStatus: ledger?.settlementStatus ?? null,
      committedAt: ledger?.committedAt?.toISOString() ?? null,
      battleTs: ledger?.battleTs ?? null,
      createdAt: battle.createdAt.toISOString(),
    };
  });

  const terminalStatus = closedRun?.terminalStatus ?? "COMPLETED";
  const shareState = resolveShareState({
    terminalStatus,
    closedAt: closedRun?.closedAt.toISOString() ?? null,
    battleStatuses: battles.map((battle) => battle.settlementStatus),
  });

  return {
    runId,
    characterId: character.id,
    characterName: character.name,
    classId: character.classId ?? "soldier",
    zoneId: closedRun?.zoneId ?? activeSnapshot!.zoneId,
    seasonId: closedRun?.seasonId ?? activeSnapshot!.seasonId,
    topologyVersion: closedRun?.topologyVersion ?? activeSnapshot!.topologyVersion,
    topologyHash: closedRun?.topologyHash ?? activeSnapshot!.topologyHash,
    terminalStatus,
    shareStatus: shareState.shareStatus,
    shareStatusLabel: shareState.shareStatusLabel,
    shareStatusDetail: shareState.shareStatusDetail,
    battleCount: battles.length,
    rewardedBattleCount:
      closedRun?.rewardedBattleCount
      ?? battles.filter((battle) => battle.rewardEligible).length,
    rewardedEncounterHistogram:
      closedRun?.rewardedEncounterHistogram
      ?? Object.fromEntries(
        battles
          .filter((battle) => battle.rewardEligible)
          .reduce((map, battle) => {
            map.set(
              String(battle.enemyArchetypeId),
              (map.get(String(battle.enemyArchetypeId)) ?? 0) + 1,
            );
            return map;
          }, new Map<string, number>()),
      ),
    zoneProgressDelta: closedRun?.zoneProgressDelta ?? [],
    closedAt: closedRun?.closedAt.toISOString() ?? null,
    resultUrl: `/runs/${encodeURIComponent(runId)}`,
    shareUrl: `/share/runs/${encodeURIComponent(runId)}`,
    battles,
  };
}

export async function createRunSharePayload(
  runId: string,
  origin: string,
): Promise<RunShareResponse> {
  const run = await getRunResult(runId);
  const shareUrl = new URL(run.shareUrl, origin).toString();
  const resultUrl = new URL(run.resultUrl, origin).toString();

  return {
    runId: run.runId,
    shareUrl,
    resultUrl,
    shareText: `${run.characterName} finished Zone ${run.zoneId} in RUNANA. ${shareUrl}`,
    shareStatus: run.shareStatus,
  };
}
