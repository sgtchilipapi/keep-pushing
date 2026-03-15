import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function makeCombatant(overrides: Partial<CombatantSnapshot>): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 2000,
    hpMax: 2000,
    atk: 180,
    def: 80,
    spd: 100,
    accuracyBP: 9000,
    evadeBP: 1000,
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

describe('stun skip battle snapshot', () => {
  it('keeps deterministic event order around stunned skips', () => {
    const result = simulateBattle({
      battleId: 'stun-snapshot',
      seed: 1,
      playerInitial: makeCombatant({ entityId: 'alpha' }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 500, hpMax: 2000 })
    });

    expect(result.events).toMatchSnapshot();
  });
});
