import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';

import {
  serializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionMessageBase64,
} from '../lib/solana/playerOwnedV0Transactions';

const prismaMock = {
  closedZoneRunSummary: {
    listNextSettleableForCharacter: jest.fn(),
  },
  runSettlement: {
    findById: jest.fn(),
    findByZoneRunId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  runSettlementRequest: {
    findById: jest.fn(),
    findByCharacterZoneRunAndIdempotencyKey: jest.fn(),
    findActiveByRunSettlementId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  settlementBatch: {
    findByCharacterAndBatchHash: jest.fn(),
    updateStatus: jest.fn(),
  },
  settlementSubmissionAttempt: {
    listByBatch: jest.fn(),
    create: jest.fn(),
  },
};

const settlementRelayMock = {
  prepareSolanaSettlement: jest.fn(),
};

const settlementLifecycleMock = {
  reconcileSettlementBatch: jest.fn(),
};

const sponsorSigner = Keypair.generate();
const runanaProgramId = Keypair.generate().publicKey;

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}));

jest.mock('../lib/solana/settlementRelay', () => ({
  prepareSolanaSettlement: settlementRelayMock.prepareSolanaSettlement,
}));

jest.mock('../lib/solana/settlementLifecycle', () => ({
  reconcileSettlementBatch: settlementLifecycleMock.reconcileSettlementBatch,
}));

jest.mock('../lib/solana/runanaClient', () => ({
  loadRunanaSponsorPayer: jest.fn(() => ({
    signer: sponsorSigner,
    signerPath: '/tmp/sponsor.json',
  })),
  resolveRunanaProgramId: jest.fn(() => runanaProgramId),
}));

import {
  prepareSettlementPresignRequest,
  finalizeSettlementPresignRequest,
  presignSettlementTransaction,
} from '../lib/solana/settlementPresign';

function sha256HexFromBase64(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
}

function buildRunSettlement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-settlement-1',
    characterId: 'character-1',
    zoneRunId: 'run-1',
    closedRunSequence: 7,
    settlementSequence: 7,
    payloadHash: 'ab'.repeat(32),
    prepareMessageHash: '12'.repeat(32),
    status: 'PREPARED',
    failureCode: null,
    latestTransactionSignature: null,
    preparedAt: new Date('2026-04-13T00:00:00.000Z'),
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSettlementRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    runSettlementId: 'run-settlement-1',
    characterId: 'character-1',
    sessionId: 'session-1',
    walletAddress: 'wallet-1',
    zoneRunId: 'run-1',
    settlementSequence: 7,
    payloadHash: 'ab'.repeat(32),
    prepareMessageHash: '',
    presignedMessageHash: null,
    status: 'PREPARED',
    invalidReasonCode: null,
    idempotencyKey: 'idem-1',
    preparedAt: new Date('2026-04-13T00:00:00.000Z'),
    presignedAt: null,
    finalizedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSettlementBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settlement-batch-1',
    characterId: 'character-1',
    batchId: 4,
    startNonce: 1,
    endNonce: 2,
    battleCount: 1,
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_101,
    seasonId: 4,
    startStateHash: '11'.repeat(32),
    endStateHash: '22'.repeat(32),
    zoneProgressDelta: [],
    encounterHistogram: [],
    optionalLoadoutRevision: null,
    batchHash: 'ab'.repeat(32),
    schemaVersion: 2,
    signatureScheme: 1,
    status: 'SUBMITTED',
    failureCategory: null,
    failureCode: null,
    latestMessageSha256Hex: '12'.repeat(32),
    latestSignedTxSha256Hex: null,
    latestTransactionSignature: 'sig-1',
    preparedAt: new Date('2026-04-13T00:00:00.000Z'),
    submittedAt: new Date('2026-04-13T00:01:00.000Z'),
    confirmedAt: null,
    failedAt: null,
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:01:00.000Z'),
    ...overrides,
  };
}

function buildPreparedTransaction(args: {
  feePayer?: PublicKey;
  programId?: PublicKey;
  extraProgramIds?: PublicKey[];
}) {
  const transaction = new Transaction({
    feePayer: args.feePayer ?? sponsorSigner.publicKey,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1,
  });
  transaction.add(
    new TransactionInstruction({
      programId: args.programId ?? runanaProgramId,
      keys: [],
      data: Buffer.from([1, 2, 3]),
    }),
  );
  for (const extraProgramId of args.extraProgramIds ?? []) {
    transaction.add(
      new TransactionInstruction({
        programId: extraProgramId,
        keys: [],
        data: Buffer.from([9]),
      }),
    );
  }
  return transaction;
}

