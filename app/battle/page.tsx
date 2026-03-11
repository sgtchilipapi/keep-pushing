'use client';

import { useState } from 'react';

import BattleReplay from '../../components/BattleReplay';
import type { BattleResult } from '../../engine/battle/battleEngine';
import type { CombatantSnapshot } from '../../types/combat';

const playerInitial: CombatantSnapshot = {
  entityId: 'player-1',
  hp: 1400,
  hpMax: 1400,
  atk: 160,
  def: 100,
  spd: 120,
  accuracyBP: 8500,
  evadeBP: 1400,
  activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW']
};

const enemyInitial: CombatantSnapshot = {
  entityId: 'enemy-scrap-drone',
  hp: 1200,
  hpMax: 1200,
  atk: 140,
  def: 90,
  spd: 110,
  accuracyBP: 8000,
  evadeBP: 1200,
  activeSkillIds: ['VOLT_STRIKE', 'FINISHING_BLOW']
};

export default function BattlePage() {
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Combat request failed.');
        return;
      }

      const payload = (await response.json()) as BattleResult;
      setResult(payload);
    } catch {
      setError('Unable to reach combat API.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Battle Simulator</h1>
      <p>Run a deterministic server-side battle and replay the events.</p>
      <label htmlFor="seed-input">Seed: </label>
      <input
        id="seed-input"
        type="number"
        value={seed}
        onChange={(event) => setSeed(Number(event.target.value))}
      />
      <button type="button" onClick={onSimulate} disabled={isLoading} style={{ marginLeft: 8 }}>
        {isLoading ? 'Simulating...' : 'Simulate Battle'}
      </button>

      {error !== null && <p style={{ color: 'crimson' }}>{error}</p>}
      {result !== null && <BattleReplay result={result} />}
    </main>
  );
}
