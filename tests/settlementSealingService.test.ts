const prismaMock = {
  character: {
    findChainState: jest.fn(),
  },
  battleOutcomeLedger: {
    listAwaitingFirstSyncForCharacter: jest.fn(),
    rebaseAwaitingFirstSyncBattleNonces: jest.fn(),
    markArchivedLocalOnly: jest.fn(),
    listNextPendingForCharacter: jest.fn(),
  },
  settlementBatch: {
    findNextUnconfirmedForCharacter: jest.fn(),
    createSealed: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

const runanaAccountsMock = {
  fetchCharacterSettlementBatchCursorAccount: jest.fn(),
  fetchProgramConfigAccount: jest.fn(),
  fetchSeasonPolicyAccount: jest.fn(),
  accountStateHashHex: jest.fn(() => '11'.repeat(32)),
};

jest.mock('../lib/solana/runanaAccounts', () => runanaAccountsMock);

jest.mock('../lib/solana/runanaSettlementEnvelope', () => ({
  loadSettlementInstructionAccountEnvelope: jest.fn(),
}));

jest.mock('../lib/solana/settlementBatchValidation', () => ({
  buildSettlementValidationContext: jest.fn(() => ({ ok: true })),
  dryRunApplyBattleSettlementBatchV1: jest.fn(() => ({ ok: true })),
}));

import { Keypair } from '@solana/web3.js';

import { loadSettlementInstructionAccountEnvelope } from '../lib/solana/runanaSettlementEnvelope';
import { loadOrSealNextSettlementBatchForCharacter } from '../lib/solana/settlementSealingService';

function buildBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    characterId: 'character-1',
    batchId: 1,
    startNonce: 1,
    endNonce: 2,
    battleCount: 2,
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_120,
    seasonId: 4,
    startStateHash: '11'.repeat(32),
    endStateHash: '22'.repeat(32),
    zoneProgressDelta: [{ zoneId: 1, newState: 2 }],
    encounterHistogram: [{ zoneId: 1, enemyArchetypeId: 100, count: 2 }],
    optionalLoadoutRevision: null,
    batchHash: '33'.repeat(32),
    schemaVersion: 2,
    signatureScheme: 1,
    status: 'SEALED',
    failureCategory: null,
    failureCode: null,
    latestMessageSha256Hex: null,
    latestSignedTxSha256Hex: null,
    latestTransactionSignature: null,
    preparedAt: null,
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
    createdAt: new Date('2026-04-04T00:00:00.000Z'),
    updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    ...overrides,
  };
}

describe('loadOrSealNextSettlementBatchForCharacter', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: Keypair.generate().publicKey.toBase58(),
      chainCharacterIdHex: '00112233445566778899aabbccddeeff',
      characterRootPubkey: Keypair.generate().publicKey.toBase58(),
      chainCreationStatus: 'CONFIRMED',
      chainCreationTxSignature: 'sig-1',
      chainCreatedAt: new Date('2026-04-04T00:00:00.000Z'),
      chainCreationTs: 1_700_000_000,
      chainCreationSeasonId: 4,
      lastReconciledEndNonce: 0,
      lastReconciledStateHash: '00'.repeat(32),
      lastReconciledBatchId: 0,
      lastReconciledBattleTs: 1_700_000_000,
      lastReconciledSeasonId: 4,
      lastReconciledAt: new Date('2026-04-04T00:00:00.000Z'),
    });
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildBatch());
    prismaMock.battleOutcomeLedger.listAwaitingFirstSyncForCharacter.mockResolvedValue([
      {
        id: 'ledger-1',
        characterId: 'character-1',
        battleId: 'battle-1',
        localSequence: 1,
        battleNonce: null,
        battleTs: 1_700_000_100,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [{ zoneId: 1, newState: 2 }],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
      {
        id: 'ledger-2',
        characterId: 'character-1',
        battleId: 'battle-2',
        localSequence: 2,
        battleNonce: null,
        battleTs: 1_700_000_120,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [{ zoneId: 1, newState: 2 }],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
    ]);
    prismaMock.battleOutcomeLedger.markArchivedLocalOnly.mockResolvedValue([]);
    prismaMock.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces.mockResolvedValue([
      {
        id: 'ledger-1',
        characterId: 'character-1',
        battleId: 'battle-1',
        localSequence: 1,
        battleNonce: 1,
        battleTs: 1_700_000_100,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [{ zoneId: 1, newState: 2 }],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
      {
        id: 'ledger-2',
        characterId: 'character-1',
        battleId: 'battle-2',
        localSequence: 2,
        battleNonce: 2,
        battleTs: 1_700_000_120,
        seasonId: 4,
        zoneId: 1,
        enemyArchetypeId: 100,
        zoneProgressDelta: [{ zoneId: 1, newState: 2 }],
        settlementStatus: 'AWAITING_FIRST_SYNC',
        sealedBatchId: null,
        committedAt: null,
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
    ]);
    prismaMock.settlementBatch.createSealed.mockResolvedValue(buildBatch());
    prismaMock.battleOutcomeLedger.listNextPendingForCharacter.mockResolvedValue([]);

    runanaAccountsMock.fetchProgramConfigAccount.mockResolvedValue({
      maxBattlesPerBatch: 8,
      maxHistogramEntriesPerBatch: 8,
    });
    runanaAccountsMock.fetchSeasonPolicyAccount.mockResolvedValue({
      commitGraceEndTs: BigInt(1_800_000_000),
    });
    (loadSettlementInstructionAccountEnvelope as jest.Mock).mockResolvedValue({
      programConfig: {
        trustedServerSigner: Keypair.generate().publicKey,
      },
      characterRoot: { pubkey: Keypair.generate().publicKey },
      characterBatchCursor: {
        lastCommittedEndNonce: 0n,
        lastCommittedBatchId: 0n,
        lastCommittedStateHash: Buffer.from('00'.repeat(32), 'hex'),
        lastCommittedBattleTs: 1_700_000_000n,
        lastCommittedSeasonId: 4,
      },
    });
  });

  it('rebases awaiting-first-sync backlog into the normal settlement pipeline after character creation confirms', async () => {
    const connection = {
      getSlot: jest.fn(async () => 99),
    };

    const result = await loadOrSealNextSettlementBatchForCharacter('character-1', {
      connection: connection as never,
      now: () => new Date('2026-04-04T00:05:00.000Z'),
      programId: Keypair.generate().publicKey,
    });

    expect(
      prismaMock.battleOutcomeLedger.rebaseAwaitingFirstSyncBattleNonces,
    ).toHaveBeenCalledWith('character-1', [
      { id: 'ledger-1', battleNonce: 1 },
      { id: 'ledger-2', battleNonce: 2 },
    ]);
    expect(prismaMock.settlementBatch.createSealed).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'character-1',
        batchId: 1,
        startNonce: 1,
        endNonce: 2,
        sealedBattleIds: ['ledger-1', 'ledger-2'],
      }),
    );
    expect(result.batch.batchId).toBe(1);
    expect(result.wasExistingBatch).toBe(false);
  });
});
