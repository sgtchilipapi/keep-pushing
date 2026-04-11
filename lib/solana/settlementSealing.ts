import type {
  BattleOutcomeLedgerRecord,
  ClosedZoneRunSummaryRecord,
  SettlementBatchRecord,
} from "../prisma";
import type {
  RunEncounterCountEntry,
  SettlementBatchPayloadV2,
  SettlementRunSummary,
  SettlementSchemaVersion,
  SettlementSignatureScheme,
  ZoneProgressDeltaEntry,
} from "../../types/settlement";
import {
  computeCanonicalEndStateHashHex,
  computeSettlementBatchHashHex,
} from "./settlementCanonical";

export const SETTLEMENT_SCHEMA_VERSION_V2: SettlementSchemaVersion = 2;
export const SETTLEMENT_SIGNATURE_SCHEME_ED25519_RAW: SettlementSignatureScheme = 0;
export const SETTLEMENT_SIGNATURE_SCHEME_WALLET_TEXT_V1: SettlementSignatureScheme = 1;
export const DEFAULT_SETTLEMENT_SIGNATURE_SCHEME: SettlementSignatureScheme =
  SETTLEMENT_SIGNATURE_SCHEME_WALLET_TEXT_V1;

export interface SettlementSealingCursor {
  lastCommittedEndNonce: number;
  lastCommittedStateHash: string;
  lastCommittedBatchId: number;
  lastCommittedBattleTs: number;
  lastCommittedSeasonId: number;
}

export interface SealSettlementBatchArgs {
  characterIdHex: string;
  cursor: SettlementSealingCursor;
  pendingRuns?: ClosedZoneRunSummaryRecord[];
  pendingBattles?: BattleOutcomeLedgerRecord[];
  maxRunsPerBatch?: number;
  maxBattlesPerBatch?: number;
  maxHistogramEntriesPerBatch: number;
  optionalLoadoutRevision?: number;
}

export interface SealedSettlementBatchDraft {
  payload: SettlementBatchPayloadV2;
  sealedRunIds?: string[];
  sealedBattleIds: string[];
}

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function compareZoneDeltas(left: ZoneProgressDeltaEntry, right: ZoneProgressDeltaEntry): number {
  return left.zoneId - right.zoneId;
}

function normalizeHexLower(value: string, field: string, expectedBytes: number): string {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  assertCondition(
    /^[0-9a-fA-F]+$/.test(normalized) && normalized.length === expectedBytes * 2,
    `ERR_INVALID_${field.toUpperCase()}`,
    `${field} must be ${expectedBytes} bytes encoded as hex`,
  );
  return normalized.toLowerCase();
}

function hexToBytes(value: string, field: string, expectedBytes: number): Uint8Array {
  return Uint8Array.from(Buffer.from(normalizeHexLower(value, field, expectedBytes), "hex"));
}

function parseRewardedEncounterHistogram(value: unknown): RunEncounterCountEntry[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      "ERR_INVALID_REWARDED_ENCOUNTER_HISTOGRAM: rewardedEncounterHistogramJson must be an object",
    );
  }

  return Object.entries(value)
    .map(([enemyArchetypeId, count]) => {
      const parsedEnemyArchetypeId = Number(enemyArchetypeId);
      if (!Number.isInteger(parsedEnemyArchetypeId) || parsedEnemyArchetypeId < 0) {
        throw new Error(
          "ERR_INVALID_REWARDED_ENCOUNTER_HISTOGRAM: enemy archetype ids must be integer keys",
        );
      }
      if (!Number.isInteger(count) || (count as number) < 0) {
        throw new Error(
          "ERR_INVALID_REWARDED_ENCOUNTER_HISTOGRAM: encounter counts must be integers >= 0",
        );
      }

      return {
        enemyArchetypeId: parsedEnemyArchetypeId,
        count: count as number,
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => left.enemyArchetypeId - right.enemyArchetypeId);
}

function parseZoneProgressDelta(value: unknown): ZoneProgressDeltaEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`ERR_INVALID_ZONE_PROGRESS_DELTA: zoneProgressDeltaJson[${index}] must be an object`);
      }
      const candidate = entry as Record<string, unknown>;
      if (!Number.isInteger(candidate.zoneId) || (candidate.zoneId as number) < 0) {
        throw new Error(
          `ERR_INVALID_ZONE_PROGRESS_DELTA: zoneProgressDeltaJson[${index}].zoneId must be an integer >= 0`,
        );
      }
      if (candidate.newState !== 1 && candidate.newState !== 2) {
        throw new Error(
          `ERR_INVALID_ZONE_PROGRESS_DELTA: zoneProgressDeltaJson[${index}].newState must be 1 or 2`,
        );
      }

      return {
        zoneId: candidate.zoneId as number,
        newState: candidate.newState as 1 | 2,
      };
    })
    .sort(compareZoneDeltas);
}

