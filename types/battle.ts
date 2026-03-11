import type { CombatantSnapshot } from "./combat";

export type BattleEvent =
  | {
      type: "ROUND_START";
      round: number;
    }
  | {
      type: "ACTION";
      round: number;
      // Migration note: renamed from actorEntityId/targetEntityId.
      actorId: string;
      targetId: string;
      skillId: string;
    }
  | {
      type: "STUNNED_SKIP";
      round: number;
      // Migration note: renamed from actorEntityId.
      actorId: string;
    }
  | {
      type: "HIT_RESULT";
      round: number;
      // Migration note: renamed from actorEntityId/targetEntityId.
      actorId: string;
      targetId: string;
      skillId: string;
      // Migration note: renamed from roll to clarify basis-point units.
      rollBP: number;
      hitChanceBP: number;
      didHit: boolean;
    }
  | {
      type: "DAMAGE";
      round: number;
      // Migration note: renamed from actorEntityId/targetEntityId.
      actorId: string;
      targetId: string;
      skillId: string;
      amount: number;
      targetHpAfter: number;
    }
  | {
      type: "STATUS_APPLY";
      round: number;
      // Migration note: renamed from targetEntityId/sourceEntityId.
      targetId: string;
      statusId: string;
      sourceId: string;
      remainingTurns: number;
    }
  | {
      type: "STATUS_REFRESH";
      round: number;
      // Migration note: renamed from targetEntityId/sourceEntityId.
      targetId: string;
      statusId: string;
      sourceId: string;
      remainingTurns: number;
    }
  | {
      type: "STATUS_EXPIRE";
      round: number;
      // Migration note: renamed from targetEntityId.
      targetId: string;
      statusId: string;
    }
  | {
      type: "COOLDOWN_SET";
      round: number;
      // Migration note: renamed from actorEntityId.
      actorId: string;
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
      // Migration note: renamed from targetEntityId.
      entityId: string;
    }
  | {
      type: "BATTLE_END";
      round: number;
      winnerEntityId: string;
      loserEntityId: string;
      reason: "death" | "timeout";
    };

export interface BattleResult {
  battleId: string;
  seed: number;
  playerInitial: CombatantSnapshot;
  enemyInitial: CombatantSnapshot;
  events: BattleEvent[];
  winnerEntityId: string;
  roundsPlayed: number;
}
