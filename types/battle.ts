import type { CombatantSnapshot } from "./combat";

export type BattleEvent =
  | {
      type: "ROUND_START";
      round: number;
    }
  | {
      type: "ACTION";
      round: number;
      actorEntityId: number;
      targetEntityId: number;
      skillId: string;
    }
  | {
      type: "HIT_RESULT";
      round: number;
      actorEntityId: number;
      targetEntityId: number;
      skillId: string;
      roll: number;
      hitChanceBP: number;
      didHit: boolean;
    }
  | {
      type: "DAMAGE";
      round: number;
      actorEntityId: number;
      targetEntityId: number;
      skillId: string;
      amount: number;
      targetHpAfter: number;
    }
  | {
      type: "STATUS_APPLY";
      round: number;
      targetEntityId: number;
      statusId: string;
      sourceEntityId: number;
      remainingTurns: number;
    }
  | {
      type: "STATUS_REFRESH";
      round: number;
      targetEntityId: number;
      statusId: string;
      sourceEntityId: number;
      remainingTurns: number;
    }
  | {
      type: "STATUS_EXPIRE";
      round: number;
      targetEntityId: number;
      statusId: string;
    }
  | {
      type: "COOLDOWN_SET";
      round: number;
      actorEntityId: number;
      skillId: string;
      cooldownRemainingTurns: number;
    }
  | {
      type: "ROUND_END";
      round: number;
    }
  | {
      type: "DEATH";
      round: number;
      targetEntityId: number;
    }
  | {
      type: "BATTLE_END";
      round: number;
      winnerEntityId: number;
      loserEntityId: number;
    };

export interface BattleResult {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  events: BattleEvent[];
}
