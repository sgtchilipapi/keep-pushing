'use client';

import { useEffect, useMemo, useState } from 'react';

import { getSkillDef } from '../../engine/battle/skillRegistry';
import type { BattleEvent, BattleResult } from '../../types/battle';
import type { CombatantSnapshot } from '../../types/combat';

const ACTION_STEP_MS = 1000;
const ACTION_BANNER_VISIBLE_MS = 850;

const playerInitial: CombatantSnapshot = {
  entityId: '1001',
  name: 'OPERATOR_A',
  hp: 15000,
  hpMax: 15000,
  atk: 160,
  def: 100,
  spd: 120,
  accuracyBP: 8500,
  evadeBP: 1400,
  activeSkillIds: ['1001', '1002']
};

const enemyInitial: CombatantSnapshot = {
  entityId: '2001',
  name: 'ADVERSARY_X',
  hp: 22000,
  hpMax: 22000,
  atk: 140,
  def: 90,
  spd: 110,
  accuracyBP: 8000,
  evadeBP: 1200,
  activeSkillIds: ['1001', '1002']
};

type ActionPlayback = {
  actorId: string;
  actorName: string;
  targetId: string;
  skillName: string;
  damage: number;
  targetHpAfter: number | null;
  line: string;
};

function resolveSkillName(skillId: string): string {
  try {
    return getSkillDef(skillId).skillName;
  } catch {
    return skillId;
  }
}

function buildActionPlayback(result: BattleResult): ActionPlayback[] {
  const entityNames: Record<string, string> = {
    [result.playerInitial.entityId]: result.playerInitial.name ?? result.playerInitial.entityId,
    [result.enemyInitial.entityId]: result.enemyInitial.name ?? result.enemyInitial.entityId
  };

  const actions: ActionPlayback[] = [];

  result.events.forEach((event, index) => {
    if (event.type !== 'ACTION') {
      return;
    }

    let damage = 0;
    let targetHpAfter: number | null = null;

    for (let cursor = index + 1; cursor < result.events.length; cursor += 1) {
      const next = result.events[cursor];
      if (next.type === 'ACTION') {
        break;
      }

      if (next.type === 'DAMAGE' && next.actorId === event.actorId && next.targetId === event.targetId) {
        damage = next.amount;
        targetHpAfter = next.targetHpAfter;
        break;
      }
    }

    const actorName = entityNames[event.actorId] ?? event.actorId;
    const skillName = resolveSkillName(event.skillId);

    actions.push({
      actorId: event.actorId,
      actorName,
      targetId: event.targetId,
      skillName,
      damage,
      targetHpAfter,
      line: `${actorName} used ${skillName} dealing ${damage} Damage!`
    });
  });

  return actions;
}