function requireBattleNonce(battle: BattleOutcomeLedgerRecord): number {
  assertCondition(
    battle.battleNonce !== null,
    "ERR_PENDING_NONCE_MISSING",
    `battle ${battle.id} is missing a finalized battle nonce`,
  );
  return battle.battleNonce;
}

function compareEncounterEntries(
  left: SettlementBatchPayloadV2["encounterHistogram"][number],
  right: SettlementBatchPayloadV2["encounterHistogram"][number],
): number {
  return left.zoneId - right.zoneId || left.enemyArchetypeId - right.enemyArchetypeId;
}

function contiguousBattlePrefix(
  battles: BattleOutcomeLedgerRecord[],
  expectedStartNonce: number,
  maxBattlesPerBatch: number,
  maxHistogramEntriesPerBatch: number,
): BattleOutcomeLedgerRecord[] {
  assertCondition(maxBattlesPerBatch > 0, "ERR_INVALID_BATCH_POLICY", "maxBattlesPerBatch must be > 0");
  assertCondition(
    maxHistogramEntriesPerBatch > 0,
    "ERR_INVALID_BATCH_POLICY",
    "maxHistogramEntriesPerBatch must be > 0",
  );
  assertCondition(battles.length > 0, "ERR_NO_PENDING_BATTLES", "no pending battles were available to seal");

  const first = battles[0];
  assertCondition(
    requireBattleNonce(first) === expectedStartNonce,
    "ERR_PENDING_NONCE_GAP",
    "oldest pending battle nonce did not match the expected next cursor nonce",
  );

  const selected: BattleOutcomeLedgerRecord[] = [];
  const histogramKeys = new Set<string>();
  const seasonId = first.seasonId;
  let expectedNonce = expectedStartNonce;

  for (const battle of battles) {
    if (requireBattleNonce(battle) !== expectedNonce) {
      break;
    }
    if (battle.seasonId !== seasonId) {
      break;
    }

    const histogramKey = `${battle.zoneId}:${battle.enemyArchetypeId}`;
    const nextHistogramSize = histogramKeys.has(histogramKey)
      ? histogramKeys.size
      : histogramKeys.size + 1;

    if (selected.length >= maxBattlesPerBatch || nextHistogramSize > maxHistogramEntriesPerBatch) {
      break;
    }

    selected.push(battle);
    histogramKeys.add(histogramKey);
    expectedNonce += 1;
  }

  assertCondition(
    selected.length > 0,
    "ERR_EMPTY_BATCH_SELECTION",
    "no contiguous pending battles could be sealed under current policy constraints",
  );

  return selected;
}

