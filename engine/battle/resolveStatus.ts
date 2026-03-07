import { getStatusDef, type StatusId } from './statusRegistry';

/**
 * Mutable map of active status effects to their remaining durations.
 *
 * A missing key or non-positive value indicates the status is not currently
 * active on the entity.
 */
export type ActiveStatuses = Partial<Record<StatusId, number>>;

/**
 * Event emitted when a status is first applied or its duration is refreshed.
 *
 * Consumers can use the discriminated {@link type} field to distinguish initial
 * application from a reapply that resets remaining turns.
 */
export type StatusApplyEvent = {
  type: 'STATUS_APPLY' | 'STATUS_REFRESH';
  round: number;
  targetId: string;
  statusId: StatusId;
  sourceId: string;
  remainingTurns: number;
};

/**
 * Event emitted when an active status naturally expires at round end.
 */
export type StatusExpireEvent = {
  type: 'STATUS_EXPIRE';
  round: number;
  targetId: string;
  statusId: StatusId;
};

/**
 * Applies or refreshes a status on a target status map.
 *
 * This function mutates {@link statuses} in place by writing the configured
 * duration for {@link statusId}. Reapplications refresh remaining turns rather
 * than stacking effect intensity.
 *
 * @param statuses - Mutable status-turn map for the target entity.
 * @param statusId - Status identifier to apply.
 * @param sourceId - Entity ID that caused the status application.
 * @param targetId - Entity ID receiving the status.
 * @param round - Current simulation round used for event metadata.
 * @returns A status lifecycle event describing apply versus refresh behavior.
 * @throws If {@link statusId} is not defined in the status registry.
 */
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

  // Reapplying a status refreshes duration instead of stacking intensity to keep effects predictable.
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

/**
 * Advances status durations at round end and emits expiration events.
 *
 * The provided {@link statuses} map is mutated in place: expired entries are
 * deleted and surviving entries are decremented by one turn. Expiration events
 * are emitted in stable key order for deterministic replay output.
 *
 * @param statuses - Mutable status-turn map for one combatant.
 * @param targetId - Entity ID owning the status map.
 * @param round - Current simulation round used for event metadata.
 * @returns Ordered list of expiration events generated during the decrement pass.
 */
export function decrementStatusesAtRoundEnd(
  statuses: ActiveStatuses,
  targetId: string,
  round: number
): StatusExpireEvent[] {
  const expires: StatusExpireEvent[] = [];

  // Stable ordering keeps emitted STATUS_EXPIRE events deterministic for snapshot-based tests and replays.
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
