import { getPassiveDef } from '../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../engine/battle/skillRegistry';
import type { CharacterReadModel } from '../../types/api/frontend';

export type PanelTone = 'neutral' | 'warning' | 'success' | 'danger' | 'info';

export type SyncMode = 'create_then_settle' | 'settlement' | null;

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
  switch (character.syncPhase) {
    case 'LOCAL_ONLY':
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'LOCAL ONLY',
        statusTone: 'neutral',
        syncMode: 'create_then_settle',
      };
    case 'CREATING_ON_CHAIN':
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'CREATING',
        statusTone: 'info',
        syncMode: 'create_then_settle',
      };
    case 'INITIAL_SETTLEMENT_REQUIRED':
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'FIRST BATCH REQUIRED',
        statusTone: 'warning',
        syncMode: 'settlement',
      };
    case 'SETTLEMENT_PENDING':
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'PENDING',
        statusTone: 'warning',
        syncMode: 'settlement',
      };
    case 'FAILED':
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'FAILED',
        statusTone: 'danger',
        syncMode: 'create_then_settle',
      };
    case 'SYNCED':
    default:
      return {
        season: resolveEffectiveSeason(character),
        statusLabel: 'CONFIRMED',
        statusTone: 'success',
        syncMode: null,
      };
  }
}
