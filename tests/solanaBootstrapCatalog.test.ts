import {
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
      { zoneId: 1, allowedEnemyArchetypeIds: [100, 101, 104] },
      { zoneId: 2, allowedEnemyArchetypeIds: [101, 102, 103, 104] },
      { zoneId: 3, allowedEnemyArchetypeIds: [102, 103, 105, 107] },
      { zoneId: 4, allowedEnemyArchetypeIds: [103, 105, 106, 107] },
      { zoneId: 5, allowedEnemyArchetypeIds: [104, 106, 108, 109] },
    ]);
  });

  it('merges explicit zone registry overrides onto shared zone defaults', () => {
    expect(
      mergeZoneRegistryDefaults([
        {
          zoneId: 3,
          expMultiplierNum: 3,
          expMultiplierDen: 2,
        },
      ]),
    ).toEqual([
      { zoneId: 1, expMultiplierNum: 1, expMultiplierDen: 1 },
      { zoneId: 2, expMultiplierNum: 1, expMultiplierDen: 1 },
      { zoneId: 3, expMultiplierNum: 3, expMultiplierDen: 2 },
      { zoneId: 4, expMultiplierNum: 1, expMultiplierDen: 1 },
      { zoneId: 5, expMultiplierNum: 1, expMultiplierDen: 1 },
    ]);
    expect(listSharedBootstrapZoneRegistries()).toHaveLength(5);
  });
});
