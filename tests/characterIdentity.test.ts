import {
  assertValidCharacterName,
  normalizeCharacterClassId,
  normalizeCharacterName,
  normalizeCharacterSlotIndex,
} from "../lib/characterIdentity";
import {
  ZONE_RUN_TERMINAL_STATUSES,
  canUseSkillDuringPostBattlePause,
  isZoneRunTerminalStatus,
} from "../lib/combat/zoneRunSkillMetadata";

describe("characterIdentity foundations", () => {
  it("normalizes and validates character names", () => {
    expect(assertValidCharacterName("  Alpha   One  ")).toBe("Alpha One");
    expect(normalizeCharacterName("  Alpha   One  ")).toBe("alpha one");
  });

  it("rejects invalid character names", () => {
    expect(() => assertValidCharacterName("ab")).toThrow(
      /ERR_CHARACTER_NAME_LENGTH/,
    );
    expect(() => assertValidCharacterName("Alpha!")).toThrow(
      /ERR_CHARACTER_NAME_FORMAT/,
    );
  });

  it("normalizes class ids and slot indexes", () => {
    expect(normalizeCharacterClassId("Soldier")).toBe("soldier");
    expect(normalizeCharacterSlotIndex(2)).toBe(2);
  });

  it("exports shared zone-run terminal status helpers and pause skill tags", () => {
    expect(ZONE_RUN_TERMINAL_STATUSES).toContain("SEASON_CUTOFF");
    expect(isZoneRunTerminalStatus("FAILED")).toBe(true);
    expect(isZoneRunTerminalStatus("bogus")).toBe(false);
    expect(canUseSkillDuringPostBattlePause("1004")).toBe(true);
    expect(canUseSkillDuringPostBattlePause("1001")).toBe(false);
  });
});
