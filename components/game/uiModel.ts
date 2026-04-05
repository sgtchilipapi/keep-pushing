import { getPassiveDef } from '../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../engine/battle/skillRegistry';
import type { CharacterReadModel } from '../../types/api/frontend';

export type PanelTone = 'neutral' | 'warning' | 'success' | 'danger' | 'info';

export type SyncMode = 'first_sync' | 'settlement' | null;

export interface SyncPanelState {
  season: number | null;
  statusLabel: string;
  statusTone: PanelTone;
  syncMode: SyncMode;
}

function fallbackName(id: string): string {
  return id;
}

export function resolveSkillNames(skillIds: readonly string[]): string[] {
  return skillIds.map((skillId) => {
    try {
      return getSkillDef(skillId).skillName;
    } catch {
      return fallbackName(skillId);
    }
  });
}

export function resolvePassiveNames(passiveIds: readonly string[]): string[] {
  return passiveIds.map((passiveId) => {
    try {
      return getPassiveDef(passiveId).skillName;
    } catch {
      return fallbackName(passiveId);
    }
  });
}

export function resolveEffectiveSeason(character: CharacterReadModel): number | null {
  return (
    character.nextSettlementBatch?.seasonId ??
    character.latestBattle?.seasonId ??
    character.chain?.cursor?.lastReconciledSeasonId ??
    character.chain?.chainCreationSeasonId ??
    null
  );
}

export function resolveSyncPanelState(character: CharacterReadModel): SyncPanelState {
  const chainStatus = character.chain?.chainCreationStatus ?? 'NOT_STARTED';
  const latestSettlementStatus = character.latestBattle?.settlementStatus ?? null;
  const hasFirstSyncBacklog =
    latestSettlementStatus === 'AWAITING_FIRST_SYNC' ||
    latestSettlementStatus === 'SEALED' ||
    chainStatus === 'PENDING' ||
    chainStatus === 'FAILED';
  const hasConfirmedSettlementBacklog =
    latestSettlementStatus === 'PENDING' ||
    latestSettlementStatus === 'SEALED' ||
    character.nextSettlementBatch !== null;

  if (chainStatus === 'CONFIRMED' && hasConfirmedSettlementBacklog) {
    return {
      season: resolveEffectiveSeason(character),
      statusLabel: 'PENDING',
      statusTone: 'warning',
      syncMode: 'settlement',
    };
  }

  if (chainStatus === 'CONFIRMED') {
    return {
      season: resolveEffectiveSeason(character),
      statusLabel: 'CONFIRMED',
      statusTone: 'success',
      syncMode: null,
    };
  }

  if (hasFirstSyncBacklog) {
    return {
      season: resolveEffectiveSeason(character),
      statusLabel: chainStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      statusTone: chainStatus === 'FAILED' ? 'danger' : 'warning',
      syncMode: 'first_sync',
    };
  }

  return {
    season: resolveEffectiveSeason(character),
    statusLabel: chainStatus,
    statusTone: chainStatus === 'SUBMITTED' ? 'info' : 'neutral',
    syncMode: null,
  };
}
