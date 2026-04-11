import {
  SettlementApplyResult,
  SettlementBatchPayloadV2,
  SettlementValidationContext,
  ZoneState,
} from "../../types/settlement";
import { accountCharacterIdHex, accountStateHashHex } from "./runanaAccounts";
import type { SettlementInstructionAccountEnvelope } from "./runanaSettlementEnvelope";

const THROUGHPUT_CAP_PER_MINUTE = 20;
const EXP_PER_LEVEL = 100;

function assertCondition(
  condition: boolean,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function zoneVersionKey(zoneId: number, topologyVersion: number): string {
  return `${zoneId}:${topologyVersion}`;
}

function totalExpToLevel(totalExp: number): number {
  return Math.max(1, Math.floor(totalExp / EXP_PER_LEVEL) + 1);
}

function normalizedRunSummaries(payload: SettlementBatchPayloadV2) {
  if ((payload.runSummaries?.length ?? 0) > 0) {
    return payload.runSummaries ?? [];
  }

  const inferredZoneId =
    payload.encounterHistogram[0]?.zoneId ?? payload.zoneProgressDelta[0]?.zoneId ?? 0;

  return [
    {
      closedRunSequence: payload.startRunSequence ?? payload.startNonce,
      zoneId: inferredZoneId,
      topologyVersion: 0,
      topologyHash: "00".repeat(32),
      terminalStatus: "COMPLETED" as const,
      rewardedBattleCount: payload.battleCount,
      rewardedEncounterHistogram: payload.encounterHistogram.map((entry) => ({
        enemyArchetypeId: entry.enemyArchetypeId,
        count: entry.count,
      })),
      zoneProgressDelta: payload.zoneProgressDelta,
      firstRewardedBattleTs: payload.firstBattleTs,
      lastRewardedBattleTs: payload.lastBattleTs,
    },
  ];
}

function normalizedMaxRunsPerBatch(context: SettlementValidationContext): number {
  return context.programConfig.maxRunsPerBatch ?? context.programConfig.maxBattlesPerBatch;
}

function normalizedEnemyRules(
  value: SettlementValidationContext["zoneEnemySet"] extends Map<any, infer TValue> ? TValue : never,
) {
  if (value instanceof Set) {
    return [...value].map((enemyArchetypeId) => ({ enemyArchetypeId, maxPerRun: Number.MAX_SAFE_INTEGER }));
  }
  return value;
}

function deriveExpDelta(
  payload: SettlementBatchPayloadV2,
  context: SettlementValidationContext,
): number {
  let totalExp = 0;

  for (const runSummary of normalizedRunSummaries(payload)) {
    const zoneRegistry =
      context.zoneRegistry.get(zoneVersionKey(runSummary.zoneId, runSummary.topologyVersion)) ??
      context.zoneRegistry.get(runSummary.zoneId);
    assertCondition(Boolean(zoneRegistry), "ERR_UNKNOWN_ZONE", "run summary references unknown zone/version");
    assertCondition(
      (zoneRegistry?.expMultiplierDen ?? 0) > 0,
      "ERR_INVALID_ZONE_CONFIG",
      "zone exp multiplier denominator must be > 0",
    );

    for (const entry of runSummary.rewardedEncounterHistogram) {
      const enemyArchetype = context.enemyArchetypes.get(entry.enemyArchetypeId);
      assertCondition(
        Boolean(enemyArchetype),
        "ERR_UNKNOWN_ENEMY_ARCHETYPE",
        "enemy archetype registry entry missing",
      );

      const weightedExp = Math.floor(
        (entry.count *
          (enemyArchetype?.expRewardBase ?? 0) *
          (zoneRegistry?.expMultiplierNum ?? 0)) /
          (zoneRegistry?.expMultiplierDen ?? 1),
      );
      totalExp += weightedExp;
    }
  }

  return totalExp;
}

function deriveLegacyExpDelta(
  payload: SettlementBatchPayloadV2,
  context: SettlementValidationContext,
): number {
  let totalExp = 0;

  for (const entry of payload.encounterHistogram) {
    const zoneRegistry = context.zoneRegistry.get(entry.zoneId);
    assertCondition(Boolean(zoneRegistry), "ERR_UNKNOWN_ZONE", "histogram references unknown zone");
    const enemyArchetype = context.enemyArchetypes.get(entry.enemyArchetypeId);
    assertCondition(Boolean(enemyArchetype), "ERR_UNKNOWN_ENEMY_ARCHETYPE", "enemy archetype registry entry missing");

    totalExp += Math.floor(
      (entry.count *
        (enemyArchetype?.expRewardBase ?? 0) *
        (zoneRegistry?.expMultiplierNum ?? 0)) /
        (zoneRegistry?.expMultiplierDen ?? 1),
    );
  }

  return totalExp;
}

export interface BuildSettlementValidationContextArgs {
  envelope: SettlementInstructionAccountEnvelope;
  currentUnixTimestamp: number;
  currentSlot: number;
  serverSigner: string;
}

export function buildSettlementValidationContext(
  args: BuildSettlementValidationContextArgs,
): SettlementValidationContext {
  const zoneStates = new Map<number, ZoneState>();
  const pages = [
    args.envelope.primaryZoneProgressPage,
    ...args.envelope.additionalZoneProgressPages,
  ];

  for (const page of pages) {
    const pageBaseZoneId = page.pageIndex * 256;
    page.zoneStates.forEach((state, offset) => {
      if (state === 0 || state === 1 || state === 2) {
        zoneStates.set(pageBaseZoneId + offset, state);
      }
    });
  }

  return {
    currentUnixTimestamp: args.currentUnixTimestamp,
    currentSlot: args.currentSlot,
    playerAuthority: args.envelope.playerAuthority.toBase58(),
    serverSigner: args.serverSigner,
    characterRoot: {
      characterId: accountCharacterIdHex(args.envelope.characterRoot.characterId),
      authority: args.envelope.characterRoot.authority.toBase58(),
      characterCreationTs: Number(args.envelope.characterRoot.characterCreationTs),
      name: args.envelope.characterRoot.name,
      classId: args.envelope.characterRoot.classId,
    },
    characterStats: {
      level: args.envelope.characterStats.level,
      totalExp: Number(args.envelope.characterStats.totalExp),
    },
    characterWorldProgress: {
      highestUnlockedZoneId: args.envelope.characterWorldProgress.highestUnlockedZoneId,
      highestClearedZoneId: args.envelope.characterWorldProgress.highestClearedZoneId,
    },
    zoneStates,
    cursor: {
      lastCommittedEndNonce: Number(args.envelope.characterBatchCursor.lastCommittedEndNonce),
      lastCommittedStateHash: accountStateHashHex(args.envelope.characterBatchCursor.lastCommittedStateHash),
      lastCommittedBatchId: Number(args.envelope.characterBatchCursor.lastCommittedBatchId),
      lastCommittedBattleTs: Number(args.envelope.characterBatchCursor.lastCommittedBattleTs),
      lastCommittedSeasonId: args.envelope.characterBatchCursor.lastCommittedSeasonId,
      updatedAtSlot: Number(args.envelope.characterBatchCursor.updatedAtSlot),
    },
    programConfig: {
      settlementPaused: args.envelope.programConfig.settlementPaused,
      maxBattlesPerBatch: args.envelope.programConfig.maxBattlesPerBatch,
      maxRunsPerBatch: args.envelope.programConfig.maxRunsPerBatch,
      maxHistogramEntriesPerBatch: args.envelope.programConfig.maxHistogramEntriesPerBatch,
      trustedServerSigner: args.envelope.programConfig.trustedServerSigner.toBase58(),
    },
    seasonPolicy: {
      seasonId: args.envelope.seasonPolicy.seasonId,
      seasonStartTs: Number(args.envelope.seasonPolicy.seasonStartTs),
      seasonEndTs: Number(args.envelope.seasonPolicy.seasonEndTs),
      commitGraceEndTs: Number(args.envelope.seasonPolicy.commitGraceEndTs),
    },
    zoneRegistry: new Map(
      args.envelope.zoneRegistries.map((entry) => [
        zoneVersionKey(entry.zoneId, entry.topologyVersion),
        {
          zoneId: entry.zoneId,
          topologyVersion: entry.topologyVersion,
      topologyHash: entry.topologyHash ? Buffer.from(entry.topologyHash).toString("hex") : undefined,
      totalSubnodeCount: entry.totalSubnodeCount,
          expMultiplierNum: entry.expMultiplierNum,
          expMultiplierDen: entry.expMultiplierDen,
        },
      ]),
    ),
    zoneEnemySet: new Map(
      args.envelope.zoneEnemySets.map((entry) => [
        zoneVersionKey(entry.zoneId, entry.topologyVersion),
        entry.enemyRules,
      ]),
    ),
    enemyArchetypes: new Map(
      args.envelope.enemyArchetypeRegistries.map((entry) => [
        entry.enemyArchetypeId,
        {
          enemyArchetypeId: entry.enemyArchetypeId,
          expRewardBase: entry.expRewardBase,
        },
      ]),
    ),
  };
}

export function dryRunApplyBattleSettlementBatchV1(
  payload: SettlementBatchPayloadV2,
  args: BuildSettlementValidationContextArgs,
): SettlementApplyResult {
  return applyBattleSettlementBatchV1(payload, buildSettlementValidationContext(args));
}

export function applyBattleSettlementBatchV1(
  payload: SettlementBatchPayloadV2,
  context: SettlementValidationContext,
): SettlementApplyResult {
  const isLegacyPayload = (payload.runSummaries?.length ?? 0) === 0;
  const startRunSequence = payload.startRunSequence ?? payload.startNonce;
  const endRunSequence = payload.endRunSequence ?? payload.endNonce;
  const {
    programConfig,
    currentSlot,
    currentUnixTimestamp,
    playerAuthority,
    characterRoot,
    characterStats,
    characterWorldProgress,
    zoneStates,
    cursor,
    serverSigner,
    seasonPolicy,
    zoneRegistry,
    zoneEnemySet,
    enemyArchetypes,
  } = context;

  assertCondition(characterRoot.authority === playerAuthority, "ERR_UNAUTHORIZED", "player is not character authority");
  assertCondition(characterRoot.characterId === payload.characterId, "ERR_CHARACTER_MISMATCH", "character id mismatch");
  assertCondition(!programConfig.settlementPaused, "ERR_SETTLEMENT_PAUSED", "settlement is paused");
  assertCondition(programConfig.trustedServerSigner === serverSigner, "ERR_UNTRUSTED_SERVER_SIGNER", "server signer is not trusted");
  assertCondition(payload.schemaVersion === 2, "ERR_SCHEMA_VERSION", "schema version must be canonical V2");
  assertCondition(payload.signatureScheme === 0 || payload.signatureScheme === 1, "ERR_SIGNATURE_SCHEME", "signature scheme must be supported");

  if (isLegacyPayload) {
    assertCondition(
      payload.startNonce === cursor.lastCommittedEndNonce + 1,
      "ERR_NONCE_GAP",
      "start nonce must match cursor continuity",
    );
    assertCondition(payload.startStateHash === cursor.lastCommittedStateHash, "ERR_STATE_HASH_GAP", "start state hash must match cursor continuity");
    assertCondition(payload.batchId === cursor.lastCommittedBatchId + 1, "ERR_BATCH_ID_GAP", "batch id must be monotonic");
    assertCondition(payload.endNonce >= payload.startNonce, "ERR_NONCE_ORDER", "end nonce must be >= start nonce");
    assertCondition(
      payload.battleCount === payload.endNonce - payload.startNonce + 1,
      "ERR_BATTLE_COUNT_NONCE_MISMATCH",
      "battle count must equal nonce range",
    );

    const seenPairs = new Set<string>();
    let histogramBattleTotal = 0;
    for (const entry of payload.encounterHistogram) {
      assertCondition(entry.count > 0, "ERR_HISTOGRAM_ZERO_COUNT", "histogram entry count must be > 0");
      const key = `${entry.zoneId}:${entry.enemyArchetypeId}`;
      assertCondition(!seenPairs.has(key), "ERR_HISTOGRAM_DUPLICATE", "duplicate zone/enemy pair in histogram");
      seenPairs.add(key);
      histogramBattleTotal += entry.count;

      const zoneMeta = zoneRegistry.get(entry.zoneId);
      assertCondition(Boolean(zoneMeta), "ERR_UNKNOWN_ZONE", "histogram references unknown zone");
      const enemyRules = normalizedEnemyRules(zoneEnemySet.get(entry.zoneId) ?? []);
      const rule = enemyRules.find((candidate) => candidate.enemyArchetypeId === entry.enemyArchetypeId);
      assertCondition(Boolean(rule), "ERR_ILLEGAL_ZONE_ENEMY_PAIR", "enemy archetype is not legal for referenced zone");
      assertCondition(enemyArchetypes.has(entry.enemyArchetypeId), "ERR_UNKNOWN_ENEMY_ARCHETYPE", "enemy archetype registry entry missing");
    }
    assertCondition(
      histogramBattleTotal === payload.battleCount,
      "ERR_HISTOGRAM_COUNT_MISMATCH",
      "histogram battle sum must equal battle_count",
    );

    assertCondition(seasonPolicy.seasonId === payload.seasonId, "ERR_SEASON_POLICY_MISMATCH", "season policy must match payload season id");
    assertCondition(payload.firstBattleTs >= cursor.lastCommittedBattleTs, "ERR_BATTLE_TS_REGRESSION", "firstBattleTs regresses behind the cursor");
    assertCondition(payload.lastBattleTs >= payload.firstBattleTs, "ERR_BATTLE_TS_ORDER", "lastBattleTs must be >= firstBattleTs");
    assertCondition(payload.firstBattleTs >= seasonPolicy.seasonStartTs, "ERR_SEASON_WINDOW_CLOSED", "firstBattleTs falls before season start");
    assertCondition(payload.lastBattleTs <= seasonPolicy.seasonEndTs, "ERR_SEASON_WINDOW_CLOSED", "lastBattleTs falls after season end");
    assertCondition(currentUnixTimestamp <= seasonPolicy.commitGraceEndTs, "ERR_SEASON_WINDOW_CLOSED", "current time is beyond season commit grace");

    const intervalSeconds = payload.lastBattleTs - payload.firstBattleTs;
    const allowedBattles = Math.floor((intervalSeconds * THROUGHPUT_CAP_PER_MINUTE) / 60) + 1;
    assertCondition(payload.battleCount <= allowedBattles, "ERR_THROUGHPUT_EXCEEDED", "battle count exceeds throughput cap");

    const nextZoneStates = new Map(zoneStates);
    for (const delta of payload.zoneProgressDelta) {
      const currentState = nextZoneStates.get(delta.zoneId) ?? 0;
      const isAllowedTransition =
        (currentState === 0 && delta.newState === 1) ||
        (currentState === 1 && (delta.newState === 1 || delta.newState === 2)) ||
        (currentState === 2 && delta.newState === 2);
      assertCondition(isAllowedTransition, "ERR_INVALID_ZONE_DELTA", "zone progress delta is not a legal monotonic transition");
      nextZoneStates.set(delta.zoneId, Math.max(currentState, delta.newState) as ZoneState);
    }

    let highestUnlockedZoneId = characterWorldProgress.highestUnlockedZoneId;
    let highestClearedZoneId = characterWorldProgress.highestClearedZoneId;
    for (const [zoneId, state] of nextZoneStates.entries()) {
      if (state >= 1) {
        highestUnlockedZoneId = Math.max(highestUnlockedZoneId, zoneId);
      }
      if (state >= 2) {
        highestClearedZoneId = Math.max(highestClearedZoneId, zoneId);
      }
    }

    const totalExp = characterStats.totalExp + deriveLegacyExpDelta(payload, context);

    return {
      characterRoot,
      characterStats: {
        level: totalExpToLevel(totalExp),
        totalExp,
      },
      characterWorldProgress: {
        highestUnlockedZoneId,
        highestClearedZoneId,
      },
      zoneStates: nextZoneStates,
      cursor: {
        ...cursor,
        lastCommittedEndNonce: payload.endNonce,
        lastCommittedStateHash: payload.endStateHash,
        lastCommittedBatchId: payload.batchId,
        lastCommittedBattleTs: payload.lastBattleTs,
        lastCommittedSeasonId: payload.seasonId,
        updatedAtSlot: currentSlot,
      },
    };
  }

  assertCondition(
    startRunSequence === cursor.lastCommittedEndNonce + 1,
    isLegacyPayload ? "ERR_NONCE_GAP" : "ERR_RUN_SEQUENCE_GAP",
    "startRunSequence must match cursor continuity",
  );
  assertCondition(
    payload.startNonce === startRunSequence && payload.endNonce === endRunSequence,
    "ERR_COMPAT_SEQUENCE_MISMATCH",
    "compat nonce aliases must match run sequence bounds",
  );
  assertCondition(payload.startStateHash === cursor.lastCommittedStateHash, "ERR_STATE_HASH_GAP", "start state hash must match cursor continuity");
  assertCondition(payload.batchId === cursor.lastCommittedBatchId + 1, "ERR_BATCH_ID_GAP", "batch id must be monotonic");
  assertCondition(endRunSequence >= startRunSequence, "ERR_RUN_SEQUENCE_ORDER", "endRunSequence must be >= startRunSequence");
  if (!isLegacyPayload) {
    assertCondition(
      normalizedRunSummaries(payload).length === endRunSequence - startRunSequence + 1,
      "ERR_RUN_COUNT_SEQUENCE_MISMATCH",
      "runSummaries length must equal run sequence range",
    );
  }
  assertCondition(
    normalizedRunSummaries(payload).length <= normalizedMaxRunsPerBatch(context),
    "ERR_BATCH_TOO_LARGE",
    "run count exceeds max policy",
  );
  const totalHistogramRows = normalizedRunSummaries(payload).reduce(
    (sum, summary) => sum + summary.rewardedEncounterHistogram.length,
    0,
  );
  assertCondition(
    totalHistogramRows <= programConfig.maxHistogramEntriesPerBatch,
    "ERR_HISTOGRAM_TOO_LARGE",
    "histogram row count exceeds batch policy",
  );
  assertCondition(
    payload.battleCount === normalizedRunSummaries(payload).reduce((sum, summary) => sum + summary.rewardedBattleCount, 0),
    "ERR_BATTLE_COUNT_MISMATCH",
    "battleCount must equal rewarded battle count sum",
  );

  assertCondition(seasonPolicy.seasonId === payload.seasonId, "ERR_SEASON_POLICY_MISMATCH", "season policy must match payload season id");
  assertCondition(
    seasonPolicy.seasonStartTs < seasonPolicy.seasonEndTs && seasonPolicy.seasonEndTs <= seasonPolicy.commitGraceEndTs,
    "ERR_INVALID_SEASON_POLICY",
    "season policy ordering is invalid",
  );
  assertCondition(payload.firstBattleTs >= cursor.lastCommittedBattleTs, "ERR_BATTLE_TS_REGRESSION", "firstBattleTs regresses behind the cursor");
  assertCondition(payload.lastBattleTs >= payload.firstBattleTs, "ERR_BATTLE_TS_ORDER", "lastBattleTs must be >= firstBattleTs");
  assertCondition(payload.seasonId >= cursor.lastCommittedSeasonId, "ERR_SEASON_REGRESSION", "season id regresses behind the cursor");
  assertCondition(payload.firstBattleTs >= seasonPolicy.seasonStartTs, "ERR_SEASON_WINDOW_CLOSED", "firstBattleTs falls before season start");
  assertCondition(payload.lastBattleTs <= seasonPolicy.seasonEndTs, "ERR_SEASON_WINDOW_CLOSED", "lastBattleTs falls after season end");
  assertCondition(currentUnixTimestamp <= seasonPolicy.commitGraceEndTs, "ERR_SEASON_WINDOW_CLOSED", "current time is beyond season commit grace");

  const intervalSeconds = payload.lastBattleTs - payload.firstBattleTs;
  const allowedBattles = Math.floor((intervalSeconds * THROUGHPUT_CAP_PER_MINUTE) / 60) + 1;
  assertCondition(
    payload.battleCount <= allowedBattles,
    "ERR_THROUGHPUT_EXCEEDED",
    "rewarded battle count exceeds throughput cap for the claimed interval",
  );

  const nextZoneStates = new Map(zoneStates);
  for (const [index, summary] of normalizedRunSummaries(payload).entries()) {
    assertCondition(
      summary.closedRunSequence === startRunSequence + index,
      "ERR_RUN_SEQUENCE_GAP",
      "run summaries must be contiguous and ordered",
    );
    assertCondition(
      summary.firstRewardedBattleTs >= payload.firstBattleTs &&
        summary.lastRewardedBattleTs <= payload.lastBattleTs &&
        summary.lastRewardedBattleTs >= summary.firstRewardedBattleTs,
      "ERR_RUN_BATTLE_TS_ORDER",
      "run summary rewarded battle timestamps must fit the batch interval",
    );

    const registryKey = zoneVersionKey(summary.zoneId, summary.topologyVersion);
    const zoneMeta = zoneRegistry.get(registryKey) ?? zoneRegistry.get(summary.zoneId);
    assertCondition(Boolean(zoneMeta), "ERR_UNKNOWN_ZONE", "run summary references unknown zone/version");
    assertCondition(
      zoneMeta?.topologyHash === undefined || zoneMeta.topologyHash === summary.topologyHash,
      "ERR_TOPOLOGY_HASH_MISMATCH",
      "run summary topology hash does not match zone metadata",
    );

    const rewardedHistogramSum = summary.rewardedEncounterHistogram.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    assertCondition(
      rewardedHistogramSum === summary.rewardedBattleCount,
      "ERR_RUN_REWARDED_COUNT_MISMATCH",
      "rewardedBattleCount must equal rewarded histogram sum",
    );
    assertCondition(
      summary.rewardedBattleCount <= (zoneMeta?.totalSubnodeCount ?? Number.MAX_SAFE_INTEGER),
      "ERR_RUN_REWARDED_COUNT_EXCEEDS_TOPOLOGY",
      "rewardedBattleCount exceeds total subnodes in the topology",
    );

    const effectiveZoneState = nextZoneStates.get(summary.zoneId) ?? zoneStates.get(summary.zoneId) ?? 0;
    assertCondition(effectiveZoneState >= 1, "ERR_LOCKED_ZONE_REFERENCE", "run references a zone that is not unlocked");

    const enemyRules = normalizedEnemyRules(
      zoneEnemySet.get(registryKey) ?? zoneEnemySet.get(summary.zoneId) ?? [],
    );
    assertCondition(Boolean(enemyRules), "ERR_ZONE_ENEMY_SET_MISSING", "zone enemy rule set is missing");

    const seenArchetypes = new Set<number>();
    for (const row of summary.rewardedEncounterHistogram) {
      assertCondition(row.count > 0, "ERR_HISTOGRAM_ZERO_COUNT", "run histogram row count must be > 0");
      assertCondition(!seenArchetypes.has(row.enemyArchetypeId), "ERR_HISTOGRAM_DUPLICATE", "duplicate enemy archetype in run histogram");
      seenArchetypes.add(row.enemyArchetypeId);
      assertCondition(enemyArchetypes.has(row.enemyArchetypeId), "ERR_UNKNOWN_ENEMY_ARCHETYPE", "enemy archetype registry entry missing");
      const rule = enemyRules.find((entry) => entry.enemyArchetypeId === row.enemyArchetypeId);
      assertCondition(Boolean(rule), "ERR_ILLEGAL_ZONE_ENEMY_PAIR", "enemy archetype is not legal for this zone/version");
      assertCondition(
        row.count <= (rule?.maxPerRun ?? 0),
        "ERR_ENEMY_ARCHETYPE_MAX_PER_RUN_EXCEEDED",
        "enemy archetype count exceeded max_per_run",
      );
    }

    if (summary.terminalStatus !== "COMPLETED") {
      assertCondition(
        summary.zoneProgressDelta.length === 0,
        "ERR_INVALID_ZONE_DELTA",
        "only successful runs may carry zone progression",
      );
    }

    for (const delta of summary.zoneProgressDelta) {
      const currentState = nextZoneStates.get(delta.zoneId) ?? zoneStates.get(delta.zoneId) ?? 0;
      const isAllowedTransition =
        (currentState === 0 && delta.newState === 1) ||
        (currentState === 1 && (delta.newState === 1 || delta.newState === 2)) ||
        (currentState === 2 && delta.newState === 2);
      assertCondition(
        isAllowedTransition,
        "ERR_INVALID_ZONE_DELTA",
        "zone progress delta is not a legal monotonic transition",
      );
      nextZoneStates.set(
        delta.zoneId,
        (Math.max(currentState, delta.newState) as ZoneState),
      );
    }
  }

  let highestUnlockedZoneId = characterWorldProgress.highestUnlockedZoneId;
  let highestClearedZoneId = characterWorldProgress.highestClearedZoneId;
  for (const [zoneId, state] of nextZoneStates.entries()) {
    if (state >= 1) {
      highestUnlockedZoneId = Math.max(highestUnlockedZoneId, zoneId);
    }
    if (state >= 2) {
      highestClearedZoneId = Math.max(highestClearedZoneId, zoneId);
    }
  }

  const totalExp = characterStats.totalExp + deriveExpDelta(payload, context);

  return {
    characterRoot,
    characterStats: {
      level: totalExpToLevel(totalExp),
      totalExp,
    },
    characterWorldProgress: {
      highestUnlockedZoneId,
      highestClearedZoneId,
    },
    zoneStates: nextZoneStates,
    cursor: {
      ...cursor,
      lastCommittedEndNonce: endRunSequence,
      lastCommittedStateHash: payload.endStateHash,
      lastCommittedBatchId: payload.batchId,
      lastCommittedBattleTs: payload.lastBattleTs,
      lastCommittedSeasonId: payload.seasonId,
      updatedAtSlot: currentSlot,
    },
  };
}
