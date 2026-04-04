import { buildEncounterSettlementPersistenceInput } from '../lib/combat/encounterSettlement';

describe('buildEncounterSettlementPersistenceInput', () => {
  it('builds canonical settlement-facing persistence input for encounter battles', () => {
    const result = buildEncounterSettlementPersistenceInput({
      battleId: 'battle-1',
      characterId: 'character-1',
      zoneId: 2,
      enemyArchetypeId: 100,
      seed: 77,
      battleTs: 1_700_000_100,
      seasonId: 1,
      playerInitial: {
        entityId: 'character-1',
        hp: 1200,
        hpMax: 1200,
        atk: 120,
        def: 70,
        spd: 100,
        accuracyBP: 8000,
        evadeBP: 1200,
        activeSkillIds: ['1001', '1002'],
      },
      enemyInitial: {
        entityId: '100',
        hp: 880,
        hpMax: 880,
        atk: 92,
        def: 58,
        spd: 112,
        accuracyBP: 8300,
        evadeBP: 1450,
        activeSkillIds: ['1001', '1003'],
      },
      battleResult: {
        battleId: 'battle-1',
        seed: 77,
        playerInitial: {
          entityId: 'character-1',
          hp: 1200,
          hpMax: 1200,
          atk: 120,
          def: 70,
          spd: 100,
          accuracyBP: 8000,
          evadeBP: 1200,
          activeSkillIds: ['1001', '1002'],
        },
        enemyInitial: {
          entityId: '100',
          hp: 880,
          hpMax: 880,
          atk: 92,
          def: 58,
          spd: 112,
          accuracyBP: 8300,
          evadeBP: 1450,
          activeSkillIds: ['1001', '1003'],
        },
        events: [{ type: 'ROUND_START', round: 1 }],
        winnerEntityId: 'character-1',
        roundsPlayed: 3,
      },
    });

    expect(result).toMatchObject({
      battleId: 'battle-1',
      characterId: 'character-1',
      zoneId: 2,
      enemyArchetypeId: 100,
      seed: 77,
      battleTs: 1_700_000_100,
      seasonId: 1,
      winnerEntityId: 'character-1',
      roundsPlayed: 3,
      zoneProgressDelta: [],
    });
  });
});
