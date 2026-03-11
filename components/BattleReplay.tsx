'use client';

import { useMemo } from 'react';

import type { BattleResult } from '../types/battle';

type Props = {
  result: BattleResult;
};

type HpState = {
  [entityId: string]: {
    hp: number;
    hpMax: number;
  };
};

function toLogLine(result: BattleResult, index: number): string {
  const event = result.events[index];

  switch (event.type) {
    case 'ROUND_START':
      return `Round ${event.round} starts`;
    case 'ACTION':
      return `${event.actorId} uses ${event.skillId} on ${event.targetId}`;
    case 'STUNNED_SKIP':
      return `${event.actorId} is stunned and skips the action`;
    case 'HIT_RESULT':
      return `${event.actorId} ${event.didHit ? 'hits' : 'misses'} (roll ${event.rollBP} vs ${event.hitChanceBP})`;
    case 'DAMAGE':
      return `${event.targetId} takes ${event.amount} damage (HP ${event.targetHpAfter})`;
    case 'STATUS_APPLY':
      return `${event.targetId} gains ${event.statusId} (${event.remainingTurns} turns)`;
    case 'STATUS_REFRESH':
      return `${event.targetId} refreshes ${event.statusId} (${event.remainingTurns} turns)`;
    case 'STATUS_EXPIRE':
      return `${event.targetId} ${event.statusId} expired`;
    case 'COOLDOWN_SET':
      return `${event.actorId} sets cooldown on ${event.skillId} to ${event.cooldownRemainingTurns}`;
    case 'DEATH':
      return `${event.entityId} is defeated`;
    case 'ROUND_END':
      return `Round ${event.round} ends`;
    case 'BATTLE_END':
      return `Battle ends. Winner: ${event.winnerEntityId} (${event.reason})`;
    default:
      return 'Unknown event';
  }
}

export default function BattleReplay({ result }: Props) {
  const hpState = useMemo<HpState>(() => {
    const state: HpState = {
      [result.playerInitial.entityId]: {
        hp: result.playerInitial.hp,
        hpMax: result.playerInitial.hpMax
      },
      [result.enemyInitial.entityId]: {
        hp: result.enemyInitial.hp,
        hpMax: result.enemyInitial.hpMax
      }
    };

    for (const event of result.events) {
      if (event.type === 'DAMAGE') {
        state[event.targetId] = {
          ...state[event.targetId],
          hp: event.targetHpAfter
        };
      }
    }

    return state;
  }, [result]);

  return (
    <section>
      <h2>Battle Replay</h2>
      <p>Seed: {result.seed}</p>
      <ul>
        {Object.entries(hpState).map(([entityId, hp]) => (
          <li key={entityId}>
            {entityId}: {hp.hp}/{hp.hpMax}
            <progress max={hp.hpMax} value={hp.hp} style={{ marginLeft: 8 }} />
          </li>
        ))}
      </ul>

      <ol>
        {result.events.map((_, index) => (
          <li key={index}>{toLogLine(result, index)}</li>
        ))}
      </ol>
    </section>
  );
}