function legacyAggregateEncounterHistogram(
  battles: BattleOutcomeLedgerRecord[],
): SettlementBatchPayloadV2["encounterHistogram"] {
  const counts = new Map<string, SettlementBatchPayloadV2["encounterHistogram"][number]>();

  for (const battle of battles) {
    const key = `${battle.zoneId}:${battle.enemyArchetypeId}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(key, {
      zoneId: battle.zoneId,
      enemyArchetypeId: battle.enemyArchetypeId,
      count: 1,
    });
  }

  return [...counts.values()].sort(compareEncounterEntries);
}

function legacyAggregateZoneProgressDelta(
  battles: BattleOutcomeLedgerRecord[],
): ZoneProgressDeltaEntry[] {
  const nextStateByZone = new Map<number, ZoneProgressDeltaEntry["newState"]>();
  for (const battle of battles) {
    for (const delta of parseZoneProgressDelta(battle.zoneProgressDelta)) {
      const current = nextStateByZone.get(delta.zoneId) ?? 1;
      nextStateByZone.set(delta.zoneId, delta.newState > current ? delta.newState : current);
    }
  }
  return [...nextStateByZone.entries()]
    .map(([zoneId, newState]) => ({ zoneId, newState }))
    .sort(compareZoneDeltas);
}

function compareRunSummaries(left: SettlementRunSummary, right: SettlementRunSummary): number {
  return left.closedRunSequence - right.closedRunSequence;
}

function toRunSummary(run: ClosedZoneRunSummaryRecord): SettlementRunSummary {
  assertCondition(run.settleable, "ERR_ZERO_VALUE_RUN", "zero-value closed runs must not be sealed");
  assertCondition(
    run.closedRunSequence !== null,
    "ERR_MISSING_CLOSED_RUN_SEQUENCE",
    `closed run ${run.zoneRunId} is missing a canonical closedRunSequence`,
  );
  assertCondition(
    run.firstRewardedBattleTs !== null && run.lastRewardedBattleTs !== null,
    "ERR_MISSING_REWARDED_BATTLE_TS",
    `closed run ${run.zoneRunId} is missing rewarded battle timestamps`,
  );

  return {
    closedRunSequence: run.closedRunSequence,
    zoneId: run.zoneId,
    topologyVersion: run.topologyVersion,
    topologyHash: normalizeHexLower(run.topologyHash, "topologyHash", 32),
    terminalStatus: run.terminalStatus,
    rewardedBattleCount: run.rewardedBattleCount,
    rewardedEncounterHistogram: parseRewardedEncounterHistogram(run.rewardedEncounterHistogram),
    zoneProgressDelta: parseZoneProgressDelta(run.zoneProgressDelta),
    firstRewardedBattleTs: run.firstRewardedBattleTs,
    lastRewardedBattleTs: run.lastRewardedBattleTs,
  };
}

function contiguousRunPrefix(
  runs: ClosedZoneRunSummaryRecord[],
  expectedStartSequence: number,
  maxRunsPerBatch: number,
  maxHistogramEntriesPerBatch: number,
): SettlementRunSummary[] {
  assertCondition(maxRunsPerBatch > 0, "ERR_INVALID_BATCH_POLICY", "maxRunsPerBatch must be > 0");
  assertCondition(
    maxHistogramEntriesPerBatch > 0,
    "ERR_INVALID_BATCH_POLICY",
    "maxHistogramEntriesPerBatch must be > 0",
  );
  assertCondition(runs.length > 0, "ERR_NO_PENDING_RUNS", "no pending closed runs were available to seal");

  const sortedRuns = [...runs].sort((left, right) => {
    const leftSequence = left.closedRunSequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.closedRunSequence ?? Number.MAX_SAFE_INTEGER;
    return leftSequence - rightSequence;
  });

  const first = toRunSummary(sortedRuns[0]);
  assertCondition(
    first.closedRunSequence === expectedStartSequence,
    "ERR_PENDING_RUN_SEQUENCE_GAP",
    "oldest pending closedRunSequence did not match the expected next cursor sequence",
  );

  const selected: SettlementRunSummary[] = [];
  let expectedSequence = expectedStartSequence;
  let histogramRowCount = 0;
  let seasonId = sortedRuns[0].seasonId;

  for (const run of sortedRuns) {
    const summary = toRunSummary(run);
    if (summary.closedRunSequence !== expectedSequence) {
      break;
    }
    if (run.seasonId !== seasonId) {
      break;
    }

    const nextHistogramRowCount = histogramRowCount + summary.rewardedEncounterHistogram.length;
    if (selected.length >= maxRunsPerBatch || nextHistogramRowCount > maxHistogramEntriesPerBatch) {
      break;
    }

    selected.push(summary);
    expectedSequence += 1;
    histogramRowCount = nextHistogramRowCount;
  }

  assertCondition(
    selected.length > 0,
    "ERR_EMPTY_BATCH_SELECTION",
    "no contiguous pending runs could be sealed under current policy constraints",
  );

  return selected.sort(compareRunSummaries);
}

function aggregateZoneProgressDelta(runSummaries: SettlementRunSummary[]): ZoneProgressDeltaEntry[] {
  const nextStateByZone = new Map<number, ZoneProgressDeltaEntry["newState"]>();

  for (const summary of runSummaries) {
    for (const delta of summary.zoneProgressDelta) {
      const current = nextStateByZone.get(delta.zoneId) ?? 1;
      nextStateByZone.set(delta.zoneId, delta.newState > current ? delta.newState : current);
    }
  }

  return [...nextStateByZone.entries()]
    .map(([zoneId, newState]) => ({ zoneId, newState }))
    .sort(compareZoneDeltas);
}

function aggregateRewardedBattleCount(runSummaries: SettlementRunSummary[]): number {
  return runSummaries.reduce((sum, summary) => sum + summary.rewardedBattleCount, 0);
}

function computeBatchBattleTs(runSummaries: SettlementRunSummary[]): { firstBattleTs: number; lastBattleTs: number } {
  const timestamps = runSummaries.flatMap((summary) => [
    summary.firstRewardedBattleTs,
    summary.lastRewardedBattleTs,
  ]);
  return {
    firstBattleTs: Math.min(...timestamps),
    lastBattleTs: Math.max(...timestamps),
  };
}

function aggregateEncounterHistogram(runSummaries: SettlementRunSummary[]) {
  const counts = new Map<string, { zoneId: number; enemyArchetypeId: number; count: number }>();

  for (const summary of runSummaries) {
    for (const entry of summary.rewardedEncounterHistogram) {
      const key = `${summary.zoneId}:${entry.enemyArchetypeId}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += entry.count;
        continue;
      }
      counts.set(key, {
        zoneId: summary.zoneId,
        enemyArchetypeId: entry.enemyArchetypeId,
        count: entry.count,
      });
    }
  }

  return [...counts.values()].sort(
    (left, right) => left.zoneId - right.zoneId || left.enemyArchetypeId - right.enemyArchetypeId,
  );
}

