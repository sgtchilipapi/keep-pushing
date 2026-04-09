import { getSkillDef, BARRIER_SKILL_ID, REPAIR_SKILL_ID } from "../../engine/battle/skillRegistry";
import { getStatusDef, isStatusId, type StatusId } from "../../engine/battle/statuses/statusRegistry";
import type { CombatantBattleStateSnapshot } from "../../types/battle";
import type { ZoneRunPlayerCarryoverState, ZoneRunStatusEffectState } from "../../types/zoneRun";

const PAUSE_SKILL_IDS = new Set([BARRIER_SKILL_ID, REPAIR_SKILL_ID]);

function cloneStatuses(
  statuses: Record<string, ZoneRunStatusEffectState>,
): Record<string, ZoneRunStatusEffectState> {
  return Object.fromEntries(
    Object.entries(statuses)
      .filter(([, status]) => status.remainingTurns > 0)
      .map(([statusId, status]) => [statusId, { ...status }]),
  );
}

export function buildInitialZoneRunCarryover(hpMax: number): ZoneRunPlayerCarryoverState {
  return {
    hp: hpMax,
    hpMax,
    cooldowns: {},
    statuses: {},
  };
}

export function buildCarryoverFromBattleFinal(
  finalState: CombatantBattleStateSnapshot,
): ZoneRunPlayerCarryoverState {
  return {
    hp: finalState.hp,
    hpMax: finalState.hpMax,
    cooldowns: { ...finalState.cooldowns },
    statuses: cloneStatuses(finalState.statuses),
  };
}

export function applyTraversalTickToCarryover(
  carryover: ZoneRunPlayerCarryoverState,
): ZoneRunPlayerCarryoverState {
  const next: ZoneRunPlayerCarryoverState = {
    hp: carryover.hp,
    hpMax: carryover.hpMax,
    cooldowns: Object.fromEntries(
      Object.entries(carryover.cooldowns).map(([skillId, remaining]) => [
        skillId,
        Math.max(0, remaining - 1),
      ]),
    ),
    statuses: cloneStatuses(carryover.statuses),
  };

  for (const [statusId, status] of Object.entries(carryover.statuses)) {
    if (!isStatusId(statusId)) {
      continue;
    }

    const statusDef = getStatusDef(statusId);
    if (statusDef.roundStartHpDelta !== 0) {
      next.hp = Math.min(next.hpMax, Math.max(0, next.hp + statusDef.roundStartHpDelta));
    }

    const nextRemainingTurns = status.remainingTurns - 1;
    if (nextRemainingTurns <= 0) {
      delete next.statuses[statusId];
      continue;
    }

    next.statuses[statusId] = {
      sourceId: status.sourceId,
      remainingTurns: nextRemainingTurns,
    };
  }

  return next;
}

function applyStatusToCarryover(
  carryover: ZoneRunPlayerCarryoverState,
  statusId: StatusId,
  sourceId: string,
): void {
  const statusDef = getStatusDef(statusId);
  const currentRemainingTurns = carryover.statuses[statusId]?.remainingTurns ?? 0;
  carryover.statuses[statusId] = {
    sourceId,
    remainingTurns: Math.max(currentRemainingTurns, statusDef.durationTurns),
  };

  if (statusDef.roundStartHpDelta !== 0) {
    carryover.hp = Math.min(carryover.hpMax, Math.max(0, carryover.hp + statusDef.roundStartHpDelta));
  }
}

export function applyPauseSkillToCarryover(args: {
  carryover: ZoneRunPlayerCarryoverState;
  skillId: string;
  sourceId: string;
}): ZoneRunPlayerCarryoverState {
  const skill = getSkillDef(args.skillId);
  if (skill.resolutionMode !== "self_utility" || !PAUSE_SKILL_IDS.has(skill.skillId)) {
    throw new Error(`ERR_ZONE_RUN_SKILL_NOT_ALLOWED: skill ${args.skillId} cannot be used during post-battle pause`);
  }
  if ((args.carryover.cooldowns[skill.skillId] ?? 0) > 0) {
    throw new Error(`ERR_ZONE_RUN_SKILL_ON_COOLDOWN: skill ${args.skillId} is still cooling down`);
  }

  const next: ZoneRunPlayerCarryoverState = {
    hp: args.carryover.hp,
    hpMax: args.carryover.hpMax,
    cooldowns: { ...args.carryover.cooldowns },
    statuses: cloneStatuses(args.carryover.statuses),
  };

  if (skill.skillId !== "1000") {
    next.cooldowns[skill.skillId] = skill.cooldownTurns;
  }

  for (const statusId of skill.selfAppliesStatusIds ?? []) {
    applyStatusToCarryover(next, statusId, args.sourceId);
  }

  return next;
}
