import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function buildCombatant(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    entityId: '101',
    hp: 2200,
    hpMax: 2200,
    atk: 180,
    def: 90,
    spd: 110,
    accuracyBP: 8500,
    evadeBP: 1200,
    activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW'],
    ...overrides
  };
}

describe('battleEngine combatant snapshot contract', () => {
  it('accepts canonical snapshots with optional metadata and no initiative', () => {
    const result = simulateBattle({
      battleId: 'canonical-baseline',
      seed: 1337,
      playerInitial: buildCombatant({ entityId: '1001', side: 'PLAYER', name: 'Alpha' }),
      enemyInitial: buildCombatant({ entityId: '2002', side: 'ENEMY', name: 'Beta', spd: 100 })
    });

    expect(result.events.some((event) => event.type === 'ACTION')).toBe(true);
    expect(result.playerInitial.entityId).toBe('1001');
    expect(result.enemyInitial.entityId).toBe('2002');
  });

  it('handles passiveSkillIds when present and when omitted', () => {
    const withPassives = simulateBattle({
      battleId: 'with-passives',
      seed: 101,
      playerInitial: buildCombatant({ entityId: '11', passiveSkillIds: ['EAGLE_EYE', 'EXECUTIONER_FOCUS'] }),
      enemyInitial: buildCombatant({ entityId: '22' }),
      maxRounds: 2
    });

    const withoutPassives = simulateBattle({
      battleId: 'without-passives',
      seed: 101,
      playerInitial: buildCombatant({ entityId: '11' }),
      enemyInitial: buildCombatant({ entityId: '22' }),
      maxRounds: 2
    });

    expect(withPassives.events.length).toBeGreaterThan(0);
    expect(withoutPassives.events.length).toBeGreaterThan(0);
  });

  it('does not require snapshot-level initiative', () => {
    expect(() =>
      simulateBattle({
        battleId: 'no-initiative',
        seed: 2024,
        playerInitial: buildCombatant({ entityId: '7' }),
        enemyInitial: buildCombatant({ entityId: '8', spd: 95 }),
        maxRounds: 1
      })
    ).not.toThrow();
  });

  it('preserves string entity IDs in status attribution and events', () => {
    const result = simulateBattle({
      battleId: 'string-id-semantics',
      seed: 99,
      playerInitial: buildCombatant({ entityId: '9001' }),
      enemyInitial: buildCombatant({ entityId: '9002', hp: 2500, hpMax: 2500 }),
      maxRounds: 3
    });

    const statusEvent = result.events.find(
      (event): event is Extract<(typeof result.events)[number], { type: 'STATUS_APPLY' | 'STATUS_REFRESH' }> =>
        event.type === 'STATUS_APPLY' || event.type === 'STATUS_REFRESH'
    );

    expect(statusEvent).toBeDefined();
    expect(statusEvent).toEqual(
      expect.objectContaining({
        sourceId: '9001',
        targetId: '9002'
      })
    );
  });
});
