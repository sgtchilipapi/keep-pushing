import { getStatusDef, type StatusId } from './statuses/statusRegistry';

export type ActiveStatusState = {
  sourceId: string;
  remainingTurns: number;
};

export type ActiveStatuses = Partial<Record<StatusId, ActiveStatusState>>;

export type StatusApplyEvent = {
  type: 'STATUS_APPLY' | 'STATUS_REFRESH';
  round: number;
  targetId: string;
  statusId: StatusId;
  sourceId: string;
  remainingTurns: number;
};

export type StatusApplyFailedEvent = {
  type: 'STATUS_APPLY_FAILED';
  round: number;
  targetId: string;
  statusId: StatusId;
  sourceId: string;
  reason: 'NON_POSITIVE_DURATION';
};

export type StatusExpireEvent = {
  type: 'STATUS_EXPIRE';
  round: number;
  targetId: string;
  statusId: StatusId;
};

export function applyStatus(
  statuses: ActiveStatuses,
  statusId: StatusId,
  sourceId: string,
  targetId: string,
  round: number
): StatusApplyEvent | StatusApplyFailedEvent {
  const statusDef = getStatusDef(statusId);
  const currentRemainingTurns = statuses[statusId]?.remainingTurns ?? 0;
  const nextRemainingTurns = Math.max(currentRemainingTurns, statusDef.durationTurns);
  if (nextRemainingTurns <= 0) {
    return {
      type: 'STATUS_APPLY_FAILED',
      round,
      targetId,
      statusId,
      sourceId,
      reason: 'NON_POSITIVE_DURATION'
    };
  }

  const hadStatus = currentRemainingTurns > 0;

  statuses[statusId] = {
    sourceId,
    remainingTurns: nextRemainingTurns
  };

  return {
    type: hadStatus ? 'STATUS_REFRESH' : 'STATUS_APPLY',
    round,
    targetId,
    statusId,
    sourceId,
    remainingTurns: nextRemainingTurns
  };
}

export function decrementStatusesAtRoundEnd(
  statuses: ActiveStatuses,
  targetId: string,
  round: number
): StatusExpireEvent[] {
  const expires: StatusExpireEvent[] = [];

  const orderedStatusIds = Object.keys(statuses).sort() as StatusId[];
  for (const statusId of orderedStatusIds) {
    const activeStatus = statuses[statusId];
    const remainingTurns = activeStatus?.remainingTurns ?? 0;
    if (remainingTurns <= 0) {
      delete statuses[statusId];
      continue;
    }

    const nextRemainingTurns = remainingTurns - 1;
    if (nextRemainingTurns <= 0) {
      delete statuses[statusId];
      expires.push({
        type: 'STATUS_EXPIRE',
        round,
        targetId,
        statusId
      });
      continue;
    }

    statuses[statusId] = {
      sourceId: activeStatus?.sourceId ?? targetId,
      remainingTurns: nextRemainingTurns
    };
  }

  return expires;
}
