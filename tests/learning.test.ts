import { chooseAction, type DecisionTrace } from '../engine/battle/aiDecision';
import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';
import {
  DEFAULT_WEAK_PRIOR_SCALE_BP,
  MAX_FEATURE_LEARNING_WEIGHT,
  MAX_LEARNING_WEIGHT,
  MIN_FEATURE_LEARNING_WEIGHT,
  MIN_LEARNING_WEIGHT,
  buildFeatureContributions,
  buildSkillContributions,
  createLearningState,
  updateLearningState,
  updateSkillWeights,
  type ArchetypeLearningState,
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

function trainLearningModel(currentModel: ArchetypeLearningState, seed: number): ArchetypeLearningState {
  const decisionTraces: DecisionTrace[] = [];
  const result = simulateBattle({
    battleId: `feature-learning-${seed}`,
    seed,
    playerInitial: buildCombatant({ entityId: 'player', spd: 125, activeSkillIds: ['1004', '1005'] }),
    enemyInitial: buildCombatant({ entityId: 'enemy', hp: 4800, hpMax: 4800, atk: 185, def: 105, spd: 120, activeSkillIds: ['1002', '1000'] }),
    playerSkillWeights: currentModel,
    maxRounds: 2,
    decisionLogger: (decision) => {
      if (decision.actorId === 'player') {
        decisionTraces.push(decision.trace);
      }
    }
  });

  return updateLearningState({
    currentModel,
    skillContributions: buildSkillContributions(result.events, 'player'),
    featureContributions: buildFeatureContributions(decisionTraces),
    enemyHpMax: result.enemyInitial.hpMax,
    didWin: result.winnerEntityId === 'player'
  });
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
          atk: 180,
          def: 120,
          accuracyBP: 8600,
          evadeBP: 1200,
          statuses: [],
          activeSkillIds: ['1001', '1002'],
          cooldowns: { 1001: 0, 1002: 0 }
        },
        target: {
          entityId: 'enemy',
          hp: 4000,
          hpMax: 6000,
          atk: 170,
          def: 130,
          accuracyBP: 8400,
          evadeBP: 1300,
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

  it('adds bounded feature-level residuals with confidence and weak priors', () => {
    let model = createLearningState();

    expect(model.priorWeightScaleBP).toBe(DEFAULT_WEAK_PRIOR_SCALE_BP);
    expect(model.featureWeights).toEqual({});
    expect(model.featureConfidence).toEqual({});

    model = trainLearningModel(model, 11);
    model = trainLearningModel(model, 11);

    expect(Math.abs(model.featureWeights.defensiveRepairValue ?? 0)).toBeGreaterThan(0);
    expect(model.featureConfidence.defensiveRepairValue).toBeGreaterThan(0);
    expect(model.featureConfidence.defensiveRepairValue).toBeLessThanOrEqual(10000);

    const traces: DecisionTrace[] = [];
    const choice = chooseAction(
      {
        actor: {
          entityId: 'player',
          hp: 650,
          hpMax: 2200,
          atk: 190,
          def: 90,
          accuracyBP: 9000,
          evadeBP: 800,
          statuses: [],
          activeSkillIds: ['1004', '1005'],
          cooldowns: { 1004: 0, 1005: 0 }
        },
        target: {
          entityId: 'enemy',
          hp: 1600,
          hpMax: 2200,
          atk: 200,
          def: 100,
          accuracyBP: 9200,
          evadeBP: 700,
          statuses: [],
          activeSkillIds: ['1002', '1000'],
          cooldowns: { 1002: 0, 1000: 0 }
        },
        battle: {
          round: 2,
          maxRounds: 6,
          roundsRemaining: 4
        }
      },
      model,
      (trace) => traces.push(trace)
    );

    expect(['1004', '1005']).toContain(choice.skillId);
    expect(traces[0].traceVersion).toBe('decision-trace.v6');
    expect(traces[0].selectedScore.weightBreakdown.learnedFeatureContributionTotal).not.toBe(0);
    expect(
      traces[0].selectedScore.featureContributions.some((feature) => feature.learnedConfidenceBP > 0)
    ).toBe(true);
  });

  it('decays unused feature confidence and clamps bounded feature residuals', () => {
    const evolved = updateLearningState({
      currentModel: createLearningState({
        featureWeights: { defensiveRepairValue: 240, controlOpportunity: -240 },
        featureConfidence: { defensiveRepairValue: 9800, controlOpportunity: 9800 }
      }),
      skillContributions: {},
      featureContributions: {
        defensiveRepairValue: { totalValue: 8, selections: 1 },
        controlOpportunity: { totalValue: 9, selections: 1 }
      },
      enemyHpMax: 2000,
      didWin: true,
      featureLearningRate: 200,
      confidenceStepBP: 5000
    });

    expect(evolved.featureWeights.defensiveRepairValue).toBe(MAX_FEATURE_LEARNING_WEIGHT);
    expect(evolved.featureConfidence.defensiveRepairValue).toBe(10000);
    expect(evolved.featureWeights.controlOpportunity).toBeGreaterThan(MIN_FEATURE_LEARNING_WEIGHT);

    const decayed = updateLearningState({
      currentModel: evolved,
      skillContributions: {},
      featureContributions: {},
      enemyHpMax: 2000,
      didWin: false
    });

    expect(decayed.featureConfidence.defensiveRepairValue).toBeLessThan(evolved.featureConfidence.defensiveRepairValue);
    expect(decayed.featureWeights.defensiveRepairValue).toBeLessThan(evolved.featureWeights.defensiveRepairValue);
  });

  it('shows deterministic progression against a stable regression league', () => {
    const leagueSeeds = [101, 202, 303, 404];
    const baselineModel = createLearningState();
    let trainedModel = baselineModel;

    for (const seed of leagueSeeds) {
      trainedModel = trainLearningModel(trainedModel, seed);
    }

    const evaluate = (model: ArchetypeLearningState) =>
      leagueSeeds.map((seed) => {
        const result = simulateBattle({
          battleId: `regression-league-${seed}`,
          seed,
          playerInitial: buildCombatant({ entityId: 'player', spd: 125, activeSkillIds: ['1004', '1005'] }),
          enemyInitial: buildCombatant({ entityId: 'enemy', hp: 4800, hpMax: 4800, atk: 185, def: 105, spd: 120, activeSkillIds: ['1002', '1000'] }),
          playerSkillWeights: model,
          maxRounds: 2
        });
        return result.winnerEntityId === 'player' ? 1 : 0;
      });

    const baselineScores = evaluate(baselineModel);
    const trainedScores = evaluate(trainedModel);

    expect(trainedScores.reduce<number>((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(
      baselineScores.reduce<number>((sum, value) => sum + value, 0)
    );
    expect(Object.keys(trainedModel.featureWeights).length).toBeGreaterThan(0);
    expect(Object.keys(trainedModel.featureConfidence).length).toBeGreaterThan(0);
  });
});
