'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { BattleEvent, BattleResult } from '../../types/battle';
import type { CombatantSnapshot } from '../../types/combat';

type Side = 'left' | 'right';

type ReplayFrame = {
  event: BattleEvent;
  leftHp: number;
  rightHp: number;
  displayLeftHp: number;
  displayRightHp: number;
  leftCooldowns: Record<string, number>;
  rightCooldowns: Record<string, number>;
  displayLeftCooldowns: Record<string, number>;
  displayRightCooldowns: Record<string, number>;
  actionLabelSide: Side | null;
  actionLabelText: string;
  logLine: string;
};

const SKILL_META: Record<string, { name: string; icon: string }> = {
  '1000': { name: 'Basic Attack', icon: '◼' },
  '1001': { name: 'Volt Strike', icon: '⚡' },
  '1002': { name: 'Finishing Blow', icon: '✦' },
  '1003': { name: 'Surge', icon: '⬢' },
  '1004': { name: 'Barrier', icon: '▦' },
  '1005': { name: 'Repair', icon: '✚' }
};

const ACTIVE_SKILL_IDS = ['1001', '1002', '1003', '1004', '1005'] as const;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickDistinct<T>(values: readonly T[], count: number): T[] {
  const mutable = [...values];
  const picked: T[] = [];

  while (picked.length < count && mutable.length > 0) {
    const index = randomInt(0, mutable.length - 1);
    const [value] = mutable.splice(index, 1);
    if (value !== undefined) {
      picked.push(value);
    }
  }

  return picked;
}

function buildRandomCharacter(entityId: string, side: Side): CombatantSnapshot {
  const [skill1, skill2] = pickDistinct(ACTIVE_SKILL_IDS, 2) as [string, string];
  const hpMax = randomInt(950, 1450);

  return {
    entityId,
    side: side === 'left' ? 'PLAYER' : 'ENEMY',
    name: side === 'left' ? `Left-${randomInt(10, 99)}` : `Right-${randomInt(10, 99)}`,
    hp: hpMax,
    hpMax,
    atk: randomInt(85, 145),
    def: randomInt(60, 120),
    spd: randomInt(70, 140),
    accuracyBP: randomInt(8600, 9600),
    evadeBP: randomInt(300, 1300),
    activeSkillIds: [skill1, skill2],
    passiveSkillIds: ['2001', '2002']
  };
}

function formatCombatantName(entityId: string, leftId: string, leftName: string, rightId: string, rightName: string): string {
  if (entityId === leftId) {
    return leftName;
  }

  if (entityId === rightId) {
    return rightName;
  }

  return entityId;
}

