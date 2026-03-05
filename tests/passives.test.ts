import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function buildCombatant(overrides: Partial<CombatantSnapshot>): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 2000,
    hpMax: 2000,
    atk: 160,
    def: 120,
    spd: 100,
    accuracyBP: 6500,
    evadeBP: 6000,
    activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW'],
    passiveSkillIds: ['EAGLE_EYE', 'EXECUTIONER_FOCUS'],
    ...overrides
  };
}

function firstHitResultForActor(result: ReturnType<typeof simulateBattle>, actorId: string) {
  return result.events.find(
    (event): event is Extract<(typeof result.events)[number], { type: 'HIT_RESULT' }> =>
      event.type === 'HIT_RESULT' && event.actorId === actorId
  );
}

describe('passives', () => {
  it('flat passives modify accuracyBP and deterministically change hit outcomes', () => {
    const withoutPassive = simulateBattle({
      battleId: 'without-passive',
      seed: 27,
      playerInitial: buildCombatant({ entityId: 'player', passiveSkillIds: undefined }),
      enemyInitial: buildCombatant({ entityId: 'enemy', passiveSkillIds: undefined }),
      maxRounds: 1
    });

    const withPassive = simulateBattle({
      battleId: 'with-passive',
      seed: 27,
      playerInitial: buildCombatant({ entityId: 'player', passiveSkillIds: ['EAGLE_EYE', 'EXECUTIONER_FOCUS'] }),
      enemyInitial: buildCombatant({ entityId: 'enemy', passiveSkillIds: undefined }),
      maxRounds: 1
    });

    expect(firstHitResultForActor(withoutPassive, 'player')).toEqual(
      expect.objectContaining({ hitChanceBP: 500, rollBP: 553, didHit: false })
    );

    expect(firstHitResultForActor(withPassive, 'player')).toEqual(
      expect.objectContaining({ hitChanceBP: 1500, rollBP: 553, didHit: true })
    );
  });
});
