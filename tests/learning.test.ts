import { chooseAction } from '../engine/battle/aiDecision';
import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';
import {
  MAX_LEARNING_WEIGHT,
  MIN_LEARNING_WEIGHT,
  buildSkillContributions,
  updateSkillWeights,
  type ArchetypeSkillWeights
} from '../engine/battle/learning';

function buildCombatant(overrides: Partial<CombatantSnapshot>): CombatantSnapshot {
  return {
    entityId: 'entity',
    hp: 2200,
    hpMax: 2200,
    atk: 190,
    def: 90,
    spd: 110,
    accuracyBP: 9000,
    evadeBP: 800,
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

function firstPlayerActionSkillId(weights: ArchetypeSkillWeights): string {
  const result = simulateBattle({
    battleId: 'learning-first-action',
    seed: 77,
    playerInitial: buildCombatant({ entityId: 'player', spd: 120, accuracyBP: 10000 }),
    enemyInitial: buildCombatant({ entityId: 'enemy', hp: 6000, hpMax: 6000, def: 140, spd: 70, atk: 80, evadeBP: 0 }),
    playerSkillWeights: weights,
    maxRounds: 1
  });

  const firstAction = result.events.find(
    (event): event is Extract<(typeof result.events)[number], { type: 'ACTION' }> =>
      event.type === 'ACTION' && event.actorId === 'player'
  );

  if (firstAction === undefined) {
    throw new Error('Expected player ACTION event.');
  }

  return firstAction.skillId;
}

describe('learning', () => {
  it('increasingly favors more effective skills across runs with persisted weights', () => {
    let weights: ArchetypeSkillWeights = {};
    const observedVoltWeights: number[] = [];

    for (let run = 1; run <= 4; run += 1) {
      const result = simulateBattle({
        battleId: `learning-run-${run}`,
        seed: 77,
        playerInitial: buildCombatant({ entityId: 'player', spd: 120 }),
        enemyInitial: buildCombatant({ entityId: 'enemy', hp: 6000, hpMax: 6000, def: 140, spd: 70, atk: 80 }),
        playerSkillWeights: weights,
        maxRounds: 3
      });

      const skillContributions = buildSkillContributions(result.events, 'player');
      weights = updateSkillWeights({
        currentSkillWeights: weights,
        skillContributions,
        enemyHpMax: result.enemyInitial.hpMax,
        didWin: true
      });

      observedVoltWeights.push(weights['1001'] ?? 0);
    }

    expect(observedVoltWeights[0]).toBeGreaterThan(0);
    for (let index = 1; index < observedVoltWeights.length; index += 1) {
      expect(observedVoltWeights[index]).toBeGreaterThan(observedVoltWeights[index - 1]);
    }
    expect(['1001', '1002']).toContain(firstPlayerActionSkillId(weights));
  });

  it('clamps weights to [-1000, 1000]', () => {
    const saturatedPositive = updateSkillWeights({
      currentSkillWeights: { 1001: 999 },
      skillContributions: { 1001: { damageDealt: 999999, statusTurnsApplied: 10 } },
      enemyHpMax: 1,
      didWin: true
    });

    const saturatedNegative = updateSkillWeights({
      currentSkillWeights: { 1002: -999 },
      skillContributions: { 1002: { damageDealt: 999999, statusTurnsApplied: 10 } },
      enemyHpMax: 1,
      didWin: false
    });

    expect(saturatedPositive['1001']).toBe(MAX_LEARNING_WEIGHT);
    expect(saturatedNegative['1002']).toBe(MIN_LEARNING_WEIGHT);
  });

  it('remains deterministic for same seed and initial weights', () => {
    const initialWeights: ArchetypeSkillWeights = { 1001: 25, 1002: -10 };

    const runA = simulateBattle({
      battleId: 'determinism-a',
      seed: 314,
      playerInitial: buildCombatant({ entityId: 'player' }),
      enemyInitial: buildCombatant({ entityId: 'enemy', hp: 5000, hpMax: 5000, spd: 80 }),
      playerSkillWeights: initialWeights,
      maxRounds: 3
    });

    const runB = simulateBattle({
      battleId: 'determinism-b',
      seed: 314,
      playerInitial: buildCombatant({ entityId: 'player' }),
      enemyInitial: buildCombatant({ entityId: 'enemy', hp: 5000, hpMax: 5000, spd: 80 }),
      playerSkillWeights: initialWeights,
      maxRounds: 3
    });

    expect(runA.events).toEqual(runB.events);

    const contributionsA = buildSkillContributions(runA.events, 'player');
    const contributionsB = buildSkillContributions(runB.events, 'player');

    expect(contributionsA).toEqual(contributionsB);
    expect(
      updateSkillWeights({
        currentSkillWeights: initialWeights,
        skillContributions: contributionsA,
        enemyHpMax: runA.enemyInitial.hpMax,
        didWin: runA.winnerEntityId === 'player'
      })
    ).toEqual(
      updateSkillWeights({
        currentSkillWeights: initialWeights,
        skillContributions: contributionsB,
        enemyHpMax: runB.enemyInitial.hpMax,
        didWin: runB.winnerEntityId === 'player'
      })
    );

    const weightedChoice = chooseAction(
      {
        actor: {
          entityId: 'player',
          hp: 6000,
          hpMax: 6000,
          statuses: [],
          activeSkillIds: ['1001', '1002'],
          cooldowns: { 1001: 0, 1002: 0 }
        },
        target: {
          entityId: 'enemy',
          hp: 4000,
          hpMax: 6000,
          statuses: []
        },
        battle: {
          round: 1,
          maxRounds: 10,
          roundsRemaining: 9
        }
      },
      { 1001: 100, 1002: -100 }
    );

    expect(weightedChoice.skillId).toBe('1001');
  });
});