function formatEventLine(
  event: BattleEvent,
  leftId: string,
  leftName: string,
  rightId: string,
  rightName: string
): string {
  switch (event.type) {
    case 'ROUND_START':
      return `Round ${event.round} start`;
    case 'ACTION':
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} uses ${SKILL_META[event.skillId]?.name ?? event.skillId} on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)}`;
    case 'COOLDOWN_SET':
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} sets cooldown on ${SKILL_META[event.skillId]?.name ?? event.skillId} to ${event.cooldownRemainingTurns}`;
    case 'STUNNED_SKIP':
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} is stunned and loses their action`;
    case 'HIT_RESULT':
      return event.didHit
        ? `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} hits ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} (${event.rollBP}/${event.hitChanceBP})`
        : `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} misses ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} (${event.rollBP}/${event.hitChanceBP})`;
    case 'DAMAGE':
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} takes ${event.amount} damage (HP now ${event.targetHpAfter})`;
    case 'STATUS_APPLY':
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} gains ${event.statusId} from ${formatCombatantName(event.sourceId, leftId, leftName, rightId, rightName)} (${event.remainingTurns} turns)`;
    case 'STATUS_REFRESH':
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} refreshes ${event.statusId} to ${event.remainingTurns} turns`;
    case 'STATUS_APPLY_FAILED':
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} failed to gain ${event.statusId} (${event.reason})`;
    case 'STATUS_EFFECT_RESOLVE':
      return `${event.statusId} resolves on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} during ${event.phase} (hpΔ ${event.hpDelta}, hp ${event.targetHpAfter})`;
    case 'STATUS_EXPIRE':
      return `${event.statusId} expired on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)}`;
    case 'DEATH':
      return `${formatCombatantName(event.entityId, leftId, leftName, rightId, rightName)} was defeated`;
    case 'ROUND_END':
      return `Round ${event.round} end`;
    case 'BATTLE_END':
      return `Battle ended by ${event.reason}. Winner: ${event.winnerEntityId}, Loser: ${event.loserEntityId}`;
    default:
      return 'Unknown event.';
  }
}

function decrementCooldowns(cooldowns: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(cooldowns).map(([skillId, value]) => [skillId, Math.max(0, value - 1)]));
}

function buildFrames(result: BattleResult): ReplayFrame[] {
  const leftId = result.playerInitial.entityId;
  const rightId = result.enemyInitial.entityId;
  const leftName = result.playerInitial.name ?? leftId;
  const rightName = result.enemyInitial.name ?? rightId;

  let leftHp = result.playerInitial.hp;
  let rightHp = result.enemyInitial.hp;
  let leftCooldowns: Record<string, number> = {
    '1000': 0,
    [result.playerInitial.activeSkillIds[0]]: 0,
    [result.playerInitial.activeSkillIds[1]]: 0
  };
  let rightCooldowns: Record<string, number> = {
    '1000': 0,
    [result.enemyInitial.activeSkillIds[0]]: 0,
    [result.enemyInitial.activeSkillIds[1]]: 0
  };
  let displayLeftHp = leftHp;
  let displayRightHp = rightHp;
  let displayLeftCooldowns = { ...leftCooldowns };
  let displayRightCooldowns = { ...rightCooldowns };
  let lastUsedSkillByActor: Record<string, string> = {};

  const frames: ReplayFrame[] = [];

  for (const event of result.events) {
    const line = formatEventLine(event, leftId, leftName, rightId, rightName);
    let actionLabelSide: Side | null = null;
    let actionLabelText = '';

    if (event.type === 'DAMAGE') {
      if (event.targetId === leftId) {
        leftHp = event.targetHpAfter;
      }

      if (event.targetId === rightId) {
        rightHp = event.targetHpAfter;
      }
    }

    if ('actorId' in event) {
      if (event.type === 'ACTION') {
        lastUsedSkillByActor = {
          ...lastUsedSkillByActor,
          [event.actorId]: SKILL_META[event.skillId]?.name ?? event.skillId
        };

        if (event.skillId === '1004' || event.skillId === '1005') {
          actionLabelSide = event.actorId === leftId ? 'left' : event.actorId === rightId ? 'right' : null;
          actionLabelText = `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} used ${SKILL_META[event.skillId]?.name ?? event.skillId} successfully!`;
        }
      }

      if (event.type === 'HIT_RESULT') {
        const usedSkill = lastUsedSkillByActor[event.actorId] ?? 'Basic Attack';
        actionLabelSide = event.actorId === leftId ? 'left' : event.actorId === rightId ? 'right' : null;
        actionLabelText = `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} used ${usedSkill} and ${event.didHit ? 'hit!' : 'missed!'}`;
      }
    }

    if (event.type === 'COOLDOWN_SET') {
      if (event.actorId === leftId) {
        leftCooldowns = { ...leftCooldowns, [event.skillId]: event.cooldownRemainingTurns };
      }

      if (event.actorId === rightId) {
        rightCooldowns = { ...rightCooldowns, [event.skillId]: event.cooldownRemainingTurns };
      }
    }

    if (event.type === 'ROUND_END') {
      leftCooldowns = decrementCooldowns(leftCooldowns);
      rightCooldowns = decrementCooldowns(rightCooldowns);
      displayLeftHp = leftHp;
      displayRightHp = rightHp;
      displayLeftCooldowns = { ...leftCooldowns };
      displayRightCooldowns = { ...rightCooldowns };
    }

    if (event.type === 'BATTLE_END') {
      displayLeftHp = leftHp;
      displayRightHp = rightHp;
      displayLeftCooldowns = { ...leftCooldowns };
      displayRightCooldowns = { ...rightCooldowns };
    }

    frames.push({
      event,
      leftHp,
      rightHp,
      displayLeftHp,
      displayRightHp,
      leftCooldowns: { ...leftCooldowns },
      rightCooldowns: { ...rightCooldowns },
      displayLeftCooldowns: { ...displayLeftCooldowns },
      displayRightCooldowns: { ...displayRightCooldowns },
      actionLabelSide,
      actionLabelText,
      logLine: line
    });
  }

  return frames;
}

export default function BattleDashboardPage() {
  const [leftCharacter, setLeftCharacter] = useState<CombatantSnapshot>(() => buildRandomCharacter('10001', 'left'));
  const [rightCharacter, setRightCharacter] = useState<CombatantSnapshot>(() => buildRandomCharacter('20001', 'right'));
  const [result, setResult] = useState<BattleResult | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [battleStarted, setBattleStarted] = useState(false);
  const [activeLabel, setActiveLabel] = useState<{ side: Side; text: string } | null>(null);

  const frames = useMemo(() => (result ? buildFrames(result) : []), [result]);
  const currentFrame = frames[currentFrameIndex];

  const runBattle = useCallback(async () => {
    setIsPlaying(false);
    setCurrentFrameIndex(0);
    setActiveLabel(null);

    const response = await fetch('/api/combat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerInitial: leftCharacter,
        enemyInitial: rightCharacter,
        seed: randomInt(1, 1000000)
      })
    });

    if (!response.ok) {
      setResult(null);
      return;
    }

    const battleResult = (await response.json()) as BattleResult;
    setResult(battleResult);
    setCurrentFrameIndex(0);
    setIsPlaying(true);
    setBattleStarted(true);
  }, [leftCharacter, rightCharacter]);

  useEffect(() => {
    if (currentFrame?.actionLabelSide === null || currentFrame?.actionLabelText.length === 0) {
      return;
    }

    setActiveLabel({ side: currentFrame.actionLabelSide, text: currentFrame.actionLabelText });
    const hideTimer = window.setTimeout(() => setActiveLabel(null), 2000);
    return () => window.clearTimeout(hideTimer);
  }, [currentFrame?.actionLabelSide, currentFrame?.actionLabelText]);

  useEffect(() => {
    if (!isPlaying || frames.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentFrameIndex((previous) => {
        if (previous >= frames.length - 1) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return previous;
        }

        return previous + 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [frames.length, isPlaying]);

  const leftHp = currentFrame?.displayLeftHp ?? leftCharacter.hp;
  const rightHp = currentFrame?.displayRightHp ?? rightCharacter.hp;
  const battleId = result?.battleId ?? '—';
  const leftActionText = activeLabel?.side === 'left' ? activeLabel.text : '';
  const rightActionText = activeLabel?.side === 'right' ? activeLabel.text : '';
  const leftSkills = ['1000', ...leftCharacter.activeSkillIds];
  const rightSkills = ['1000', ...rightCharacter.activeSkillIds];

  return (
    <main style={{ minHeight: '100vh', background: '#000', color: '#fff', padding: '1rem' }}>
      <section style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'grid', gap: '0.9rem' }}>
        <header style={{ border: '2px solid #fff', padding: '0.75rem 1rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          Battle ID: {battleId}
        </header>

        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" disabled={battleStarted} onClick={() => setLeftCharacter(buildRandomCharacter('10001', 'left'))} style={buttonStyle}>
            Randomize Left
          </button>
          <button type="button" disabled={battleStarted} onClick={() => setRightCharacter(buildRandomCharacter('20001', 'right'))} style={buttonStyle}>
            Randomize Right
          </button>
          <button type="button" disabled={battleStarted} onClick={runBattle} style={{ ...buttonStyle, gridColumn: '1 / -1' }}>
            Start Replay
          </button>
        </div>

        <section style={{ border: '2px solid #fff', minHeight: '58vh', display: 'grid', gridTemplateRows: '70% 30%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '2px solid #fff' }}>
            <ArenaCell
              name={leftCharacter.name ?? leftCharacter.entityId}
              actionText={leftActionText}
              side="left"
              isActive={currentFrame?.event.type === 'ACTION' && 'actorId' in currentFrame.event && currentFrame.event.actorId === leftCharacter.entityId}
            />
            <ArenaCell
              name={rightCharacter.name ?? rightCharacter.entityId}
              actionText={rightActionText}
              side="right"
              isActive={currentFrame?.event.type === 'ACTION' && 'actorId' in currentFrame.event && currentFrame.event.actorId === rightCharacter.entityId}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <StatsCell
              hp={leftHp}
              hpMax={leftCharacter.hpMax}
              initiative={leftCharacter.spd}
              skillIds={leftSkills}
              cooldowns={currentFrame?.displayLeftCooldowns ?? { '1000': 0, [leftCharacter.activeSkillIds[0]]: 0, [leftCharacter.activeSkillIds[1]]: 0 }}
            />
            <StatsCell
              hp={rightHp}
              hpMax={rightCharacter.hpMax}
              initiative={rightCharacter.spd}
              skillIds={rightSkills}
              cooldowns={currentFrame?.displayRightCooldowns ?? { '1000': 0, [rightCharacter.activeSkillIds[0]]: 0, [rightCharacter.activeSkillIds[1]]: 0 }}
            />
          </div>
        </section>

        <details style={{ border: '2px solid #fff', padding: '0.75rem 1rem' }} open>
          <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: '0.5rem' }}>Battle Log</summary>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', maxHeight: 220, overflowY: 'auto', display: 'grid', gap: '0.3rem' }}>
            {frames.map((frame, index) => (
              <li
                key={`${frame.event.type}-${index}`}
                style={{ opacity: index <= currentFrameIndex ? 1 : 0.45, fontWeight: index === currentFrameIndex ? 700 : 400 }}
              >
                {frame.logLine}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </main>
  );
}

type ArenaCellProps = {
  name: string;
  actionText: string;
  side: Side;
  isActive: boolean;
};

function ArenaCell({ name, actionText, side, isActive }: ArenaCellProps) {
  return (
    <article style={{ borderRight: side === 'left' ? '2px solid #fff' : undefined, padding: '0.75rem', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '0.75rem' }}>
      <p style={{ margin: 0, border: '1px solid #fff', padding: '0.5rem', minHeight: '3rem', background: '#0d0d0d' }}>{actionText}</p>
      <div
        style={{
          border: '2px dashed #fff',
          display: 'grid',
          placeItems: 'center',
          fontSize: '1.25rem',
          letterSpacing: '0.05em',
          background: isActive ? '#1a1a1a' : '#000',
          transition: 'background 0.25s ease'
        }}
      >
        {name}
      </div>
    </article>
  );
}

type StatsCellProps = {
  hp: number;
  hpMax: number;
  initiative: number;
  skillIds: string[];
  cooldowns: Record<string, number>;
};

function StatsCell({ hp, hpMax, initiative, skillIds, cooldowns }: StatsCellProps) {
  return (
    <article style={{ borderRight: '2px solid #fff', padding: '0.75rem' }}>
      <p style={{ margin: '0 0 0.3rem' }}>HP: {hp}/{hpMax}</p>
      <p style={{ margin: '0 0 0.5rem' }}>Initiative: {initiative}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
        <span>Actions:</span>
        {skillIds.map((skillId) => {
          const cooldown = cooldowns[skillId] ?? 0;
          const disabled = cooldown > 0;

          return (
            <span
              key={skillId}
              title={SKILL_META[skillId]?.name ?? skillId}
              style={{
                minWidth: 32,
                height: 32,
                border: '1px solid #fff',
                display: 'inline-grid',
                placeItems: 'center',
                opacity: disabled ? 0.4 : 1,
                background: disabled ? '#2b2b2b' : '#000',
                position: 'relative',
                fontSize: '0.9rem'
              }}
            >
              {SKILL_META[skillId]?.icon ?? '◻'}
              {disabled ? <small style={{ position: 'absolute', bottom: -18 }}>{cooldown}</small> : null}
            </span>
          );
        })}
      </div>
    </article>
  );
}

const buttonStyle: CSSProperties = {
  border: '2px solid #fff',
  background: '#000',
  color: '#fff',
  padding: '0.7rem 0.8rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  cursor: 'pointer'
};
