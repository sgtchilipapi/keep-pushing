import {
  ApplyBattleSettlementBatchV1Payload,
  SettlementValidationContext,
  SettlementApplyResult,
  ZoneState,
} from "../../types/settlement";

const XP_PER_LEVEL = 100;

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function validateZoneTransition(current: ZoneState, next: ZoneState, allowDirectLockedToCleared: boolean): void {
  if (next < current) {
    throw new Error("ERR_ZONE_STATE_DOWNGRADE: zone state cannot downgrade");
  }

  if (current === 0 && next === 2 && !allowDirectLockedToCleared) {
    throw new Error("ERR_ZONE_INVALID_TRANSITION: locked->cleared is forbidden by policy");
  }
}

function recomputeWorldSummary(zoneStates: Map<number, ZoneState>): {
  highestMainZoneUnlocked: number;
  highestMainZoneCleared: number;
} {
  let highestMainZoneUnlocked = 0;
  let highestMainZoneCleared = 0;

  for (const [zoneId, state] of zoneStates.entries()) {
    if (state >= 1) {
      highestMainZoneUnlocked = Math.max(highestMainZoneUnlocked, zoneId);
    }
    if (state >= 2) {
      highestMainZoneCleared = Math.max(highestMainZoneCleared, zoneId);
    }
  }

  return { highestMainZoneUnlocked, highestMainZoneCleared };
}

export function applyBattleSettlementBatchV1(
  payload: ApplyBattleSettlementBatchV1Payload,
  context: SettlementValidationContext,
): SettlementApplyResult {
  const {
    programConfig,
    currentSlot,
    playerAuthority,
    characterRoot,
    characterStats,
    characterWorldProgress,
    zoneStates,
    loadout,
    cursor,
    serverSigner,
    zoneRegistry,
    zoneEnemySet,
    enemyArchetypes,
  } = context;

  // 1) Derivation and ownership (approximated in off-chain TS model).
  assertCondition(characterRoot.authority === playerAuthority, "ERR_UNAUTHORIZED", "player is not character authority");
  assertCondition(characterRoot.characterId === payload.characterId, "ERR_CHARACTER_MISMATCH", "character id mismatch");

  // 2) Program config checks.
  assertCondition(!programConfig.settlementPaused, "ERR_SETTLEMENT_PAUSED", "settlement is paused");
  assertCondition(
    programConfig.trustedServerSigners.includes(serverSigner),
    "ERR_UNTRUSTED_SERVER_SIGNER",
    "server signer is not trusted",
  );
  assertCondition(payload.attestationExpirySlot >= currentSlot, "ERR_ATTESTATION_EXPIRED", "attestation is expired");
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

  // 3) Batch continuity checks.
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

  // 4) Histogram integrity checks.
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
    assertCondition(zoneRegistry.has(delta.zoneId), "ERR_UNKNOWN_ZONE_DELTA", "zone delta references unknown zone");
    assertCondition(!zoneDeltaMap.has(delta.zoneId), "ERR_DUPLICATE_ZONE_DELTA", "duplicate zone progress delta zone id");
    zoneDeltaMap.set(delta.zoneId, delta.newState);
  }

  // 5-7) World eligibility, zone/enemy legality, reward bounds.
  let maxAllowedExp = 0;
  for (const entry of payload.encounterHistogram) {
    const zoneMeta = zoneRegistry.get(entry.zoneId);
    assertCondition(Boolean(zoneMeta), "ERR_UNKNOWN_ZONE", "histogram references unknown zone");

    const currentState = zoneStates.get(entry.zoneId) ?? 0;
    const deltaState = zoneDeltaMap.get(entry.zoneId);
    const projectedState = deltaState ?? currentState;

    // referenced zone must be currently unlocked, or become unlocked/cleared in same batch.
    assertCondition(
      projectedState >= 1,
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

    const enemy = enemyArchetypes.get(entry.enemyArchetypeId);
    assertCondition(Boolean(enemy), "ERR_UNKNOWN_ENEMY_ARCHETYPE", "enemy archetype registry entry missing");
    maxAllowedExp += entry.count * (enemy?.expCapPerEncounter ?? 0);
  }

  assertCondition(payload.expDelta <= maxAllowedExp, "ERR_EXP_OVER_CAP", "exp delta exceeds registry-derived cap");

  // 8) Optional loadout consistency.
  if (payload.optionalLoadoutRevision !== undefined) {
    assertCondition(Boolean(loadout), "ERR_LOADOUT_REQUIRED", "loadout account required when loadout revision is provided");
    assertCondition(
      loadout?.loadoutRevision === payload.optionalLoadoutRevision,
      "ERR_LOADOUT_REVISION_MISMATCH",
      "loadout revision mismatch",
    );
  }

  // 9) Apply progression transitions.
  const nextZoneStates = new Map(zoneStates);
  for (const [zoneId, nextState] of zoneDeltaMap.entries()) {
    const zoneMeta = zoneRegistry.get(zoneId);
    assertCondition(Boolean(zoneMeta), "ERR_UNKNOWN_ZONE_DELTA", "zone delta references unknown zone");

    const currentState = nextZoneStates.get(zoneId) ?? 0;
    validateZoneTransition(currentState, nextState, Boolean(zoneMeta?.allowDirectLockedToCleared));
    nextZoneStates.set(zoneId, nextState);
  }

  let nextExp = characterRoot.exp + payload.expDelta;
  let nextLevel = characterRoot.level;
  let leveledUp = false;

  while (nextExp >= XP_PER_LEVEL) {
    nextExp -= XP_PER_LEVEL;
    nextLevel += 1;
    leveledUp = true;
  }

  const recomputedSummary = recomputeWorldSummary(nextZoneStates);

  // 10) Persist batch cursor.
  return {
    characterRoot: {
      ...characterRoot,
      level: nextLevel,
      exp: nextExp,
    },
    characterStats: {
      ...characterStats,
      lastRecalcSlot: leveledUp ? currentSlot : characterStats.lastRecalcSlot,
    },
    characterWorldProgress: {
      ...characterWorldProgress,
      highestMainZoneUnlocked: recomputedSummary.highestMainZoneUnlocked,
      highestMainZoneCleared: recomputedSummary.highestMainZoneCleared,
      updatedAtSlot: currentSlot,
    },
    zoneStates: nextZoneStates,
    cursor: {
      ...cursor,
      lastCommittedEndNonce: payload.endNonce,
      lastCommittedStateHash: payload.endStateHash,
      lastCommittedBatchId: payload.batchId,
      updatedAtSlot: currentSlot,
    },
  };
}
