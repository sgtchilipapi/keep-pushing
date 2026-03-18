import { applyRoundInitiative, hasReadyActor, nextActorIndex, timeoutWinner } from './initiative';
import { resolveAttack } from './resolveDamage';
import { XorShift32 } from '../rng/xorshift32';
import { chooseAction, type DecisionTrace } from './aiDecision';
import { BASIC_ATTACK_SKILL_ID, getSkillDef, validateSkillDef } from './skillRegistry';
import { applyStatus, decrementStatusesAtRoundEnd, type ActiveStatuses } from './resolveStatus';
import { getStatusDef, isStatusId, type StatusId } from './statuses/statusRegistry';
import { applyConditionalPassives, applyFlatPassives } from './applyPassives';
import { getResolversForRoundStart, getStatusResolver, hasStatusResolveTiming } from './statuses/resolverRegistry';
import type { StatusResolvePhase } from './statuses/types';
import type { ArchetypeSkillWeights } from './learning';
import type { BattleEvent, BattleResult } from '../../types/battle';
import type { CombatantSnapshot } from '../../types/combat';

export type { CombatantSnapshot } from '../../types/combat';

export type BattleInput = {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  playerSkillWeights?: ArchetypeSkillWeights;
  enemySkillWeights?: ArchetypeSkillWeights;
  maxRounds?: number;
  decisionLogger?: (decision: { round: number; actorId: string; targetId: string; trace: DecisionTrace }) => void;
};

type RuntimeEntity = CombatantSnapshot & { initiative: number; cooldowns: Record<string, number>; statuses: ActiveStatuses };

export function adjustDamageForStatuses(baseDamage: number, activeStatusIds: readonly StatusId[]): number {
  const incomingDamageMultiplierBP = activeStatusIds.reduce((acc, statusId) => {
    const multiplier = getStatusDef(statusId).incomingDamageMultiplierBP;
    return Math.floor((acc * multiplier) / 10000);
  }, 10000);

  return Math.max(1, Math.floor((baseDamage * incomingDamageMultiplierBP) / 10000));
}

function cloneEntity(entity: CombatantSnapshot): CombatantSnapshot {
  const cloned: CombatantSnapshot = {
    ...entity,
    activeSkillIds: [...entity.activeSkillIds] as [string, string]
  };

  if (entity.passiveSkillIds !== undefined) {
    cloned.passiveSkillIds = [...entity.passiveSkillIds] as [string, string];
  }

  return cloned;
}

function initializeCooldowns(entity: CombatantSnapshot): Record<string, number> {
  return Object.fromEntries(entity.activeSkillIds.map((skillId) => [skillId, 0]));
}

function decrementCooldowns(entity: RuntimeEntity): void {
  for (const skillId of entity.activeSkillIds) {
    entity.cooldowns[skillId] = Math.max(0, (entity.cooldowns[skillId] ?? 0) - 1);
  }
}

function getActiveStatusIds(entity: RuntimeEntity): StatusId[] {
  return Object.keys(entity.statuses)
    .filter((statusId) => {
      if (!isStatusId(statusId)) {
        throw new Error(`Unknown active statusId: ${statusId}`);
      }

      return (entity.statuses[statusId]?.remainingTurns ?? 0) > 0;
    })
    .sort() as StatusId[];
}

function emitStatusEffectResolution(
  events: BattleEvent[],
  phase: StatusResolvePhase,
  round: number,
  statusId: StatusId,
  sourceId: string,
  target: RuntimeEntity
): void {
  const resolver = getStatusResolver(statusId);
  if (phase === 'onApply' && !hasStatusResolveTiming(statusId, 'onApply')) {
    return;
  }
  if (phase === 'onRoundStart' && !hasStatusResolveTiming(statusId, 'onRoundStart')) {
    return;
  }

  const resolution = resolver.resolve({
    round,
    phase,
    statusId,
    sourceId,
    targetId: target.entityId,
    targetHpBefore: target.hp
  });

  if (resolution.hpDelta !== 0) {
    target.hp = Math.min(target.hpMax, Math.max(0, target.hp + resolution.hpDelta));
  }

  events.push({
    type: 'STATUS_EFFECT_RESOLVE',
    round,
    phase,
    statusId,
    sourceId,
    targetId: target.entityId,
    hpDelta: resolution.hpDelta,
    targetHpAfter: target.hp,
    controlLossApplied: resolution.controlLossApplied
  });
}

function resolveRoundStartStatuses(round: number, combatants: RuntimeEntity[], events: BattleEvent[]): RuntimeEntity | null {
  const targets = [...combatants].sort((left, right) => right.spd - left.spd || left.entityId.localeCompare(right.entityId));

  for (const target of targets) {
    const activeStatuses = getActiveStatusIds(target);
    const resolvers = getResolversForRoundStart(activeStatuses);

    for (const resolver of resolvers) {
      const statusState = target.statuses[resolver.statusId];
      const sourceId = statusState?.sourceId ?? target.entityId;
      emitStatusEffectResolution(events, 'onRoundStart', round, resolver.statusId, sourceId, target);

      if (target.hp <= 0) {
        events.push({ type: 'DEATH', round, entityId: target.entityId });
        const winner = combatants.find((entity) => entity.entityId !== target.entityId) ?? null;
        return winner;
      }
    }
  }

  return null;
}

