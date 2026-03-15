import { randomUUID } from 'crypto';
import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';
import { ALL_SKILL_IDS, BASIC_ATTACK_SKILL_ID, getSkillDef } from '../engine/battle/skillRegistry';
import { ALL_PASSIVE_IDS, getPassiveDef } from '../engine/battle/passiveRegistry';
import type { BattleEvent } from '../types/battle';

const COLORS = {
  round: '\x1b[36m',
  action: '\x1b[34m',
  damage: '\x1b[31m',
  status: '\x1b[35m',
  cooldown: '\x1b[33m',
  death: '\x1b[90m',
  summary: '\x1b[32m',
  reset: '\x1b[0m'
} as const;

type RuntimeResources = {
  hp: number;
  hpMax: number;
  statuses: Record<string, { remainingTurns: number; sourceId: string }>;
  cooldowns: Record<string, number>;
  activeSkillIds: [string, string];
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickDistinct<T>(values: readonly T[], count: number): T[] {
  const pool = [...values];
  const picked: T[] = [];

  while (picked.length < count && pool.length > 0) {
    const index = randomInt(0, pool.length - 1);
    const [selected] = pool.splice(index, 1);
    if (selected !== undefined) {
      picked.push(selected);
    }
  }

  return picked;
}

function createRandomCharacter(entityId: string, name: string): CombatantSnapshot {
  const selectableSkills = ALL_SKILL_IDS.filter((skillId) => skillId !== BASIC_ATTACK_SKILL_ID);
  const [skillOne, skillTwo] = pickDistinct(selectableSkills, 2) as [string, string];
  const [passiveOne, passiveTwo] = pickDistinct(ALL_PASSIVE_IDS, 2) as [string, string];
  const hpMax = randomInt(950, 1450);

  return {
    entityId,
    name,
    hp: hpMax,
    hpMax,
    atk: randomInt(85, 145),
    def: randomInt(60, 120),
    spd: randomInt(70, 140),
    accuracyBP: randomInt(8600, 9600),
    evadeBP: randomInt(300, 1300),
    activeSkillIds: [skillOne, skillTwo],
    passiveSkillIds: [passiveOne, passiveTwo]
  };
}

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatEvent(event: BattleEvent): { message: string; color: keyof typeof COLORS } {
  switch (event.type) {
    case 'ROUND_START':
      return { message: `Round ${event.round} start`, color: 'round' };
    case 'ACTION':
      return {
        message: `${event.actorId} uses ${getSkillDef(event.skillId).skillName} on ${event.targetId}`,
        color: 'action'
      };
    case 'COOLDOWN_SET':
      return {
        message: `${event.actorId} sets cooldown on ${getSkillDef(event.skillId).skillName} to ${event.cooldownRemainingTurns}`,
        color: 'cooldown'
      };
    case 'HIT_RESULT':
      return {
        message: `${event.actorId} ${event.didHit ? 'hits' : 'misses'} ${event.targetId} (${event.rollBP}/${event.hitChanceBP})`,
        color: event.didHit ? 'action' : 'death'
      };
    case 'DAMAGE':
      return {
        message: `${event.targetId} takes ${event.amount} damage (HP now ${event.targetHpAfter})`,
        color: 'damage'
      };
    case 'STATUS_APPLY':
      return {
        message: `${event.targetId} gains ${event.statusId} from ${event.sourceId} (${event.remainingTurns} turns)`,
        color: 'status'
      };
    case 'STATUS_REFRESH':
      return {
        message: `${event.targetId} refreshes ${event.statusId} to ${event.remainingTurns} turns`,
        color: 'status'
      };
    case 'STATUS_APPLY_FAILED':
      return {
        message: `${event.targetId} failed to gain ${event.statusId} (${event.reason})`,
        color: 'death'
      };
    case 'STATUS_EFFECT_RESOLVE':
      return {
        message: `${event.statusId} resolves on ${event.targetId} during ${event.phase} (hpΔ ${event.hpDelta}, hp ${event.targetHpAfter})`,
        color: 'status'
      };
    case 'STATUS_EXPIRE':
      return { message: `${event.statusId} expired on ${event.targetId}`, color: 'status' };
    case 'STUNNED_SKIP':
      return { message: `${event.actorId} is stunned and loses their action`, color: 'status' };
    case 'DEATH':
      return { message: `${event.entityId} was defeated`, color: 'death' };
    case 'ROUND_END':
      return { message: `Round ${event.round} end`, color: 'round' };
    case 'BATTLE_END':
      return {
        message: `Battle ended by ${event.reason}. Winner: ${event.winnerEntityId}, Loser: ${event.loserEntityId}`,
        color: 'summary'
      };
    default:
      return { message: `Unhandled event: ${JSON.stringify(event)}`, color: 'death' };
  }
}

function initializeResources(character: CombatantSnapshot): RuntimeResources {
  return {
    hp: character.hp,
    hpMax: character.hpMax,
    statuses: {},
    cooldowns: Object.fromEntries(character.activeSkillIds.map((skillId) => [skillId, 0])),
    activeSkillIds: character.activeSkillIds
  };
}

function applyEvent(resourcesByEntityId: Record<string, RuntimeResources>, event: BattleEvent): void {
  if ('targetId' in event && resourcesByEntityId[event.targetId] === undefined) {
    return;
  }

  switch (event.type) {
    case 'DAMAGE': {
      resourcesByEntityId[event.targetId].hp = event.targetHpAfter;
      return;
    }
    case 'STATUS_EFFECT_RESOLVE': {
      resourcesByEntityId[event.targetId].hp = event.targetHpAfter;
      return;
    }
    case 'STATUS_APPLY':
    case 'STATUS_REFRESH': {
      resourcesByEntityId[event.targetId].statuses[event.statusId] = {
        remainingTurns: event.remainingTurns,
        sourceId: event.sourceId
      };
      return;
    }
    case 'STATUS_EXPIRE': {
      delete resourcesByEntityId[event.targetId].statuses[event.statusId];
      return;
    }
    case 'COOLDOWN_SET': {
      resourcesByEntityId[event.actorId].cooldowns[event.skillId] = event.cooldownRemainingTurns;
      return;
    }
    case 'DEATH': {
      resourcesByEntityId[event.entityId].hp = 0;
      return;
    }
    case 'ROUND_END': {
      for (const entityResources of Object.values(resourcesByEntityId)) {
        for (const skillId of entityResources.activeSkillIds) {
          entityResources.cooldowns[skillId] = Math.max(0, (entityResources.cooldowns[skillId] ?? 0) - 1);
        }

        for (const status of Object.values(entityResources.statuses)) {
          status.remainingTurns = Math.max(0, status.remainingTurns - 1);
        }

        for (const [statusId, status] of Object.entries(entityResources.statuses)) {
          if (status.remainingTurns === 0) {
            delete entityResources.statuses[statusId];
          }
        }
      }
      return;
    }
    default:
      return;
  }
}

function printRoundResources(round: number, entities: CombatantSnapshot[], resourcesByEntityId: Record<string, RuntimeResources>): void {
  console.log(colorize(`Resources after round ${round}:`, 'summary'));
  for (const entity of entities) {
    const resources = resourcesByEntityId[entity.entityId];
    const cooldownSummary = entity.activeSkillIds
      .map((skillId) => `${getSkillDef(skillId).skillName}:${resources.cooldowns[skillId]}`)
      .join(', ');
    const statusSummary = Object.entries(resources.statuses)
      .map(([statusId, status]) => `${statusId}(${status.remainingTurns})`)
      .join(', ');

    console.log(
      `  - ${entity.name ?? entity.entityId} | HP ${resources.hp}/${resources.hpMax} | CD [${cooldownSummary}] | Status [${statusSummary || 'none'}]`
    );
  }
}

function printCharacter(label: string, character: CombatantSnapshot): void {
  const skills = character.activeSkillIds.map((skillId) => getSkillDef(skillId).skillName).join(', ');
  const passives = (character.passiveSkillIds ?? [])
    .map((passiveId) => getPassiveDef(passiveId).skillName)
    .join(', ');

  console.log(
    colorize(
      `${label}: ${character.name} (HP ${character.hpMax}, ATK ${character.atk}, DEF ${character.def}, SPD ${character.spd}, ACC ${character.accuracyBP}, EVA ${character.evadeBP})`,
      'summary'
    )
  );
  console.log(`  Skills: ${skills}`);
  console.log(`  Passives: ${passives || 'none'}`);
}

function main(): void {
  const seed = randomInt(1, 0x7fffffff);
  const player = createRandomCharacter('player', 'Random Vanguard');
  const enemy = createRandomCharacter('enemy', 'Random Marauder');

  const battle = simulateBattle({
    battleId: randomUUID(),
    seed,
    playerInitial: player,
    enemyInitial: enemy
  });

  console.log(colorize(`\n=== Random Combat Simulation ===`, 'summary'));
  console.log(`Seed: ${seed}`);
  printCharacter('Player', player);
  printCharacter('Enemy', enemy);
  console.log(colorize(`\n=== Battle Log ===`, 'summary'));

  const entities = [player, enemy];
  const resourcesByEntityId: Record<string, RuntimeResources> = {
    [player.entityId]: initializeResources(player),
    [enemy.entityId]: initializeResources(enemy)
  };

  for (const event of battle.events) {
    applyEvent(resourcesByEntityId, event);
    const { message, color } = formatEvent(event);
    console.log(colorize(`[R${event.round}] ${message}`, color));

    if (event.type === 'ROUND_END') {
      printRoundResources(event.round, entities, resourcesByEntityId);
    }
  }

  console.log(colorize(`\nWinner: ${battle.winnerEntityId} in ${battle.roundsPlayed} rounds\n`, 'summary'));
}

main();