export function sealSettlementBatchDraft(args: SealSettlementBatchArgs): SealedSettlementBatchDraft {
  const characterIdHex = normalizeHexLower(args.characterIdHex, "characterId", 16);
  const cursor: SettlementSealingCursor = {
    lastCommittedEndNonce: args.cursor.lastCommittedEndNonce,
    lastCommittedStateHash: normalizeHexLower(args.cursor.lastCommittedStateHash, "lastCommittedStateHash", 32),
    lastCommittedBatchId: args.cursor.lastCommittedBatchId,
    lastCommittedBattleTs: args.cursor.lastCommittedBattleTs,
    lastCommittedSeasonId: args.cursor.lastCommittedSeasonId,
  };

  if ((args.pendingRuns?.length ?? 0) === 0 && (args.pendingBattles?.length ?? 0) > 0) {
    const battles = contiguousBattlePrefix(
      [...(args.pendingBattles ?? [])].sort(
        (left, right) => requireBattleNonce(left) - requireBattleNonce(right),
      ),
      cursor.lastCommittedEndNonce + 1,
      args.maxBattlesPerBatch ?? args.maxRunsPerBatch ?? 1,
      args.maxHistogramEntriesPerBatch,
    );
    const zoneProgressDelta = legacyAggregateZoneProgressDelta(battles);
    const encounterHistogram = legacyAggregateEncounterHistogram(battles);
    const first = battles[0];
    const last = battles[battles.length - 1];
    const payloadBase = {
      characterId: characterIdHex,
      batchId: cursor.lastCommittedBatchId + 1,
      startRunSequence: requireBattleNonce(first),
      endRunSequence: requireBattleNonce(last),
      runSummaries: undefined,
      startNonce: requireBattleNonce(first),
      endNonce: requireBattleNonce(last),
      battleCount: battles.length,
      startStateHash: cursor.lastCommittedStateHash,
      endStateHash: "",
      zoneProgressDelta,
      encounterHistogram,
      optionalLoadoutRevision: args.optionalLoadoutRevision,
      batchHash: "",
      firstBattleTs: first.battleTs,
      lastBattleTs: last.battleTs,
      seasonId: first.seasonId,
      schemaVersion: SETTLEMENT_SCHEMA_VERSION_V2,
      signatureScheme: DEFAULT_SETTLEMENT_SIGNATURE_SCHEME,
    };
    const endStateHash = computeCanonicalEndStateHashHex({
      ...payloadBase,
      characterId: hexToBytes(payloadBase.characterId, "characterId", 16),
      startStateHash: hexToBytes(payloadBase.startStateHash, "startStateHash", 32),
    });
    const payload: SettlementBatchPayloadV2 = {
      ...payloadBase,
      endStateHash,
      batchHash: computeSettlementBatchHashHex({
        ...payloadBase,
        characterId: hexToBytes(payloadBase.characterId, "characterId", 16),
        startStateHash: hexToBytes(payloadBase.startStateHash, "startStateHash", 32),
        endStateHash: hexToBytes(endStateHash, "endStateHash", 32),
      }),
    };

    return {
      payload,
      sealedRunIds: [],
      sealedBattleIds: battles.map((battle) => battle.id),
    };
  }

  const pendingRuns = args.pendingRuns ?? [];
  assertCondition(pendingRuns.length > 0, "ERR_NO_PENDING_RUNS", "no pending closed runs were available to seal");
  const selectedRuns = contiguousRunPrefix(
    pendingRuns,
    cursor.lastCommittedEndNonce + 1,
    args.maxRunsPerBatch ?? args.maxBattlesPerBatch ?? 1,
    args.maxHistogramEntriesPerBatch,
  );
  const startRunSequence = selectedRuns[0].closedRunSequence;
  const endRunSequence = selectedRuns[selectedRuns.length - 1].closedRunSequence;
  const batchBattleTs = computeBatchBattleTs(selectedRuns);
  const battleCount = aggregateRewardedBattleCount(selectedRuns);
  const zoneProgressDelta = aggregateZoneProgressDelta(selectedRuns);
  const encounterHistogram = aggregateEncounterHistogram(selectedRuns);
  const optionalLoadoutRevision = args.optionalLoadoutRevision;
  const seasonId = pendingRuns.find(
    (run) => run.closedRunSequence === startRunSequence,
  )?.seasonId;

  assertCondition(
    seasonId !== undefined,
    "ERR_PENDING_RUN_MISSING",
    "could not resolve season for selected run batch",
  );

  const payloadBase = {
    characterId: characterIdHex,
    batchId: cursor.lastCommittedBatchId + 1,
    startRunSequence,
    endRunSequence,
    runSummaries: selectedRuns,
    startNonce: startRunSequence,
    endNonce: endRunSequence,
    battleCount,
    startStateHash: cursor.lastCommittedStateHash,
    endStateHash: "",
    zoneProgressDelta,
    encounterHistogram,
    optionalLoadoutRevision,
    batchHash: "",
    firstBattleTs: batchBattleTs.firstBattleTs,
    lastBattleTs: batchBattleTs.lastBattleTs,
    seasonId,
    schemaVersion: SETTLEMENT_SCHEMA_VERSION_V2,
    signatureScheme: DEFAULT_SETTLEMENT_SIGNATURE_SCHEME,
  };

  const endStateHash = computeCanonicalEndStateHashHex({
    ...payloadBase,
    characterId: hexToBytes(payloadBase.characterId, "characterId", 16),
    startStateHash: hexToBytes(payloadBase.startStateHash, "startStateHash", 32),
  });

  const payload: SettlementBatchPayloadV2 = {
    ...payloadBase,
    endStateHash,
    batchHash: computeSettlementBatchHashHex({
      ...payloadBase,
      characterId: hexToBytes(payloadBase.characterId, "characterId", 16),
      startStateHash: hexToBytes(payloadBase.startStateHash, "startStateHash", 32),
      endStateHash: hexToBytes(endStateHash, "endStateHash", 32),
    }),
  };

  return {
    payload,
    sealedRunIds: pendingRuns
      .filter((run) => {
        const sequence = run.closedRunSequence;
        return sequence !== null && sequence >= startRunSequence && sequence <= endRunSequence;
      })
      .map((run) => run.id),
    sealedBattleIds: [],
  };
}

