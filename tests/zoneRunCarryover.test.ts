import {
  applyPauseSkillToCarryover,
  applyTraversalTickToCarryover,
  buildCarryoverFromBattleFinal,
} from "../lib/combat/zoneRunCarryover";

describe("zone run carryover", () => {
  it("ticks cooldowns and statuses during traversal", () => {
    const next = applyTraversalTickToCarryover({
      hp: 900,
      hpMax: 1200,
      cooldowns: { "1004": 2, "1005": 1 },
      statuses: {
        recovering: {
          sourceId: "character-1",
          remainingTurns: 2,
        },
      },
    });

    expect(next.hp).toBe(990);
    expect(next.cooldowns["1004"]).toBe(1);
    expect(next.cooldowns["1005"]).toBe(0);
    expect(next.statuses.recovering?.remainingTurns).toBe(1);
  });

  it("applies allowed pause skills onto carryover", () => {
    const next = applyPauseSkillToCarryover({
      carryover: {
        hp: 700,
        hpMax: 1200,
        cooldowns: {},
        statuses: {},
      },
      skillId: "1005",
      sourceId: "character-1",
    });

    expect(next.hp).toBe(790);
    expect(next.cooldowns["1005"]).toBe(2);
    expect(next.statuses.recovering?.remainingTurns).toBe(3);
  });

  it("builds carryover from a final battle state snapshot", () => {
    const carryover = buildCarryoverFromBattleFinal({
      entityId: "character-1",
      hp: 810,
      hpMax: 1200,
      atk: 100,
      def: 100,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1000,
      activeSkillIds: ["1001", "1005"],
      passiveSkillIds: ["2001", "2002"],
      initiative: 0,
      cooldowns: { "1005": 2 },
      statuses: {
        shielded: {
          sourceId: "character-1",
          remainingTurns: 1,
        },
      },
    });

    expect(carryover.hp).toBe(810);
    expect(carryover.cooldowns["1005"]).toBe(2);
    expect(carryover.statuses.shielded?.remainingTurns).toBe(1);
  });
});
