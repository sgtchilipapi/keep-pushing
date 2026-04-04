import { selectEncounterForZone } from '../lib/combat/encounterSelection';

describe('encounterSelection', () => {
  it('returns the same encounter for the same zone and seed', () => {
    const first = selectEncounterForZone(1, 123456);
    const second = selectEncounterForZone(1, 123456);

    expect(second).toEqual(first);
  });

  it('changes encounter rolls across different seeds while staying within the zone table', () => {
    const first = selectEncounterForZone(2, 101);
    const second = selectEncounterForZone(2, 202);

    expect(first.zoneId).toBe(2);
    expect(second.zoneId).toBe(2);
    expect([101, 102, 103, 104]).toContain(first.enemyArchetypeId);
    expect([101, 102, 103, 104]).toContain(second.enemyArchetypeId);
    expect(first.roll).not.toBe(second.roll);
  });

  it('uses weighted deterministic selection rather than direct caller overrides', () => {
    const result = selectEncounterForZone(1, 1);

    expect(result.totalWeight).toBe(100);
    expect(result.roll).toBe(70);
    expect(result.enemyArchetypeId).toBe(101);
    expect(result.enemyArchetype.displayName).toBe('Razor Hound');
  });

  it('rejects invalid inputs and unknown zones', () => {
    expect(() => selectEncounterForZone(-1, 1)).toThrow(/ERR_INVALID_ZONEID/);
    expect(() => selectEncounterForZone(999, 1)).toThrow(/ERR_UNKNOWN_ZONE_ID/);
    expect(() => selectEncounterForZone(1, 1.5)).toThrow(/ERR_INVALID_SEED/);
  });
});