export function settlementBatchRecordToPayload(
  batch: SettlementBatchRecord,
  characterIdHex: string,
): SettlementBatchPayloadV2 {
  return {
    characterId: normalizeHexLower(characterIdHex, "characterId", 16),
    batchId: batch.batchId,
    startRunSequence: batch.startRunSequence,
    endRunSequence: batch.endRunSequence,
    runSummaries: batch.runSummaries,
    startNonce: batch.startNonce,
    endNonce: batch.endNonce,
    battleCount: batch.battleCount,
    startStateHash: normalizeHexLower(batch.startStateHash, "startStateHash", 32),
    endStateHash: normalizeHexLower(batch.endStateHash, "endStateHash", 32),
    zoneProgressDelta: batch.zoneProgressDelta as ZoneProgressDeltaEntry[],
    encounterHistogram: batch.encounterHistogram as {
      zoneId: number;
      enemyArchetypeId: number;
      count: number;
    }[],
    optionalLoadoutRevision: batch.optionalLoadoutRevision ?? undefined,
    batchHash: normalizeHexLower(batch.batchHash, "batchHash", 32),
    firstBattleTs: batch.firstBattleTs,
    lastBattleTs: batch.lastBattleTs,
    seasonId: batch.seasonId,
    schemaVersion: batch.schemaVersion as SettlementSchemaVersion,
    signatureScheme: batch.signatureScheme as SettlementSignatureScheme,
  };
}

export function summarizeRunBatchForLegacyReadModel(payload: SettlementBatchPayloadV2) {
  const runSummaries = payload.runSummaries ?? [];
  return {
    zoneProgressDelta: aggregateZoneProgressDelta(runSummaries),
    encounterHistogram: aggregateEncounterHistogram(runSummaries),
  };
}
