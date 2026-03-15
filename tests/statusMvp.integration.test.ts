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
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

describe('status MVP mechanics', () => {
  it('applies all five MVP statuses via dedicated and remapped skills', () => {
    const remapped = simulateBattle({
      battleId: 'status-remapped',
      seed: 7,
      playerInitial: makeCombatant({ entityId: 'alpha', activeSkillIds: ['1001', '1002'] }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 2600, hpMax: 2600, activeSkillIds: ['1001', '1002'] }),
      maxRounds: 3
    });

    const dedicatedOffenseDefense = simulateBattle({
      battleId: 'status-dedicated-overheat-shield',
      seed: 11,
      playerInitial: makeCombatant({ entityId: 'gamma', activeSkillIds: ['1003', '1004'] }),
      enemyInitial: makeCombatant({ entityId: 'delta', hp: 2600, hpMax: 2600, activeSkillIds: ['1003', '1004'] }),
      maxRounds: 4
    });

    const dedicatedRecover = simulateBattle({
      battleId: 'status-dedicated-recover',
      seed: 17,
      playerInitial: makeCombatant({ entityId: 'epsilon', activeSkillIds: ['1005', '1005'], hp: 1400 }),
      enemyInitial: makeCombatant({ entityId: 'zeta', hp: 2600, hpMax: 2600, activeSkillIds: ['1005', '1005'] }),
      maxRounds: 3
    });

    const appliedIds = new Set(
      [...remapped.events, ...dedicatedOffenseDefense.events, ...dedicatedRecover.events]
        .filter((event): event is Extract<(typeof remapped.events)[number], { type: 'STATUS_APPLY' }> =>
          event.type === 'STATUS_APPLY'
        )
        .map((event) => event.statusId)
    );

    expect(appliedIds).toEqual(new Set(['stunned', 'recovering', 'overheated', 'shielded', 'broken_armor']));
  });

  it('does not leak old side-status mappings from volt strike and finishing blow', () => {
    const result = simulateBattle({
      battleId: 'status-remap-no-leak',
      seed: 19,
      playerInitial: makeCombatant({ entityId: 'alpha', activeSkillIds: ['1001', '1002'] }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 2600, hpMax: 2600, activeSkillIds: ['1001', '1002'] }),
      maxRounds: 3
    });

    const actionsByRoundActor = new Map<string, string>();
    for (const event of result.events) {
      if (event.type === 'ACTION') {
        actionsByRoundActor.set(`${event.round}:${event.actorId}`, event.skillId);
      }
    }

    const statusBySkill = new Map<string, Set<string>>();
    for (const event of result.events) {
      if (event.type !== 'STATUS_APPLY') {
        continue;
      }

      const sourceSkillId = actionsByRoundActor.get(`${event.round}:${event.sourceId}`);
      if (sourceSkillId === undefined) {
        continue;
      }

      const existing = statusBySkill.get(sourceSkillId) ?? new Set<string>();
      existing.add(event.statusId);
      statusBySkill.set(sourceSkillId, existing);
    }

    expect(statusBySkill.get('1001') ?? new Set()).toEqual(new Set(['stunned']));
    expect(statusBySkill.get('1002') ?? new Set()).toEqual(new Set(['broken_armor']));
  });

  it('overheated deals round-start damage and recovering heals without exceeding hpMax', () => {
    const overheatedResult = simulateBattle({
      battleId: 'status-dot-only',
      seed: 23,
      playerInitial: makeCombatant({ entityId: 'alpha', activeSkillIds: ['1003', '1003'], hp: 1600, hpMax: 2000 }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 2600, hpMax: 2600, activeSkillIds: ['1003', '1003'] }),
      maxRounds: 3
    });

    const recoveringResult = simulateBattle({
      battleId: 'status-hot-only',
      seed: 29,
      playerInitial: makeCombatant({ entityId: 'gamma', activeSkillIds: ['1005', '1005'], hp: 1600, hpMax: 2000 }),
      enemyInitial: makeCombatant({ entityId: 'delta', hp: 2600, hpMax: 2600, activeSkillIds: ['1005', '1005'] }),
      maxRounds: 3
    });

    const dotEvent = overheatedResult.events.find(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.statusId === 'overheated' && event.phase === 'onRoundStart'
    );
    const hotEvent = recoveringResult.events.find(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.statusId === 'recovering' && event.phase === 'onRoundStart'
    );

    expect(dotEvent).toEqual(expect.objectContaining({ hpDelta: -120 }));
    expect(hotEvent).toBeDefined();
    expect(hotEvent).toEqual(expect.objectContaining({ hpDelta: 90 }));

    const maxHpViolation = recoveringResult.events.find(
      (event) =>
        event.type === 'STATUS_EFFECT_RESOLVE' &&
        event.statusId === 'recovering' &&
        event.targetId === 'gamma' &&
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
