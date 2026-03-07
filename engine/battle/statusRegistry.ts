/**
 * Enumerates every status effect identifier supported by the combat engine.
 *
 * These identifiers are used as stable keys for lookup, serialization, and
 * status application logic across battle systems.
 */
export type StatusId = 'stunned' | 'shielded' | 'broken_armor' | 'silenced' | 'resist';

/**
 * Describes the canonical configuration for a status effect.
 *
 * Each definition encodes immutable metadata used by combat resolution, such
 * as how long the status should remain active once applied.
 */
export type StatusDef = {
  /** Unique registry key for the status definition. */
  id: StatusId;
  /** Number of turns the status persists before expiring. */
  durationTurns: number;
};

const STATUS_REGISTRY: Record<StatusId, StatusDef> = {
  stunned: { id: 'stunned', durationTurns: 1 },
  shielded: { id: 'shielded', durationTurns: 2 },
  broken_armor: { id: 'broken_armor', durationTurns: 2 },
  silenced: { id: 'silenced', durationTurns: 1 },
  resist: { id: 'resist', durationTurns: 3 }
};

/**
 * Retrieves the immutable definition for a known status effect.
 *
 * This function assumes {@link statusId} is a valid member of {@link StatusId}
 * and returns the corresponding entry from the in-memory status registry.
 *
 * @param statusId - Identifier of the status whose configuration is needed.
 * @returns The canonical status definition associated with the provided ID.
 */
export function getStatusDef(statusId: StatusId): StatusDef {
  return STATUS_REGISTRY[statusId];
}