export default function BattlePage() {
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [playerHp, setPlayerHp] = useState(playerInitial.hp);
  const [enemyHp, setEnemyHp] = useState(enemyInitial.hp);
  const [playerActionBanner, setPlayerActionBanner] = useState('READY_FOR_SIMULATION');
  const [enemyActionBanner, setEnemyActionBanner] = useState('AWAITING_CONTACT');
  const [feedLines, setFeedLines] = useState<string[]>(['SYSTEM_READY // CLICK SIMULATE_BATTLE']);

  const playbackActions = useMemo(() => (result === null ? [] : buildActionPlayback(result)), [result]);

  useEffect(() => {
    if (result === null) {
      return;
    }

    setPlayerHp(result.playerInitial.hp);
    setEnemyHp(result.enemyInitial.hp);
    setPlayerActionBanner('');
    setEnemyActionBanner('');
    setFeedLines([`SEED=${result.seed} // ACTIONS=${playbackActions.length}`]);

    if (playbackActions.length === 0) {
      return;
    }

    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    playbackActions.forEach((action, index) => {
      const actionTimer = setTimeout(() => {
        if (action.actorId === result.playerInitial.entityId) {
          setPlayerActionBanner(action.line);
          setEnemyActionBanner('');
        } else {
          setEnemyActionBanner(action.line);
          setPlayerActionBanner('');
        }

        if (action.targetHpAfter !== null) {
          if (action.targetId === result.playerInitial.entityId) {
            setPlayerHp(action.targetHpAfter);
          }
          if (action.targetId === result.enemyInitial.entityId) {
            setEnemyHp(action.targetHpAfter);
          }
        }

        setFeedLines((prev) => [...prev, action.line]);

        const clearTimer = setTimeout(() => {
          setPlayerActionBanner('');
          setEnemyActionBanner('');
        }, ACTION_BANNER_VISIBLE_MS);

        timeoutIds.push(clearTimer);
      }, index * ACTION_STEP_MS);

      timeoutIds.push(actionTimer);
    });

    const completeTimer = setTimeout(() => {
      setFeedLines((prev) => [
        ...prev,
        `PLAYBACK_COMPLETE // ROUND_DURATION_MS=${playbackActions.length * ACTION_STEP_MS}`
      ]);
    }, playbackActions.length * ACTION_STEP_MS);
    timeoutIds.push(completeTimer);

    return () => {
      timeoutIds.forEach((timerId) => clearTimeout(timerId));
    };
  }, [playbackActions, result]);

  const onSimulate = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/combat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerInitial,
          enemyInitial,
          seed
        })
      });

      const payload = (await response.json()) as BattleResult | { error?: string };

      if (!response.ok) {
        const message = 'error' in payload ? payload.error : undefined;
        setError(message ?? 'Combat request failed.');
        return;
      }

      setResult(payload as BattleResult);
    } catch {
      setError('Unable to reach combat API.');
    } finally {
      setIsLoading(false);
    }
  };

  const playerHpPercent = (playerHp / playerInitial.hpMax) * 100;
  const enemyHpPercent = (enemyHp / enemyInitial.hpMax) * 100;

  return (
    <main className="battle-terminal">
      <header className="top-bar">
        <div>BATTLE_TERMINAL_V1.0</div>
        <div className="actions">
          <input
            aria-label="seed"
            type="number"
            value={seed}
            onChange={(event) => setSeed(Number(event.target.value))}
          />
          <button type="button" onClick={onSimulate} disabled={isLoading}>
            {isLoading ? 'SIMULATING...' : 'SIMULATE_BATTLE'}
          </button>
        </div>
      </header>

      <section className="arena">
        <div className="units">
          <article className="unit-card">
            <div className="event">{playerActionBanner || ' '}</div>
            <div className="image-placeholder">CHARACTER_IMAGE_SLOT_BLANK</div>
            <div className="stats">
              <div className="hp-label">HP_BAR_V1</div>
              <div className="hp-track">
                <div className="hp-fill hp-player" style={{ width: `${Math.max(0, playerHpPercent)}%` }} />
              </div>
              <div>{playerHp.toLocaleString()} / {playerInitial.hpMax.toLocaleString()}</div>
            </div>
          </article>

          <article className="unit-card">
            <div className="event event-enemy">{enemyActionBanner || ' '}</div>
            <div className="image-placeholder">CHARACTER_IMAGE_SLOT_BLANK</div>
            <div className="stats">
              <div className="hp-label">HP_BAR_ADVERSARY</div>
              <div className="hp-track">
                <div className="hp-fill hp-enemy" style={{ width: `${Math.max(0, enemyHpPercent)}%` }} />
              </div>
              <div>{enemyHp.toLocaleString()} / {enemyInitial.hpMax.toLocaleString()}</div>
            </div>
          </article>
        </div>
      </section>

      <section className="console">
        <div className="console-title">COMBAT_FEED_REALTIME</div>
        <div className="console-body">
          {feedLines.map((line, index) => (
            <div key={`${line}-${index}`}>[{String(index).padStart(2, '0')}] {line}</div>
          ))}
          {error !== null && <div className="error">ERROR: {error}</div>}
        </div>
      </section>

      <style jsx>{`
        .battle-terminal {
          min-height: 100vh;
          background: #131313;
          color: #e2e2e2;
          font-family: 'Space Grotesk', sans-serif;
          padding: 16px;
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          gap: 1px;
        }
        .top-bar {
          background: #0e0e0e;
          border: 1px solid #353535;
          padding: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 700;
          color: #00dbe9;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        input,
        button {
          background: #1f1f1f;
          border: 1px solid #474747;
          color: #e2e2e2;
          padding: 8px;
        }
        button {
          cursor: pointer;
          color: #00dbe9;
          font-weight: 700;
        }
        .arena,
        .console {
          border: 1px solid #353535;
          background: #1b1b1b;
        }
        .console-title {
          background: #2a2a2a;
          color: #00dbe9;
          padding: 8px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .units {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: #353535;
        }
        .unit-card {
          background: #131313;
          padding: 12px;
          display: grid;
          gap: 12px;
        }
        .event {
          border-left: 2px solid #00dbe9;
          background: #2a2a2a;
          padding: 8px;
          font-size: 12px;
          text-transform: uppercase;
          min-height: 34px;
        }
        .event-enemy {
          border-left: none;
          border-right: 2px solid #ff6a6a;
          text-align: right;
        }
        .image-placeholder {
          min-height: 220px;
          border: 1px dashed #474747;
          display: grid;
          place-items: center;
          color: #919191;
          background: #0e0e0e;
          font-size: 12px;
          letter-spacing: 0.08em;
        }
        .stats {
          display: grid;
          gap: 8px;
          font-weight: 700;
        }
        .hp-label {
          font-size: 11px;
          color: #919191;
        }
        .hp-track {
          height: 8px;
          background: #353535;
        }
        .hp-fill {
          height: 100%;
        }
        .hp-player {
          background: #00dbe9;
        }
        .hp-enemy {
          background: #ff6a6a;
        }
        .console-body {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          padding: 12px;
          display: grid;
          gap: 4px;
          font-size: 11px;
          max-height: 220px;
          overflow: auto;
        }
        .error {
          color: #ffb4ab;
          font-weight: 700;
        }
        @media (max-width: 820px) {
          .units {
            grid-template-columns: 1fr;
          }
          .top-bar {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          .actions {
            width: 100%;
          }
          input,
          button {
            flex: 1;
          }
        }
      `}</style>
    </main>
  );
}
