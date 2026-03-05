import { applyStatus, decrementStatusesAtRoundEnd, type ActiveStatuses } from '../engine/battle/resolveStatus';

describe('status resolution', () => {
  it('refreshes duration when reapplied instead of stacking', () => {
    const statuses: ActiveStatuses = {};

    const applyEvent = applyStatus(statuses, 'stunned', 'actor-a', 'target-a', 1);
    const refreshEvent = applyStatus(statuses, 'stunned', 'actor-a', 'target-a', 2);

    expect(applyEvent.type).toBe('STATUS_APPLY');
    expect(refreshEvent.type).toBe('STATUS_REFRESH');
    expect(statuses.stunned).toBe(1);
  });

  it('expires statuses at end of round when remaining turns reaches zero', () => {
    const statuses: ActiveStatuses = {};
    applyStatus(statuses, 'stunned', 'actor-a', 'target-a', 1);

    const expires = decrementStatusesAtRoundEnd(statuses, 'target-a', 1);

    expect(expires).toEqual([
      {
        type: 'STATUS_EXPIRE',
        round: 1,
        targetId: 'target-a',
        statusId: 'stunned'
      }
    ]);
    expect(statuses.stunned).toBeUndefined();
  });

  it('does not increase active status count when reapplied', () => {
    const statuses: ActiveStatuses = {};
    applyStatus(statuses, 'resist', 'actor-a', 'target-a', 1);
    applyStatus(statuses, 'resist', 'actor-b', 'target-a', 1);

    expect(Object.keys(statuses)).toHaveLength(1);
    expect(statuses.resist).toBe(3);
  });
});
