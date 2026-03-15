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

describe('stun skip action gate', () => {
  it('emits STUNNED_SKIP and prevents ACTION when stunned actor is scheduled', () => {
    const input = {
      battleId: 'stun-skip',
      seed: 1,
      playerInitial: makeCombatant({ entityId: 'alpha' }),
      enemyInitial: makeCombatant({ entityId: 'beta', hp: 500, hpMax: 2000 })
    };

    const first = simulateBattle(input);
    const second = simulateBattle(input);

    expect(first.events).toEqual(second.events);

    const stunApplyIndex = first.events.findIndex(
      (event) => event.type === 'STATUS_APPLY' && event.targetId === 'beta' && event.statusId === 'stunned'
    );

    expect(stunApplyIndex).toBeGreaterThan(-1);

    const postStunRoundEvents = first.events
      .slice(stunApplyIndex + 1)
      .filter((event) => event.round === 1);

    expect(postStunRoundEvents).toContainEqual({
      type: 'STUNNED_SKIP',
      round: 1,
      actorId: 'beta'
    });

    const stunnedActorActionInRound = postStunRoundEvents.find(
      (event) => event.type === 'ACTION' && event.actorId === 'beta'
    );

    expect(stunnedActorActionInRound).toBeUndefined();
  });
});
