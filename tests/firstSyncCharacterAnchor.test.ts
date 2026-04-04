const prismaMock = {
  character: {
    findBattleReadyById: jest.fn(),
  },
  characterProvisionalProgress: {
    findByCharacterId: jest.fn(),
  },
  battleOutcomeLedger: {
    findEarliestForCharacter: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

import { prepareFirstSyncCharacterAnchor } from '../lib/solana/firstSyncCharacterAnchor';

describe('prepareFirstSyncCharacterAnchor', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.character.findBattleReadyById.mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
      name: 'Rookie',
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
      playerAuthorityPubkey: null,
      chainCharacterIdHex: null,
      characterRootPubkey: null,
      chainCreationStatus: 'NOT_STARTED',
      chainCreationSeasonId: null,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      activeSkills: ['1001', '1002'],
      passiveSkills: ['2001', '2002'],
    });
    prismaMock.characterProvisionalProgress.findByCharacterId.mockResolvedValue({
      id: 'progress-1',
      characterId: 'character-1',
      highestUnlockedZoneId: 3,
      highestClearedZoneId: 2,
      zoneStates: { '1': 2, '2': 2, '3': 1 },
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    });
    prismaMock.battleOutcomeLedger.findEarliestForCharacter.mockResolvedValue({
      seasonId: 4,
    });
  });

  it('anchors first sync to the local character origin time and earliest backlog season', async () => {
    const result = await prepareFirstSyncCharacterAnchor({
      characterId: 'character-1',
      authority: 'authority-pubkey',
      env: { NODE_ENV: 'test' },
    });

    expect(result).toEqual({
      characterId: 'character-1',
      authority: 'authority-pubkey',
      feePayer: 'authority-pubkey',
      characterCreationTs: 1_775_037_600,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    });
  });

  it('falls back to the configured active season when the backlog is empty', async () => {
    prismaMock.battleOutcomeLedger.findEarliestForCharacter.mockResolvedValue(null);

    const result = await prepareFirstSyncCharacterAnchor({
      characterId: 'character-1',
      authority: 'authority-pubkey',
      feePayer: 'payer-pubkey',
      env: {
        NODE_ENV: 'test',
        RUNANA_ACTIVE_SEASON_ID: '7',
      },
    });

    expect(result.seasonIdAtCreation).toBe(7);
    expect(result.feePayer).toBe('payer-pubkey');
  });

  it('rejects already confirmed characters', async () => {
    prismaMock.character.findBattleReadyById.mockResolvedValue({
      id: 'character-1',
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      chainCreationStatus: 'CONFIRMED',
    });

    await expect(
      prepareFirstSyncCharacterAnchor({
        characterId: 'character-1',
        authority: 'authority-pubkey',
      }),
    ).rejects.toThrow(/ERR_CHARACTER_ALREADY_CONFIRMED/);
  });
});
