import {
  SettlementApplyResult,
  SettlementBatchPayloadV2,
  SettlementValidationContext,
  ZoneState,
} from "../../types/settlement";
import {
  accountCharacterIdHex,
  accountStateHashHex,
} from "./runanaAccounts";
import type { SettlementInstructionAccountEnvelope } from "./runanaSettlementEnvelope";

const THROUGHPUT_CAP_PER_MINUTE = 20;

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function zoneStateAfterBatch(
  zoneId: number,
  zoneStates: Map<number, ZoneState>,
  payload: SettlementBatchPayloadV2,
): ZoneState {
  const current = zoneStates.get(zoneId) ?? 0;
  const delta = payload.zoneProgressDelta.find((entry) => entry.zoneId === zoneId);
  return delta ? Math.max(current, delta.newState) as ZoneState : current;
}

function deriveExpDelta(
  payload: SettlementBatchPayloadV2,
  context: SettlementValidationContext,
): number {
  let totalExp = 0;

  for (const entry of payload.encounterHistogram) {
    const zoneRegistry = context.zoneRegistry.get(entry.zoneId);
    assertCondition(Boolean(zoneRegistry), "ERR_UNKNOWN_ZONE", "histogram references unknown zone");
    assertCondition(
      (zoneRegistry?.expMultiplierDen ?? 0) > 0,
      "ERR_INVALID_ZONE_CONFIG",
      "zone exp multiplier denominator must be > 0",
    );

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
  const pages = [args.envelope.primaryZoneProgressPage, ...args.envelope.additionalZoneProgressPages];

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
        entry.zoneId,
        {
          zoneId: entry.zoneId,
          expMultiplierNum: entry.expMultiplierNum,
          expMultiplierDen: entry.expMultiplierDen,
        },
      ]),
    ),
    zoneEnemySet: new Map(
      args.envelope.zoneEnemySets.map((entry) => [
        entry.zoneId,
        new Set(entry.allowedEnemyArchetypeIds),
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
  assertCondition(
    programConfig.trustedServerSigner === serverSigner,
    "ERR_UNTRUSTED_SERVER_SIGNER",
    "server signer is not trusted",
  );
  assertCondition(
    payload.battleCount <= programConfig.maxBattlesPerBatch,
    "ERR_BATCH_TOO_LARGE",
    "battle count exceeds max policy",
  );
  assertCondition(
    payload.encounterHistogram.length <= programConfig.maxHistogramEntriesPerBatch,
    "ERR_HISTOGRAM_TOO_LARGE",
    "histogram entry count exceeds max policy",
  );
  assertCondition(payload.schemaVersion === 2, "ERR_SCHEMA_VERSION", "schema version must be canonical V2");
  assertCondition(payload.signatureScheme === 0, "ERR_SIGNATURE_SCHEME", "signature scheme must be ed25519 domain 0");

  assertCondition(
    payload.startNonce === cursor.lastCommittedEndNonce + 1,
    "ERR_NONCE_GAP",
    "start nonce must match cursor continuity",
  );
  assertCondition(
    payload.startStateHash === cursor.lastCommittedStateHash,
    "ERR_STATE_HASH_GAP",
    "start state hash must match cursor continuity",
  );
  assertCondition(payload.batchId === cursor.lastCommittedBatchId + 1, "ERR_BATCH_ID_GAP", "batch id must be monotonic");
  assertCondition(payload.endNonce >= payload.startNonce, "ERR_NONCE_ORDER", "end nonce must be >= start nonce");
  assertCondition(
    payload.battleCount === payload.endNonce - payload.startNonce + 1,
    "ERR_BATTLE_COUNT_NONCE_MISMATCH",
    "battle count must equal nonce range",
  );

  const keySet = new Set<string>();
  let histogramBattleTotal = 0;

  for (const entry of payload.encounterHistogram) {
    assertCondition(entry.count > 0, "ERR_HISTOGRAM_ZERO_COUNT", "histogram entry count must be > 0");

    const key = `${entry.zoneId}:${entry.enemyArchetypeId}`;
    assertCondition(!keySet.has(key), "ERR_HISTOGRAM_DUPLICATE", "duplicate zone/enemy pair in histogram");
    keySet.add(key);

    histogramBattleTotal += entry.count;
  }

  assertCondition(
    histogramBattleTotal === payload.battleCount,
    "ERR_HISTOGRAM_COUNT_MISMATCH",
    "histogram battle sum must equal battle_count",
  );

  const zoneDeltaMap = new Map<number, ZoneState>();
  for (const delta of payload.zoneProgressDelta) {
    assertCondition(
      delta.newState === 1 || delta.newState === 2,
      "ERR_INVALID_ZONE_DELTA",
      "zone progress delta state must be unlocked or cleared",
    );
    assertCondition(!zoneDeltaMap.has(delta.zoneId), "ERR_DUPLICATE_ZONE_DELTA", "duplicate zone progress delta zone id");
    zoneDeltaMap.set(delta.zoneId, delta.newState);

    const currentState = zoneStates.get(delta.zoneId) ?? 0;
    const isAllowedTransition = (
      currentState === 0 && delta.newState === 1
    ) || (
      currentState === 1 && (delta.newState === 1 || delta.newState === 2)
    ) || (
      currentState === 2 && delta.newState === 2
    );

    assertCondition(
      isAllowedTransition,
      "ERR_INVALID_ZONE_DELTA",
      "zone progress delta is not a legal monotonic transition",
    );
  }

  assertCondition(
    seasonPolicy.seasonId === payload.seasonId,
    "ERR_SEASON_POLICY_MISMATCH",
    "season policy must match payload season id",
  );
  assertCondition(
    seasonPolicy.seasonStartTs < seasonPolicy.seasonEndTs &&
      seasonPolicy.seasonEndTs <= seasonPolicy.commitGraceEndTs,
    "ERR_INVALID_SEASON_POLICY",
    "season policy ordering is invalid",
  );
  assertCondition(
    payload.firstBattleTs >= characterRoot.characterCreationTs,
    "ERR_PRE_CHARACTER_TIMESTAMP",
    "first battle timestamp predates character creation",
  );
  assertCondition(
    payload.firstBattleTs >= cursor.lastCommittedBattleTs,
    "ERR_BATTLE_TS_REGRESSION",
    "first battle timestamp regresses behind the cursor",
  );
  assertCondition(
    payload.lastBattleTs >= payload.firstBattleTs,
    "ERR_BATTLE_TS_ORDER",
    "last battle timestamp must be >= first battle timestamp",
  );
  assertCondition(
    payload.seasonId >= cursor.lastCommittedSeasonId,
    "ERR_SEASON_REGRESSION",
    "season id regresses behind the cursor",
  );
  assertCondition(
    payload.firstBattleTs >= seasonPolicy.seasonStartTs,
    "ERR_SEASON_WINDOW_CLOSED",
    "first battle timestamp falls before season start",
  );
  assertCondition(
    payload.lastBattleTs <= seasonPolicy.seasonEndTs,
    "ERR_SEASON_WINDOW_CLOSED",
    "last battle timestamp falls after season end",
  );
  assertCondition(
    currentUnixTimestamp <= seasonPolicy.commitGraceEndTs,
    "ERR_SEASON_WINDOW_CLOSED",
    "current time is beyond season commit grace",
  );

  const intervalSeconds = payload.lastBattleTs - payload.firstBattleTs;
  const allowedBattles = Math.floor((intervalSeconds * THROUGHPUT_CAP_PER_MINUTE) / 60) + 1;
  assertCondition(
    payload.battleCount <= allowedBattles,
    "ERR_THROUGHPUT_EXCEEDED",
    "battle count exceeds throughput cap for the claimed interval",
  );

  for (const entry of payload.encounterHistogram) {
    const effectiveZoneState = zoneStateAfterBatch(entry.zoneId, zoneStates, payload);
    assertCondition(
      effectiveZoneState >= 1,
      "ERR_LOCKED_ZONE_REFERENCE",
      "batch references zone that is not unlocked for this character",
    );

    const allowedEnemies = zoneEnemySet.get(entry.zoneId);
    assertCondition(Boolean(allowedEnemies), "ERR_ZONE_ENEMY_SET_MISSING", "zone enemy set is missing");
    assertCondition(
      allowedEnemies?.has(entry.enemyArchetypeId) ?? false,
      "ERR_ILLEGAL_ZONE_ENEMY_PAIR",
      "enemy archetype is not legal for referenced zone",
    );
    assertCondition(zoneRegistry.has(entry.zoneId), "ERR_UNKNOWN_ZONE", "zone registry entry missing");
    assertCondition(
      enemyArchetypes.has(entry.enemyArchetypeId),
      "ERR_UNKNOWN_ENEMY_ARCHETYPE",
      "enemy archetype registry entry missing",
    );
  }

  const nextZoneStates = new Map(zoneStates);
  for (const [zoneId, nextState] of zoneDeltaMap.entries()) {
    const priorState = nextZoneStates.get(zoneId) ?? 0;
    if (nextState > priorState) {
      nextZoneStates.set(zoneId, nextState);
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

  const expDelta = deriveExpDelta(payload, context);

  return {
    characterRoot,
    characterStats: {
      ...characterStats,
      totalExp: characterStats.totalExp + expDelta,
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
