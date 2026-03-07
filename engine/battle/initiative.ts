/**
 * Represents mutable per-combatant state used by initiative resolution.
 *
 * Consumers are expected to keep these values in sync with the broader combat model,
 * especially the invariant that `hp <= 0` indicates an actor that cannot gain initiative
 * or take turns.
 */
export type InitiativeCombatant = {
  entityId: string;
  spd: number;
  initiative: number;
  hp: number;
};

function compareTurnOrder(a: InitiativeCombatant, b: InitiativeCombatant): number {
  if (a.initiative !== b.initiative) {
    return b.initiative - a.initiative;
  }

  if (a.spd !== b.spd) {
    return b.spd - a.spd;
  }

  // Entity id tie-breaker ensures strict deterministic ordering when stats are identical.
  return a.entityId.localeCompare(b.entityId);
}

/**
 * Advances initiative for all living combatants by one round-equivalent step.
 *
 * This function mutates the provided combatant objects in place. Defeated combatants
 * (`hp <= 0`) are intentionally skipped so they cannot re-enter turn order.
 *
 * @param combatants - Mutable combatant records participating in initiative tracking.
 * @returns Nothing.
 */
export function applyRoundInitiative(combatants: InitiativeCombatant[]): void {
  for (const combatant of combatants) {
    if (combatant.hp > 0) {
      combatant.initiative += combatant.spd;
    }
  }
}

/**
 * Indicates whether at least one living combatant is eligible to act immediately.
 *
 * Eligibility requires both positive HP and initiative at or above the action threshold
 * of `100`, matching the same readiness rule used by turn selection.
 *
 * @param combatants - Combatant records to evaluate.
 * @returns `true` when any combatant can act now; otherwise `false`.
 */
export function hasReadyActor(combatants: InitiativeCombatant[]): boolean {
  return combatants.some((combatant) => combatant.hp > 0 && combatant.initiative >= 100);
}

/**
 * Selects the index of the next acting combatant using deterministic turn-order rules.
 *
 * Only living, ready combatants are considered. Ordering is resolved by highest
 * initiative, then highest speed, then lexicographic entity id to keep results stable
 * across runtimes when stats are tied.
 *
 * @param combatants - Combatant list whose original indices are preserved for the result.
 * @returns The original array index of the next actor, or `-1` when no actor is ready.
 */
export function nextActorIndex(combatants: InitiativeCombatant[]): number {
  const ordered = combatants
    .map((combatant, index) => ({ combatant, index }))
    .filter(({ combatant }) => combatant.hp > 0 && combatant.initiative >= 100)
    .sort((left, right) => compareTurnOrder(left.combatant, right.combatant));

  return ordered.length === 0 ? -1 : ordered[0].index;
}

/**
 * Resolves a deterministic winner when combat ends due to timeout.
 *
 * The winner is chosen by higher HP, then higher initiative, then lexicographically
 * lower entity id as a final deterministic tiebreaker.
 *
 * @param a - First timeout candidate.
 * @param b - Second timeout candidate.
 * @returns The combatant that wins timeout resolution.
 */
export function timeoutWinner(a: InitiativeCombatant, b: InitiativeCombatant): InitiativeCombatant {
  if (a.hp !== b.hp) {
    return a.hp > b.hp ? a : b;
  }

  if (a.initiative !== b.initiative) {
    return a.initiative > b.initiative ? a : b;
  }

  // Final deterministic tie-break keeps timeout outcomes stable across runs and environments.
  return a.entityId.localeCompare(b.entityId) <= 0 ? a : b;
}
