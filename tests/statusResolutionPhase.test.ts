import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';
import { getStatusResolver } from '../engine/battle/statuses/resolverRegistry';

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

describe('status resolution phase', () => {
  it('emits on-apply status effect resolution after successful status apply', () => {
    const result = simulateBattle({
      battleId: 'status-on-apply',
      seed: 1,
      playerInitial: makeCombatant({ entityId: 'alpha' }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 500, hpMax: 2000 }),
      maxRounds: 1
    });

    const applyIndex = result.events.findIndex((event) => event.type === 'STATUS_APPLY');
    const resolveIndex = result.events.findIndex(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.phase === 'onApply'
    );

    expect(applyIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(applyIndex);
  });

  it('resolves round-start status effects before first action in the round', () => {
    const result = simulateBattle({
      battleId: 'status-round-start',
      seed: 1,
      playerInitial: makeCombatant({ entityId: 'alpha' }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 500, hpMax: 2000 }),
      maxRounds: 3
    });

    const roundStartIndex = result.events.findIndex((event) => event.type === 'ROUND_START' && event.round === 3);
    const roundStartResolveIndex = result.events.findIndex(
      (event) => event.type === 'STATUS_EFFECT_RESOLVE' && event.phase === 'onRoundStart' && event.round === 3
    );
    const roundFirstActionIndex = result.events.findIndex((event) => event.type === 'ACTION' && event.round === 3);

    expect(roundStartIndex).toBeGreaterThan(-1);
    expect(roundStartResolveIndex).toBeGreaterThan(roundStartIndex);
    expect(roundStartResolveIndex).toBeLessThan(roundFirstActionIndex);
  });

  it('fails fast for missing status resolver lookups', () => {
    expect(() => getStatusResolver('unknown_status' as never)).toThrow('Missing status resolver');
  });
});
