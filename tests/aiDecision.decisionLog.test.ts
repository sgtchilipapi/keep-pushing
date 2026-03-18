import { chooseAction, type DecisionContext, type DecisionTrace } from '../engine/battle/aiDecision';

function createDecisionContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    actor: {
      entityId: 'actor-1',
      hp: 5000,
      hpMax: 5000,
      statuses: [],
      activeSkillIds: ['1001', '1002'],
      cooldowns: { 1001: 0, 1002: 0 },
      ...overrides.actor
    },
    target: {
      entityId: 'target-1',
      hp: 1000,
      hpMax: 5000,
      statuses: ['shielded'],
      activeSkillIds: ['1003', '1000'],
      cooldowns: { 1003: 1, 1000: 0 },
      ...overrides.target
    },
    battle: {
      round: 3,
      maxRounds: 8,
      roundsRemaining: 5,
      ...overrides.battle
    }
  };
}

describe('ai decision logging', () => {
  it('captures feature and intent-driven scoring breakdown plus the selected skill', () => {
    const traces: DecisionTrace[] = [];

    const choice = chooseAction(createDecisionContext(), {}, (trace) => traces.push(trace));

    expect(choice.skillId).toBe('1002');
    expect(traces).toHaveLength(1);

    const [trace] = traces;
    expect(trace.traceVersion).toBe('decision-trace.v3');
    expect(trace.candidateSkillIds).toEqual(['1000', '1001', '1002']);
    expect(trace.selectedSkillId).toBe('1002');
    expect(trace.context).toEqual(createDecisionContext());
    expect(trace.actorActiveSkillIds).toEqual(['1001', '1002']);
    expect(trace.actorCooldowns).toEqual({ 1001: 0, 1002: 0 });
    expect(trace.intentWeights).toEqual({
      finish: 7,
      survive: 1,
      control: 2,
      setup: 0,
      attrition: 1
    });

    const finishingBlowScore = trace.scores.find((score) => score.skillId === '1002');
    expect(finishingBlowScore).toEqual(
      expect.objectContaining({
        executeBonus: 120,
        shieldbreakBonus: 90,
        activeSkillBonus: 25,
        intentContributionTotal: expect.any(Number),
        priorContributionTotal: expect.any(Number)
      })
    );
    expect(finishingBlowScore?.features).toEqual(
      expect.objectContaining({
        executeOpportunity: 1,
        shieldbreakOpportunity: 1
      })
    );
    expect(finishingBlowScore?.featureContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureId: 'executeOpportunity',
          value: 1,
          priorContribution: 120,
          intentContribution: 1120
        })
      ])
    );
  });

  it('chooses repair under high survival pressure', () => {
    const choice = chooseAction(
      createDecisionContext({
        actor: {
          entityId: 'actor-1',
          hp: 700,
          hpMax: 5000,
          statuses: [],
          activeSkillIds: ['1004', '1005'],
          cooldowns: { 1004: 0, 1005: 0 }
        },
        target: {
          entityId: 'target-1',
          hp: 4200,
          hpMax: 5000,
          statuses: [],
          activeSkillIds: ['1001', '1002'],
          cooldowns: { 1001: 0, 1002: 0 }
        }
      })
    );

    expect(choice.skillId).toBe('1005');
  });

  it('prefers surge as an early setup/attrition action against a healthy target', () => {
    const choice = chooseAction(
      createDecisionContext({
        actor: {
          entityId: 'actor-1',
          hp: 5000,
          hpMax: 5000,
          statuses: [],
          activeSkillIds: ['1001', '1003'],
          cooldowns: { 1001: 0, 1003: 0 }
        },
        target: {
          entityId: 'target-1',
          hp: 5000,
          hpMax: 5000,
          statuses: [],
          activeSkillIds: ['1002', '1000'],
          cooldowns: { 1002: 0, 1000: 0 }
        },
        battle: {
          round: 1,
          maxRounds: 8,
          roundsRemaining: 7
        }
      })
    );

    expect(choice.skillId).toBe('1003');
  });
});
