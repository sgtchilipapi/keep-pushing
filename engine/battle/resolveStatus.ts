import { getStatusDef, type StatusId } from './statusRegistry';

export type ActiveStatuses = Partial<Record<StatusId, number>>;

export type StatusApplyEvent = {
  type: 'STATUS_APPLY' | 'STATUS_REFRESH';
  round: number;
  targetId: string;
  statusId: StatusId;
  sourceId: string;
  remainingTurns: number;
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
): StatusApplyEvent {
  const statusDef = getStatusDef(statusId);
  const nextRemainingTurns = statusDef.durationTurns;
  const hadStatus = (statuses[statusId] ?? 0) > 0;

  statuses[statusId] = nextRemainingTurns;

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
    const remainingTurns = statuses[statusId] ?? 0;
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

    statuses[statusId] = nextRemainingTurns;
  }

  return expires;
}
