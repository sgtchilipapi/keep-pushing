import { applyRoundInitiative, hasReadyActor, nextActorIndex, timeoutWinner } from './initiative';
import { resolveAttack } from './resolveDamage';
import { XorShift32 } from '../rng/xorshift32';

export type BattleEntity = {
  entityId: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
};

export type BattleInput = {
  battleId: string;
  seed: number;
  playerInitial: BattleEntity;
  enemyInitial: BattleEntity;
  maxRounds?: number;
};

export type BattleEvent =
  | { type: 'ROUND_START'; round: number }
  | { type: 'ACTION'; round: number; actorId: string; targetId: string; skillId: 'BASIC_ATTACK' }
  | { type: 'HIT_RESULT'; round: number; actorId: string; targetId: string; hitChanceBP: number; rollBP: number; didHit: boolean }
  | { type: 'DAMAGE'; round: number; actorId: string; targetId: string; amount: number; targetHpAfter: number }
  | { type: 'DEATH'; round: number; entityId: string }
  | { type: 'ROUND_END'; round: number }
  | { type: 'BATTLE_END'; round: number; winnerEntityId: string; reason: 'death' | 'timeout' };

export type BattleResult = {
  battleId: string;
  seed: number;
  playerInitial: BattleEntity;
  enemyInitial: BattleEntity;
  events: BattleEvent[];
  winnerEntityId: string;
  roundsPlayed: number;
};

type RuntimeEntity = BattleEntity & { initiative: number };

const BASIC_ATTACK = {
  skillId: 'BASIC_ATTACK' as const,
  basePower: 100,
  accuracyModBP: 0
};

function cloneEntity(entity: BattleEntity): BattleEntity {
  return { ...entity };
}

export function simulateBattle(input: BattleInput): BattleResult {
  const rng = new XorShift32(input.seed);
  const maxRounds = input.maxRounds ?? 30;
  const events: BattleEvent[] = [];

  const player: RuntimeEntity = { ...cloneEntity(input.playerInitial), initiative: 0 };
  const enemy: RuntimeEntity = { ...cloneEntity(input.enemyInitial), initiative: 0 };
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
      events.push({
        type: 'ACTION',
        round,
        actorId: actor.entityId,
        targetId: target.entityId,
        skillId: 'BASIC_ATTACK'
      });

      const attack = resolveAttack(actor, target, BASIC_ATTACK, rng);
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
