import { chooseAction, type DecisionContext, type DecisionTrace } from '../engine/battle/aiDecision';

function createDecisionContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    actor: {
      entityId: 'actor-1',
      hp: 5000,
      hpMax: 5000,
      atk: 180,
      def: 125,
      accuracyBP: 8600,
      evadeBP: 1200,
      statuses: [],
      activeSkillIds: ['1001', '1002'],
      cooldowns: { 1001: 0, 1002: 0 },
      ...overrides.actor
    },
    target: {
      entityId: 'target-1',
      hp: 1000,
      hpMax: 5000,
      atk: 170,
      def: 130,
      accuracyBP: 8400,
      evadeBP: 1300,
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
  it('captures feature, intent, and forecast-driven scoring breakdown plus the selected skill', () => {
    const traces: DecisionTrace[] = [];

    const choice = chooseAction(createDecisionContext(), {}, (trace) => traces.push(trace));

    expect(choice.skillId).toBe('1002');
    expect(traces).toHaveLength(1);

    const [trace] = traces;
    expect(trace.traceVersion).toBe('decision-trace.v4');
    expect(trace.candidateSkillIds).toEqual(['1000', '1001', '1002']);
    expect(trace.selectedSkillId).toBe('1002');
    expect(trace.context).toEqual(createDecisionContext());
    expect(trace.actorActiveSkillIds).toEqual(['1001', '1002']);
    expect(trace.actorCooldowns).toEqual({ 1001: 0, 1002: 0 });
    expect(trace.predictedOpponentSkillId).toBe('1000');
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
        priorContributionTotal: expect.any(Number),
        projections: expect.objectContaining({
          predictedOpponentSkillId: '1000',
          projectedOutgoingDamage: expect.any(Number),
          projectedIncomingDamage: expect.any(Number),
          projectedRecovery: expect.any(Number)
        })
      })
    );
    expect(finishingBlowScore?.features).toEqual(
      expect.objectContaining({
        executeOpportunity: 1,
        shieldbreakOpportunity: 1,
        projectedOutgoingPressure: expect.any(Number)
      })
    );
    expect(finishingBlowScore?.featureContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureId: 'executeOpportunity',
          value: 1,
          priorContribution: 120,
          intentContribution: 1120
        }),
        expect.objectContaining({
          featureId: 'projectedOutgoingPressure',
          value: expect.any(Number),
          totalContribution: expect.any(Number)
        })
      ])
    );
  });

  it('lets forecasting flip a defensive barrier preference into a proactive stun', () => {
    const context = createDecisionContext({
      actor: {
        entityId: 'actor-1',
        hp: 2200,
        hpMax: 2200,
        atk: 165,
        def: 120,
        accuracyBP: 8600,
        evadeBP: 1300,
        statuses: [],
        activeSkillIds: ['1001', '1004'],
        cooldowns: { 1001: 0, 1004: 0 }
      },
      target: {
        entityId: 'target-1',
        hp: 2100,
        hpMax: 2100,
        atk: 155,
        def: 130,
        accuracyBP: 8400,
        evadeBP: 1500,
        statuses: [],
        activeSkillIds: ['1001', '1000'],
        cooldowns: { 1001: 0, 1000: 0 }
      },
      battle: {
        round: 1,
        maxRounds: 8,
        roundsRemaining: 7
      }
    });

    expect(chooseAction(context, {}, undefined, { disableForecast: true }).skillId).toBe('1004');
    expect(chooseAction(context).skillId).toBe('1001');
  });

  it('chooses repair under high survival pressure', () => {
    const choice = chooseAction(
      createDecisionContext({
        actor: {
          entityId: 'actor-1',
          hp: 700,
          hpMax: 5000,
          atk: 160,
          def: 120,
          accuracyBP: 8500,
          evadeBP: 1200,
          statuses: [],
          activeSkillIds: ['1004', '1005'],
          cooldowns: { 1004: 0, 1005: 0 }
        },
        target: {
          entityId: 'target-1',
          hp: 4200,
          hpMax: 5000,
          atk: 180,
          def: 125,
          accuracyBP: 8600,
          evadeBP: 1200,
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
          atk: 175,
          def: 120,
          accuracyBP: 8600,
          evadeBP: 1250,
          statuses: [],
          activeSkillIds: ['1001', '1003'],
          cooldowns: { 1001: 0, 1003: 0 }
        },
        target: {
          entityId: 'target-1',
          hp: 5000,
          hpMax: 5000,
          atk: 170,
          def: 130,
          accuracyBP: 8400,
          evadeBP: 1300,
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
