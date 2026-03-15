import {
  ALL_SKILL_IDS,
  BARRIER_SKILL_ID,
  FINISHING_BLOW_SKILL_ID,
  REPAIR_SKILL_ID,
  SURGE_SKILL_ID,
  VOLT_STRIKE_SKILL_ID,
  getSkillDef
} from '../engine/battle/skillRegistry';

describe('skill registry status mappings', () => {
  it('registers dedicated status skills and remapped legacy skills', () => {
    expect(ALL_SKILL_IDS).toEqual(['1000', '1001', '1002', '1003', '1004', '1005']);

    expect(getSkillDef(SURGE_SKILL_ID)).toEqual(
      expect.objectContaining({ appliesStatusIds: ['overheated'], selfAppliesStatusIds: [] })
    );

    expect(getSkillDef(BARRIER_SKILL_ID)).toEqual(
      expect.objectContaining({ appliesStatusIds: [], selfAppliesStatusIds: ['shielded'] })
    );

    expect(getSkillDef(REPAIR_SKILL_ID)).toEqual(
      expect.objectContaining({ appliesStatusIds: [], selfAppliesStatusIds: ['recovering'] })
    );

    expect(getSkillDef(VOLT_STRIKE_SKILL_ID)).toEqual(
      expect.objectContaining({ appliesStatusIds: ['stunned'], selfAppliesStatusIds: [] })
    );

    expect(getSkillDef(FINISHING_BLOW_SKILL_ID)).toEqual(
      expect.objectContaining({ appliesStatusIds: ['broken_armor'], selfAppliesStatusIds: [] })
    );
  });
});
