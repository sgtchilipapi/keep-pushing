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
  settlementRequest: {
    findById: jest.fn(),
    findByCharacterAndIdempotencyKey: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  settlementBatch: {
    findByCharacterAndBatchId: jest.fn(),
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
  finalizeSettlementPresignRequest,
  presignSettlementTransaction,
} from '../lib/solana/settlementPresign';

function sha256HexFromBase64(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
}

function buildSettlementRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    characterId: 'character-1',
    sessionId: 'session-1',
    walletAddress: 'wallet-1',
    batchId: 4,
    batchHash: 'ab'.repeat(32),
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
    prismaMock.settlementSubmissionAttempt.listByBatch.mockResolvedValue([]);
    settlementLifecycleMock.reconcileSettlementBatch.mockResolvedValue({
      state: 'SUBMITTED',
    });
  });

  it('invalidates the request when the presign callback message hash does not match', async () => {
    const transaction = buildPreparedTransaction({});
    prismaMock.settlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        prepareMessageHash: '00'.repeat(32),
      }),
    );
    prismaMock.settlementRequest.update.mockResolvedValue(null);

    await expect(
      presignSettlementTransaction({
        prepareRequestId: 'request-1',
        presignToken: 'request-1',
        walletAddress: 'wallet-1',
        transactionBase64: serializeLegacyOrVersionedTransactionBase64(transaction),
      }),
    ).rejects.toThrow('ERR_SETTLEMENT_TX_MISMATCH_MESSAGE_HASH');

    expect(prismaMock.settlementRequest.update).toHaveBeenCalledWith(
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
    prismaMock.settlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        prepareMessageHash: messageSha256Hex,
      }),
    );
    prismaMock.settlementRequest.update.mockResolvedValue(null);

    await expect(
      presignSettlementTransaction({
        prepareRequestId: 'request-1',
        presignToken: 'request-1',
        walletAddress: 'wallet-1',
        transactionBase64: serializeLegacyOrVersionedTransactionBase64(transaction),
      }),
    ).rejects.toThrow('ERR_SETTLEMENT_TX_MISMATCH_FEE_PAYER');

    expect(prismaMock.settlementRequest.update).toHaveBeenCalledWith(
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
    prismaMock.settlementRequest.findById.mockResolvedValue(
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
    expect(prismaMock.settlementRequest.update).not.toHaveBeenCalled();
  });

  it('returns the prior finalize result idempotently for the same transaction signature', async () => {
    prismaMock.settlementRequest.findById.mockResolvedValue(
      buildSettlementRequest({
        status: 'SUBMITTED',
        presignedMessageHash: '12'.repeat(32),
      }),
    );
    prismaMock.settlementBatch.findByCharacterAndBatchId.mockResolvedValue(
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
      settlementBatchId: 'settlement-batch-1',
      transactionSignature: 'sig-1',
    });
    expect(prismaMock.settlementBatch.updateStatus).not.toHaveBeenCalled();
    expect(settlementLifecycleMock.reconcileSettlementBatch).not.toHaveBeenCalled();
  });
});
