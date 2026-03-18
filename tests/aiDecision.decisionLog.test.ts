import { chooseAction, type DecisionTrace } from '../engine/battle/aiDecision';

describe('ai decision logging', () => {
  it('captures scoring breakdown and selected skill', () => {
    const traces: DecisionTrace[] = [];

    const choice = chooseAction(
      ['1001', '1002'],
      { 1001: 0, 1002: 0 },
      { hp: 1000, hpMax: 5000, statuses: ['shielded'] },
      {},
      (trace) => traces.push(trace)
    );

    expect(choice.skillId).toBe('1002');
    expect(traces).toHaveLength(1);

    const [trace] = traces;
    expect(trace.candidateSkillIds).toEqual(['1000', '1001', '1002']);
    expect(trace.selectedSkillId).toBe('1002');

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
