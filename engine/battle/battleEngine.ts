import { applyRoundInitiative, hasReadyActor, nextActorIndex, timeoutWinner } from './initiative';
import { resolveAttack } from './resolveDamage';
import { XorShift32 } from '../rng/xorshift32';
import { chooseAction } from './aiDecision';
import { BASIC_ATTACK_SKILL_ID, getSkillDef } from './skillRegistry';

export type CombatantSnapshot = {
  entityId: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkillIds: [string, string];
};

export type BattleInput = {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  maxRounds?: number;
};

export type BattleEvent =
  | { type: 'ROUND_START'; round: number }
  | { type: 'ACTION'; round: number; actorId: string; targetId: string; skillId: string }
  | { type: 'HIT_RESULT'; round: number; actorId: string; targetId: string; hitChanceBP: number; rollBP: number; didHit: boolean }
  | { type: 'DAMAGE'; round: number; actorId: string; targetId: string; amount: number; targetHpAfter: number }
  | { type: 'COOLDOWN_SET'; round: number; actorId: string; skillId: string; cooldownRemainingTurns: number }
  | { type: 'DEATH'; round: number; entityId: string }
  | { type: 'ROUND_END'; round: number }
  | { type: 'BATTLE_END'; round: number; winnerEntityId: string; reason: 'death' | 'timeout' };

export type BattleResult = {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  events: BattleEvent[];
  winnerEntityId: string;
  roundsPlayed: number;
};

type RuntimeEntity = CombatantSnapshot & { initiative: number; cooldowns: Record<string, number> };

function cloneEntity(entity: CombatantSnapshot): CombatantSnapshot {
  return { ...entity, activeSkillIds: [...entity.activeSkillIds] as [string, string] };
}

function initializeCooldowns(entity: CombatantSnapshot): Record<string, number> {
  return Object.fromEntries(entity.activeSkillIds.map((skillId) => [skillId, 0]));
}

function decrementCooldowns(entity: RuntimeEntity): void {
  for (const skillId of entity.activeSkillIds) {
    entity.cooldowns[skillId] = Math.max(0, (entity.cooldowns[skillId] ?? 0) - 1);
  }
}

export function simulateBattle(input: BattleInput): BattleResult {
  const rng = new XorShift32(input.seed);
  const maxRounds = input.maxRounds ?? 30;
  const events: BattleEvent[] = [];

  const player: RuntimeEntity = {
    ...cloneEntity(input.playerInitial),
    initiative: 0,
    cooldowns: initializeCooldowns(input.playerInitial)
  };
  const enemy: RuntimeEntity = {
    ...cloneEntity(input.enemyInitial),
    initiative: 0,
    cooldowns: initializeCooldowns(input.enemyInitial)
  };
  const combatants: RuntimeEntity[] = [player, enemy];

  let roundsPlayed = 0;
  let winner: RuntimeEntity | null = null;
  let reason: 'death' | 'timeout' = 'timeout';

  for (let round = 1; round <= maxRounds; round += 1) {
    roundsPlayed = round;
    events.push({ type: 'ROUND_START', round });
    applyRoundInitiative(combatants);

    while (hasReadyActor(combatants)) {
      const actorIndex = nextActorIndex(combatants);
      if (actorIndex < 0) {
        break;
      }

      const actor = combatants[actorIndex];
      const target = combatants[1 - actorIndex];

      if (actor.hp <= 0 || target.hp <= 0) {
        break;
      }

      actor.initiative -= 100;

      const selectedAction = chooseAction(actor.activeSkillIds, actor.cooldowns, {
        hp: target.hp,
        hpMax: target.hpMax
      });
      const selectedSkill = getSkillDef(selectedAction.skillId);

      events.push({
        type: 'ACTION',
        round,
        actorId: actor.entityId,
        targetId: target.entityId,
        skillId: selectedSkill.skillId
      });

      if (selectedSkill.skillId !== BASIC_ATTACK_SKILL_ID) {
        actor.cooldowns[selectedSkill.skillId] = selectedSkill.cooldownTurns;
        events.push({
          type: 'COOLDOWN_SET',
          round,
          actorId: actor.entityId,
          skillId: selectedSkill.skillId,
          cooldownRemainingTurns: selectedSkill.cooldownTurns
        });
      }

      const attack = resolveAttack(actor, target, selectedSkill, rng);
      events.push({
        type: 'HIT_RESULT',
        round,
        actorId: actor.entityId,
        targetId: target.entityId,
        hitChanceBP: attack.hitChanceBP,
        rollBP: attack.rollBP,
        didHit: attack.didHit
      });

      if (attack.didHit) {
        target.hp = Math.max(0, target.hp - attack.damage);
        events.push({
          type: 'DAMAGE',
          round,
          actorId: actor.entityId,
          targetId: target.entityId,
          amount: attack.damage,
          targetHpAfter: target.hp
        });

        if (target.hp === 0) {
          events.push({ type: 'DEATH', round, entityId: target.entityId });
          winner = actor;
          reason = 'death';
          break;
        }
      }
    }

    decrementCooldowns(player);
    decrementCooldowns(enemy);
    events.push({ type: 'ROUND_END', round });

    if (winner !== null) {
      break;
    }
  }

  if (winner === null) {
    winner = timeoutWinner(player, enemy) as RuntimeEntity;
    reason = 'timeout';
  }

  events.push({
    type: 'BATTLE_END',
    round: roundsPlayed,
    winnerEntityId: winner.entityId,
    reason
  });

  return {
    battleId: input.battleId,
    seed: input.seed,
    playerInitial: cloneEntity(input.playerInitial),
    enemyInitial: cloneEntity(input.enemyInitial),
    events,
    winnerEntityId: winner.entityId,
    roundsPlayed
  };
}
