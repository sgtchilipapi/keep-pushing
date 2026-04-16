import type { CombatantSnapshot } from '../../types/combat';
import type { BattleResult } from '../../types/battle';
import type { CreatePersistedEncounterInput } from '../prisma';

export interface BuildEncounterSettlementInput {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  seed: number;
  battleTs: number;
  seasonId: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  battleResult: BattleResult;
}

export function buildEncounterSettlementPersistenceInput(
  input: BuildEncounterSettlementInput,
): CreatePersistedEncounterInput {
  return {
    battleId: input.battleId,
    characterId: input.characterId,
    zoneId: input.zoneId,
    enemyArchetypeId: input.enemyArchetypeId,
    seed: input.seed,
    playerInitial: input.playerInitial,
    enemyInitial: input.enemyInitial,
    playerFinal: input.battleResult.playerFinal ?? null,
    enemyFinal: input.battleResult.enemyFinal ?? null,
    rewardEligible: true,
    winnerEntityId: input.battleResult.winnerEntityId,
    roundsPlayed: input.battleResult.roundsPlayed,
    events: input.battleResult.events,
    battleTs: input.battleTs,
    seasonId: input.seasonId,
    zoneProgressDelta: [],
  };
}
