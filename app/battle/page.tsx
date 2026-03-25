'use client';

import { useMemo, useState } from 'react';

import type { BattleEvent, BattleResult } from '../../types/battle';
import type { CombatantSnapshot } from '../../types/combat';

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

type CombatView = {
  playerHp: number;
  enemyHp: number;
  playerLastAction: string;
  enemyLastAction: string;
  feed: string[];
};

function eventLine(event: BattleEvent): string {
  switch (event.type) {
    case 'ROUND_START':
      return `ROUND ${event.round} START`;
    case 'ACTION':
      return `${event.actorId} >> ACTION >> ${event.skillId} -> ${event.targetId}`;
    case 'HIT_RESULT':
      return `${event.actorId} ${event.didHit ? 'HIT' : 'MISS'} (${event.rollBP}/${event.hitChanceBP})`;
    case 'DAMAGE':
      return `${event.targetId} TOOK ${event.amount} DMG (HP ${event.targetHpAfter})`;
    case 'STATUS_APPLY':
      return `${event.targetId} STATUS_APPLY ${event.statusId} (${event.remainingTurns}T)`;
    case 'STATUS_REFRESH':
      return `${event.targetId} STATUS_REFRESH ${event.statusId} (${event.remainingTurns}T)`;
    case 'STATUS_EXPIRE':
      return `${event.targetId} STATUS_EXPIRE ${event.statusId}`;
    case 'STATUS_EFFECT_RESOLVE':
      return `${event.statusId} RESOLVE ${event.targetId} HPΔ ${event.hpDelta}`;
    case 'COOLDOWN_SET':
      return `${event.actorId} COOLDOWN ${event.skillId}=${event.cooldownRemainingTurns}`;
    case 'DEATH':
      return `${event.entityId} WAS DEFEATED`;
    case 'STUNNED_SKIP':
      return `${event.actorId} STUNNED_SKIP`;
    case 'ROUND_END':
      return `ROUND ${event.round} END`;
    case 'BATTLE_END':
      return `BATTLE_END WINNER=${event.winnerEntityId} REASON=${event.reason}`;
    case 'STATUS_APPLY_FAILED':
      return `${event.targetId} STATUS_APPLY_FAILED ${event.statusId} (${event.reason})`;
    default:
      return 'UNKNOWN_EVENT';
  }
}

function deriveView(result: BattleResult | null): CombatView {
  if (result === null) {
    return {
      playerHp: playerInitial.hp,
      enemyHp: enemyInitial.hp,
      playerLastAction: 'READY_FOR_SIMULATION',
      enemyLastAction: 'AWAITING_CONTACT',
      feed: ['SYSTEM_READY // CLICK SIMULATE_BATTLE']
    };
  }

  let playerHp = result.playerInitial.hp;
  let enemyHp = result.enemyInitial.hp;
  let playerLastAction = 'NO_ACTION';
  let enemyLastAction = 'NO_ACTION';

  for (const event of result.events) {
    if (event.type === 'DAMAGE') {
      if (event.targetId === result.playerInitial.entityId) {
        playerHp = event.targetHpAfter;
      }
      if (event.targetId === result.enemyInitial.entityId) {
        enemyHp = event.targetHpAfter;
      }
    }

    if (event.type === 'ACTION') {
      if (event.actorId === result.playerInitial.entityId) {
        playerLastAction = `EXECUTED ${event.skillId} ON ${event.targetId}`;
      }
      if (event.actorId === result.enemyInitial.entityId) {
        enemyLastAction = `EXECUTED ${event.skillId} ON ${event.targetId}`;
      }
    }
  }

  const lines = result.events.slice(-8).map((event) => eventLine(event));
  lines.unshift(`SEED=${result.seed} // ROUNDS=${result.roundsPlayed} // WINNER=${result.winnerEntityId}`);

  return {
    playerHp,
    enemyHp,
    playerLastAction,
    enemyLastAction,
    feed: lines
  };
}

export default function BattlePage() {
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const view = useMemo(() => deriveView(result), [result]);

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

  const playerHpPercent = (view.playerHp / playerInitial.hpMax) * 100;
  const enemyHpPercent = (view.enemyHp / enemyInitial.hpMax) * 100;

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
        <div className="status">SYSTEM_READY // ENCOUNTER_ACTIVE</div>
        <div className="units">
          <article className="unit-card">
            <div className="event">{playerInitial.name}: {view.playerLastAction}</div>
            <div className="image-placeholder">CHARACTER_IMAGE_SLOT_BLANK</div>
            <div className="stats">
              <div className="hp-label">HP_BAR_V1</div>
              <div className="hp-track">
                <div className="hp-fill hp-player" style={{ width: `${Math.max(0, playerHpPercent)}%` }} />
              </div>
              <div>{view.playerHp.toLocaleString()} / {playerInitial.hpMax.toLocaleString()}</div>
            </div>
          </article>

          <article className="unit-card">
            <div className="event">{enemyInitial.name}: {view.enemyLastAction}</div>
            <div className="image-placeholder">CHARACTER_IMAGE_SLOT_BLANK</div>
            <div className="stats">
              <div className="hp-label">HP_BAR_ADVERSARY</div>
              <div className="hp-track">
                <div className="hp-fill hp-enemy" style={{ width: `${Math.max(0, enemyHpPercent)}%` }} />
              </div>
              <div>{view.enemyHp.toLocaleString()} / {enemyInitial.hpMax.toLocaleString()}</div>
            </div>
          </article>
        </div>
      </section>

      <section className="console">
        <div className="console-title">COMBAT_FEED_REALTIME</div>
        <div className="console-body">
          {view.feed.map((line, index) => (
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
        .status,
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
