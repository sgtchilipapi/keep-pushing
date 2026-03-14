import { adjustDamageForStatuses, simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function makeCombatant(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 2000,
    hpMax: 2000,
    atk: 180,
    def: 80,
    spd: 100,
    accuracyBP: 9000,
    evadeBP: 1000,
    activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW'],
    ...overrides
  };
}

describe('status MVP mechanics', () => {
  it('applies all five MVP statuses via normal combat flow', () => {
    const result = simulateBattle({
      battleId: 'status-all-five',
      seed: 7,
      playerInitial: makeCombatant({ entityId: 'alpha' }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 2600, hpMax: 2600 }),
      maxRounds: 3
    });

    const appliedIds = new Set(
      result.events
        .filter((event): event is Extract<(typeof result.events)[number], { type: 'STATUS_APPLY' }> =>
          event.type === 'STATUS_APPLY'
        )
        .map((event) => event.statusId)
    );

    expect(appliedIds).toEqual(new Set(['stunned', 'recovering', 'overheated', 'shielded', 'broken_armor']));
  });

  it('overheated deals round-start damage and recovering heals without exceeding hpMax', () => {
    const result = simulateBattle({
      battleId: 'status-hot-dot',
      seed: 11,
      playerInitial: makeCombatant({ entityId: 'alpha', hp: 1600, hpMax: 2000 }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 2600, hpMax: 2600 }),
      maxRounds: 3
    });

    const dotEvent = result.events.find(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.statusId === 'overheated' && event.phase === 'onRoundStart'
    );
    const hotEvent = result.events.find(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.statusId === 'recovering' && event.phase === 'onRoundStart'
    );

    expect(dotEvent).toEqual(expect.objectContaining({ hpDelta: -120 }));
    expect(hotEvent).toBeDefined();
    expect(hotEvent).toEqual(expect.objectContaining({ hpDelta: 90 }));

    const maxHpViolation = result.events.find(
      (event) =>
        event.type === 'STATUS_EFFECT_RESOLVE' &&
        event.statusId === 'recovering' &&
        event.targetId === 'alpha' &&
        event.targetHpAfter > 2000
    );
    expect(maxHpViolation).toBeUndefined();
  });

  it('shielded reduces incoming damage and broken_armor increases incoming damage', () => {
    const baseDamage = 200;
    expect(adjustDamageForStatuses(baseDamage, ['shielded'])).toBe(160);
    expect(adjustDamageForStatuses(baseDamage, ['broken_armor'])).toBe(260);
    expect(adjustDamageForStatuses(baseDamage, ['broken_armor', 'shielded'])).toBe(208);
  });
});
