export type StatusId = 'stunned' | 'shielded' | 'broken_armor' | 'silenced' | 'resist';

export type StatusDef = {
  id: StatusId;
  durationTurns: number;
};

const STATUS_REGISTRY: Record<StatusId, StatusDef> = {
  stunned: { id: 'stunned', durationTurns: 1 },
  shielded: { id: 'shielded', durationTurns: 2 },
  broken_armor: { id: 'broken_armor', durationTurns: 2 },
  silenced: { id: 'silenced', durationTurns: 1 },
  resist: { id: 'resist', durationTurns: 3 }
};

export function getStatusDef(statusId: StatusId): StatusDef {
  return STATUS_REGISTRY[statusId];
}
