import { simulateBattle, type BattleInput, type CombatantSnapshot } from '../engine/battle/battleEngine';
import { getSkillDef } from '../engine/battle/skillRegistry';
import { applyFlatPassives, applyConditionalPassives } from '../engine/battle/applyPassives';
import { calculateDamage, calculateHitChanceBP } from '../engine/battle/resolveDamage';
import { ALL_STATUS_IDS, getStatusDef, isStatusId, type StatusId } from '../engine/battle/statuses/statusRegistry';
import { timeoutWinner } from '../engine/battle/initiative';
import type { BattleEvent } from '../types/battle';

type RuntimeState = {
  entityId: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkillIds: [string, string];
  passiveSkillIds?: [string, string];
  initiative: number;
  cooldowns: Record<string, number>;
  statuses: Partial<Record<StatusId, { sourceId: string; remainingTurns: number }>>;
};

function activeLoadouts(): [string, string][] {
  const skills = ['BASIC_ATTACK', 'VOLT_STRIKE', 'FINISHING_BLOW'];
  const result: [string, string][] = [];

  for (const left of skills) {
    for (const right of skills) {
      result.push([left, right]);
    }
  }

  return result;
}

function passiveLoadouts(): (undefined | [string, string])[] {
  return [undefined, ['EAGLE_EYE', 'EAGLE_EYE'], ['EXECUTIONER_FOCUS', 'EXECUTIONER_FOCUS'], ['EAGLE_EYE', 'EXECUTIONER_FOCUS']];
}

function combatantProfiles(): Array<Omit<CombatantSnapshot, 'entityId' | 'activeSkillIds'>> {
  return [
    {
      hp: 1600,
      hpMax: 1600,
      atk: 180,
      def: 70,
      spd: 120,
      accuracyBP: 8600,
      evadeBP: 1200
    },
    {
      hp: 2300,
      hpMax: 2300,
      atk: 120,
      def: 180,
      spd: 90,
      accuracyBP: 7600,
      evadeBP: 2000
    }
  ];
}

function makeCombatant(
  entityId: string,
  profile: Omit<CombatantSnapshot, 'entityId' | 'activeSkillIds'>,
  skills: [string, string],
  passiveSkillIds?: [string, string]
): CombatantSnapshot {
  return {
    entityId,
    ...profile,
    activeSkillIds: skills,
    passiveSkillIds
  };
}

function getActiveStatusIds(state: RuntimeState): StatusId[] {
  return ALL_STATUS_IDS.filter((statusId) => (state.statuses[statusId]?.remainingTurns ?? 0) > 0);
}

function buildState(input: BattleInput): Record<string, RuntimeState> {
  const playerBase = applyFlatPassives({ ...input.playerInitial });
  const enemyBase = applyFlatPassives({ ...input.enemyInitial });

  const init = (snapshot: CombatantSnapshot): RuntimeState => ({
    ...snapshot,
    initiative: 0,
    cooldowns: Object.fromEntries(snapshot.activeSkillIds.map((skillId) => [skillId, 0])),
    statuses: {}
  });

  return {
    [playerBase.entityId]: init(playerBase),
    [enemyBase.entityId]: init(enemyBase)
  };
}

function decrementRoundEndStatuses(state: RuntimeState): StatusId[] {
  const expired: StatusId[] = [];

  for (const statusId of ALL_STATUS_IDS) {
    const current = state.statuses[statusId];
    const remaining = current?.remainingTurns ?? 0;

    if (remaining <= 0) {
      delete state.statuses[statusId];
      continue;
    }

    if (remaining - 1 <= 0) {
      delete state.statuses[statusId];
      expired.push(statusId);
      continue;
    }

    state.statuses[statusId] = {
      sourceId: current?.sourceId ?? state.entityId,
      remainingTurns: remaining - 1
    };
  }

  return expired;
}

function decrementCooldowns(state: RuntimeState): void {
  for (const skillId of state.activeSkillIds) {
    state.cooldowns[skillId] = Math.max(0, (state.cooldowns[skillId] ?? 0) - 1);
  }
}

function clampHp(hp: number, hpMax: number): number {
  return Math.min(hpMax, Math.max(0, hp));
}

