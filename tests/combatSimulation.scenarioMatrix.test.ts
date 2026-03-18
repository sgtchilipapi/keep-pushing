import { simulateBattle, type BattleInput, type CombatantSnapshot } from '../engine/battle/battleEngine';
import { calculateHitChanceBP } from '../engine/battle/resolveDamage';
import { getSkillDef } from '../engine/battle/skillRegistry';
import type { BattleEvent } from '../types/battle';

function createCombatant(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    entityId: '101',
    hp: 2200,
    hpMax: 2200,
    atk: 165,
    def: 120,
    spd: 110,
    accuracyBP: 8600,
    evadeBP: 1300,
    activeSkillIds: ['1001', '1002'],
    ...overrides
  };
}

function createInput(overrides: Partial<BattleInput> = {}): BattleInput {
  return {
    battleId: 'scenario-matrix',
    seed: 1337,
    maxRounds: 8,
    playerInitial: createCombatant({ entityId: '101' }),
    enemyInitial: createCombatant({
      entityId: '202',
      hp: 2100,
      hpMax: 2100,
      atk: 155,
      def: 130,
      spd: 105,
      accuracyBP: 8400,
      evadeBP: 1500,
      activeSkillIds: ['1003', '1000']
    }),
    ...overrides
  };
}

function findEvents<T extends BattleEvent['type']>(events: BattleEvent[], type: T): Extract<BattleEvent, { type: T }>[] {
  return events.filter((event): event is Extract<BattleEvent, { type: T }> => event.type === type);
}

