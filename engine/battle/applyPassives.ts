import type { AttackSkill, AttackSnapshot } from './resolveDamage';
import { getPassiveDef, type ConditionalPassiveModifier, type PassiveStatKey, type PassiveStatModifiers } from './passiveRegistry';

type BattleStatBlock = {
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
};

type SnapshotWithPassives = AttackSnapshot &
  BattleStatBlock & {
    passiveSkillIds?: readonly string[];
  };

type AttackContext = {
  actor: SnapshotWithPassives;
  target: SnapshotWithPassives;
  skill: AttackSkill;
};

const STAT_KEYS: PassiveStatKey[] = ['hp', 'hpMax', 'atk', 'def', 'spd', 'accuracyBP', 'evadeBP'];

function applyStats(base: BattleStatBlock, modifiers?: PassiveStatModifiers): BattleStatBlock {
  if (modifiers === undefined) {
    return base;
  }

  const next = { ...base };
  for (const statKey of STAT_KEYS) {
    const delta = modifiers[statKey] ?? 0;
    if (delta !== 0) {
      next[statKey] += delta;
    }
  }

  return next;
}

function hpPercentBP(entity: Pick<SnapshotWithPassives, 'hp' | 'hpMax'>): number {
  if (entity.hpMax <= 0) {
    return 0;
  }

  return Math.floor((entity.hp * 10000) / entity.hpMax);
}

function conditionMatches(condition: ConditionalPassiveModifier['when'], context: AttackContext): boolean {
  if (condition.kind === 'target_hp_below_bp') {
    return hpPercentBP(context.target) <= condition.thresholdBP;
  }

  return false;
}

function collectFlatModifiers(passiveSkillIds: readonly string[]): PassiveStatModifiers {
  return passiveSkillIds.reduce<PassiveStatModifiers>((acc, passiveId) => {
    const passive = getPassiveDef(passiveId);
    for (const statKey of STAT_KEYS) {
      const delta = passive.flatStats?.[statKey] ?? 0;
      if (delta !== 0) {
        acc[statKey] = (acc[statKey] ?? 0) + delta;
      }
    }

    return acc;
  }, {});
}

export function applyFlatPassives<T extends SnapshotWithPassives>(snapshot: T): T {
  const flatStats = collectFlatModifiers(snapshot.passiveSkillIds ?? []);
  const nextStats = applyStats(snapshot, flatStats);
  return { ...snapshot, ...nextStats };
}

function applyModifierToEntity(entity: SnapshotWithPassives, modifiers?: PassiveStatModifiers): SnapshotWithPassives {
  const nextStats = applyStats(entity, modifiers);
  return { ...entity, ...nextStats };
}

export function applyConditionalPassives(context: AttackContext): {
  actor: AttackSnapshot;
  target: AttackSnapshot;
  skill: AttackSkill;
} {
  let actor = { ...context.actor };
  let target = { ...context.target };
  let skill = { ...context.skill };

  for (const passiveId of context.actor.passiveSkillIds ?? []) {
    const passive = getPassiveDef(passiveId);

    for (const modifier of passive.conditional ?? []) {
      if (!conditionMatches(modifier.when, { actor, target, skill })) {
        continue;
      }

      actor = applyModifierToEntity(actor, modifier.actorStats);
      target = applyModifierToEntity(target, modifier.targetStats);
      skill = { ...skill, accuracyModBP: skill.accuracyModBP + (modifier.skillAccuracyModBP ?? 0) };
    }
  }

  return {
    actor,
    target,
    skill
  };
}
