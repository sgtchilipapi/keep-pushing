import { XorShift32 } from '../rng/xorshift32';

export type AttackSnapshot = {
  entityId: string;
  atk: number;
  def: number;
  accuracyBP: number;
  evadeBP: number;
};

export type AttackSkill = {
  skillId: string;
  basePower: number;
  accuracyModBP: number;
};

export type AttackResolution = {
  rollBP: number;
  hitChanceBP: number;
  didHit: boolean;
  damage: number;
};

const MIN_HIT_BP = 500;
const MAX_HIT_BP = 9500;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateHitChanceBP(actor: AttackSnapshot, target: AttackSnapshot, skill: AttackSkill): number {
  return clamp(actor.accuracyBP - target.evadeBP + skill.accuracyModBP, MIN_HIT_BP, MAX_HIT_BP);
}

export function calculateDamage(actor: AttackSnapshot, target: AttackSnapshot, skill: AttackSkill): number {
  const raw = skill.basePower + actor.atk;
  const damage = Math.floor((raw * 100) / (100 + target.def));
  return Math.max(1, damage);
}

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
