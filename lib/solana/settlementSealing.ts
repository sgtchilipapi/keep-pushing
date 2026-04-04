import type {
  BattleOutcomeLedgerRecord,
  CharacterChainState,
  SettlementBatchRecord,
} from '../prisma';
import type {
  EncounterCountEntry,
  ProgressZoneState,
  SettlementBatchPayloadV2,
  SettlementSchemaVersion,
  SettlementSignatureScheme,
  ZoneProgressDeltaEntry,
} from '../../types/settlement';
import {
  computeCanonicalEndStateHashHex,
  computeSettlementBatchHashHex,
} from './settlementCanonical';

export const SETTLEMENT_SCHEMA_VERSION_V2: SettlementSchemaVersion = 2;
export const SETTLEMENT_SIGNATURE_SCHEME_ED25519: SettlementSignatureScheme = 0;

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
  pendingBattles: BattleOutcomeLedgerRecord[];
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  optionalLoadoutRevision?: number;
}

export interface SealedSettlementBatchDraft {
  payload: SettlementBatchPayloadV2;
  sealedBattleIds: string[];
}

function assertCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${code}: ${message}`);
  }
}

function requireBattleNonce(battle: BattleOutcomeLedgerRecord): number {
  assertCondition(
    battle.battleNonce !== null,
    'ERR_PENDING_NONCE_MISSING',
    `battle ${battle.id} is missing a finalized battle nonce`,
  );
  return battle.battleNonce;
}

function compareEncounterEntries(left: EncounterCountEntry, right: EncounterCountEntry): number {
  return left.zoneId - right.zoneId || left.enemyArchetypeId - right.enemyArchetypeId;
}

function compareZoneDeltas(left: ZoneProgressDeltaEntry, right: ZoneProgressDeltaEntry): number {
  return left.zoneId - right.zoneId;
}

function parseBattleZoneProgressDelta(
  value: unknown,
  field = 'zoneProgressDeltaJson',
): ZoneProgressDeltaEntry[] {
  if (value === null || value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  const parsed = values.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`ERR_INVALID_BATTLE_ZONE_DELTA: ${field}[${index}] must be an object`);
    }

    const candidate = entry as Record<string, unknown>;
    const zoneId = candidate.zoneId;
    const newState = candidate.newState;

    if (!Number.isInteger(zoneId) || (zoneId as number) < 0) {
      throw new Error(`ERR_INVALID_BATTLE_ZONE_DELTA: ${field}[${index}].zoneId must be an integer >= 0`);
    }
    if (newState !== 1 && newState !== 2) {
      throw new Error(`ERR_INVALID_BATTLE_ZONE_DELTA: ${field}[${index}].newState must be 1 or 2`);
    }

    return {
      zoneId: zoneId as number,
      newState: newState as ProgressZoneState,
    };
  });

  return parsed.sort(compareZoneDeltas);
}

function normalizeHexLower(value: string, field: string, expectedBytes: number): string {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  assertCondition(
    /^[0-9a-fA-F]+$/.test(normalized) && normalized.length === expectedBytes * 2,
    `ERR_INVALID_${field.toUpperCase()}`,
    `${field} must be ${expectedBytes} bytes encoded as hex`,
  );
  return normalized.toLowerCase();
}

function hexToBytes(value: string, field: string, expectedBytes: number): Uint8Array {
  return Uint8Array.from(Buffer.from(normalizeHexLower(value, field, expectedBytes), 'hex'));
}

function contiguousBattlePrefix(
  battles: BattleOutcomeLedgerRecord[],
  expectedStartNonce: number,
  maxBattlesPerBatch: number,
  maxHistogramEntriesPerBatch: number,
): BattleOutcomeLedgerRecord[] {
  assertCondition(maxBattlesPerBatch > 0, 'ERR_INVALID_BATCH_POLICY', 'maxBattlesPerBatch must be > 0');
  assertCondition(
    maxHistogramEntriesPerBatch > 0,
    'ERR_INVALID_BATCH_POLICY',
    'maxHistogramEntriesPerBatch must be > 0',
  );
  assertCondition(battles.length > 0, 'ERR_NO_PENDING_BATTLES', 'no pending battles were available to seal');

  const first = battles[0];
  assertCondition(
    requireBattleNonce(first) === expectedStartNonce,
    'ERR_PENDING_NONCE_GAP',
    'oldest pending battle nonce did not match the expected next cursor nonce',
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
    'ERR_EMPTY_BATCH_SELECTION',
    'no contiguous pending battles could be sealed under current policy constraints',
  );

  return selected;
}

function aggregateEncounterHistogram(battles: BattleOutcomeLedgerRecord[]): EncounterCountEntry[] {
  const counts = new Map<string, EncounterCountEntry>();

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

function aggregateZoneProgressDelta(battles: BattleOutcomeLedgerRecord[]): ZoneProgressDeltaEntry[] {
  const nextStateByZone = new Map<number, ProgressZoneState>();

  for (const battle of battles) {
    for (const delta of parseBattleZoneProgressDelta(battle.zoneProgressDelta)) {
      const current = nextStateByZone.get(delta.zoneId) ?? 1;
      if (delta.newState > current) {
        nextStateByZone.set(delta.zoneId, delta.newState);
      } else if (!nextStateByZone.has(delta.zoneId)) {
        nextStateByZone.set(delta.zoneId, delta.newState);
      }
    }
  }

  return [...nextStateByZone.entries()]
    .map(([zoneId, newState]) => ({ zoneId, newState }))
    .sort(compareZoneDeltas);
}

export function sealSettlementBatchDraft(args: SealSettlementBatchArgs): SealedSettlementBatchDraft {
  const characterIdHex = normalizeHexLower(args.characterIdHex, 'characterId', 16);
  const cursor: SettlementSealingCursor = {
    lastCommittedEndNonce: args.cursor.lastCommittedEndNonce,
    lastCommittedStateHash: normalizeHexLower(args.cursor.lastCommittedStateHash, 'lastCommittedStateHash', 32),
    lastCommittedBatchId: args.cursor.lastCommittedBatchId,
    lastCommittedBattleTs: args.cursor.lastCommittedBattleTs,
    lastCommittedSeasonId: args.cursor.lastCommittedSeasonId,
  };

  const battles = contiguousBattlePrefix(
    [...args.pendingBattles].sort(
      (left, right) => requireBattleNonce(left) - requireBattleNonce(right),
    ),
    cursor.lastCommittedEndNonce + 1,
    args.maxBattlesPerBatch,
    args.maxHistogramEntriesPerBatch,
  );

  const encounterHistogram = aggregateEncounterHistogram(battles);
  const zoneProgressDelta = aggregateZoneProgressDelta(battles);
  const first = battles[0];
  const last = battles[battles.length - 1];
  const optionalLoadoutRevision = args.optionalLoadoutRevision;

  const payloadBase = {
    characterId: characterIdHex,
    batchId: cursor.lastCommittedBatchId + 1,
    startNonce: requireBattleNonce(first),
    endNonce: requireBattleNonce(last),
    battleCount: battles.length,
    startStateHash: cursor.lastCommittedStateHash,
    zoneProgressDelta,
    encounterHistogram,
    optionalLoadoutRevision,
    firstBattleTs: first.battleTs,
    lastBattleTs: last.battleTs,
    seasonId: first.seasonId,
    schemaVersion: SETTLEMENT_SCHEMA_VERSION_V2,
    signatureScheme: SETTLEMENT_SIGNATURE_SCHEME_ED25519,
  };

  const endStateHash = computeCanonicalEndStateHashHex({
    ...payloadBase,
    characterId: hexToBytes(payloadBase.characterId, 'characterId', 16),
    startStateHash: hexToBytes(payloadBase.startStateHash, 'startStateHash', 32),
  });
  const payload: SettlementBatchPayloadV2 = {
    ...payloadBase,
    endStateHash,
    batchHash: computeSettlementBatchHashHex({
      ...payloadBase,
      characterId: hexToBytes(payloadBase.characterId, 'characterId', 16),
      startStateHash: hexToBytes(payloadBase.startStateHash, 'startStateHash', 32),
      endStateHash: hexToBytes(endStateHash, 'endStateHash', 32),
    }),
  };

  return {
    payload,
    sealedBattleIds: battles.map((battle) => battle.id),
  };
}

export function settlementBatchRecordToPayload(
  batch: SettlementBatchRecord,
  characterIdHex: string,
): SettlementBatchPayloadV2 {
  return {
    characterId: normalizeHexLower(characterIdHex, 'characterId', 16),
    batchId: batch.batchId,
    startNonce: batch.startNonce,
    endNonce: batch.endNonce,
    battleCount: batch.battleCount,
    startStateHash: normalizeHexLower(batch.startStateHash, 'startStateHash', 32),
    endStateHash: normalizeHexLower(batch.endStateHash, 'endStateHash', 32),
    zoneProgressDelta: parseBattleZoneProgressDelta(batch.zoneProgressDelta, 'zoneProgressDeltaJson'),
    encounterHistogram: parseEncounterHistogramJson(batch.encounterHistogram),
    optionalLoadoutRevision: batch.optionalLoadoutRevision ?? undefined,
    batchHash: normalizeHexLower(batch.batchHash, 'batchHash', 32),
    firstBattleTs: batch.firstBattleTs,
    lastBattleTs: batch.lastBattleTs,
    seasonId: batch.seasonId,
    schemaVersion: batch.schemaVersion as SettlementSchemaVersion,
    signatureScheme: batch.signatureScheme as SettlementSignatureScheme,
  };
}

function parseEncounterHistogramJson(value: unknown): EncounterCountEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('ERR_INVALID_ENCOUNTER_HISTOGRAM: encounterHistogramJson must be an array');
  }

  return value
    .map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`ERR_INVALID_ENCOUNTER_HISTOGRAM: encounterHistogramJson[${index}] must be an object`);
      }

      const candidate = entry as Record<string, unknown>;
      const zoneId = candidate.zoneId;
      const enemyArchetypeId = candidate.enemyArchetypeId;
      const count = candidate.count;

      if (!Number.isInteger(zoneId) || !Number.isInteger(enemyArchetypeId) || !Number.isInteger(count)) {
        throw new Error(
          `ERR_INVALID_ENCOUNTER_HISTOGRAM: encounterHistogramJson[${index}] must use integer zoneId/enemyArchetypeId/count fields`,
        );
      }

      return {
        zoneId: zoneId as number,
        enemyArchetypeId: enemyArchetypeId as number,
        count: count as number,
      };
    })
    .sort(compareEncounterEntries);
}

export function characterCursorToSettlementSealingCursor(
  character: Pick<
    CharacterChainState,
    | 'chainCharacterIdHex'
    | 'lastReconciledEndNonce'
    | 'lastReconciledStateHash'
    | 'lastReconciledBatchId'
    | 'lastReconciledBattleTs'
    | 'lastReconciledSeasonId'
  >,
): SettlementSealingCursor {
  assertCondition(
    character.lastReconciledEndNonce !== null &&
      character.lastReconciledStateHash !== null &&
      character.lastReconciledBatchId !== null &&
      character.lastReconciledBattleTs !== null &&
      character.lastReconciledSeasonId !== null,
    'ERR_MISSING_CURSOR_SNAPSHOT',
    'character is missing the last reconciled cursor snapshot required for sealing',
  );

  return {
    lastCommittedEndNonce: character.lastReconciledEndNonce,
    lastCommittedStateHash: normalizeHexLower(character.lastReconciledStateHash, 'lastReconciledStateHash', 32),
    lastCommittedBatchId: character.lastReconciledBatchId,
    lastCommittedBattleTs: character.lastReconciledBattleTs,
    lastCommittedSeasonId: character.lastReconciledSeasonId,
  };
}
