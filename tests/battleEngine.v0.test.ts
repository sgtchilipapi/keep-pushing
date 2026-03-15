import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function baseEntity(overrides: Partial<CombatantSnapshot>): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 2000,
    hpMax: 2000,
    atk: 150,
    def: 120,
    spd: 100,
    accuracyBP: 8000,
    evadeBP: 1500,
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

describe('battleEngine v0', () => {
  it('is deterministic for same input and seed', () => {
    const player = baseEntity({ entityId: 'player', spd: 120 });
    const enemy = baseEntity({ entityId: 'enemy', spd: 110 });

    const first = simulateBattle({
      battleId: 'determinism',
      seed: 12345,
      playerInitial: player,
      enemyInitial: enemy
    });

    const second = simulateBattle({
      battleId: 'determinism',
      seed: 12345,
      playerInitial: player,
      enemyInitial: enemy
    });

    expect(first).toEqual(second);
  });

  it('gives faster combatant more actions over 30 rounds', () => {
    const result = simulateBattle({
      battleId: 'speed-check',
      seed: 999,
      playerInitial: baseEntity({ entityId: 'fast', spd: 160 }),
      enemyInitial: baseEntity({ entityId: 'slow', spd: 80, hp: 6000, hpMax: 6000, def: 220 }),
      maxRounds: 30
    });

    const actionEvents = result.events.filter((event) => event.type === 'ACTION');
    const fastActions = actionEvents.filter((event) => event.actorId === 'fast').length;
    const slowActions = actionEvents.filter((event) => event.actorId === 'slow').length;

    expect(fastActions).toBeGreaterThan(slowActions);
  });

  it('uses timeout tiebreaker by hp then initiative then entityId', () => {
    const result = simulateBattle({
      battleId: 'timeout',
      seed: 7,
      playerInitial: baseEntity({
        entityId: 'alpha',
        hp: 10000,
        hpMax: 10000,
        atk: 10,
        def: 10000,
        spd: 101,
        accuracyBP: 500,
        evadeBP: 9500
      }),
      enemyInitial: baseEntity({
        entityId: 'beta',
        hp: 10000,
        hpMax: 10000,
        atk: 10,
        def: 10000,
        spd: 100,
        accuracyBP: 500,
        evadeBP: 9500
      }),
      maxRounds: 30
    });

    const battleEnd = result.events[result.events.length - 1];

    expect(battleEnd).toEqual({
      type: 'BATTLE_END',
      round: 30,
      winnerEntityId: 'alpha',
      loserEntityId: 'beta',
      reason: 'timeout'
    });
    expect(result.winnerEntityId).toBe('alpha');
  });
});
