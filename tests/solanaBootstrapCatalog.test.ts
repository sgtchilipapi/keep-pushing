import {
  listSharedBootstrapClassRegistries,
  listSharedBootstrapEnemyArchetypes,
  listSharedBootstrapZoneEnemySets,
  listSharedBootstrapZoneRegistries,
  mergeZoneRegistryDefaults,
} from '../lib/combat/solanaBootstrapCatalog';

describe('solanaBootstrapCatalog', () => {
  it('derives enemy archetype bootstrap rows from the shared encounter catalog', () => {
    expect(listSharedBootstrapEnemyArchetypes()).toEqual([
      { enemyArchetypeId: 100, expRewardBase: 25 },
      { enemyArchetypeId: 101, expRewardBase: 28 },
      { enemyArchetypeId: 102, expRewardBase: 32 },
      { enemyArchetypeId: 103, expRewardBase: 34 },
      { enemyArchetypeId: 104, expRewardBase: 30 },
      { enemyArchetypeId: 105, expRewardBase: 36 },
      { enemyArchetypeId: 106, expRewardBase: 40 },
      { enemyArchetypeId: 107, expRewardBase: 38 },
      { enemyArchetypeId: 108, expRewardBase: 44 },
      { enemyArchetypeId: 109, expRewardBase: 50 },
    ]);
  });

  it('derives zone enemy legality sets from the shared encounter tables', () => {
    expect(listSharedBootstrapZoneEnemySets()).toEqual([
      {
        zoneId: 1,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 100, maxPerRun: 3 },
          { enemyArchetypeId: 101, maxPerRun: 2 },
          { enemyArchetypeId: 104, maxPerRun: 1 },
        ],
      },
      {
        zoneId: 2,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 101, maxPerRun: 2 },
          { enemyArchetypeId: 102, maxPerRun: 2 },
          { enemyArchetypeId: 103, maxPerRun: 1 },
          { enemyArchetypeId: 104, maxPerRun: 1 },
        ],
      },
      {
        zoneId: 3,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 102, maxPerRun: 2 },
          { enemyArchetypeId: 103, maxPerRun: 2 },
          { enemyArchetypeId: 105, maxPerRun: 2 },
          { enemyArchetypeId: 107, maxPerRun: 1 },
        ],
      },
      {
        zoneId: 4,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 103, maxPerRun: 2 },
          { enemyArchetypeId: 105, maxPerRun: 2 },
          { enemyArchetypeId: 106, maxPerRun: 2 },
          { enemyArchetypeId: 107, maxPerRun: 1 },
        ],
      },
      {
        zoneId: 5,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 104, maxPerRun: 1 },
          { enemyArchetypeId: 106, maxPerRun: 2 },
          { enemyArchetypeId: 108, maxPerRun: 2 },
          { enemyArchetypeId: 109, maxPerRun: 2 },
        ],
      },
    ]);
  });

  it('merges explicit zone registry overrides onto shared zone defaults', () => {
    expect(
      mergeZoneRegistryDefaults([
        {
          zoneId: 3,
          topologyVersion: 1,
          totalSubnodeCount: 8,
          topologyHash: 'aa'.repeat(32),
          expMultiplierNum: 3,
          expMultiplierDen: 2,
        },
      ]),
    ).toEqual([
      expect.objectContaining({ zoneId: 1, topologyVersion: 1, expMultiplierNum: 1, expMultiplierDen: 1 }),
      expect.objectContaining({ zoneId: 2, topologyVersion: 1, expMultiplierNum: 1, expMultiplierDen: 1 }),
      {
        zoneId: 3,
        topologyVersion: 1,
        totalSubnodeCount: 8,
        topologyHash: 'aa'.repeat(32),
        expMultiplierNum: 3,
        expMultiplierDen: 2,
      },
      expect.objectContaining({ zoneId: 4, topologyVersion: 1, expMultiplierNum: 1, expMultiplierDen: 1 }),
      expect.objectContaining({ zoneId: 5, topologyVersion: 1, expMultiplierNum: 1, expMultiplierDen: 1 }),
    ]);
    expect(listSharedBootstrapZoneRegistries()).toHaveLength(5);
  });

  it('derives enabled class registry rows from the shared class catalog', () => {
    expect(listSharedBootstrapClassRegistries()).toEqual([
      { classId: 'soldier', compactId: 1, enabled: true },
      { classId: 'scout', compactId: 2, enabled: true },
      { classId: 'warden', compactId: 3, enabled: true },
    ]);
  });
});
