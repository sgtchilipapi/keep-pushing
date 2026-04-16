import { createHash } from 'node:crypto';

import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
  type RpcResponseAndContext,
  type SignatureResult,
} from '@solana/web3.js';

import type {
  CharacterChainState,
  SettlementBatchRecord,
  SettlementSubmissionAttemptRecord,
} from '../lib/prisma';
import { prepareSettlementTransaction } from '../lib/solana/playerOwnedTransactions';
import {
  markSettlementBatchPrepared,
  recoverUnresolvedSettlementBatches,
  reconcileSettlementBatch,
  submitSettlementBatch,
  type SettlementCursorSnapshot,
} from '../lib/solana/settlementLifecycle';
import { RUNANA_PROGRAM_ID } from '../lib/solana/runanaProgram';

function accountDiscriminator(accountName: string): Buffer {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
}

function u8(value: number): Buffer {
  return Buffer.from([value]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function accountInfo(data: Buffer): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1,
    owner: RUNANA_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function cursorAccountData(args: {
  characterRoot: PublicKey;
  lastCommittedEndNonce: bigint;
  lastCommittedStateHash: Buffer;
  lastCommittedBatchId: bigint;
  lastCommittedBattleTs: bigint;
  lastCommittedSeasonId: number;
  updatedAtSlot: bigint;
}): Buffer {
  return Buffer.concat([
    accountDiscriminator('CharacterSettlementBatchCursorAccount'),
    u8(1),
    u8(249),
    args.characterRoot.toBuffer(),
    u64(args.lastCommittedEndNonce),
    args.lastCommittedStateHash,
    u64(args.lastCommittedBatchId),
    u64(args.lastCommittedBattleTs),
    u32(args.lastCommittedSeasonId),
    u64(args.updatedAtSlot),
  ]);
}

function buildUnsignedV0TransactionBase64(feePayer: PublicKey) {
  const recentBlockhash = Keypair.generate().publicKey.toBase58();
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash,
    instructions: [],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);

  return {
    serializedMessageBase64: Buffer.from(message.serialize()).toString('base64'),
    serializedTransactionBase64: Buffer.from(transaction.serialize()).toString('base64'),
  };
}

function buildBatch(overrides: Partial<SettlementBatchRecord> = {}): SettlementBatchRecord {
  return {
    id: 'batch-1',
    characterId: 'local-character-1',
    batchId: 1,
    startNonce: 1,
    endNonce: 3,
    battleCount: 3,
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_120,
    seasonId: 4,
    startStateHash: '11'.repeat(32),
    endStateHash: '22'.repeat(32),
    zoneProgressDelta: [{ zoneId: 3, newState: 1 }],
    encounterHistogram: [{ zoneId: 3, enemyArchetypeId: 22, count: 3 }],
    optionalLoadoutRevision: null,
    batchHash: '33'.repeat(32),
    schemaVersion: 2,
    signatureScheme: 0,
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

function buildAttempt(overrides: Partial<SettlementSubmissionAttemptRecord> = {}): SettlementSubmissionAttemptRecord {
  return {
    id: 'attempt-1',
    settlementBatchId: 'batch-1',
    attemptNumber: 1,
    status: 'STARTED',
    messageSha256Hex: null,
    signedTransactionSha256Hex: null,
    transactionSignature: null,
    rpcError: null,
    createdAt: new Date('2026-04-04T00:00:00.000Z'),
    updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    submittedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function buildChainState(characterRootPubkey: string): CharacterChainState {
  return {
    id: 'local-character-1',
    playerAuthorityPubkey: Keypair.generate().publicKey.toBase58(),
    chainCharacterIdHex: '00112233445566778899aabbccddeeff',
    characterRootPubkey,
    chainCreationStatus: 'CONFIRMED',
    chainCreationTxSignature: null,
    chainCreatedAt: null,
    chainCreationTs: 1_700_000_000,
    chainCreationSeasonId: 4,
    lastReconciledEndNonce: 0,
    lastReconciledStateHash: '00'.repeat(32),
    lastReconciledBatchId: 0,
    lastReconciledBattleTs: 1_700_000_050,
    lastReconciledSeasonId: 4,
    lastReconciledAt: null,
  };
}

function exactCursor(batch: SettlementBatchRecord): SettlementCursorSnapshot {
  return {
    lastCommittedEndNonce: batch.endNonce,
    lastCommittedStateHash: batch.endStateHash,
    lastCommittedBatchId: batch.batchId,
    lastCommittedBattleTs: batch.lastBattleTs,
    lastCommittedSeasonId: batch.seasonId,
  };
}

function priorCursor(batch: SettlementBatchRecord): SettlementCursorSnapshot {
  return {
    lastCommittedEndNonce: batch.startNonce - 1,
    lastCommittedStateHash: batch.startStateHash,
    lastCommittedBatchId: batch.batchId - 1,
    lastCommittedBattleTs: batch.firstBattleTs - 1,
    lastCommittedSeasonId: batch.seasonId,
  };
}

function connectionForCursorSnapshots(
  characterRoot: PublicKey,
  snapshots: SettlementCursorSnapshot[],
): Pick<
  Connection,
  'getAccountInfo' | 'sendRawTransaction' | 'confirmTransaction' | 'getSignatureStatuses'
> {
  let cursorIndex = 0;

  return {
    getAccountInfo: jest.fn(async () => {
      const snapshot = snapshots[Math.min(cursorIndex, snapshots.length - 1)];
      cursorIndex += 1;
      return accountInfo(
        cursorAccountData({
          characterRoot,
          lastCommittedEndNonce: BigInt(snapshot.lastCommittedEndNonce),
          lastCommittedStateHash: Buffer.from(snapshot.lastCommittedStateHash, 'hex'),
          lastCommittedBatchId: BigInt(snapshot.lastCommittedBatchId),
          lastCommittedBattleTs: BigInt(snapshot.lastCommittedBattleTs),
          lastCommittedSeasonId: snapshot.lastCommittedSeasonId,
          updatedAtSlot: 99n,
        }),
      );
    }),
    sendRawTransaction: jest.fn(async () => 'sig-1'),
    confirmTransaction: jest.fn(
      async () =>
        ({
          context: { slot: 99 },
          value: { err: null },
        }) as RpcResponseAndContext<SignatureResult>,
    ),
    getSignatureStatuses: jest.fn(async () => ({
      context: { slot: 99 },
      value: [null],
    })),
  };
}

function createMockPrisma(args: {
  batches: SettlementBatchRecord[];
  chainState: CharacterChainState;
  attemptsByBatchId?: Record<string, SettlementSubmissionAttemptRecord[]>;
}) {
  const batches = new Map(args.batches.map((batch) => [batch.id, { ...batch }]));
  const attemptsByBatchId = new Map<string, SettlementSubmissionAttemptRecord[]>(
    Object.entries(args.attemptsByBatchId ?? {}).map(([batchId, attempts]) => [
      batchId,
      attempts.map((attempt) => ({ ...attempt })),
    ]),
  );

  return {
    state: {
      batches,
      attemptsByBatchId,
    },
    client: {
      character: {
        findChainState: jest.fn(async () => ({ ...args.chainState })),
        updateCursorSnapshot: jest.fn(async () => undefined),
      },
      battleOutcomeLedger: {
        markCommittedForBatch: jest.fn(async () => []),
      },
      settlementBatch: {
        findById: jest.fn(async (id: string) => {
          const batch = batches.get(id);
          return batch ? { ...batch } : null;
        }),
        findNextUnconfirmedForCharacter: jest.fn(async (characterId: string) => {
          const next = [...batches.values()]
            .filter((batch) => batch.characterId === characterId && batch.status !== 'CONFIRMED')
            .sort((left, right) => left.batchId - right.batchId)[0];
          return next ? { ...next } : null;
        }),
        listUnconfirmed: jest.fn(async () =>
          [...batches.values()]
            .filter((batch) => batch.status !== 'CONFIRMED')
            .sort((left, right) =>
              left.characterId === right.characterId
                ? left.batchId - right.batchId
                : left.characterId.localeCompare(right.characterId),
            )
            .map((batch) => ({ ...batch })),
        ),
        updateStatus: jest.fn(async (id: string, input: Record<string, unknown>) => {
          const current = batches.get(id);
          if (!current) {
            return null;
          }
          const next = { ...current, ...input, updatedAt: new Date('2026-04-04T00:00:01.000Z') };
          batches.set(id, next);
          return { ...next };
        }),
      },
      settlementSubmissionAttempt: {
        create: jest.fn(async (input: Record<string, unknown>) => {
          const created = buildAttempt(input as Partial<SettlementSubmissionAttemptRecord>);
          const attempts = attemptsByBatchId.get(created.settlementBatchId) ?? [];
          attempts.push(created);
          attemptsByBatchId.set(created.settlementBatchId, attempts);
          return { ...created };
        }),
        listByBatch: jest.fn(async (batchId: string) =>
          (attemptsByBatchId.get(batchId) ?? []).map((attempt) => ({ ...attempt })),
        ),
        update: jest.fn(async (id: string, input: Record<string, unknown>) => {
          for (const [batchId, attempts] of attemptsByBatchId.entries()) {
            const index = attempts.findIndex((attempt) => attempt.id === id);
            if (index >= 0) {
              const next = { ...attempts[index], ...input };
              attempts[index] = next;
              attemptsByBatchId.set(batchId, attempts);
              return { ...next };
            }
          }
          return null;
        }),
      },
    },
  };
}

function buildPreparedSettlement(
  batch: SettlementBatchRecord,
  authority: string,
  characterRootPubkey: string,
) {
  const feePayer = new PublicKey(authority);
  const unsigned = buildUnsignedV0TransactionBase64(feePayer);

  return prepareSettlementTransaction({
    playerAuthority: authority,
    feePayer: authority,
    characterRootPubkey,
    payload: {
      characterId: '00112233445566778899aabbccddeeff',
      batchId: batch.batchId,
      startNonce: batch.startNonce,
      endNonce: batch.endNonce,
      battleCount: batch.battleCount,
      startStateHash: batch.startStateHash,
      endStateHash: batch.endStateHash,
      zoneProgressDelta: batch.zoneProgressDelta as SettlementBatchRecord['zoneProgressDelta'] as never,
      encounterHistogram: batch.encounterHistogram as SettlementBatchRecord['encounterHistogram'] as never,
      optionalLoadoutRevision: batch.optionalLoadoutRevision ?? undefined,
      batchHash: batch.batchHash,
      firstBattleTs: batch.firstBattleTs,
      lastBattleTs: batch.lastBattleTs,
      seasonId: batch.seasonId,
      schemaVersion: 2,
      signatureScheme: 0,
    },
    expectedCursor: priorCursor(batch),
    permitDomain: {
      programId: RUNANA_PROGRAM_ID.toBase58(),
      clusterId: 1,
      playerAuthority: authority,
      characterRootPubkey,
      batchHash: batch.batchHash,
      batchId: batch.batchId,
      signatureScheme: 0,
    },
    serializedMessageBase64: unsigned.serializedMessageBase64,
    serializedTransactionBase64: unsigned.serializedTransactionBase64,
  });
}

describe('settlementLifecycle', () => {
  it('marks a settlement batch prepared and stores the message hash', async () => {
    const batch = buildBatch();
    const chainState = buildChainState(Keypair.generate().publicKey.toBase58());
    const mockPrisma = createMockPrisma({ batches: [batch], chainState });

    const result = await markSettlementBatchPrepared(
      {
        settlementBatchId: batch.id,
        messageSha256Hex: 'aa'.repeat(32),
      },
      {
        prismaClient: mockPrisma.client as never,
        now: () => new Date('2026-04-04T01:00:00.000Z'),
      },
    );

    expect(result.state).toBe('PREPARED');
    expect(result.batch.status).toBe('PREPARED');
    expect(result.batch.latestMessageSha256Hex).toBe('aa'.repeat(32));
    expect(result.batch.preparedAt?.toISOString()).toBe('2026-04-04T01:00:00.000Z');
  });

  it('submits, confirms, and reconciles a settlement batch into committed state', async () => {
    const characterRoot = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey.toBase58();
    const batch = buildBatch();
    const chainState = {
      ...buildChainState(characterRoot.toBase58()),
      playerAuthorityPubkey: authority,
    };
    const mockPrisma = createMockPrisma({ batches: [batch], chainState });
    const prepared = buildPreparedSettlement(batch, authority, characterRoot.toBase58());
    const connection = connectionForCursorSnapshots(characterRoot, [exactCursor(batch)]);

    const result = await submitSettlementBatch(
      {
        settlementBatchId: batch.id,
        prepared,
        signedMessageBase64: prepared.serializedMessageBase64,
        signedTransactionBase64: prepared.serializedTransactionBase64,
      },
      {
        prismaClient: mockPrisma.client as never,
        connection,
        now: () => new Date('2026-04-04T02:00:00.000Z'),
      },
    );

    expect(result.state).toBe('CONFIRMED');
    expect(result.batch.status).toBe('CONFIRMED');
    expect(result.attempt?.status).toBe('CONFIRMED');
    expect(result.cursor).toEqual(exactCursor(batch));
    expect(mockPrisma.client.battleOutcomeLedger.markCommittedForBatch).toHaveBeenCalledWith(
      batch.id,
      new Date('2026-04-04T02:00:00.000Z'),
    );
    expect(mockPrisma.client.character.updateCursorSnapshot).toHaveBeenCalled();
  });

  it('reconciles a submitted batch into retryable state when the signature is unknown', async () => {
    const characterRoot = Keypair.generate().publicKey;
    const batch = buildBatch({
      status: 'SUBMITTED',
      latestTransactionSignature: 'sig-unknown',
      latestMessageSha256Hex: 'aa'.repeat(32),
      latestSignedTxSha256Hex: 'bb'.repeat(32),
      submittedAt: new Date('2026-04-04T02:00:00.000Z'),
    });
    const attempt = buildAttempt({
      status: 'BROADCAST',
      messageSha256Hex: 'aa'.repeat(32),
      signedTransactionSha256Hex: 'bb'.repeat(32),
      transactionSignature: 'sig-unknown',
      submittedAt: new Date('2026-04-04T02:00:00.000Z'),
    });
    const mockPrisma = createMockPrisma({
      batches: [batch],
      chainState: buildChainState(characterRoot.toBase58()),
      attemptsByBatchId: {
        [batch.id]: [attempt],
      },
    });
    const connection = connectionForCursorSnapshots(characterRoot, [priorCursor(batch)]);

    const result = await reconcileSettlementBatch(batch.id, {
      prismaClient: mockPrisma.client as never,
      connection,
      now: () => new Date('2026-04-04T03:00:00.000Z'),
    });

    expect(result.state).toBe('RETRYABLE');
    expect(result.retryDisposition).toBe('SAFE_SAME_PAYLOAD_RETRY');
    expect(result.batch.status).toBe('FAILED');
    expect(result.batch.failureCategory).toBe('SAFE_SAME_PAYLOAD_RETRY');
    expect(result.attempt?.status).toBe('TIMEOUT');
  });

  it('recovers unresolved batches oldest-first without skipping newer backlog', async () => {
    const characterRoot = Keypair.generate().publicKey;
    const first = buildBatch({ id: 'batch-1', batchId: 1, endStateHash: '22'.repeat(32) });
    const second = buildBatch({
      id: 'batch-2',
      batchId: 2,
      startNonce: 4,
      endNonce: 5,
      startStateHash: '22'.repeat(32),
      endStateHash: '44'.repeat(32),
      firstBattleTs: 1_700_000_130,
      lastBattleTs: 1_700_000_140,
    });
    const mockPrisma = createMockPrisma({
      batches: [first, second],
      chainState: buildChainState(characterRoot.toBase58()),
    });
    const connection = connectionForCursorSnapshots(characterRoot, [
      exactCursor(first),
      exactCursor(second),
    ]);

    const results = await recoverUnresolvedSettlementBatches({
      prismaClient: mockPrisma.client as never,
      connection,
      now: () => new Date('2026-04-04T04:00:00.000Z'),
    });

    expect(results.map((result) => `${result.batch.id}:${result.state}`)).toEqual([
      'batch-1:CONFIRMED',
      'batch-2:CONFIRMED',
    ]);
  });
});
