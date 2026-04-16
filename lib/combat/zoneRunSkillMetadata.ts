import { BARRIER_SKILL_ID, REPAIR_SKILL_ID } from "../../engine/battle/skillRegistry";

export const ZONE_RUN_TERMINAL_STATUSES = [
  "COMPLETED",
  "FAILED",
  "ABANDONED",
  "EXPIRED",
  "SEASON_CUTOFF",
] as const;

export type ZoneRunTerminalStatusValue = (typeof ZONE_RUN_TERMINAL_STATUSES)[number];

export type ZoneRunSkillTag = "POST_BATTLE_SUPPORT_RECOVERY";

export interface ZoneRunSkillMetadata {
  skillId: string;
  tags: ZoneRunSkillTag[];
  allowedDuringPostBattlePause: boolean;
}

const ZONE_RUN_SKILL_METADATA: Record<string, ZoneRunSkillMetadata> = {
  [BARRIER_SKILL_ID]: {
    skillId: BARRIER_SKILL_ID,
    tags: ["POST_BATTLE_SUPPORT_RECOVERY"],
    allowedDuringPostBattlePause: true,
  },
  [REPAIR_SKILL_ID]: {
    skillId: REPAIR_SKILL_ID,
    tags: ["POST_BATTLE_SUPPORT_RECOVERY"],
    allowedDuringPostBattlePause: true,
  },
};

export function isZoneRunTerminalStatus(value: string): value is ZoneRunTerminalStatusValue {
  return (ZONE_RUN_TERMINAL_STATUSES as readonly string[]).includes(value);
}

export function getZoneRunSkillMetadata(skillId: string): ZoneRunSkillMetadata | null {
  return ZONE_RUN_SKILL_METADATA[skillId] ?? null;
}

export function canUseSkillDuringPostBattlePause(skillId: string): boolean {
  return getZoneRunSkillMetadata(skillId)?.allowedDuringPostBattlePause ?? false;
}
