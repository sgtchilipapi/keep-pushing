'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { BattleEvent, BattleResult } from '../../types/battle';
import type { CombatantSnapshot } from '../../types/combat';

type Side = 'left' | 'right';

type ReplayFrame = {
  event: BattleEvent;
  leftHp: number;
  rightHp: number;
  leftCooldowns: Record<string, number>;
  rightCooldowns: Record<string, number>;
  leftActionText: string;
  rightActionText: string;
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

function formatEventLine(event: BattleEvent): string {
  switch (event.type) {
    case 'ROUND_START':
      return `Round ${event.round} starts.`;
    case 'ACTION':
      return `${event.actorId} used ${SKILL_META[event.skillId]?.name ?? event.skillId} on ${event.targetId}.`;
    case 'STUNNED_SKIP':
      return `${event.actorId} is stunned and loses their turn.`;
    case 'HIT_RESULT':
      return event.didHit
        ? `${event.actorId} attacked and connected.`
        : `${event.actorId} attacked and missed.`;
    case 'DAMAGE':
      return `${event.targetId} took ${event.amount} damage.`;
    case 'STATUS_APPLY':
      return `${event.targetId} gained ${event.statusId} (${event.remainingTurns} turns).`;
    case 'STATUS_REFRESH':
      return `${event.targetId} refreshed ${event.statusId} (${event.remainingTurns} turns).`;
    case 'STATUS_APPLY_FAILED':
      return `${event.targetId} failed to gain ${event.statusId}.`;
    case 'STATUS_EFFECT_RESOLVE': {
      if (event.hpDelta > 0) {
        return `${event.targetId} used heal on self for ${event.hpDelta}hp.`;
      }

      if (event.hpDelta < 0) {
        return `${event.targetId} suffered ${Math.abs(event.hpDelta)}hp from ${event.statusId}.`;
      }

      return `${event.statusId} resolved on ${event.targetId}.`;
    }
    case 'STATUS_EXPIRE':
      return `${event.targetId} had ${event.statusId} expire.`;
    case 'COOLDOWN_SET':
      return `${event.actorId} set ${SKILL_META[event.skillId]?.name ?? event.skillId} cooldown to ${event.cooldownRemainingTurns}.`;
    case 'DEATH':
      return `${event.entityId} has fallen.`;
    case 'ROUND_END':
      return `Round ${event.round} ended.`;
    case 'BATTLE_END':
      return `Battle ended. Winner: ${event.winnerEntityId}.`;
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

  let leftHp = result.playerInitial.hp;
  let rightHp = result.enemyInitial.hp;
  let leftActionText = 'Awaiting first action...';
  let rightActionText = 'Awaiting first action...';
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

  const frames: ReplayFrame[] = [];

  for (const event of result.events) {
    const line = formatEventLine(event);

    if (event.type === 'DAMAGE') {
      if (event.targetId === leftId) {
        leftHp = event.targetHpAfter;
      }

      if (event.targetId === rightId) {
        rightHp = event.targetHpAfter;
      }
    }

    if (event.type === 'ACTION' || event.type === 'HIT_RESULT' || event.type === 'STATUS_EFFECT_RESOLVE' || event.type === 'STUNNED_SKIP') {
      if ('actorId' in event && event.actorId === leftId) {
        leftActionText = line;
      }

      if ('actorId' in event && event.actorId === rightId) {
        rightActionText = line;
      }

      if ('targetId' in event && !('actorId' in event)) {
        if (event.targetId === leftId) {
          leftActionText = line;
        }

        if (event.targetId === rightId) {
          rightActionText = line;
        }
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
    }

    frames.push({
      event,
      leftHp,
      rightHp,
      leftCooldowns: { ...leftCooldowns },
      rightCooldowns: { ...rightCooldowns },
      leftActionText,
      rightActionText,
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

  const frames = useMemo(() => (result ? buildFrames(result) : []), [result]);
  const currentFrame = frames[currentFrameIndex];

  const runBattle = useCallback(async () => {
    setIsPlaying(false);
    setCurrentFrameIndex(0);

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
  }, [leftCharacter, rightCharacter]);

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

  const leftHp = currentFrame?.leftHp ?? leftCharacter.hp;
  const rightHp = currentFrame?.rightHp ?? rightCharacter.hp;
  const battleId = result?.battleId ?? '—';
  const leftActionText = currentFrame?.leftActionText ?? 'Ready.';
  const rightActionText = currentFrame?.rightActionText ?? 'Ready.';
  const leftSkills = ['1000', ...leftCharacter.activeSkillIds];
  const rightSkills = ['1000', ...rightCharacter.activeSkillIds];

  return (
    <main style={{ minHeight: '100vh', background: '#000', color: '#fff', padding: '1rem' }}>
      <section style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'grid', gap: '0.9rem' }}>
        <header style={{ border: '2px solid #fff', padding: '0.75rem 1rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          Battle ID: {battleId}
        </header>

        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" onClick={() => setLeftCharacter(buildRandomCharacter('10001', 'left'))} style={buttonStyle}>
            Randomize Left
          </button>
          <button type="button" onClick={() => setRightCharacter(buildRandomCharacter('20001', 'right'))} style={buttonStyle}>
            Randomize Right
          </button>
          <button type="button" onClick={runBattle} style={{ ...buttonStyle, gridColumn: '1 / -1' }}>
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
              cooldowns={currentFrame?.leftCooldowns ?? { '1000': 0, [leftCharacter.activeSkillIds[0]]: 0, [leftCharacter.activeSkillIds[1]]: 0 }}
            />
            <StatsCell
              hp={rightHp}
              hpMax={rightCharacter.hpMax}
              initiative={rightCharacter.spd}
              skillIds={rightSkills}
              cooldowns={currentFrame?.rightCooldowns ?? { '1000': 0, [rightCharacter.activeSkillIds[0]]: 0, [rightCharacter.activeSkillIds[1]]: 0 }}
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