export function simulateBattle(input: BattleInput): BattleResult {
  const rng = new XorShift32(input.seed);
  const maxRounds = input.maxRounds ?? 30;
  const events: BattleEvent[] = [];

  const player: RuntimeEntity = {
    ...applyFlatPassives(cloneEntity(input.playerInitial)),
    initiative: 0,
    cooldowns: initializeCooldowns(input.playerInitial),
    statuses: {}
  };
  const enemy: RuntimeEntity = {
    ...applyFlatPassives(cloneEntity(input.enemyInitial)),
    initiative: 0,
    cooldowns: initializeCooldowns(input.enemyInitial),
    statuses: {}
  };
  const combatants: RuntimeEntity[] = [player, enemy];

  let roundsPlayed = 0;
  let winner: RuntimeEntity | null = null;
  let reason: 'death' | 'timeout' = 'timeout';

  for (let round = 1; round <= maxRounds; round += 1) {
    roundsPlayed = round;
    events.push({ type: 'ROUND_START', round });

    winner = resolveRoundStartStatuses(round, combatants, events);
    if (winner !== null) {
      reason = 'death';
      break;
    }

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

      if ((actor.statuses.stunned?.remainingTurns ?? 0) > 0) {
        events.push({
          type: 'STUNNED_SKIP',
          round,
          actorId: actor.entityId
        });
        continue;
      }

      const selectedAction = chooseAction(
        {
          actor: {
            entityId: actor.entityId,
            hp: actor.hp,
            hpMax: actor.hpMax,
            statuses: getActiveStatusIds(actor),
            activeSkillIds: actor.activeSkillIds,
            cooldowns: actor.cooldowns
          },
          target: {
            entityId: target.entityId,
            hp: target.hp,
            hpMax: target.hpMax,
            statuses: getActiveStatusIds(target),
            activeSkillIds: target.activeSkillIds,
            cooldowns: target.cooldowns
          },
          battle: {
            round,
            maxRounds,
            roundsRemaining: Math.max(0, maxRounds - round)
          }
        },
        actorIndex === 0 ? (input.playerSkillWeights ?? {}) : (input.enemySkillWeights ?? {}),
        (trace) => {
          input.decisionLogger?.({
            round,
            actorId: actor.entityId,
            targetId: target.entityId,
            trace
          });
        }
      );
      const selectedSkill = getSkillDef(selectedAction.skillId);

      validateSkillDef(selectedSkill);

      const actionTarget = selectedSkill.resolutionMode === 'self_utility' ? actor : target;
      events.push({
        type: 'ACTION',
        round,
        actorId: actor.entityId,
        targetId: actionTarget.entityId,
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

      if (selectedSkill.resolutionMode === 'attack') {
        const attackContext = applyConditionalPassives({ actor, target, skill: selectedSkill });
        const attack = resolveAttack(attackContext.actor, attackContext.target, attackContext.skill, rng);
        events.push({
          type: 'HIT_RESULT',
          round,
          actorId: actor.entityId,
          targetId: target.entityId,
          skillId: selectedSkill.skillId,
          hitChanceBP: attack.hitChanceBP,
          rollBP: attack.rollBP,
          didHit: attack.didHit
        });

        if (attack.didHit) {
          const adjustedDamage = adjustDamageForStatuses(attack.damage, getActiveStatusIds(target));
          target.hp = Math.max(0, target.hp - adjustedDamage);
          events.push({
            type: 'DAMAGE',
            round,
            actorId: actor.entityId,
            targetId: target.entityId,
            skillId: selectedSkill.skillId,
            amount: adjustedDamage,
            targetHpAfter: target.hp
          });

          for (const statusId of selectedSkill.appliesStatusIds ?? []) {
            const statusEvent = applyStatus(target.statuses, statusId, actor.entityId, target.entityId, round);
            events.push(statusEvent);

            if (statusEvent.type !== 'STATUS_APPLY_FAILED') {
              emitStatusEffectResolution(events, 'onApply', round, statusId, actor.entityId, target);
              if (target.hp <= 0) {
                events.push({ type: 'DEATH', round, entityId: target.entityId });
                winner = actor;
                reason = 'death';
                break;
              }
            }
          }

          for (const statusId of selectedSkill.selfAppliesStatusIds ?? []) {
            const statusEvent = applyStatus(actor.statuses, statusId, actor.entityId, actor.entityId, round);
            events.push(statusEvent);

            if (statusEvent.type !== 'STATUS_APPLY_FAILED') {
              emitStatusEffectResolution(events, 'onApply', round, statusId, actor.entityId, actor);
              if (actor.hp <= 0) {
                events.push({ type: 'DEATH', round, entityId: actor.entityId });
                winner = target;
                reason = 'death';
                break;
              }
            }
          }

          if (winner !== null) {
            break;
          }

          if (target.hp === 0) {
            events.push({ type: 'DEATH', round, entityId: target.entityId });
            winner = actor;
            reason = 'death';
            break;
          }
        }
      }

      if (selectedSkill.resolutionMode === 'self_utility') {
        for (const statusId of selectedSkill.selfAppliesStatusIds ?? []) {
          const statusEvent = applyStatus(actor.statuses, statusId, actor.entityId, actor.entityId, round);
          events.push(statusEvent);

          if (statusEvent.type !== 'STATUS_APPLY_FAILED') {
            emitStatusEffectResolution(events, 'onApply', round, statusId, actor.entityId, actor);
            if (actor.hp <= 0) {
              events.push({ type: 'DEATH', round, entityId: actor.entityId });
              winner = target;
              reason = 'death';
              break;
            }
          }
        }

        if (winner !== null) {
          break;
        }
      }
    }

    events.push(...decrementStatusesAtRoundEnd(player.statuses, player.entityId, round));
    events.push(...decrementStatusesAtRoundEnd(enemy.statuses, enemy.entityId, round));
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

  const loser = winner.entityId === player.entityId ? enemy : player;

  events.push({
    type: 'BATTLE_END',
    round: roundsPlayed,
    winnerEntityId: winner.entityId,
    loserEntityId: loser.entityId,
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
