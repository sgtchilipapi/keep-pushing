import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';

function baseEntity(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 1000,
    hpMax: 1000,
    atk: 140,
    def: 90,
    spd: 100,
    accuracyBP: 8500,
    evadeBP: 1200,
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

describe('battle event schema migration contract', () => {
  it('emits canonical normalized event keys and no legacy key aliases', () => {
    const result = simulateBattle({
      battleId: 'schema-check',
      seed: 42,
      playerInitial: baseEntity({ entityId: 'alpha' }),
      enemyInitial: baseEntity({ entityId: 'beta' }),
      maxRounds: 3
    });

    for (const event of result.events) {
      expect(event).not.toHaveProperty('actorEntityId');
      expect(event).not.toHaveProperty('targetEntityId');
      expect(event).not.toHaveProperty('sourceEntityId');
      expect(event).not.toHaveProperty('roll');

      if (event.type === 'ACTION' || event.type === 'STUNNED_SKIP' || event.type === 'COOLDOWN_SET') {
        expect(typeof event.actorId).toBe('string');
      }

      if (event.type === 'ACTION' || event.type === 'DAMAGE' || event.type === 'HIT_RESULT') {
        expect(typeof event.targetId).toBe('string');
      }

      if (event.type === 'HIT_RESULT') {
        expect(typeof event.rollBP).toBe('number');
        expect(typeof event.skillId).toBe('string');
      }

      if (event.type === 'STATUS_APPLY' || event.type === 'STATUS_REFRESH') {
        expect(typeof event.sourceId).toBe('string');
        expect(typeof event.targetId).toBe('string');
      }

      if (event.type === 'DEATH') {
        expect(typeof event.entityId).toBe('string');
      }

      if (event.type === 'BATTLE_END') {
        expect(typeof event.winnerEntityId).toBe('string');
        expect(typeof event.loserEntityId).toBe('string');
      }
    }
  });
});
