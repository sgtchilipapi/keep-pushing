import { randomUUID } from 'crypto';
import { simulateBattle, type CombatantSnapshot } from '../engine/battle/battleEngine';
import type { DecisionTrace, FeatureContribution, IntentId, SkillScoreBreakdown } from '../engine/battle/aiDecision';
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
  decision: '\x1b[96m',
  selected: '\x1b[92m',
  positive: '\x1b[32m',
  negative: '\x1b[31m',
  neutral: '\x1b[37m',
  intent: '\x1b[94m',
  projection: '\x1b[95m',
  dim: '\x1b[2m',
  reset: '\x1b[0m'
} as const;

type RuntimeResources = {
  hp: number;
  hpMax: number;
  statuses: Record<string, { remainingTurns: number; sourceId: string }>;
  cooldowns: Record<string, number>;
  activeSkillIds: [string, string];
};

type DecisionLogEntry = {
  round: number;
  actorId: string;
  targetId: string;
  trace: DecisionTrace;
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

function colorizeSignedNumber(value: number): string {
  if (value > 0) {
    return colorize(`${value}`, 'positive');
  }

  if (value < 0) {
    return colorize(`${value}`, 'negative');
  }

  return colorize('0', 'dim');
}

function formatIntentTotals(perIntentTotals: Record<IntentId, number>): string {
  return (Object.entries(perIntentTotals) as [IntentId, number][])
    .map(([intentId, value]) => `${colorize(intentId, 'intent')}=${colorizeSignedNumber(value)}`)
    .join(', ');
}

function formatContributionLine(featureContribution: FeatureContribution): string {
  const intentDetails = Object.entries(featureContribution.intentBreakdown)
    .map(([intentId, contribution]) => `${colorize(intentId, 'intent')}:${colorizeSignedNumber(contribution ?? 0)}`)
    .join(', ');

  return [
    `      • ${featureContribution.featureId}`,
    `value=${featureContribution.value}`,
    `prior=${colorizeSignedNumber(featureContribution.priorContribution)}`,
    `intent=${colorizeSignedNumber(featureContribution.intentContribution)}`,
    `total=${colorizeSignedNumber(featureContribution.totalContribution)}`,
    intentDetails ? `| ${intentDetails}` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function formatScoreHeadline(score: SkillScoreBreakdown, selectedSkillId: string): string {
  const skillLabel = `${getSkillDef(score.skillId).skillName} (${score.skillId})`;
  const prefix = score.skillId === selectedSkillId ? colorize('  ★', 'selected') : colorize('  -', 'dim');
  const total = score.skillId === selectedSkillId ? colorizeSignedNumber(score.totalScore) : `${score.totalScore}`;

  return `${prefix} ${skillLabel} => total ${total}`;
}

function getActionTargetLabel(event: Extract<BattleEvent, { type: 'ACTION' }>): string {
  const skill = getSkillDef(event.skillId);
  const isSelfTargetSkill =
    skill.basePower === 0 &&
    (skill.appliesStatusIds?.length ?? 0) === 0 &&
    (skill.selfAppliesStatusIds?.length ?? 0) > 0;

  return isSelfTargetSkill ? 'self' : event.targetId;
}

function formatEvent(event: BattleEvent): { message: string; color: keyof typeof COLORS } {
  switch (event.type) {
    case 'ROUND_START':
      return { message: `Round ${event.round} start`, color: 'round' };
    case 'ACTION':
      return {
        message: `${event.actorId} uses ${getSkillDef(event.skillId).skillName} on ${getActionTargetLabel(event)}`,
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

function formatRoundResources(round: number, entities: CombatantSnapshot[], resourcesByEntityId: Record<string, RuntimeResources>): string[] {
  const lines = [colorize(`Resources after round ${round}:`, 'summary')];

  for (const entity of entities) {
    const resources = resourcesByEntityId[entity.entityId];
    const cooldownSummary = entity.activeSkillIds
      .map((skillId) => `${getSkillDef(skillId).skillName}:${resources.cooldowns[skillId]}`)
      .join(', ');
    const statusSummary = Object.entries(resources.statuses)
      .map(([statusId, status]) => `${statusId}(${status.remainingTurns})`)
      .join(', ');

    lines.push(
      colorize(
        `  - ${entity.name ?? entity.entityId} | HP ${resources.hp}/${resources.hpMax} | CD [${cooldownSummary}] | Status [${statusSummary || 'none'}]`,
        'summary'
      )
    );
  }

  return lines;
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
  console.log(colorize(`  Skills: ${skills}`, 'neutral'));
  console.log(colorize(`  Passives: ${passives || 'none'}`, 'neutral'));
}

function hasDecisionLogFlag(argv: readonly string[]): boolean {
  return argv.includes('--decisionlog');
}

function formatDecisionTrace(decision: DecisionLogEntry): string[] {
  const lines: string[] = [];
  const { round, actorId, targetId, trace } = decision;
  const statusSummary = trace.context.target.statuses.length > 0 ? trace.context.target.statuses.join(', ') : 'none';
  const actorCooldownSummary = Object.entries(trace.context.actor.cooldowns)
    .map(([skillId, cooldown]) => `${getSkillDef(skillId).skillName}:${cooldown}`)
    .join(', ');

  lines.push(colorize(`[R${round}] ${actorId} AI decision against ${targetId}`, 'decision'));
  lines.push(
    colorize(
      `  trace ${trace.traceVersion} | round ${trace.context.battle.round}/${trace.context.battle.maxRounds} ` +
        `(remaining ${trace.context.battle.roundsRemaining})`,
      'dim'
    )
  );
  lines.push(colorize(`  target snapshot: ${trace.context.target.entityId} hp ${trace.context.target.hp}/${trace.context.target.hpMax}, statuses: ${statusSummary}`, 'neutral'));
  lines.push(colorize(`  actor cooldowns: ${actorCooldownSummary || 'none'}`, 'neutral'));
  lines.push(colorize(`  predicted opponent skill: ${getSkillDef(trace.predictedOpponentSkillId).skillName} (${trace.predictedOpponentSkillId})`, 'projection'));
  lines.push(colorize(`  candidate skills: ${trace.candidateSkillIds.join(', ')}`, 'neutral'));

  for (const score of trace.scores) {
    lines.push(formatScoreHeadline(score, trace.selectedSkillId));
    lines.push(
      colorize(
        `    totals | prior=${score.weightBreakdown.priorContributionTotal} intent=${score.weightBreakdown.intentContributionTotal} ` +
          `learned=${score.weightBreakdown.learnedWeight} feature=${score.weightBreakdown.featureContributionTotal} total=${score.weightBreakdown.totalScore}`,
        score.skillId === trace.selectedSkillId ? 'selected' : 'neutral'
      )
    );
    lines.push(`    intents | ${formatIntentTotals(score.weightBreakdown.perIntentContributionTotals)}`);
    lines.push(
      colorize(
        `    projections | outgoing=${score.projections.projectedOutgoingDamage} incoming=${score.projections.projectedIncomingDamage} ` +
          `recovery=${score.projections.projectedRecovery} net=${score.projections.projectedNetPressure} ` +
          `statusSwing=${score.projections.projectedStatusSwing}`,
        'projection'
      )
    );

    for (const featureContribution of score.featureContributions) {
      lines.push(formatContributionLine(featureContribution));
    }
  }

  lines.push(
    colorize(
      `  selected: ${getSkillDef(trace.selectedSkillId).skillName} (${trace.selectedSkillId}) => ${trace.selectedScore.totalScore}`,
      'selected'
    )
  );

  return lines;
}

function buildDecisionDocument(
  seed: number,
  player: CombatantSnapshot,
  enemy: CombatantSnapshot,
  decisionLogs: DecisionLogEntry[],
  battleEvents: BattleEvent[],
  winnerEntityId: string,
  roundsPlayed: number
): string {
  const lines: string[] = [];
  const entities = [player, enemy];
  const resourcesByEntityId: Record<string, RuntimeResources> = {
    [player.entityId]: initializeResources(player),
    [enemy.entityId]: initializeResources(enemy)
  };

  lines.push(colorize('# Random Combat Simulation Decision Document', 'summary'));
  lines.push('');
  lines.push(colorize(`Seed: ${seed}`, 'summary'));
  lines.push(colorize(`Player: ${player.name} (${player.entityId})`, 'neutral'));
  lines.push(colorize(`Enemy: ${enemy.name} (${enemy.entityId})`, 'neutral'));
  lines.push('');
  lines.push(colorize('## AI Decision Trace', 'decision'));

  if (decisionLogs.length === 0) {
    lines.push(colorize('No decision logs captured.', 'death'));
  }

  for (const decision of decisionLogs) {
    lines.push(...formatDecisionTrace(decision));
    lines.push('');
  }

  lines.push(colorize('## Battle Event Timeline', 'summary'));
  for (const event of battleEvents) {
    applyEvent(resourcesByEntityId, event);
    const { message, color } = formatEvent(event);
    lines.push(colorize(`[R${event.round}] ${message}`, color));

    if (event.type === 'ROUND_END') {
      lines.push(...formatRoundResources(event.round, entities, resourcesByEntityId));
    }
  }

  lines.push('');
  lines.push(colorize(`Winner: ${winnerEntityId}`, 'summary'));
  lines.push(colorize(`Rounds Played: ${roundsPlayed}`, 'summary'));

  return lines.join('\n');
}

function main(): void {
  const decisionLogEnabled = hasDecisionLogFlag(process.argv.slice(2));
  const seed = randomInt(1, 0x7fffffff);
  const player = createRandomCharacter('player', 'Random Vanguard');
  const enemy = createRandomCharacter('enemy', 'Random Marauder');

  const decisionLogs: DecisionLogEntry[] = [];

  const battle = simulateBattle({
    battleId: randomUUID(),
    seed,
    playerInitial: player,
    enemyInitial: enemy,
    decisionLogger: decisionLogEnabled
      ? (decision) => {
          decisionLogs.push(decision);
        }
      : undefined
  });

  if (decisionLogEnabled) {
    console.log(
      buildDecisionDocument(seed, player, enemy, decisionLogs, battle.events, battle.winnerEntityId, battle.roundsPlayed)
    );
    return;
  }

  console.log(colorize(`\n=== Random Combat Simulation ===`, 'summary'));
  console.log(colorize(`Seed: ${seed}`, 'summary'));
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
      for (const resourceLine of formatRoundResources(event.round, entities, resourcesByEntityId)) {
        console.log(resourceLine);
      }
    }
  }

  console.log(colorize(`\nWinner: ${battle.winnerEntityId} in ${battle.roundsPlayed} rounds\n`, 'summary'));
}

main();
