const prismaMock = {
  character: {
    findChainState: jest.fn(),
    updateChainIdentity: jest.fn(),
  },
  battleOutcomeLedger: {
    listAwaitingFirstSyncForCharacter: jest.fn(),
    markArchivedLocalOnly: jest.fn(),
    rebaseAwaitingFirstSyncBattleNonces: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

jest.mock('../lib/solana/firstSyncCharacterAnchor', () => ({
  prepareFirstSyncCharacterAnchor: jest.fn(),
}));

jest.mock('../lib/solana/runanaAccounts', () => ({
  fetchProgramConfigAccount: jest.fn(),
  fetchSeasonPolicyAccount: jest.fn(),
}));

import { PublicKey } from '@solana/web3.js';

import { prepareFirstSyncCharacterAnchor } from '../lib/solana/firstSyncCharacterAnchor';
import {
  fetchProgramConfigAccount,
  fetchSeasonPolicyAccount,
} from '../lib/solana/runanaAccounts';
import { prepareFirstSyncRebase } from '../lib/solana/firstSyncRebasing';

describe('prepareFirstSyncRebase', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (prepareFirstSyncCharacterAnchor as jest.Mock).mockResolvedValue({
      characterId: 'character-1',
      authority: new PublicKey('11111111111111111111111111111111').toBase58(),
      feePayer: new PublicKey('11111111111111111111111111111111').toBase58(),
      characterCreationTs: 1_775_037_600,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    });
    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: null,
      chainCharacterIdHex: null,
      characterRootPubkey: null,
      chainCreationStatus: 'NOT_STARTED',
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.character.updateChainIdentity.mockResolvedValue({});
    (fetchProgramConfigAccount as jest.Mock).mockResolvedValue({
      maxBattlesPerBatch: 8,
      maxHistogramEntriesPerBatch: 8,
    });
    prismaMock.battleOutcomeLedger.listAwaitingFirstSyncForCharacter.mockResolvedValue([
      {
        id: 'battle-1',
        characterId: 'character-1',
        battleId: 'battle-id-1',
        localSequence: 1,
        battleNonce: null,
        battleTs: 1_775_037_660,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [{ zoneId: 1, newState: 2 }, { zoneId: 2, newState: 1 }],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-01T10:01:00.000Z'),
        updatedAt: new Date('2026-04-01T10:01:00.000Z'),
      },
      {
        id: 'battle-2',
        characterId: 'character-1',
        battleId: 'battle-id-2',
        localSequence: 2,
        battleNonce: null,
        battleTs: 1_775_037_720,
        seasonId: 3,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-01T10:02:00.000Z'),
        updatedAt: new Date('2026-04-01T10:02:00.000Z'),
      },
    ]);
    (fetchSeasonPolicyAccount as jest.Mock).mockImplementation(
      async (_connection, _pda, _commitment) => ({
        seasonId: 4,
        commitGraceEndTs: BigInt(4_200_000_000),
      }),
    );
    prismaMock.battleOutcomeLedger.markArchivedLocalOnly.mockResolvedValue([]);
    prismaMock.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces.mockImplementation(
      async (_characterId, assignments) =>
        assignments.map((assignment: { id: string; battleNonce: number }) => ({
          id: assignment.id,
          characterId: 'character-1',
          battleId: `${assignment.id}-ledger`,
          localSequence: assignment.battleNonce,
          battleNonce: assignment.battleNonce,
          battleTs: 1_775_037_660,
          seasonId: 4,
          zoneId: 1,
          enemyArchetypeId: 100,
          zoneProgressDelta: [{ zoneId: 1, newState: 2 }, { zoneId: 2, newState: 1 }],
          settlementStatus: 'AWAITING_FIRST_SYNC',
          sealedBatchId: null,
          committedAt: null,
          createdAt: new Date('2026-04-01T10:01:00.000Z'),
          updatedAt: new Date('2026-04-01T10:01:00.000Z'),
        })),
    );
  });

  it('reserves identity, archives stale backlog, and rebases remaining battles', async () => {
    (fetchSeasonPolicyAccount as jest.Mock)
      .mockResolvedValueOnce({
        seasonId: 4,
        commitGraceEndTs: BigInt(4_200_000_000),
      })
      .mockResolvedValueOnce({
        seasonId: 3,
        commitGraceEndTs: BigInt(1_700_000_000),
      });

    const authority = new PublicKey('11111111111111111111111111111111').toBase58();
    const result = await prepareFirstSyncRebase(
      {
        characterId: 'character-1',
        authority,
        env: { NODE_ENV: 'test' },
      },
      {
        now: () => new Date('2026-04-04T12:00:00.000Z'),
        generateCharacterIdHex: () => '22'.repeat(16),
      },
    );

    expect(prismaMock.character.updateChainIdentity).toHaveBeenCalledWith(
      'character-1',
      expect.objectContaining({
        playerAuthorityPubkey: authority,
        chainCharacterIdHex: '22'.repeat(16),
        chainCreationStatus: 'PENDING',
        chainCreationTs: 1_775_037_600,
        chainCreationSeasonId: 4,
      }),
    );
    expect(prismaMock.battleOutcomeLedger.markArchivedLocalOnly).toHaveBeenCalledWith(['battle-2']);
    expect(prismaMock.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces).toHaveBeenCalledWith(
      'character-1',
      [{ id: 'battle-1', battleNonce: 1 }],
    );
    expect(result.archivedBattleIds).toEqual(['battle-2']);
    expect(result.rebasedBattles[0]?.battleNonce).toBe(1);
    expect(result.genesisCursor.lastCommittedBattleTs).toBe(1_775_037_600);
    expect(result.batchDrafts).toHaveLength(1);
  });

  it('reuses a previously reserved identity for the same authority', async () => {
    const authority = new PublicKey('11111111111111111111111111111111').toBase58();
    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: authority,
      chainCharacterIdHex: '33'.repeat(16),
      characterRootPubkey: new PublicKey('11111111111111111111111111111111').toBase58(),
      chainCreationStatus: 'PENDING',
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: 1_775_037_600,
      chainCreationSeasonId: 4,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.battleOutcomeLedger.listAwaitingFirstSyncForCharacter.mockResolvedValue([
      {
        id: 'battle-1',
        characterId: 'character-1',
        battleId: 'battle-id-1',
        localSequence: 1,
        battleNonce: null,
        battleTs: 1_775_037_660,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-01T10:01:00.000Z'),
        updatedAt: new Date('2026-04-01T10:01:00.000Z'),
      },
    ]);

    const result = await prepareFirstSyncRebase(
      {
        characterId: 'character-1',
        authority,
        env: { NODE_ENV: 'test' },
      },
      {
        now: () => new Date('2026-04-04T12:00:00.000Z'),
      },
    );

    expect(result.reservedIdentity.chainCharacterIdHex).toBe('33'.repeat(16));
  });
});