describe('combat simulation scenario matrix', () => {
  describe('determinism, replayability, and invariants', () => {
    it('produces byte-identical event logs for the same input and seed', () => {
      const input = createInput();
      const first = simulateBattle(input);
      const second = simulateBattle(input);

      expect(first.events).toEqual(second.events);
      expect(first.winnerEntityId).toBe(second.winnerEntityId);
      expect(input.playerInitial.hp).toBe(2200);
      expect(input.enemyInitial.hp).toBe(2100);
    });

    it('changes stochastic outcomes when seed differs', () => {
      const first = simulateBattle(createInput({ seed: 42 }));
      const second = simulateBattle(createInput({ seed: 43 }));

      expect(first.events).not.toEqual(second.events);
    });

    it('maintains key invariants across a broad seed sweep', () => {
      for (let seed = 1; seed <= 100; seed += 1) {
        const result = simulateBattle(createInput({ seed, battleId: `seed-${seed}` }));
        const deaths = findEvents(result.events, 'DEATH');
        const terminal = findEvents(result.events, 'BATTLE_END');

        expect(terminal).toHaveLength(1);
        expect(result.winnerEntityId === '101' || result.winnerEntityId === '202').toBe(true);

        for (const event of findEvents(result.events, 'DAMAGE')) {
          expect(event.targetHpAfter).toBeGreaterThanOrEqual(0);
        }

        if (deaths.length > 0) {
          const deadSet = new Set(deaths.map((event) => event.entityId));
          for (const action of findEvents(result.events, 'ACTION')) {
            const firstDeathRound = deaths.find((death) => death.entityId === action.actorId)?.round;
            if (firstDeathRound !== undefined) {
              expect(action.round).toBeLessThanOrEqual(firstDeathRound);
            }
          }
          expect(deadSet.size).toBe(1);
        }
      }
    });
  });

  describe('round lifecycle and terminal ordering', () => {
    it('emits ordered ROUND_START/ROUND_END markers and one BATTLE_END', () => {
      const result = simulateBattle(createInput({ seed: 7 }));
      const roundStarts = findEvents(result.events, 'ROUND_START');
      const roundEnds = findEvents(result.events, 'ROUND_END');
      const terminal = findEvents(result.events, 'BATTLE_END');

      expect(roundStarts.length).toBeGreaterThan(0);
      expect(roundEnds.length).toBe(roundStarts.length);
      expect(terminal).toHaveLength(1);

      for (let i = 0; i < roundStarts.length; i += 1) {
        expect(roundStarts[i].round).toBe(i + 1);
        expect(roundEnds[i].round).toBe(i + 1);
      }

      const terminalIndex = result.events.findIndex((event) => event.type === 'BATTLE_END');
      expect(terminalIndex).toBe(result.events.length - 1);
    });

    it('supports timeout resolution via maxRounds boundary', () => {
      const result = simulateBattle(
        createInput({
          seed: 99,
          maxRounds: 1,
          playerInitial: createCombatant({ entityId: '101', hp: 5000, hpMax: 5000, def: 350 }),
          enemyInitial: createCombatant({ entityId: '202', hp: 5000, hpMax: 5000, def: 350, activeSkillIds: ['1004', '1005'] })
        })
      );

      const end = findEvents(result.events, 'BATTLE_END')[0];
      expect(end.reason).toBe('timeout');
      expect(result.roundsPlayed).toBe(1);
    });
  });

  describe('accuracy, hit resolution, cooldowns, and statuses', () => {
    it('matches hit chance clamp boundaries at 500 BP and 9500 BP', () => {
      const skill = getSkillDef('1000');
      const guaranteedHit = calculateHitChanceBP(
        createCombatant({ accuracyBP: 10000 }),
        createCombatant({ evadeBP: 0 }),
        skill
      );
      const guaranteedMiss = calculateHitChanceBP(
        createCombatant({ accuracyBP: 0 }),
        createCombatant({ evadeBP: 10000 }),
        skill
      );

      expect(guaranteedHit).toBe(9500);
      expect(guaranteedMiss).toBe(500);
    });

    it('emits COOLDOWN_SET for non-basic skills and never for basic attack', () => {
      const result = simulateBattle(
        createInput({
          seed: 123,
          playerInitial: createCombatant({ activeSkillIds: ['1001', '1002'] }),
          enemyInitial: createCombatant({ entityId: '202', activeSkillIds: ['1000', '1000'] })
        })
      );

      const cooldowns = findEvents(result.events, 'COOLDOWN_SET');
      expect(cooldowns.some((event) => event.skillId === '1000')).toBe(false);
      expect(cooldowns.length).toBeGreaterThan(0);
    });

    it('covers new skill/status combinations for surge, barrier, and repair', () => {
      const result = simulateBattle(
        createInput({
          seed: 12,
          maxRounds: 12,
          playerInitial: createCombatant({ entityId: '101', activeSkillIds: ['1003', '1004'] }),
          enemyInitial: createCombatant({ entityId: '202', activeSkillIds: ['1005', '1000'] })
        })
      );

      const applyEvents = findEvents(result.events, 'STATUS_APPLY');
      const refreshEvents = findEvents(result.events, 'STATUS_REFRESH');
      const statusIds = new Set([...applyEvents, ...refreshEvents].map((event) => event.statusId));

      expect(statusIds.has('overheated')).toBe(true);
      expect(statusIds.has('shielded')).toBe(true);
      expect(statusIds.has('recovering')).toBe(true);

      const roundStartResolves = findEvents(result.events, 'STATUS_EFFECT_RESOLVE').filter(
        (event) => event.phase === 'onRoundStart'
      );
      expect(roundStartResolves.some((event) => event.statusId === 'overheated' && event.hpDelta < 0)).toBe(true);
      expect(roundStartResolves.some((event) => event.statusId === 'recovering' && event.hpDelta > 0)).toBe(true);
    });
  });


  describe('slice 2 tactical behavior', () => {
    it('opens with a finishing action when the target is in execute range', () => {
      const decisions: { round: number; actorId: string; targetId: string; trace: { selectedSkillId: string } }[] = [];
      simulateBattle(
        createInput({
          seed: 1,
          maxRounds: 1,
          playerInitial: createCombatant({ entityId: '101', activeSkillIds: ['1001', '1002'] }),
          enemyInitial: createCombatant({ entityId: '202', hp: 600, hpMax: 2100, activeSkillIds: ['1000', '1003'] }),
          decisionLogger: (decision) => decisions.push(decision)
        })
      );

      expect(decisions.find((decision) => decision.actorId === '101' && decision.round === 1)?.trace.selectedSkillId).toBe('1002');
    });

    it('opens with repair when the actor starts in a critical survival state', () => {
      const decisions: { round: number; actorId: string; targetId: string; trace: { selectedSkillId: string } }[] = [];
      simulateBattle(
        createInput({
          seed: 1,
          maxRounds: 1,
          playerInitial: createCombatant({ entityId: '101', hp: 500, hpMax: 2200, activeSkillIds: ['1004', '1005'] }),
          enemyInitial: createCombatant({ entityId: '202', activeSkillIds: ['1001', '1002'] }),
          decisionLogger: (decision) => decisions.push(decision)
        })
      );

      expect(decisions.find((decision) => decision.actorId === '101' && decision.round === 1)?.trace.selectedSkillId).toBe('1005');
    });
  });

  describe('input contract and error handling', () => {
    it('fails fast for unknown skill identifiers in loadout', () => {
      expect(() =>
        simulateBattle(
          createInput({
            playerInitial: createCombatant({ activeSkillIds: ['1000', '9999'] })
          })
        )
      ).toThrow('Unknown skillId: 9999');
    });

    it('handles maxRounds=0 deterministically with immediate timeout', () => {
      const result = simulateBattle(createInput({ maxRounds: 0 }));
      const roundStarts = findEvents(result.events, 'ROUND_START');
      const end = findEvents(result.events, 'BATTLE_END')[0];

      expect(roundStarts).toHaveLength(0);
      expect(end.reason).toBe('timeout');
      expect(result.roundsPlayed).toBe(0);
    });
  });
});
