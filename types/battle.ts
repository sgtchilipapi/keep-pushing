import type { CombatantSnapshot } from "./combat";

export type BattleEvent =
  | {
      type: "ROUND_START";
      round: number;
    }
  | {
      type: "ACTION";
      round: number;
      actorEntityId: string;
      targetEntityId: string;
      skillId: string;
    }
  | {
      type: "STUNNED_SKIP";
      round: number;
      actorEntityId: string;
    }
  | {
      type: "HIT_RESULT";
      round: number;
      actorEntityId: string;
      targetEntityId: string;
      skillId: string;
      roll: number;
      hitChanceBP: number;
      didHit: boolean;
    }
  | {
      type: "DAMAGE";
      round: number;
      actorEntityId: string;
      targetEntityId: string;
      skillId: string;
      amount: number;
      targetHpAfter: number;
    }
  | {
      type: "STATUS_APPLY";
      round: number;
      targetEntityId: string;
      statusId: string;
      sourceEntityId: string;
      remainingTurns: number;
    }
  | {
      type: "STATUS_REFRESH";
      round: number;
      targetEntityId: string;
      statusId: string;
      sourceEntityId: string;
      remainingTurns: number;
    }
  | {
      type: "STATUS_EXPIRE";
      round: number;
      targetEntityId: string;
      statusId: string;
    }
  | {
      type: "COOLDOWN_SET";
      round: number;
      actorEntityId: string;
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
      targetEntityId: string;
    }
  | {
      type: "BATTLE_END";
      round: number;
      winnerEntityId: string;
      loserEntityId: string;
    };

export interface BattleResult {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  events: BattleEvent[];
}
