/**
 * Enumerates every status effect identifier supported by the combat engine.
 *
 * These identifiers are used as stable keys for lookup, serialization, and
 * status application logic across battle systems.
 */
export type StatusId = 'stunned' | 'shielded' | 'broken_armor' | 'overheated' | 'recovering';

export const ALL_STATUS_IDS: readonly StatusId[] = ['stunned', 'shielded', 'broken_armor', 'overheated', 'recovering'];

/**
 * Describes the canonical configuration for a status effect.
 *
 * Each definition encodes immutable metadata used by combat resolution, such
 * as how long the status should remain active once applied.
 */
export type StatusDef = {
  /** Unique registry key for the status definition. */
  id: StatusId;
  /** High-level gameplay class for the status mechanic. */
  kind: 'disable' | 'dot' | 'hot' | 'buff' | 'debuff';
  /** Number of turns the status persists before expiring. */
  durationTurns: number;
  /** Signed HP delta applied by status resolvers when applicable. */
  roundStartHpDelta: number;
  /** Incoming damage multiplier in basis points while status is active. */
  incomingDamageMultiplierBP: number;
};

/**
 * @todo: Flesh out statuses. Disables, DOTs & HOTs, Buffs & Debuffs, etc.
 */
const STATUS_REGISTRY: Record<StatusId, StatusDef> = {
  stunned: {
    id: 'stunned',
    kind: 'disable',
    durationTurns: 1,
    roundStartHpDelta: 0,
    incomingDamageMultiplierBP: 10000
  },
  shielded: {
    id: 'shielded',
    kind: 'buff',
    durationTurns: 2,
    roundStartHpDelta: 0,
    incomingDamageMultiplierBP: 8000
  },
  broken_armor: {
    id: 'broken_armor',
    kind: 'debuff',
    durationTurns: 2,
    roundStartHpDelta: 0,
    incomingDamageMultiplierBP: 13000
  },
  overheated: {
    id: 'overheated',
    kind: 'dot',
    durationTurns: 2,
    roundStartHpDelta: -120,
    incomingDamageMultiplierBP: 10000
  },
  recovering: {
    id: 'recovering',
    kind: 'hot',
    durationTurns: 3,
    roundStartHpDelta: 90,
    incomingDamageMultiplierBP: 10000
  }
};

export function isStatusId(value: string): value is StatusId {
  return (ALL_STATUS_IDS as readonly string[]).includes(value);
}

/**
 * Retrieves the immutable definition for a known status effect.
 *
 * @param statusId - Identifier of the status whose configuration is needed.
 * @returns The canonical status definition associated with the provided ID.
 */
export function getStatusDef(statusId: StatusId): StatusDef {
  return STATUS_REGISTRY[statusId];
}
