import type { BattleResult } from '../../types/battle';
import type { CharacterProvisionalProgressRecord } from '../prisma';
import type { ZoneProgressDeltaEntry } from '../../types/settlement';
import { getZoneEncounterTable } from './zoneEncounterTables';

export interface ProvisionalProgressUpdate {
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
  zoneStates: Record<string, 0 | 1 | 2>;
  zoneProgressDelta: ZoneProgressDeltaEntry[];
}

function hasEncounterTable(zoneId: number): boolean {
  try {
    getZoneEncounterTable(zoneId);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ERR_UNKNOWN_ZONE_ID')) {
      return false;
    }

    throw error;
  }
}

export function assertProvisionalZoneAccess(zoneId: number, highestUnlockedZoneId: number): void {
  if (zoneId > highestUnlockedZoneId) {
    throw new Error(
      `ERR_ZONE_LOCKED: zone ${zoneId} is not unlocked for the character (highest unlocked ${highestUnlockedZoneId})`,
    );
  }
}

export function applyLocalFirstBattleToProvisionalProgress(args: {
  progress: CharacterProvisionalProgressRecord;
  zoneId: number;
  characterId: string;
  battleResult: BattleResult;
}): ProvisionalProgressUpdate {
  const zoneStates: Record<string, 0 | 1 | 2> = { ...args.progress.zoneStates };
  const zoneProgressDelta: ZoneProgressDeltaEntry[] = [];
  let highestUnlockedZoneId = args.progress.highestUnlockedZoneId;
  let highestClearedZoneId = args.progress.highestClearedZoneId;

  assertProvisionalZoneAccess(args.zoneId, highestUnlockedZoneId);

  if (args.battleResult.winnerEntityId !== args.characterId) {
    return {
      highestUnlockedZoneId,
      highestClearedZoneId,
      zoneStates,
      zoneProgressDelta,
    };
  }

  const currentZoneKey = String(args.zoneId);
  const currentZoneState = zoneStates[currentZoneKey] ?? 1;
  if (currentZoneState < 2) {
    zoneStates[currentZoneKey] = 2;
    zoneProgressDelta.push({
      zoneId: args.zoneId,
      newState: 2,
    });
  }
  highestClearedZoneId = Math.max(highestClearedZoneId, args.zoneId);

  const nextZoneId = args.zoneId + 1;
  const nextZoneKey = String(nextZoneId);
  const nextZoneState = zoneStates[nextZoneKey] ?? 0;
  if (hasEncounterTable(nextZoneId) && nextZoneState === 0) {
    zoneStates[nextZoneKey] = 1;
    zoneProgressDelta.push({
      zoneId: nextZoneId,
      newState: 1,
    });
    highestUnlockedZoneId = Math.max(highestUnlockedZoneId, nextZoneId);
  }

  zoneProgressDelta.sort((left, right) => left.zoneId - right.zoneId);

  return {
    highestUnlockedZoneId,
    highestClearedZoneId,
    zoneStates,
    zoneProgressDelta,
  };
}
