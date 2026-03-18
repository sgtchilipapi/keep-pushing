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
  it('captures richer decision context, scoring breakdown, and selected skill', () => {
    const traces: DecisionTrace[] = [];

    const choice = chooseAction(createDecisionContext(), {}, (trace) => traces.push(trace));

    expect(choice.skillId).toBe('1002');
    expect(traces).toHaveLength(1);

    const [trace] = traces;
    expect(trace.traceVersion).toBe('decision-trace.v2');
    expect(trace.candidateSkillIds).toEqual(['1000', '1001', '1002']);
    expect(trace.selectedSkillId).toBe('1002');
    expect(trace.context).toEqual(createDecisionContext());
    expect(trace.actorActiveSkillIds).toEqual(['1001', '1002']);
    expect(trace.actorCooldowns).toEqual({ 1001: 0, 1002: 0 });

    const finishingBlowScore = trace.scores.find((score) => score.skillId === '1002');
    expect(finishingBlowScore).toEqual(
      expect.objectContaining({
        executeBonus: 500,
        shieldbreakBonus: 350,
        activeSkillBonus: 200
      })
    );
  });
});
