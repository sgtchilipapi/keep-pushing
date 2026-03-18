import { chooseAction, type DecisionContext, type DecisionTrace } from '../engine/battle/aiDecision';

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    actor: {
      entityId: 'actor',
      hp: 1000,
      hpMax: 5000,
      statuses: [],
      activeSkillIds: ['1001', '1002'],
      cooldowns: { 1001: 0, 1002: 0 }
    },
    target: {
      entityId: 'target',
      hp: 1000,
      hpMax: 5000,
      statuses: ['shielded'],
      activeSkillIds: ['1003', '1000'],
      cooldowns: { 1003: 0, 1000: 0 }
    },
    battle: {
      round: 2,
      maxRounds: 8,
      roundsRemaining: 6
    },
    ...overrides
  };
}

describe('ai decision logging', () => {
  it('captures feature and intent breakdowns with rich context', () => {
    const traces: DecisionTrace[] = [];

    const choice = chooseAction(createContext(), {}, (trace) => traces.push(trace));

    expect(choice.skillId).toBe('1002');
    expect(traces).toHaveLength(1);

    const [trace] = traces;
    expect(trace.version).toBe('intent_v1');
    expect(trace.candidateSkillIds).toEqual(['1000', '1001', '1002']);
    expect(trace.selectedSkillId).toBe('1002');
    expect(trace.context.target.statuses).toEqual(['shielded']);
    expect(trace.intentWeights).toEqual(
      expect.objectContaining({
        finish: 700,
        survive: 850,
        attrition: 120
      })
    );

    const finishingBlowScore = trace.scores.find((score) => score.skillId === '1002');
    expect(finishingBlowScore?.featureContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureId: 'executeOpportunity', contribution: 120 }),
        expect.objectContaining({ featureId: 'shieldbreakOpportunity', contribution: 90 })
      ])
    );
    expect(finishingBlowScore?.intentContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ intentId: 'finish', contribution: 49 })
      ])
    );
  });
});