describe('settlementPresign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.closedZoneRunSummary.listNextSettleableForCharacter.mockResolvedValue([
      {
        id: 'closed-run-1',
        zoneRunId: 'run-1',
        characterId: 'character-1',
        zoneId: 3,
        seasonId: 4,
        topologyVersion: 1,
        topologyHash: 'topo-1',
        terminalStatus: 'COMPLETED',
        settleable: true,
        closedRunSequence: 7,
        rewardedBattleCount: 2,
        rewardedEncounterHistogram: {},
        zoneProgressDelta: [],
        firstRewardedBattleTs: 1_700_000_100,
        lastRewardedBattleTs: 1_700_000_200,
        closedAt: new Date('2026-04-13T00:00:00.000Z'),
        createdAt: new Date('2026-04-13T00:00:00.000Z'),
        updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      },
    ]);
    prismaMock.runSettlement.findByZoneRunId.mockResolvedValue(null);
    prismaMock.runSettlement.create.mockResolvedValue(buildRunSettlement());
    prismaMock.runSettlement.findById.mockResolvedValue(buildRunSettlement());
    prismaMock.runSettlement.update.mockImplementation(async (_id: string, input: Record<string, unknown>) =>
      buildRunSettlement(input),
    );
    prismaMock.runSettlementRequest.findActiveByRunSettlementId.mockResolvedValue(null);
    prismaMock.settlementSubmissionAttempt.listByBatch.mockResolvedValue([]);
    settlementLifecycleMock.reconcileSettlementBatch.mockResolvedValue({
      state: 'SUBMITTED',
    });
  });

  it('rejects prepare when the requested run is not the oldest pending settlement run', async () => {
    prismaMock.closedZoneRunSummary.listNextSettleableForCharacter.mockResolvedValue([
      {
        id: 'closed-run-1',
        zoneRunId: 'run-1',
        characterId: 'character-1',
        zoneId: 3,
        seasonId: 4,
        topologyVersion: 1,
        topologyHash: 'topo-1',
        terminalStatus: 'COMPLETED',
        settleable: true,
        closedRunSequence: 7,
        rewardedBattleCount: 2,
        rewardedEncounterHistogram: {},
        zoneProgressDelta: [],
        firstRewardedBattleTs: 1_700_000_100,
        lastRewardedBattleTs: 1_700_000_200,
        closedAt: new Date('2026-04-13T00:00:00.000Z'),
        createdAt: new Date('2026-04-13T00:00:00.000Z'),
        updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      },
    ]);

    await expect(
      prepareSettlementPresignRequest({
        characterId: 'character-1',
        zoneRunId: 'run-2',
        walletAddress: 'wallet-1',
        sessionId: 'session-1',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow('ERR_SETTLEMENT_RUN_NOT_OLDEST_PENDING');
  });

  it('echoes the prepared zone run id when prepare succeeds', async () => {
    prismaMock.runSettlementRequest.findByCharacterZoneRunAndIdempotencyKey.mockResolvedValue(null);
    prismaMock.runSettlementRequest.create.mockResolvedValue({
      ...buildSettlementRequest(),
    });
    settlementRelayMock.prepareSolanaSettlement.mockResolvedValue({
      phase: 'sign_transaction',
      settlementBatchId: 'settlement-batch-1',
      payload: { batchId: 4, batchHash: 'ab'.repeat(32) },
      preparedTransaction: {
        kind: 'battle_settlement',
        authority: 'wallet-1',
        feePayer: 'sponsor-1',
        messageSha256Hex: '12'.repeat(32),
      },
    });

    const result = await prepareSettlementPresignRequest({
      characterId: 'character-1',
      zoneRunId: 'run-1',
      walletAddress: 'wallet-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.zoneRunId).toBe('run-1');
    expect(result.runSettlementId).toBe('run-settlement-1');
    expect(settlementRelayMock.prepareSolanaSettlement).toHaveBeenCalled();
  });

  it('replaces an older prepared request for the same run when a new prepare starts after client-side failure', async () => {
    prismaMock.runSettlementRequest.findByCharacterZoneRunAndIdempotencyKey.mockResolvedValue(null);
    prismaMock.runSettlementRequest.findActiveByRunSettlementId.mockResolvedValue(
      buildSettlementRequest({
        id: 'request-old',
        idempotencyKey: 'idem-old',
        status: 'PREPARED',
      }),
    );
    prismaMock.runSettlementRequest.create.mockResolvedValue(buildSettlementRequest());
    settlementRelayMock.prepareSolanaSettlement.mockResolvedValue({
      phase: 'sign_transaction',
      settlementBatchId: 'settlement-batch-1',
      payload: { batchId: 4, batchHash: 'ab'.repeat(32) },
      preparedTransaction: {
        kind: 'battle_settlement',
        authority: 'wallet-1',
        feePayer: 'sponsor-1',
        messageSha256Hex: '12'.repeat(32),
      },
    });

    const result = await prepareSettlementPresignRequest({
      characterId: 'character-1',
      zoneRunId: 'run-1',
      walletAddress: 'wallet-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-new',
    });

    expect(prismaMock.runSettlementRequest.update).toHaveBeenCalledWith(
      'request-old',
      expect.objectContaining({
        status: 'INVALIDATED',
        invalidReasonCode: 'SETTLEMENT_REQUEST_REPLACED',
      }),
    );
    expect(result.prepareRequestId).toBe('request-1');
  });

  it('invalidates the request when the presign callback message hash does not match', async () => {
    const transaction = buildPreparedTransaction({});
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        prepareMessageHash: '00'.repeat(32),
      }),
    );
    prismaMock.runSettlementRequest.update.mockResolvedValue(null);

    await expect(
      presignSettlementTransaction({
        prepareRequestId: 'request-1',
        presignToken: 'request-1',
        walletAddress: 'wallet-1',
        transactionBase64: serializeLegacyOrVersionedTransactionBase64(transaction),
      }),
    ).rejects.toThrow('ERR_SETTLEMENT_TX_MISMATCH_MESSAGE_HASH');

    expect(prismaMock.runSettlementRequest.update).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({
        status: 'INVALIDATED',
        invalidReasonCode: 'SETTLEMENT_TX_MISMATCH_MESSAGE_HASH',
      }),
    );
  });

  it('rejects non-canonical presign callbacks when the fee payer is not the sponsor signer', async () => {
    const transaction = buildPreparedTransaction({
      feePayer: Keypair.generate().publicKey,
    });
    const messageSha256Hex = sha256HexFromBase64(
      serializeLegacyOrVersionedTransactionMessageBase64(transaction),
    );
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        prepareMessageHash: messageSha256Hex,
      }),
    );
    prismaMock.runSettlementRequest.update.mockResolvedValue(null);

    await expect(
      presignSettlementTransaction({
        prepareRequestId: 'request-1',
        presignToken: 'request-1',
        walletAddress: 'wallet-1',
        transactionBase64: serializeLegacyOrVersionedTransactionBase64(transaction),
      }),
    ).rejects.toThrow('ERR_SETTLEMENT_TX_MISMATCH_FEE_PAYER');

    expect(prismaMock.runSettlementRequest.update).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({
        status: 'INVALIDATED',
        invalidReasonCode: 'SETTLEMENT_TX_MISMATCH_FEE_PAYER',
      }),
    );
  });

  it('replays a previously presigned request idempotently for the same transaction message', async () => {
    const transaction = buildPreparedTransaction({});
    const transactionBase64 = serializeLegacyOrVersionedTransactionBase64(transaction);
    const messageSha256Hex = sha256HexFromBase64(
      serializeLegacyOrVersionedTransactionMessageBase64(transaction),
    );
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        status: 'PRESIGNED',
        prepareMessageHash: messageSha256Hex,
        presignedMessageHash: messageSha256Hex,
      }),
    );

    const result = await presignSettlementTransaction({
      prepareRequestId: 'request-1',
      presignToken: 'request-1',
      walletAddress: 'wallet-1',
      transactionBase64,
    });

    expect(result.prepareRequestId).toBe('request-1');
    expect(result.messageSha256Hex).toBe(messageSha256Hex);
    expect(prismaMock.runSettlementRequest.update).not.toHaveBeenCalled();
  });

  it('returns the prior finalize result idempotently for the same transaction signature', async () => {
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        status: 'SUBMITTED',
        presignedMessageHash: '12'.repeat(32),
      }),
    );
    prismaMock.settlementBatch.findByCharacterAndBatchHash.mockResolvedValue(
      buildSettlementBatch({
        status: 'SUBMITTED',
        latestTransactionSignature: 'sig-1',
      }),
    );

    const result = await finalizeSettlementPresignRequest({
      prepareRequestId: 'request-1',
      walletAddress: 'wallet-1',
      transactionSignature: 'sig-1',
    });

    expect(result).toEqual({
      phase: 'submitted',
      runSettlementId: 'run-settlement-1',
      transactionSignature: 'sig-1',
    });
    expect(prismaMock.settlementBatch.updateStatus).not.toHaveBeenCalled();
    expect(settlementLifecycleMock.reconcileSettlementBatch).not.toHaveBeenCalled();
  });

  it('retries finalize recovery for a presigned request when the same transaction was already broadcast', async () => {
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        status: 'PRESIGNED',
        presignedMessageHash: '12'.repeat(32),
      }),
    );
    prismaMock.settlementBatch.findByCharacterAndBatchHash.mockResolvedValue(
      buildSettlementBatch({
        status: 'SUBMITTED',
        latestTransactionSignature: 'sig-1',
      }),
    );
    prismaMock.settlementSubmissionAttempt.listByBatch.mockResolvedValue([
      {
        id: 'attempt-1',
        settlementBatchId: 'settlement-batch-1',
        attemptNumber: 1,
        status: 'BROADCAST',
        messageSha256Hex: '12'.repeat(32),
        transactionSignature: 'sig-1',
        submittedAt: new Date('2026-04-13T00:01:00.000Z'),
        resolvedAt: null,
        rpcError: null,
        createdAt: new Date('2026-04-13T00:01:00.000Z'),
        updatedAt: new Date('2026-04-13T00:01:00.000Z'),
      },
    ]);
    settlementLifecycleMock.reconcileSettlementBatch.mockResolvedValue({
      state: 'CONFIRMED',
    });

    const result = await finalizeSettlementPresignRequest({
      prepareRequestId: 'request-1',
      walletAddress: 'wallet-1',
      transactionSignature: 'sig-1',
    });

    expect(result).toEqual({
      phase: 'confirmed',
      runSettlementId: 'run-settlement-1',
      transactionSignature: 'sig-1',
    });
    expect(prismaMock.settlementBatch.updateStatus).toHaveBeenCalledWith(
      'settlement-batch-1',
      expect.objectContaining({
        status: 'SUBMITTED',
        latestTransactionSignature: 'sig-1',
      }),
    );
    expect(prismaMock.settlementSubmissionAttempt.create).not.toHaveBeenCalled();
    expect(settlementLifecycleMock.reconcileSettlementBatch).toHaveBeenCalledWith(
      'settlement-batch-1',
    );
    expect(prismaMock.runSettlementRequest.update).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({
        status: 'CONFIRMED',
        finalizedAt: expect.any(Date),
      }),
    );
  });

  it('rejects finalize recovery when a presigned request is retried with a different transaction signature', async () => {
    prismaMock.runSettlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        status: 'PRESIGNED',
        presignedMessageHash: '12'.repeat(32),
      }),
    );
    prismaMock.settlementBatch.findByCharacterAndBatchHash.mockResolvedValue(
      buildSettlementBatch({
        status: 'SUBMITTED',
        latestTransactionSignature: 'sig-1',
      }),
    );

    await expect(
      finalizeSettlementPresignRequest({
        prepareRequestId: 'request-1',
        walletAddress: 'wallet-1',
        transactionSignature: 'sig-2',
      }),
    ).rejects.toThrow(
      'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement batch was already submitted with a different transaction signature',
    );

    expect(prismaMock.settlementBatch.updateStatus).not.toHaveBeenCalled();
    expect(settlementLifecycleMock.reconcileSettlementBatch).not.toHaveBeenCalled();
    expect(prismaMock.runSettlementRequest.update).not.toHaveBeenCalled();
  });
});
