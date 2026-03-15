import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function buildCombatant(overrides: Partial<CombatantSnapshot>): CombatantSnapshot {
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

describe('battleEngine skills', () => {
  it('decrements cooldowns at round end and emits COOLDOWN_SET', () => {
    const result = simulateBattle({
      battleId: 'cooldown-round-end',
      seed: 42,
      playerInitial: buildCombatant({ entityId: 'player', atk: 60 }),
      enemyInitial: buildCombatant({ entityId: 'enemy', hp: 9000, hpMax: 9000, def: 2000, atk: 5 }),
      maxRounds: 3
    });

    const cooldownSet = result.events.filter(
      (event): event is Extract<(typeof result.events)[number], { type: 'COOLDOWN_SET' }> =>
        event.type === 'COOLDOWN_SET' && event.actorId === 'player' && event.skillId === '1001'
    );

    expect(cooldownSet.length).toBeGreaterThanOrEqual(1);
    expect(cooldownSet[0]).toEqual(
      expect.objectContaining({ type: 'COOLDOWN_SET', cooldownRemainingTurns: 2 })
    );

    const actionRounds = result.events
      .filter((event): event is Extract<(typeof result.events)[number], { type: 'ACTION' }> => event.type === 'ACTION')
      .map((event) => event.round);

    expect(actionRounds).toContain(cooldownSet[0].round);
  });

  it('AI uses execute when target HP percent is below threshold', () => {
    const result = simulateBattle({
      battleId: 'execute-threshold',
      seed: 99,
      playerInitial: buildCombatant({ entityId: 'player', spd: 120 }),
      enemyInitial: buildCombatant({ entityId: 'enemy', hp: 500, hpMax: 2000, def: 300, spd: 90 }),
      maxRounds: 1
    });

    const firstAction = result.events.find(
      (event): event is Extract<(typeof result.events)[number], { type: 'ACTION' }> =>
        event.type === 'ACTION' && event.actorId === 'player'
    );

    expect(firstAction).toEqual(
      expect.objectContaining({ type: 'ACTION', skillId: '1002', round: 1 })
    );
  });
});
