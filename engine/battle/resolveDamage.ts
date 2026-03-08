import { XorShift32 } from '../rng/xorshift32';

/**
 * Minimal actor/target stat projection required to resolve a single attack.
 *
 * Resolver call sites pass this reduced shape so hit and damage math stays
 * decoupled from larger runtime entity objects.
 */
export type AttackSnapshot = {
  entityId: string;
  atk: number;
  def: number;
  accuracyBP: number;
  evadeBP: number;
};

/**
 * Immutable attack-skill parameters consumed by hit and damage calculations.
 *
 * Values are interpreted in basis points where applicable to keep combat math
 * deterministic and free from floating-point rounding drift.
 */
export type AttackSkill = {
  skillId: string;
  basePower: number;
  accuracyModBP: number;
};

/**
 * Deterministic result payload produced when resolving one attack attempt.
 *
 * The payload includes both intermediate roll/chance values and final damage
 * so callers can emit complete replay and debugging events.
 */
export type AttackResolution = {
  rollBP: number;
  hitChanceBP: number;
  didHit: boolean;
  damage: number;
};

const MIN_HIT_BP = 500;
const MAX_HIT_BP = 9500;

/**
 * Clamps a numeric value into an inclusive range.
 *
 * This helper is used by combat math to enforce safety bounds on derived
 * percentages before they are consumed by random rolls.
 *
 * @param value - Raw numeric value to constrain.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns The bounded value, never lower than {@link min} or higher than {@link max}.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes final hit chance in basis points for an attack attempt.
 *
 * The formula combines actor accuracy, target evasion, and skill modifiers,
 * then clamps to global floor/ceiling values so outcomes remain plausible and
 * no attack becomes strictly guaranteed or impossible.
 *
 * @param actor - Acting unit snapshot providing accuracy stats.
 * @param target - Defending unit snapshot providing evade stats.
 * @param skill - Selected skill accuracy modifier.
 * @returns Hit probability in basis points, constrained to the resolver bounds.
 * @todo #21 After the MVP is implemented, assess whether it is worth it to separate the roll for enemy evade and player accuracy.
 */
export function calculateHitChanceBP(actor: AttackSnapshot, target: AttackSnapshot, skill: AttackSkill): number {
  return clamp(actor.accuracyBP - target.evadeBP + skill.accuracyModBP, MIN_HIT_BP, MAX_HIT_BP);
}

/**
 * Calculates on-hit damage for a resolved attack.
 *
 * The damage model applies defense mitigation using an integer-only formula and
 * enforces a minimum damage floor of 1 so successful hits always have impact.
 *
 * @param actor - Acting unit snapshot providing attack stat.
 * @param target - Defending unit snapshot providing defense stat.
 * @param skill - Selected skill base power contribution.
 * @returns Final integer damage amount to subtract from target HP.
 */
export function calculateDamage(actor: AttackSnapshot, target: AttackSnapshot, skill: AttackSkill): number {
  const raw = skill.basePower + actor.atk;
  const damage = Math.floor((raw * 100) / (100 + target.def));
  return Math.max(1, damage);
}

/**
 * Resolves a complete attack attempt, including hit roll and conditional damage.
 *
 * This function is pure with respect to combat state and does not mutate actor
 * or target snapshots. Callers are responsible for applying returned damage and
 * downstream side effects such as status riders.
 *
 * Assumptions:
 * - {@link rng} is seeded externally for deterministic replay behavior.
 * - Basis-point conventions are used for both hit chance and roll domains.
 *
 * @param actor - Acting unit snapshot used for attack and accuracy values.
 * @param target - Defending unit snapshot used for defense and evasion values.
 * @param skill - Skill parameters that define power and accuracy behavior.
 * @param rng - Battle RNG used to sample a 1..10000 hit roll.
 * @returns Structured attack resolution including whether the hit connected.
 */
export function resolveAttack(
  actor: AttackSnapshot,
  target: AttackSnapshot,
  skill: AttackSkill,
  rng: XorShift32
): AttackResolution {
  const hitChanceBP = calculateHitChanceBP(actor, target, skill);
  const rollBP = rng.nextInt(1, 10000);
  const didHit = rollBP <= hitChanceBP;

  return {
    rollBP,
    hitChanceBP,
    didHit,
    damage: didHit ? calculateDamage(actor, target, skill) : 0
  };
}
