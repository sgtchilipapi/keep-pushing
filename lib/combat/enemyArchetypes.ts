import type { CombatantSnapshot } from '../../types/combat';

export interface EnemyArchetypeAiDefaults {
  aggressionBias?: number;
}

export interface EnemyArchetypeDef {
  enemyArchetypeId: number;
  key: string;
  displayName: string;
  expRewardBase: number;
  snapshot: Omit<CombatantSnapshot, 'entityId'>;
  ai?: EnemyArchetypeAiDefaults;
}

const ENEMY_ARCHETYPE_DEFS: EnemyArchetypeDef[] = [
  {
    enemyArchetypeId: 100,
    key: 'scrap-drone',
    displayName: 'Scrap Drone',
    expRewardBase: 25,
    snapshot: {
      side: 'ENEMY',
      name: 'Scrap Drone',
      hp: 880,
      hpMax: 880,
      atk: 92,
      def: 58,
      spd: 112,
      accuracyBP: 8300,
      evadeBP: 1450,
      activeSkillIds: ['1001', '1003'],
      passiveSkillIds: ['2001', '2002'],
    },
    ai: {
      aggressionBias: 58,
    },
  },
  {
    enemyArchetypeId: 101,
    key: 'razor-hound',
    displayName: 'Razor Hound',
    expRewardBase: 28,
    snapshot: {
      side: 'ENEMY',
      name: 'Razor Hound',
      hp: 970,
      hpMax: 970,
      atk: 118,
      def: 62,
      spd: 126,
      accuracyBP: 8600,
      evadeBP: 1650,
      activeSkillIds: ['1003', '1002'],
      passiveSkillIds: ['2001', '2002'],
    },
    ai: {
      aggressionBias: 74,
    },
  },
  {
    enemyArchetypeId: 102,
    key: 'plated-enforcer',
    displayName: 'Plated Enforcer',
    expRewardBase: 32,
    snapshot: {
      side: 'ENEMY',
      name: 'Plated Enforcer',
      hp: 1320,
      hpMax: 1320,
      atk: 122,
      def: 118,
      spd: 82,
      accuracyBP: 8100,
      evadeBP: 900,
      activeSkillIds: ['1002', '1004'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 103,
    key: 'signal-witch',
    displayName: 'Signal Witch',
    expRewardBase: 34,
    snapshot: {
      side: 'ENEMY',
      name: 'Signal Witch',
      hp: 990,
      hpMax: 990,
      atk: 136,
      def: 72,
      spd: 114,
      accuracyBP: 9000,
      evadeBP: 1400,
      activeSkillIds: ['1001', '1005'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 104,
    key: 'nano-leech',
    displayName: 'Nano Leech',
    expRewardBase: 30,
    snapshot: {
      side: 'ENEMY',
      name: 'Nano Leech',
      hp: 860,
      hpMax: 860,
      atk: 102,
      def: 54,
      spd: 138,
      accuracyBP: 8750,
      evadeBP: 1825,
      activeSkillIds: ['1003', '1005'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 105,
    key: 'cloak-stalker',
    displayName: 'Cloak Stalker',
    expRewardBase: 36,
    snapshot: {
      side: 'ENEMY',
      name: 'Cloak Stalker',
      hp: 1060,
      hpMax: 1060,
      atk: 144,
      def: 74,
      spd: 132,
      accuracyBP: 9100,
      evadeBP: 1700,
      activeSkillIds: ['1002', '1003'],
      passiveSkillIds: ['2001', '2002'],
    },
    ai: {
      aggressionBias: 80,
    },
  },
  {
    enemyArchetypeId: 106,
    key: 'overclock-brute',
    displayName: 'Overclock Brute',
    expRewardBase: 40,
    snapshot: {
      side: 'ENEMY',
      name: 'Overclock Brute',
      hp: 1540,
      hpMax: 1540,
      atk: 158,
      def: 102,
      spd: 88,
      accuracyBP: 8450,
      evadeBP: 950,
      activeSkillIds: ['1001', '1002'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 107,
    key: 'ward-turret',
    displayName: 'Ward Turret',
    expRewardBase: 38,
    snapshot: {
      side: 'ENEMY',
      name: 'Ward Turret',
      hp: 1480,
      hpMax: 1480,
      atk: 128,
      def: 136,
      spd: 72,
      accuracyBP: 8200,
      evadeBP: 700,
      activeSkillIds: ['1004', '1005'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 108,
    key: 'protocol-knight',
    displayName: 'Protocol Knight',
    expRewardBase: 44,
    snapshot: {
      side: 'ENEMY',
      name: 'Protocol Knight',
      hp: 1620,
      hpMax: 1620,
      atk: 166,
      def: 124,
      spd: 98,
      accuracyBP: 8800,
      evadeBP: 1100,
      activeSkillIds: ['1002', '1004'],
      passiveSkillIds: ['2001', '2002'],
    },
  },
  {
    enemyArchetypeId: 109,
    key: 'overseer-unit',
    displayName: 'Overseer Unit',
    expRewardBase: 50,
    snapshot: {
      side: 'ENEMY',
      name: 'Overseer Unit',
      hp: 1760,
      hpMax: 1760,
      atk: 172,
      def: 138,
      spd: 118,
      accuracyBP: 9200,
      evadeBP: 1250,
      activeSkillIds: ['1001', '1002'],
      passiveSkillIds: ['2001', '2002'],
    },
    ai: {
      aggressionBias: 85,
    },
  },
];

function cloneSnapshot(snapshot: EnemyArchetypeDef['snapshot']): EnemyArchetypeDef['snapshot'] {
  return {
    ...snapshot,
    activeSkillIds: [...snapshot.activeSkillIds] as [string, string],
    passiveSkillIds: snapshot.passiveSkillIds
      ? ([...snapshot.passiveSkillIds] as [string, string])
      : undefined,
  };
}

function assertCatalogIntegrity(defs: EnemyArchetypeDef[]): void {
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();

  for (const def of defs) {
    if (!Number.isInteger(def.enemyArchetypeId) || def.enemyArchetypeId < 100) {
      throw new Error('ERR_INVALID_ENEMY_ARCHETYPE_ID: archetype ids must be integers >= 100');
    }
    if (seenIds.has(def.enemyArchetypeId)) {
      throw new Error(`ERR_DUPLICATE_ENEMY_ARCHETYPE_ID: ${def.enemyArchetypeId}`);
    }
    if (seenKeys.has(def.key)) {
      throw new Error(`ERR_DUPLICATE_ENEMY_ARCHETYPE_KEY: ${def.key}`);
    }
    if (def.snapshot.activeSkillIds.length !== 2) {
      throw new Error(
        `ERR_INVALID_ENEMY_ARCHETYPE_LOADOUT: ${def.displayName} must have exactly 2 active skills`,
      );
    }
    if (def.snapshot.passiveSkillIds !== undefined && def.snapshot.passiveSkillIds.length !== 2) {
      throw new Error(
        `ERR_INVALID_ENEMY_ARCHETYPE_PASSIVES: ${def.displayName} must have exactly 2 passives when present`,
      );
    }

    seenIds.add(def.enemyArchetypeId);
    seenKeys.add(def.key);
  }
}

assertCatalogIntegrity(ENEMY_ARCHETYPE_DEFS);

const ENEMY_ARCHETYPE_BY_ID = new Map(
  ENEMY_ARCHETYPE_DEFS.map((def) => [def.enemyArchetypeId, def] as const),
);

export function listEnemyArchetypeDefs(): EnemyArchetypeDef[] {
  return ENEMY_ARCHETYPE_DEFS.map((def) => ({
    ...def,
    snapshot: cloneSnapshot(def.snapshot),
  }));
}

export function getEnemyArchetypeDef(enemyArchetypeId: number): EnemyArchetypeDef {
  const def = ENEMY_ARCHETYPE_BY_ID.get(enemyArchetypeId);
  if (def === undefined) {
    throw new Error(`ERR_UNKNOWN_ENEMY_ARCHETYPE_ID: ${enemyArchetypeId}`);
  }

  return {
    ...def,
    snapshot: cloneSnapshot(def.snapshot),
  };
}

