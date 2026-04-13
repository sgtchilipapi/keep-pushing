import {
  Ed25519Program,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

jest.mock('../lib/solana/firstSyncRebasing', () => ({
  prepareFirstSyncRebase: jest.fn(),
}));

jest.mock('../lib/solana/firstSyncCharacterAnchor', () => ({
  prepareFirstSyncCharacterAnchor: jest.fn(),
}));

const prismaMock = {
  character: {
    findChainState: jest.fn(),
    updateChainIdentity: jest.fn(),
    updateCursorSnapshot: jest.fn(),
  },
  settlementBatch: {
    findNextUnconfirmedForCharacter: jest.fn(),
    findByCharacterAndBatchId: jest.fn(),
    createSealed: jest.fn(),
    updateStatus: jest.fn(),
  },
  battleOutcomeLedger: {
    markCommittedForBatch: jest.fn(),
  },
  settlementSubmissionAttempt: {
    create: jest.fn(),
    listByBatch: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

jest.mock('../lib/solana/runanaAccounts', () => ({
  fetchProgramConfigAccount: jest.fn(),
  fetchCharacterRootAccount: jest.fn(),
  fetchCharacterSettlementBatchCursorAccount: jest.fn(),
  accountCharacterIdHex: jest.fn(),
  accountStateHashHex: jest.fn(),
}));

import {
  prepareSolanaFirstSync,
  submitSolanaFirstSync,
} from '../lib/solana/firstSyncRelay';
import { prepareFirstSyncCharacterAnchor } from '../lib/solana/firstSyncCharacterAnchor';
import { prepareFirstSyncRebase } from '../lib/solana/firstSyncRebasing';
import {
  accountCharacterIdHex,
  accountStateHashHex,
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
} from '../lib/solana/runanaAccounts';
import { prepareFirstSyncTransaction } from '../lib/solana/playerOwnedTransactions';
import {
  RUNANA_PROGRAM_ID,
  computeAnchorInstructionDiscriminator,
  computeGenesisStateHashHex,
} from '../lib/solana/runanaProgram';

const prepareFirstSyncRebaseMock = jest.mocked(prepareFirstSyncRebase);
const prepareFirstSyncCharacterAnchorMock = jest.mocked(prepareFirstSyncCharacterAnchor);
const fetchProgramConfigAccountMock = jest.mocked(fetchProgramConfigAccount);
const fetchCharacterRootAccountMock = jest.mocked(fetchCharacterRootAccount);
const fetchCharacterSettlementBatchCursorAccountMock = jest.mocked(
  fetchCharacterSettlementBatchCursorAccount,
);
const accountCharacterIdHexMock = jest.mocked(accountCharacterIdHex);
const accountStateHashHexMock = jest.mocked(accountStateHashHex);

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function buildPreparedRebase(authority: string, batchCount = 1) {
  const chainCharacterIdHex = '11'.repeat(16);
  const characterRootPubkey = Keypair.generate().publicKey.toBase58();

  return {
    anchor: {
      characterId: 'character-1',
      authority,
      feePayer: authority,
      name: 'Rookie',
      classId: 'soldier',
      characterCreationTs: 1_700_000_000,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    },
    reservedIdentity: {
      playerAuthorityPubkey: authority,
      chainCharacterIdHex,
      characterRootPubkey,
      chainCreationStatus: 'PENDING' as const,
    },
    genesisCursor: {
      lastCommittedEndNonce: 0,
      lastCommittedBatchId: 0,
      lastCommittedStateHash: '22'.repeat(32),
      lastCommittedBattleTs: 1_700_000_000,
      lastCommittedSeasonId: 4,
    },
    archivedBattleIds: [],
    rebasedBattles: [],
    batchDrafts: Array.from({ length: batchCount }, (_, index) => {
      const batchId = index + 1;
      const startNonce = index * 2 + 1;
      const endNonce = startNonce + 1;

      return {
        payload: {
          characterId: chainCharacterIdHex,
          batchId,
          startRunSequence: batchId,
          endRunSequence: batchId,
          runSummaries: [
            {
              closedRunSequence: batchId,
              zoneId: 1 + index,
              topologyVersion: 1,
              topologyHash: `${44 + index}`.repeat(32),
              terminalStatus: 'COMPLETED' as const,
              rewardedBattleCount: 2,
              rewardedEncounterHistogram: [{ enemyArchetypeId: 101 + index, count: 2 }],
              zoneProgressDelta: [{ zoneId: 1 + index, newState: 2 as const }],
              firstRewardedBattleTs: 1_700_000_010 + index * 40,
              lastRewardedBattleTs: 1_700_000_040 + index * 40,
            },
          ],
          startNonce,
          endNonce,
          battleCount: 2,
          startStateHash: index === 0 ? '22'.repeat(32) : '33'.repeat(32),
          endStateHash: index === 0 ? '33'.repeat(32) : '55'.repeat(32),
          zoneProgressDelta: [{ zoneId: 1 + index, newState: 2 as const }],
          encounterHistogram: [{ zoneId: 1 + index, enemyArchetypeId: 101 + index, count: 2 }],
          optionalLoadoutRevision: undefined,
          batchHash: index === 0 ? '44'.repeat(32) : '66'.repeat(32),
          firstBattleTs: 1_700_000_010 + index * 40,
          lastBattleTs: 1_700_000_040 + index * 40,
          seasonId: 4,
          schemaVersion: 2 as const,
          signatureScheme: 1 as const,
        },
        sealedBattleIds: [`battle-${startNonce}`, `battle-${endNonce}`],
      };
    }),
  };
}

function buildPersistedBatch(
  rebased: ReturnType<typeof buildPreparedRebase>,
  batchIndex = 0,
) {
  const draft = rebased.batchDrafts[batchIndex]!;

  return {
    id: `settlement-batch-${batchIndex + 1}`,
    characterId: rebased.anchor.characterId,
    batchId: draft.payload.batchId,
    startRunSequence: draft.payload.startRunSequence,
    endRunSequence: draft.payload.endRunSequence,
    runSummaries: draft.payload.runSummaries,
    startNonce: draft.payload.startNonce,
    endNonce: draft.payload.endNonce,
    battleCount: draft.payload.battleCount,
    firstBattleTs: draft.payload.firstBattleTs,
    lastBattleTs: draft.payload.lastBattleTs,
    seasonId: draft.payload.seasonId,
    startStateHash: draft.payload.startStateHash,
    endStateHash: draft.payload.endStateHash,
    zoneProgressDelta: draft.payload.zoneProgressDelta,
    encounterHistogram: draft.payload.encounterHistogram,
    optionalLoadoutRevision: null,
    batchHash: draft.payload.batchHash,
    schemaVersion: 2 as const,
    signatureScheme: 1 as const,
    status: 'SEALED' as const,
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
  };
}

describe('firstSyncRelay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountStateHashHexMock.mockImplementation((value) => Buffer.from(value).toString('hex'));
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(null);
    prepareFirstSyncCharacterAnchorMock.mockResolvedValue({
      characterId: 'character-1',
      authority: '',
      feePayer: '',
      name: 'Rookie',
      classId: 'soldier',
      characterCreationTs: 1_700_000_000,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    });
  });

  it('returns the player authorization message before transaction assembly', async () => {
    const authority = Keypair.generate();
    const serverSigner = Keypair.generate();
    const buildPreparedTransaction = jest.fn(async () => ({
      serializedMessageBase64: Buffer.from('message').toString('base64'),
      serializedTransactionBase64: Buffer.from('transaction').toString('base64'),
      recentBlockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 88,
    }));
    prepareFirstSyncRebaseMock.mockResolvedValue(buildPreparedRebase(authority.publicKey.toBase58()));
    fetchProgramConfigAccountMock.mockResolvedValue({
      trustedServerSigner: serverSigner.publicKey,
      settlementAuthorizationMode: 0,
    } as Awaited<ReturnType<typeof fetchProgramConfigAccount>>);

    const result = await prepareSolanaFirstSync(
      {
        characterId: 'character-1',
        authority: authority.publicKey.toBase58(),
      },
      {
        connection: {
          getLatestBlockhash: jest.fn().mockResolvedValue({
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 88,
          }),
          getAccountInfo: jest.fn(),
        },
        serverSigner,
        addressLookupTableAccounts: [],
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
        buildPreparedTransaction: buildPreparedTransaction as never,
      },
    );

    expect(result.phase).toBe('sign_transaction');
    expect(result.expectedCursor.lastCommittedEndNonce).toBe(0);
    expect(result.permitDomain.playerAuthority).toBe(authority.publicKey.toBase58());
    expect(result.payload.signatureScheme).toBe(1);
    expect(result.playerAuthorizationMessageUtf8).toBe('');
    expect(result.playerAuthorizationMessageBase64).toBe('');
    expect(buildPreparedTransaction).toHaveBeenCalledTimes(1);
  });

  it('assembles create-plus-settle instructions in the required order', async () => {
    const authority = Keypair.generate();
    const serverSigner = Keypair.generate();
    const preparedRebase = buildPreparedRebase(authority.publicKey.toBase58());
    const buildPreparedTransaction = jest.fn(async (args: {
      instructions: Array<{ programId: PublicKey; data: Buffer }>;
    }) => {
      const instructionProgramIds = args.instructions.map((instruction) =>
        instruction.programId.toBase58(),
      );
      const instructionDiscriminators = args.instructions
        .filter((instruction) => instruction.programId.equals(RUNANA_PROGRAM_ID))
        .map((instruction) => Buffer.from(instruction.data).subarray(0, 8).toString('hex'));

      expect(instructionProgramIds).toEqual([
        RUNANA_PROGRAM_ID.toBase58(),
        Ed25519Program.programId.toBase58(),
        RUNANA_PROGRAM_ID.toBase58(),
      ]);
      expect(instructionDiscriminators).toEqual([
        Buffer.from(computeAnchorInstructionDiscriminator('create_character')).toString('hex'),
        Buffer.from(
          computeAnchorInstructionDiscriminator('apply_battle_settlement_batch_v1'),
        ).toString('hex'),
      ]);

      return {
        serializedMessageBase64: Buffer.from('message').toString('base64'),
        serializedTransactionBase64: Buffer.from('transaction').toString('base64'),
        recentBlockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 88,
      };
    });

    prepareFirstSyncRebaseMock.mockResolvedValue(preparedRebase);
    fetchProgramConfigAccountMock.mockResolvedValue({
      trustedServerSigner: serverSigner.publicKey,
      settlementAuthorizationMode: 0,
    } as Awaited<ReturnType<typeof fetchProgramConfigAccount>>);

    const result = await prepareSolanaFirstSync(
      {
        characterId: 'character-1',
        authority: authority.publicKey.toBase58(),
        playerAuthorizationSignatureBase64: Buffer.from(new Uint8Array(64).fill(5)).toString(
          'base64',
        ),
      },
      {
        connection: {
          getLatestBlockhash: jest.fn().mockResolvedValue({
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 88,
          }),
          getAccountInfo: jest.fn(),
        },
        serverSigner,
        addressLookupTableAccounts: [],
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
        buildPreparedTransaction: buildPreparedTransaction as never,
      },
    );

    if (result.phase !== 'sign_transaction') {
      throw new Error('expected sign_transaction phase');
    }

    expect(buildPreparedTransaction).toHaveBeenCalledTimes(1);
    expect(result.preparedTransaction.kind).toBe('player_owned_instruction');
    expect(result.preparedTransaction.characterCreationRelay?.localCharacterId).toBe('character-1');
    expect(result.preparedTransaction.settlementRelay?.batchId).toBe(1);
  });

  it('reuses an existing unconfirmed first-sync batch on prepare retries', async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const preparedRebase = buildPreparedRebase(authority);
    const persistedBatch = {
      ...buildPersistedBatch(preparedRebase),
      startStateHash: computeGenesisStateHashHex(
        new PublicKey(preparedRebase.reservedIdentity.characterRootPubkey),
        preparedRebase.reservedIdentity.chainCharacterIdHex,
      ),
    };

    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: authority,
      chainCharacterIdHex: preparedRebase.reservedIdentity.chainCharacterIdHex,
      characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
      chainCreationStatus: 'FAILED',
      chainCreationTxSignature: 'sig-1',
      chainCreatedAt: null,
      chainCreationTs: preparedRebase.anchor.characterCreationTs,
      chainCreationSeasonId: preparedRebase.anchor.seasonIdAtCreation,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.settlementBatch.findNextUnconfirmedForCharacter.mockResolvedValue(persistedBatch);
    const serverSigner = Keypair.generate();
    const buildPreparedTransaction = jest.fn(async () => ({
      serializedMessageBase64: Buffer.from('message').toString('base64'),
      serializedTransactionBase64: Buffer.from('transaction').toString('base64'),
      recentBlockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 88,
    }));
    fetchProgramConfigAccountMock.mockResolvedValue({
      trustedServerSigner: serverSigner.publicKey,
      settlementAuthorizationMode: 0,
    } as Awaited<ReturnType<typeof fetchProgramConfigAccount>>);

    const result = await prepareSolanaFirstSync(
      {
        characterId: 'character-1',
        authority,
      },
      {
        connection: {
          getLatestBlockhash: jest.fn().mockResolvedValue({
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 88,
          }),
          getAccountInfo: jest.fn(),
        },
        serverSigner,
        addressLookupTableAccounts: [],
        buildPreparedTransaction: buildPreparedTransaction as never,
        prismaClient: prismaMock as never,
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
      },
    );

    expect(result.phase).toBe('sign_transaction');
    expect(result.payload.batchHash).toBe(persistedBatch.batchHash);
    expect(result.expectedCursor.lastCommittedStateHash).toHaveLength(64);
    expect(prepareFirstSyncRebaseMock).not.toHaveBeenCalled();
    expect(prepareFirstSyncCharacterAnchorMock).toHaveBeenCalledTimes(1);
    expect(buildPreparedTransaction).toHaveBeenCalledTimes(1);
  });

  it('reuses the persisted first-sync batch on submit retries when awaiting backlog is already sealed', async () => {
    const authority = Keypair.generate();
    const preparedRebase = buildPreparedRebase(authority.publicKey.toBase58(), 2);
    const persistedBatch = {
      ...buildPersistedBatch(preparedRebase, 0),
      status: 'FAILED' as const,
    };
    const persistedBatchTwo = buildPersistedBatch(preparedRebase, 1);
    const unsignedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: authority.publicKey,
        recentBlockhash: '11111111111111111111111111111111',
        instructions: [],
      }).compileToV0Message([]),
    );
    const prepared = prepareFirstSyncTransaction({
      authority: authority.publicKey.toBase58(),
      feePayer: authority.publicKey.toBase58(),
      serializedMessageBase64: toBase64(unsignedTransaction.message.serialize()),
      serializedTransactionBase64: toBase64(unsignedTransaction.serialize()),
      characterCreation: {
        localCharacterId: preparedRebase.anchor.characterId,
        chainCharacterIdHex: preparedRebase.reservedIdentity.chainCharacterIdHex,
        characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
        classId: preparedRebase.anchor.classId,
        name: preparedRebase.anchor.name,
        characterCreationTs: preparedRebase.anchor.characterCreationTs,
        seasonIdAtCreation: preparedRebase.anchor.seasonIdAtCreation,
        initialUnlockedZoneId: preparedRebase.anchor.initialUnlockedZoneId,
        recentBlockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 88,
      },
      settlement: {
        characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
        payload: preparedRebase.batchDrafts[0]!.payload,
        expectedCursor: {
          lastCommittedEndNonce: 0,
          lastCommittedBatchId: 0,
          lastCommittedStateHash: preparedRebase.genesisCursor.lastCommittedStateHash,
          lastCommittedBattleTs: preparedRebase.genesisCursor.lastCommittedBattleTs,
          lastCommittedSeasonId: preparedRebase.genesisCursor.lastCommittedSeasonId,
        },
        permitDomain: {
          programId: RUNANA_PROGRAM_ID.toBase58(),
          clusterId: 1,
          playerAuthority: authority.publicKey.toBase58(),
          characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
          batchHash: preparedRebase.batchDrafts[0]!.payload.batchHash,
          batchId: preparedRebase.batchDrafts[0]!.payload.batchId,
          signatureScheme: 1,
        },
      },
    });

    prepareFirstSyncRebaseMock.mockRejectedValue(
      new Error('ERR_NO_FIRST_SYNC_BACKLOG: character has no awaiting-first-sync battles to settle'),
    );
    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: authority.publicKey.toBase58(),
      chainCharacterIdHex: preparedRebase.reservedIdentity.chainCharacterIdHex,
      characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
      chainCreationStatus: 'PENDING',
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: preparedRebase.anchor.characterCreationTs,
      chainCreationSeasonId: preparedRebase.anchor.seasonIdAtCreation,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.character.updateChainIdentity.mockResolvedValue({});
    prismaMock.character.updateCursorSnapshot.mockResolvedValue({});
    prismaMock.settlementBatch.findByCharacterAndBatchId.mockImplementation(
      async (_characterId: string, batchId: number) => {
        if (batchId === 1) {
          return persistedBatch;
        }
        if (batchId === 2) {
          return persistedBatchTwo;
        }
        return null;
      },
    );
    prismaMock.settlementBatch.updateStatus.mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => ({
        ...persistedBatch,
        ...patch,
      }),
    );
    prismaMock.battleOutcomeLedger.markCommittedForBatch.mockResolvedValue([]);
    prismaMock.settlementSubmissionAttempt.listByBatch.mockResolvedValue([]);
    prismaMock.settlementSubmissionAttempt.create.mockResolvedValue({
      id: 'attempt-1',
      attemptNumber: 1,
      status: 'STARTED',
    });
    prismaMock.settlementSubmissionAttempt.update.mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => ({
        id: 'attempt-1',
        attemptNumber: 1,
        ...patch,
      }),
    );
    fetchCharacterRootAccountMock.mockResolvedValue({
      characterId: Buffer.alloc(16),
    } as Awaited<ReturnType<typeof fetchCharacterRootAccount>>);
    accountCharacterIdHexMock.mockReturnValue(preparedRebase.reservedIdentity.chainCharacterIdHex);
    fetchCharacterSettlementBatchCursorAccountMock.mockResolvedValue({
      lastCommittedEndNonce: 2n,
      lastCommittedBatchId: 1n,
      lastCommittedStateHash: Buffer.from('33'.repeat(32), 'hex'),
      lastCommittedBattleTs: 1_700_000_040n,
      lastCommittedSeasonId: 4,
    } as Awaited<ReturnType<typeof fetchCharacterSettlementBatchCursorAccount>>);

    const result = await submitSolanaFirstSync(
      {
        prepared,
        signedMessageBase64: prepared.serializedMessageBase64,
        signedTransactionBase64: prepared.serializedTransactionBase64,
      },
      {
        connection: {
          getAccountInfo: jest.fn(),
          sendRawTransaction: jest.fn().mockResolvedValue('tx-signature-1'),
          confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
        },
        now: () => new Date('2026-04-04T12:00:00.000Z'),
        prismaClient: prismaMock as never,
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
      },
    );

    expect(result.chainCreationStatus).toBe('CONFIRMED');
    expect(result.firstSettlementBatchId).toBe('settlement-batch-1');
    expect(result.remainingSettlementBatchIds).toEqual(['settlement-batch-2']);
    expect(prepareFirstSyncRebaseMock).not.toHaveBeenCalled();
    expect(prismaMock.settlementBatch.createSealed).not.toHaveBeenCalled();
  });

  it('submits the atomic first sync, confirms batch 1, and queues later batches for normal settlement', async () => {
    const authority = Keypair.generate();
    const preparedRebase = buildPreparedRebase(authority.publicKey.toBase58(), 2);
    const persistedBatch = buildPersistedBatch(preparedRebase, 0);
    const persistedBatchTwo = buildPersistedBatch(preparedRebase, 1);
    const unsignedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: authority.publicKey,
        recentBlockhash: '11111111111111111111111111111111',
        instructions: [],
      }).compileToV0Message([]),
    );
    const prepared = prepareFirstSyncTransaction({
      authority: authority.publicKey.toBase58(),
      feePayer: authority.publicKey.toBase58(),
      serializedMessageBase64: toBase64(unsignedTransaction.message.serialize()),
      serializedTransactionBase64: toBase64(unsignedTransaction.serialize()),
      characterCreation: {
        localCharacterId: preparedRebase.anchor.characterId,
        chainCharacterIdHex: preparedRebase.reservedIdentity.chainCharacterIdHex,
        characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
        classId: preparedRebase.anchor.classId,
        name: preparedRebase.anchor.name,
        characterCreationTs: preparedRebase.anchor.characterCreationTs,
        seasonIdAtCreation: preparedRebase.anchor.seasonIdAtCreation,
        initialUnlockedZoneId: preparedRebase.anchor.initialUnlockedZoneId,
        recentBlockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 88,
      },
      settlement: {
        characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
        payload: preparedRebase.batchDrafts[0]!.payload,
        expectedCursor: {
          lastCommittedEndNonce: 0,
          lastCommittedBatchId: 0,
          lastCommittedStateHash: preparedRebase.genesisCursor.lastCommittedStateHash,
          lastCommittedBattleTs: preparedRebase.genesisCursor.lastCommittedBattleTs,
          lastCommittedSeasonId: preparedRebase.genesisCursor.lastCommittedSeasonId,
        },
        permitDomain: {
          programId: RUNANA_PROGRAM_ID.toBase58(),
          clusterId: 1,
          playerAuthority: authority.publicKey.toBase58(),
          characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
          batchHash: preparedRebase.batchDrafts[0]!.payload.batchHash,
          batchId: preparedRebase.batchDrafts[0]!.payload.batchId,
          signatureScheme: 1,
        },
      },
    });

    prepareFirstSyncRebaseMock.mockResolvedValue(preparedRebase);
    prismaMock.character.findChainState.mockResolvedValue({
      id: 'character-1',
      playerAuthorityPubkey: authority.publicKey.toBase58(),
      chainCharacterIdHex: preparedRebase.reservedIdentity.chainCharacterIdHex,
      characterRootPubkey: preparedRebase.reservedIdentity.characterRootPubkey,
      chainCreationStatus: 'PENDING',
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: preparedRebase.anchor.characterCreationTs,
      chainCreationSeasonId: preparedRebase.anchor.seasonIdAtCreation,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.character.updateChainIdentity.mockResolvedValue({});
    prismaMock.character.updateCursorSnapshot.mockResolvedValue({});
    prismaMock.settlementBatch.findByCharacterAndBatchId.mockResolvedValue(null);
    prismaMock.settlementBatch.createSealed
      .mockResolvedValueOnce(persistedBatch)
      .mockResolvedValueOnce(persistedBatchTwo);
    prismaMock.settlementBatch.updateStatus.mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => ({
        ...persistedBatch,
        ...patch,
      }),
    );
    prismaMock.battleOutcomeLedger.markCommittedForBatch.mockResolvedValue([]);
    prismaMock.settlementSubmissionAttempt.listByBatch.mockResolvedValue([]);
    prismaMock.settlementSubmissionAttempt.create.mockResolvedValue({
      id: 'attempt-1',
      attemptNumber: 1,
      status: 'STARTED',
    });
    prismaMock.settlementSubmissionAttempt.update.mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => ({
        id: 'attempt-1',
        attemptNumber: 1,
        ...patch,
      }),
    );
    fetchCharacterRootAccountMock.mockResolvedValue({
      characterId: Buffer.alloc(16),
    } as Awaited<ReturnType<typeof fetchCharacterRootAccount>>);
    accountCharacterIdHexMock.mockReturnValue(preparedRebase.reservedIdentity.chainCharacterIdHex);
    fetchCharacterSettlementBatchCursorAccountMock.mockResolvedValue({
      lastCommittedEndNonce: 2n,
      lastCommittedBatchId: 1n,
      lastCommittedStateHash: Buffer.from('33'.repeat(32), 'hex'),
      lastCommittedBattleTs: 1_700_000_040n,
      lastCommittedSeasonId: 4,
    } as Awaited<ReturnType<typeof fetchCharacterSettlementBatchCursorAccount>>);

    const result = await submitSolanaFirstSync(
      {
        prepared,
        signedMessageBase64: prepared.serializedMessageBase64,
        signedTransactionBase64: prepared.serializedTransactionBase64,
      },
      {
        connection: {
          getAccountInfo: jest.fn(),
          sendRawTransaction: jest.fn().mockResolvedValue('tx-signature-1'),
          confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
        },
        now: () => new Date('2026-04-04T12:00:00.000Z'),
        prismaClient: prismaMock as never,
        prepareFirstSyncRebase: prepareFirstSyncRebaseMock,
      },
    );

    expect(result.chainCreationStatus).toBe('CONFIRMED');
    expect(result.firstSettlementBatchId).toBe('settlement-batch-1');
    expect(result.remainingSettlementBatchIds).toEqual(['settlement-batch-2']);
    expect(result.cursor.lastCommittedEndNonce).toBe(2);
    expect(prismaMock.settlementBatch.createSealed).toHaveBeenCalledTimes(2);
    expect(prismaMock.character.updateCursorSnapshot).toHaveBeenCalledTimes(1);
    expect(prismaMock.battleOutcomeLedger.markCommittedForBatch).toHaveBeenCalledWith(
      'settlement-batch-1',
      new Date('2026-04-04T12:00:00.000Z'),
    );
  });
});
