const prismaMock = {
  character: {
    findBattleReadyById: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

import {
  buildEnemyCombatSnapshot,
  buildPlayerCombatSnapshot,
  loadCharacterBattleReadyRecord,
} from '../lib/combat/combatSnapshotAssembly';
import { getEnemyArchetypeDef } from '../lib/combat/enemyArchetypes';

describe('combatSnapshotAssembly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads a persisted battle-ready character from prisma', async () => {
    prismaMock.character.findBattleReadyById.mockResolvedValue({ id: 'character-1' });

    await expect(loadCharacterBattleReadyRecord('character-1')).resolves.toEqual({ id: 'character-1' });
    expect(prismaMock.character.findBattleReadyById).toHaveBeenCalledWith('character-1');
  });

  it('maps a persisted player character into a CombatantSnapshot', () => {
    const snapshot = buildPlayerCombatSnapshot({
      id: 'character-1',
      userId: 'user-1',
      name: 'Rookie',
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: 'authority',
      chainCharacterIdHex: '11'.repeat(16),
      characterRootPubkey: 'root',
      chainCreationStatus: 'CONFIRMED',
      chainCreationSeasonId: 1,
      lastReconciledEndNonce: 0,
      lastReconciledStateHash: '22'.repeat(32),
      lastReconciledBatchId: 0,
      lastReconciledBattleTs: 0,
      lastReconciledSeasonId: 1,
      activeSkills: ['1001', '1002'],
      passiveSkills: ['2001', '2002'],
    });

    expect(snapshot).toEqual({
      entityId: 'character-1',
      side: 'PLAYER',
      name: 'Rookie',
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      activeSkillIds: ['1001', '1002'],
      passiveSkillIds: ['2001', '2002'],
    });
  });

  it('maps an enemy archetype into a CombatantSnapshot', () => {
    const snapshot = buildEnemyCombatSnapshot(getEnemyArchetypeDef(100));

    expect(snapshot).toMatchObject({
      entityId: '100',
      side: 'ENEMY',
      name: 'Scrap Drone',
      activeSkillIds: ['1001', '1003'],
      passiveSkillIds: ['2001', '2002'],
    });
  });

  it('rejects malformed player loadouts', () => {
    expect(() =>
      buildPlayerCombatSnapshot({
        id: 'character-1',
        userId: 'user-1',
        name: 'Rookie',
        hp: 1200,
        hpMax: 1200,
        atk: 120,
        def: 70,
        spd: 100,
        accuracyBP: 8000,
        evadeBP: 1200,
        playerAuthorityPubkey: 'authority',
        chainCharacterIdHex: '11'.repeat(16),
        characterRootPubkey: 'root',
        chainCreationStatus: 'CONFIRMED',
        chainCreationSeasonId: 1,
        lastReconciledEndNonce: 0,
        lastReconciledStateHash: '22'.repeat(32),
        lastReconciledBatchId: 0,
        lastReconciledBattleTs: 0,
        lastReconciledSeasonId: 1,
        activeSkills: ['1001'],
        passiveSkills: ['2001', '2002'],
      }),
    ).toThrow(/ERR_INVALID_ACTIVESKILLS/);
  });
});
