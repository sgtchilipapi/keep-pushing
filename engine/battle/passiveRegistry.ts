/**
 * Stat keys that can be modified by passive effects.
 *
 * These keys map to the combatant stat surface used by battle calculations
 * and allow passives to apply flat adjustments to actor or target values.
 */
export type PassiveStatKey = 'hp' | 'hpMax' | 'atk' | 'def' | 'spd' | 'accuracyBP' | 'evadeBP';

/**
 * Sparse map of passive-driven stat adjustments.
 *
 * Only specified keys are modified; omitted keys are treated as unchanged
 * by passive application logic.
 */
export type PassiveStatModifiers = Partial<Record<PassiveStatKey, number>>;

/**
 * Predicate that gates a conditional passive modifier.
 *
 * Conditions are evaluated at runtime against battle context to determine
 * whether associated bonus modifiers should be applied.
 */
export type PassiveCondition =
  | {
      kind: 'target_hp_below_bp';
      thresholdBP: number;
    };

/**
 * Conditional passive effect bundle applied when its predicate matches.
 *
 * Modifiers can affect actor stats, target stats, and skill-specific
 * accuracy adjustments during combat resolution.
 */
export type ConditionalPassiveModifier = {
  when: PassiveCondition;
  actorStats?: PassiveStatModifiers;
  targetStats?: PassiveStatModifiers;
  skillAccuracyModBP?: number;
};

/**
 * Registry definition for a passive ability.
 *
 * A passive can contribute unconditional flat stat modifiers and/or a
 * collection of conditional effects activated by combat state checks.
 */
export type PassiveDef = {
  passiveId: string;
  flatStats?: PassiveStatModifiers;
  conditional?: ConditionalPassiveModifier[];
};

const PASSIVE_REGISTRY: Record<string, PassiveDef> = {
  EAGLE_EYE: {
    passiveId: 'EAGLE_EYE',
    flatStats: {
      accuracyBP: 1000
    }
  },
  EXECUTIONER_FOCUS: {
    passiveId: 'EXECUTIONER_FOCUS',
    conditional: [
      {
        when: {
          kind: 'target_hp_below_bp',
          thresholdBP: 3000
        },
        skillAccuracyModBP: 1200
      }
    ]
  }
};

/**
 * Resolves a passive definition by its identifier.
 *
 * The passive registry is expected to be authoritative for all passive IDs
 * referenced by gameplay data. Unknown IDs indicate invalid configuration
 * and are rejected with an error.
 *
 * @param passiveId - Unique passive identifier to resolve from the registry.
 * @returns The passive definition associated with the provided identifier.
 * @throws Error if the passive identifier is unknown.
 */
export function getPassiveDef(passiveId: string): PassiveDef {
  const passive = PASSIVE_REGISTRY[passiveId];
  if (passive === undefined) {
    throw new Error(`Unknown passiveId: ${passiveId}`);
  }

  return passive;
}