function validateBattle(input: BattleInput, events: BattleEvent[]): string[] {
  const errors: string[] = [];
  const stateById = buildState(input);

  const getState = (entityId: string): RuntimeState => {
    const state = stateById[entityId];
    if (state === undefined) {
      throw new Error(`Unknown entity in event stream: ${entityId}`);
    }

    return state;
  };

  let lastRound = 0;
  let currentRound = 0;
  let ended = false;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];

    if (event.round < lastRound) {
      errors.push(`round regressed at index ${i}`);
    }
    lastRound = event.round;

    switch (event.type) {
      case 'ROUND_START': {
        currentRound = event.round;
        if (event.round <= 0) {
          errors.push('invalid round start');
        }
        break;
      }

      case 'ACTION': {
        const actor = getState(event.actorId);
        const target = getState(event.targetId);
        const skill = getSkillDef(event.skillId);

        if (actor.hp <= 0 || target.hp <= 0) {
          errors.push(`action while dead at round ${event.round}`);
          break;
        }

        actor.initiative -= 100;

        if (skill.skillId !== 'BASIC_ATTACK') {
          const maybeCooldown = events[i + 1];
          if (maybeCooldown?.type !== 'COOLDOWN_SET' || maybeCooldown.actorId !== actor.entityId || maybeCooldown.skillId !== skill.skillId) {
            errors.push(`missing cooldown set after action idx ${i}`);
          } else {
            if (maybeCooldown.cooldownRemainingTurns !== skill.cooldownTurns) {
              errors.push(`cooldown mismatch for ${skill.skillId}`);
            }
            actor.cooldowns[skill.skillId] = maybeCooldown.cooldownRemainingTurns;
            i += 1;
          }
        }

        const hit = events[i + 1];
        if (hit?.type !== 'HIT_RESULT' || hit.actorId !== actor.entityId || hit.targetId !== target.entityId || hit.skillId !== skill.skillId) {
          errors.push(`missing hit result for action idx ${i}`);
          break;
        }

        const conditioned = applyConditionalPassives({ actor, target, skill });
        const expectedHitChance = calculateHitChanceBP(conditioned.actor, conditioned.target, conditioned.skill);
        if (hit.hitChanceBP !== expectedHitChance) {
          errors.push(`hit chance mismatch: expected ${expectedHitChance}, got ${hit.hitChanceBP}`);
        }

        const expectedDidHit = hit.rollBP <= expectedHitChance;
        if (hit.didHit !== expectedDidHit) {
          errors.push(`didHit mismatch at round ${event.round}`);
        }

        i += 1;

        if (!hit.didHit) {
          break;
        }

        const maybeDamage = events[i + 1];
        if (maybeDamage?.type !== 'DAMAGE' || maybeDamage.actorId !== actor.entityId || maybeDamage.targetId !== target.entityId || maybeDamage.skillId !== skill.skillId) {
          errors.push(`missing damage event for hit at index ${i}`);
          break;
        }

        const expectedBaseDamage = calculateDamage(conditioned.actor, conditioned.target, conditioned.skill);
        const incomingMultiplier = getActiveStatusIds(target).reduce((acc, statusId) => {
          return Math.floor((acc * getStatusDef(statusId).incomingDamageMultiplierBP) / 10000);
        }, 10000);
        const expectedDamage = Math.max(1, Math.floor((expectedBaseDamage * incomingMultiplier) / 10000));
        if (maybeDamage.amount !== expectedDamage) {
          errors.push(`damage mismatch at round ${event.round}: expected ${expectedDamage}, got ${maybeDamage.amount}`);
        }

        target.hp = clampHp(target.hp - maybeDamage.amount, target.hpMax);
        if (maybeDamage.targetHpAfter !== target.hp) {
          errors.push(`target hp mismatch after damage at round ${event.round}`);
        }

        i += 1;

        const applyStatuses = (statusIds: readonly StatusId[] | undefined, subject: RuntimeState): void => {
          for (const statusId of statusIds ?? []) {
            const statusDef = getStatusDef(statusId);
            const current = subject.statuses[statusId]?.remainingTurns ?? 0;
            const expectedRemaining = Math.max(current, statusDef.durationTurns);

            const statusEvent = events[i + 1];
            if (statusEvent?.type !== 'STATUS_APPLY' && statusEvent?.type !== 'STATUS_REFRESH') {
              return;
            }
            if (statusEvent.targetId !== subject.entityId || statusEvent.statusId !== statusId || statusEvent.remainingTurns !== expectedRemaining) {
              errors.push(`status event mismatch for ${statusId}`);
            }

            subject.statuses[statusId] = {
              sourceId: actor.entityId,
              remainingTurns: expectedRemaining
            };
            i += 1;

            const statusResolve = events[i + 1];
            if (statusResolve?.type === 'STATUS_EFFECT_RESOLVE' && statusResolve.phase === 'onApply' && isStatusId(statusResolve.statusId)) {
              const beforeHp = subject.hp;
              const hpAfter = clampHp(beforeHp + statusResolve.hpDelta, subject.hpMax);
              subject.hp = hpAfter;
              if (statusResolve.targetId !== subject.entityId || statusResolve.statusId !== statusId || statusResolve.targetHpAfter !== hpAfter) {
                errors.push(`status resolve mismatch for ${statusId}`);
              }
              i += 1;
            }
          }
        };

        applyStatuses(skill.appliesStatusIds, target);
        applyStatuses(skill.selfAppliesStatusIds, actor);
        break;
      }

      case 'STUNNED_SKIP': {
        const actor = getState(event.actorId);
        actor.initiative -= 100;
        if ((actor.statuses.stunned?.remainingTurns ?? 0) <= 0) {
          errors.push(`stunned skip without stun at round ${event.round}`);
        }
        break;
      }

      case 'STATUS_EFFECT_RESOLVE': {
        if (!isStatusId(event.statusId)) {
          errors.push(`unknown status resolve id at ${event.statusId}`);
          break;
        }

        const target = getState(event.targetId);
        const expectedDelta = event.phase === 'onRoundStart' ? getStatusDef(event.statusId).roundStartHpDelta : getStatusDef(event.statusId).roundStartHpDelta;
        if (event.hpDelta !== expectedDelta) {
          errors.push(`status delta mismatch for ${event.statusId}`);
        }

        target.hp = clampHp(target.hp + event.hpDelta, target.hpMax);
        if (event.targetHpAfter !== target.hp) {
          errors.push(`status target hp mismatch at round ${event.round}`);
        }
        break;
      }

      case 'DEATH': {
        const dead = getState(event.entityId);
        if (dead.hp !== 0) {
          errors.push(`death event emitted while hp=${dead.hp}`);
        }
        break;
      }

      case 'ROUND_END': {
        for (const entityId of Object.keys(stateById)) {
          const state = getState(entityId);
          decrementRoundEndStatuses(state);
          decrementCooldowns(state);
        }
        break;
      }

      case 'BATTLE_END': {
        ended = true;
        const ids = Object.keys(stateById);
        const first = getState(ids[0]);
        const second = getState(ids[1]);

        const timeout = timeoutWinner(first, second);
        if (event.reason === 'timeout' && event.winnerEntityId !== timeout.entityId) {
          errors.push('timeout winner mismatch');
        }

        const loserId = ids.find((id) => id !== event.winnerEntityId);
        if (loserId === undefined || loserId !== event.loserEntityId) {
          errors.push('battle end loser mismatch');
        }
        break;
      }

      case 'STATUS_EXPIRE': {
        if (!isStatusId(event.statusId)) {
          errors.push(`unknown status expire id ${event.statusId}`);
          break;
        }
        const target = getState(event.targetId);
        const remaining = target.statuses[event.statusId]?.remainingTurns ?? 0;
        if (remaining <= 0) {
          errors.push(`status expire emitted for inactive ${event.statusId}`);
        }
        break;
      }

      case 'COOLDOWN_SET':
      case 'DAMAGE':
      case 'HIT_RESULT':
      case 'STATUS_APPLY':
      case 'STATUS_REFRESH':
      case 'STATUS_APPLY_FAILED':
        break;

      default:
        break;
    }
  }

  if (!ended) {
    errors.push('missing BATTLE_END event');
  }

  return errors;
}

describe('combat simulation exhaustive matrix', () => {
  it('matches expected outcomes across broad scenario space', () => {
    const seeds = [1, 2];
    const profiles = combatantProfiles();
    const skills = activeLoadouts();
    const passives = passiveLoadouts();

    const failures: string[] = [];
    let scenarios = 0;

    for (const seed of seeds) {
      for (const playerProfile of profiles) {
        for (const enemyProfile of profiles) {
          for (const playerSkills of skills) {
            for (const enemySkills of skills) {
              for (const playerPassives of passives) {
                for (const enemyPassives of passives) {
                  scenarios += 1;

                  const input: BattleInput = {
                    battleId: `matrix-${scenarios}`,
                    seed,
                    maxRounds: 5,
                    playerInitial: makeCombatant('player', playerProfile, playerSkills, playerPassives),
                    enemyInitial: makeCombatant('enemy', enemyProfile, enemySkills, enemyPassives)
                  };

                  const result = simulateBattle(input);
                  const validationErrors = validateBattle(input, result.events);

                  if (validationErrors.length > 0) {
                    failures.push(`${input.battleId}: ${validationErrors.slice(0, 3).join('; ')}`);
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(scenarios).toBe(10368);
    expect(failures).toEqual([]);
  });
});
