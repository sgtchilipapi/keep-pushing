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
    activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW'],
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

      observedVoltWeights.push(weights.VOLT_STRIKE ?? 0);
    }

    expect(observedVoltWeights[0]).toBeGreaterThan(0);
    for (let index = 1; index < observedVoltWeights.length; index += 1) {
      expect(observedVoltWeights[index]).toBeGreaterThan(observedVoltWeights[index - 1]);
    }
    expect(firstPlayerActionSkillId(weights)).toBe('VOLT_STRIKE');
  });

  it('clamps weights to [-1000, 1000]', () => {
    const saturatedPositive = updateSkillWeights({
      currentSkillWeights: { VOLT_STRIKE: 999 },
      skillContributions: { VOLT_STRIKE: { damageDealt: 999999, statusTurnsApplied: 10 } },
      enemyHpMax: 1,
      didWin: true
    });

    const saturatedNegative = updateSkillWeights({
      currentSkillWeights: { FINISHING_BLOW: -999 },
      skillContributions: { FINISHING_BLOW: { damageDealt: 999999, statusTurnsApplied: 10 } },
      enemyHpMax: 1,
      didWin: false
    });

    expect(saturatedPositive.VOLT_STRIKE).toBe(MAX_LEARNING_WEIGHT);
    expect(saturatedNegative.FINISHING_BLOW).toBe(MIN_LEARNING_WEIGHT);
  });

  it('remains deterministic for same seed and initial weights', () => {
    const initialWeights: ArchetypeSkillWeights = { VOLT_STRIKE: 25, FINISHING_BLOW: -10 };

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
      ['VOLT_STRIKE', 'FINISHING_BLOW'],
      { VOLT_STRIKE: 0, FINISHING_BLOW: 0 },
      { hp: 4000, hpMax: 6000, statuses: [] },
      { VOLT_STRIKE: 100, FINISHING_BLOW: -100 }
    );

    expect(weightedChoice.skillId).toBe('VOLT_STRIKE');
  });
});
