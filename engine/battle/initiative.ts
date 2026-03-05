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

  return a.entityId.localeCompare(b.entityId);
}

export function applyRoundInitiative(combatants: InitiativeCombatant[]): void {
  for (const combatant of combatants) {
    if (combatant.hp > 0) {
      combatant.initiative += combatant.spd;
    }
  }
}

export function hasReadyActor(combatants: InitiativeCombatant[]): boolean {
  return combatants.some((combatant) => combatant.hp > 0 && combatant.initiative >= 100);
}

export function nextActorIndex(combatants: InitiativeCombatant[]): number {
  const ordered = combatants
    .map((combatant, index) => ({ combatant, index }))
    .filter(({ combatant }) => combatant.hp > 0 && combatant.initiative >= 100)
    .sort((left, right) => compareTurnOrder(left.combatant, right.combatant));

  return ordered.length === 0 ? -1 : ordered[0].index;
}

export function timeoutWinner(a: InitiativeCombatant, b: InitiativeCombatant): InitiativeCombatant {
  if (a.hp !== b.hp) {
    return a.hp > b.hp ? a : b;
  }

  if (a.initiative !== b.initiative) {
    return a.initiative > b.initiative ? a : b;
  }

  return a.entityId.localeCompare(b.entityId) <= 0 ? a : b;
}
