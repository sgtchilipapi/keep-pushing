import { type Commitment, type Connection, PublicKey } from '@solana/web3.js';

import type {
  SettlementBatchRecord,
  SettlementSubmissionAttemptRecord,
  UpdateSettlementBatchStatusInput,
  UpdateSettlementSubmissionAttemptInput,
} from '../prisma';
import { prisma } from '../prisma';
import type { SubmittedPlayerOwnedTransaction } from '../../types/api/solana';
import {
  acceptSignedPlayerOwnedTransaction,
} from './playerOwnedTransactions';
import {
  deserializeVersionedTransactionBase64,
  serializeVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';
import {
  accountStateHashHex,
  fetchCharacterSettlementBatchCursorAccount,
} from './runanaAccounts';
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from './runanaClient';
import { deriveCharacterBatchCursorPda } from './runanaProgram';

export type SettlementLifecycleState =
  | 'PREPARED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'RETRYABLE';

export type SettlementRetryDisposition =
  | 'SAFE_SAME_PAYLOAD_RETRY'
  | 'REBUILD_AND_RETRY'
  | 'STATE_REPAIR_REQUIRED'
  | 'PERMANENT_REJECTION'
  | 'NONE';

export interface SettlementCursorSnapshot {
  lastCommittedEndNonce: number;
  lastCommittedStateHash: string;
  lastCommittedBatchId: number;
  lastCommittedBattleTs: number;
  lastCommittedSeasonId: number;
}

export interface SettlementLifecycleResult {
  state: SettlementLifecycleState;
  retryDisposition: SettlementRetryDisposition;
  batch: SettlementBatchRecord;
  attempt: SettlementSubmissionAttemptRecord | null;
  cursor: SettlementCursorSnapshot | null;
  errorMessage?: string;
}

export interface MarkSettlementBatchPreparedInput {
  settlementBatchId: string;
  messageSha256Hex: string;
}

export interface SubmitSettlementBatchInput {
  settlementBatchId: string;
  prepared: Parameters<typeof acceptSignedPlayerOwnedTransaction>[0]['prepared'];
  signedMessageBase64: string;
  signedTransactionBase64: string;
}

export interface AcknowledgeSettlementBatchInput {
  settlementBatchId: string;
  prepared: Parameters<typeof acceptSignedPlayerOwnedTransaction>[0]['prepared'];
  transactionSignature: string;
}

type SettlementConnection = Pick<
  Connection,
  'getAccountInfo' | 'sendRawTransaction' | 'confirmTransaction' | 'getSignatureStatuses'
>;

type SettlementPrismaLike = {
  character: Pick<typeof prisma.character, 'findChainState' | 'updateCursorSnapshot'>;
  battleOutcomeLedger: Pick<typeof prisma.battleOutcomeLedger, 'markCommittedForBatch'>;
  settlementBatch: Pick<
    typeof prisma.settlementBatch,
    'findById' | 'findNextUnconfirmedForCharacter' | 'listUnconfirmed' | 'updateStatus'
  >;
  settlementSubmissionAttempt: Pick<
    typeof prisma.settlementSubmissionAttempt,
    'create' | 'listByBatch' | 'update'
  >;
};

export interface SettlementLifecycleDependencies {
  connection?: SettlementConnection;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  prismaClient?: SettlementPrismaLike;
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function parseFailureCode(message: string, fallback: string): string {
  const match = message.match(/^([A-Z0-9_]+):/);
  return match?.[1] ?? fallback;
}

function toCursorSnapshot(cursor: Awaited<ReturnType<typeof fetchCharacterSettlementBatchCursorAccount>>): SettlementCursorSnapshot {
  return {
    lastCommittedEndNonce: Number(cursor.lastCommittedEndNonce),
    lastCommittedStateHash: accountStateHashHex(cursor.lastCommittedStateHash),
    lastCommittedBatchId: Number(cursor.lastCommittedBatchId),
    lastCommittedBattleTs: Number(cursor.lastCommittedBattleTs),
    lastCommittedSeasonId: cursor.lastCommittedSeasonId,
  };
}

function isExactlyCommitted(batch: SettlementBatchRecord, cursor: SettlementCursorSnapshot): boolean {
  return (
    cursor.lastCommittedBatchId === batch.batchId &&
    cursor.lastCommittedEndNonce === batch.endNonce &&
    cursor.lastCommittedStateHash === batch.endStateHash &&
    cursor.lastCommittedBattleTs === batch.lastBattleTs &&
    cursor.lastCommittedSeasonId === batch.seasonId
  );
}

function isCursorBeyondBatch(batch: SettlementBatchRecord, cursor: SettlementCursorSnapshot): boolean {
  return (
    cursor.lastCommittedBatchId > batch.batchId ||
    cursor.lastCommittedEndNonce > batch.endNonce ||
    cursor.lastCommittedBattleTs > batch.lastBattleTs ||
    cursor.lastCommittedSeasonId > batch.seasonId
  );
}

function classifyFailure(errorLike: unknown): {
  state: SettlementLifecycleState;
  retryDisposition: SettlementRetryDisposition;
  failureCategory: string;
  failureCode: string;
  attemptStatus: SettlementSubmissionAttemptRecord['status'];
  rpcError: string;
} {
  const message = errorLike instanceof Error ? errorLike.message : String(errorLike);
  const lowered = message.toLowerCase();

  if (
    lowered.includes('timeout') ||
    lowered.includes('timed out') ||
    lowered.includes('429') ||
    lowered.includes('503') ||
    lowered.includes('fetch failed') ||
    lowered.includes('signature status unknown') ||
    lowered.includes('signature_status_unknown')
  ) {
    return {
      state: 'RETRYABLE',
      retryDisposition: 'SAFE_SAME_PAYLOAD_RETRY',
      failureCategory: 'SAFE_SAME_PAYLOAD_RETRY',
      failureCode: parseFailureCode(message, 'ERR_SETTLEMENT_TRANSPORT_TIMEOUT'),
      attemptStatus: 'TIMEOUT',
      rpcError: message,
    };
  }

  if (
    lowered.includes('blockhash not found') ||
    lowered.includes('signature verification failed') ||
    message.startsWith('ERR_SIGNED_') ||
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_PLAYER_MUST_PAY')
  ) {
    return {
      state: 'RETRYABLE',
      retryDisposition: 'REBUILD_AND_RETRY',
      failureCategory: 'REBUILD_AND_RETRY',
      failureCode: parseFailureCode(message, 'ERR_SETTLEMENT_REBUILD_REQUIRED'),
      attemptStatus: 'FAILED',
      rpcError: message,
    };
  }

  if (message.startsWith('ERR_UNTRUSTED_SERVER_SIGNER') || message.startsWith('ERR_MISSING_')) {
    return {
      state: 'FAILED',
      retryDisposition: 'STATE_REPAIR_REQUIRED',
      failureCategory: 'STATE_REPAIR_REQUIRED',
      failureCode: parseFailureCode(message, 'ERR_SETTLEMENT_STATE_REPAIR_REQUIRED'),
      attemptStatus: 'FAILED',
      rpcError: message,
    };
  }

  return {
    state: 'FAILED',
    retryDisposition: 'PERMANENT_REJECTION',
    failureCategory: 'PERMANENT_REJECTION',
    failureCode: parseFailureCode(message, 'ERR_SETTLEMENT_PERMANENT_FAILURE'),
    attemptStatus: 'FAILED',
    rpcError: message,
  };
}

function mergeBatchStatus(
  batch: SettlementBatchRecord,
  patch: UpdateSettlementBatchStatusInput,
): UpdateSettlementBatchStatusInput {
  return {
    status: patch.status,
    failureCategory: 'failureCategory' in patch ? patch.failureCategory ?? null : batch.failureCategory,
    failureCode: 'failureCode' in patch ? patch.failureCode ?? null : batch.failureCode,
    latestMessageSha256Hex:
      'latestMessageSha256Hex' in patch
        ? patch.latestMessageSha256Hex ?? null
        : batch.latestMessageSha256Hex,
    latestSignedTxSha256Hex:
      'latestSignedTxSha256Hex' in patch
        ? patch.latestSignedTxSha256Hex ?? null
        : batch.latestSignedTxSha256Hex,
    latestTransactionSignature:
      'latestTransactionSignature' in patch
        ? patch.latestTransactionSignature ?? null
        : batch.latestTransactionSignature,
    preparedAt: 'preparedAt' in patch ? patch.preparedAt ?? null : batch.preparedAt,
    submittedAt: 'submittedAt' in patch ? patch.submittedAt ?? null : batch.submittedAt,
    confirmedAt: 'confirmedAt' in patch ? patch.confirmedAt ?? null : batch.confirmedAt,
    failedAt: 'failedAt' in patch ? patch.failedAt ?? null : batch.failedAt,
  };
}

function mergeAttemptStatus(
  attempt: SettlementSubmissionAttemptRecord,
  patch: UpdateSettlementSubmissionAttemptInput,
): UpdateSettlementSubmissionAttemptInput {
  return {
    status: patch.status,
    messageSha256Hex:
      'messageSha256Hex' in patch ? patch.messageSha256Hex ?? null : attempt.messageSha256Hex,
    signedTransactionSha256Hex:
      'signedTransactionSha256Hex' in patch
        ? patch.signedTransactionSha256Hex ?? null
        : attempt.signedTransactionSha256Hex,
    transactionSignature:
      'transactionSignature' in patch
        ? patch.transactionSignature ?? null
        : attempt.transactionSignature,
    rpcError: 'rpcError' in patch ? patch.rpcError ?? null : attempt.rpcError,
    submittedAt: 'submittedAt' in patch ? patch.submittedAt ?? null : attempt.submittedAt,
    resolvedAt: 'resolvedAt' in patch ? patch.resolvedAt ?? null : attempt.resolvedAt,
  };
}

async function requireBatch(
  prismaClient: SettlementPrismaLike,
  settlementBatchId: string,
): Promise<SettlementBatchRecord> {
  const batch = await prismaClient.settlementBatch.findById(settlementBatchId);
  if (batch === null) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch was not found');
  }
  return batch;
}

async function requireChainState(prismaClient: SettlementPrismaLike, characterId: string) {
  const chainState = await prismaClient.character.findChainState(characterId);
  if (chainState === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: character chain state was not found');
  }
  if (chainState.characterRootPubkey === null) {
    throw new Error('ERR_CHARACTER_CHAIN_IDENTITY_MISSING: character root pubkey was missing');
  }
  return chainState;
}

async function assertOldestUnresolvedBatch(
  prismaClient: SettlementPrismaLike,
  batch: SettlementBatchRecord,
): Promise<void> {
  const oldest = await prismaClient.settlementBatch.findNextUnconfirmedForCharacter(batch.characterId);
  if (oldest !== null && oldest.id !== batch.id) {
    throw new Error(
      'ERR_SETTLEMENT_OUT_OF_ORDER: an older unresolved settlement batch is still blocking this character',
    );
  }
}

async function loadLiveCursor(args: {
  connection: SettlementConnection;
  commitment?: Commitment;
  programId: PublicKey;
  characterRootPubkey: string;
}): Promise<SettlementCursorSnapshot> {
  const cursor = await fetchCharacterSettlementBatchCursorAccount(
    args.connection as Connection,
    deriveCharacterBatchCursorPda(new PublicKey(args.characterRootPubkey), args.programId),
    args.commitment,
  );

  return toCursorSnapshot(cursor);
}

function assertAcceptedSettlementMatchesBatch(
  batch: SettlementBatchRecord,
  accepted: SubmittedPlayerOwnedTransaction,
): void {
  const relay = accepted.settlementRelay;
  if (relay === undefined) {
    throw new Error('ERR_INVALID_SETTLEMENT_SUBMISSION: settlement relay metadata was missing');
  }

  if (relay.batchId !== batch.batchId || relay.batchHash !== batch.batchHash) {
    throw new Error('ERR_SETTLEMENT_BATCH_RELAY_MISMATCH: relay metadata did not match the stored batch');
  }

  if (
    relay.startNonce !== batch.startNonce ||
    relay.endNonce !== batch.endNonce ||
    relay.startStateHash !== batch.startStateHash ||
    relay.endStateHash !== batch.endStateHash
  ) {
    throw new Error('ERR_SETTLEMENT_PAYLOAD_RELAY_MISMATCH: relay cursor anchors did not match the stored batch');
  }
}

async function persistConfirmedBatch(args: {
  prismaClient: SettlementPrismaLike;
  batch: SettlementBatchRecord;
  attempt: SettlementSubmissionAttemptRecord | null;
  cursor: SettlementCursorSnapshot;
  now: Date;
}): Promise<SettlementLifecycleResult> {
  const confirmedBatch = await args.prismaClient.settlementBatch.updateStatus(
    args.batch.id,
    mergeBatchStatus(args.batch, {
      status: 'CONFIRMED',
      failureCategory: null,
      failureCode: null,
      confirmedAt: args.now,
    }),
  );
  if (confirmedBatch === null) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch disappeared during confirmation');
  }

  await args.prismaClient.battleOutcomeLedger.markCommittedForBatch(args.batch.id, args.now);
  await args.prismaClient.character.updateCursorSnapshot(args.batch.characterId, {
    lastReconciledEndNonce: args.cursor.lastCommittedEndNonce,
    lastReconciledStateHash: args.cursor.lastCommittedStateHash,
    lastReconciledBatchId: args.cursor.lastCommittedBatchId,
    lastReconciledBattleTs: args.cursor.lastCommittedBattleTs,
    lastReconciledSeasonId: args.cursor.lastCommittedSeasonId,
    lastReconciledAt: args.now,
  });

  const confirmedAttempt =
    args.attempt === null
      ? null
      : await args.prismaClient.settlementSubmissionAttempt.update(
          args.attempt.id,
          mergeAttemptStatus(args.attempt, {
            status: 'CONFIRMED',
            resolvedAt: args.now,
          }),
        );

  return {
    state: 'CONFIRMED',
    retryDisposition: 'NONE',
    batch: confirmedBatch,
    attempt: confirmedAttempt,
    cursor: args.cursor,
  };
}

async function persistFailure(args: {
  prismaClient: SettlementPrismaLike;
  batch: SettlementBatchRecord;
  attempt: SettlementSubmissionAttemptRecord | null;
  classification: ReturnType<typeof classifyFailure>;
  now: Date;
  messageSha256Hex?: string | null;
  signedTransactionSha256Hex?: string | null;
  transactionSignature?: string | null;
}): Promise<SettlementLifecycleResult> {
  const failedBatch = await args.prismaClient.settlementBatch.updateStatus(
    args.batch.id,
    mergeBatchStatus(args.batch, {
      status: 'FAILED',
      failureCategory: args.classification.failureCategory,
      failureCode: args.classification.failureCode,
      latestMessageSha256Hex: args.messageSha256Hex ?? args.batch.latestMessageSha256Hex,
      latestSignedTxSha256Hex:
        args.signedTransactionSha256Hex ?? args.batch.latestSignedTxSha256Hex,
      latestTransactionSignature:
        args.transactionSignature ?? args.batch.latestTransactionSignature,
      failedAt: args.now,
    }),
  );
  if (failedBatch === null) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch disappeared during failure persistence');
  }

  const failedAttempt =
    args.attempt === null
      ? null
      : await args.prismaClient.settlementSubmissionAttempt.update(
          args.attempt.id,
          mergeAttemptStatus(args.attempt, {
            status: args.classification.attemptStatus,
            messageSha256Hex: args.messageSha256Hex ?? args.attempt.messageSha256Hex,
            signedTransactionSha256Hex:
              args.signedTransactionSha256Hex ?? args.attempt.signedTransactionSha256Hex,
            transactionSignature: args.transactionSignature ?? args.attempt.transactionSignature,
            rpcError: args.classification.rpcError,
            resolvedAt: args.now,
          }),
        );

  return {
    state: args.classification.state,
    retryDisposition: args.classification.retryDisposition,
    batch: failedBatch,
    attempt: failedAttempt,
    cursor: null,
    errorMessage: args.classification.rpcError,
  };
}

export async function markSettlementBatchPrepared(
  input: MarkSettlementBatchPreparedInput,
  deps: SettlementLifecycleDependencies = {},
): Promise<SettlementLifecycleResult> {
  assertNonEmptyString(input.settlementBatchId, 'settlementBatchId');
  assertNonEmptyString(input.messageSha256Hex, 'messageSha256Hex');

  const prismaClient = deps.prismaClient ?? prisma;
  const now = (deps.now ?? (() => new Date()))();
  const batch = await requireBatch(prismaClient, input.settlementBatchId);
  await assertOldestUnresolvedBatch(prismaClient, batch);

  const preparedBatch = await prismaClient.settlementBatch.updateStatus(
    batch.id,
    mergeBatchStatus(batch, {
      status: 'PREPARED',
      failureCategory: null,
      failureCode: null,
      latestMessageSha256Hex: input.messageSha256Hex,
      preparedAt: now,
    }),
  );
  if (preparedBatch === null) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch disappeared during prepare');
  }

  return {
    state: 'PREPARED',
    retryDisposition: 'NONE',
    batch: preparedBatch,
    attempt: null,
    cursor: null,
  };
}

export async function reconcileSettlementBatch(
  settlementBatchId: string,
  deps: SettlementLifecycleDependencies = {},
): Promise<SettlementLifecycleResult> {
  assertNonEmptyString(settlementBatchId, 'settlementBatchId');

  const prismaClient = deps.prismaClient ?? prisma;
  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const now = (deps.now ?? (() => new Date()))();

  const batch = await requireBatch(prismaClient, settlementBatchId);
  await assertOldestUnresolvedBatch(prismaClient, batch);
  const chainState = await requireChainState(prismaClient, batch.characterId);
  const attempts = await prismaClient.settlementSubmissionAttempt.listByBatch(batch.id);
  const latestAttempt = attempts.at(-1) ?? null;
  const liveCursor = await loadLiveCursor({
    connection,
    commitment,
    programId,
    characterRootPubkey: chainState.characterRootPubkey!,
  });

  if (isExactlyCommitted(batch, liveCursor)) {
    return persistConfirmedBatch({
      prismaClient,
      batch,
      attempt: latestAttempt,
      cursor: liveCursor,
      now,
    });
  }

  if (isCursorBeyondBatch(batch, liveCursor)) {
    return persistFailure({
      prismaClient,
      batch,
      attempt: latestAttempt,
      classification: classifyFailure(
        new Error('ERR_SETTLEMENT_CURSOR_DIVERGENCE: live cursor advanced beyond the unresolved batch'),
      ),
      now,
    });
  }

  if (batch.latestTransactionSignature !== null) {
    const statuses = await connection.getSignatureStatuses(
      [batch.latestTransactionSignature],
      { searchTransactionHistory: true },
    );
    const signatureStatus = statuses.value[0];

    if (signatureStatus === null) {
      return persistFailure({
        prismaClient,
        batch,
        attempt: latestAttempt,
        classification: classifyFailure(
          new Error('ERR_SETTLEMENT_SIGNATURE_STATUS_UNKNOWN: transaction signature was not found on chain'),
        ),
        now,
      });
    }

    if (signatureStatus.err !== null) {
      return persistFailure({
        prismaClient,
        batch,
        attempt: latestAttempt,
        classification: classifyFailure(
          new Error(`ERR_SETTLEMENT_SIGNATURE_FAILED: ${JSON.stringify(signatureStatus.err)}`),
        ),
        now,
        transactionSignature: batch.latestTransactionSignature,
      });
    }

    return {
      state: 'SUBMITTED',
      retryDisposition: 'NONE',
      batch,
      attempt: latestAttempt,
      cursor: liveCursor,
    };
  }

  if (batch.status === 'FAILED' && batch.failureCategory !== null) {
    return {
      state:
        batch.failureCategory === 'SAFE_SAME_PAYLOAD_RETRY' ||
        batch.failureCategory === 'REBUILD_AND_RETRY'
          ? 'RETRYABLE'
          : 'FAILED',
      retryDisposition:
        batch.failureCategory === 'SAFE_SAME_PAYLOAD_RETRY' ||
        batch.failureCategory === 'REBUILD_AND_RETRY' ||
        batch.failureCategory === 'STATE_REPAIR_REQUIRED' ||
        batch.failureCategory === 'PERMANENT_REJECTION'
          ? (batch.failureCategory as SettlementRetryDisposition)
          : 'NONE',
      batch,
      attempt: latestAttempt,
      cursor: liveCursor,
      errorMessage: batch.failureCode ?? undefined,
    };
  }

  return {
    state: batch.status === 'SEALED' || batch.status === 'PREPARED' ? 'PREPARED' : 'SUBMITTED',
    retryDisposition: 'NONE',
    batch,
    attempt: latestAttempt,
    cursor: liveCursor,
  };
}

export async function submitSettlementBatch(
  input: SubmitSettlementBatchInput,
  deps: SettlementLifecycleDependencies = {},
): Promise<SettlementLifecycleResult> {
  assertNonEmptyString(input.settlementBatchId, 'settlementBatchId');
  const accepted = acceptSignedPlayerOwnedTransaction({
    prepared: input.prepared,
    signedMessageBase64: input.signedMessageBase64,
    signedTransactionBase64: input.signedTransactionBase64,
  });

  if (accepted.kind !== 'battle_settlement' || accepted.settlementRelay === undefined) {
    throw new Error('ERR_INVALID_SETTLEMENT_SUBMISSION: signed submission was not a settlement transaction');
  }

  const deserializedTransaction = deserializeVersionedTransactionBase64(accepted.signedTransactionBase64);
  const signedMessageBase64 = serializeVersionedTransactionMessageBase64(deserializedTransaction);
  if (signedMessageBase64 !== input.prepared.serializedMessageBase64) {
    throw new Error(
      'ERR_SIGNED_TRANSACTION_MESSAGE_MISMATCH: signed transaction bytes did not match the prepared settlement message',
    );
  }

  const prismaClient = deps.prismaClient ?? prisma;
  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const now = (deps.now ?? (() => new Date()))();

  let batch = await requireBatch(prismaClient, input.settlementBatchId);
  await assertOldestUnresolvedBatch(prismaClient, batch);
  if (batch.status === 'CONFIRMED') {
    return reconcileSettlementBatch(batch.id, deps);
  }

  assertAcceptedSettlementMatchesBatch(batch, accepted);

  batch =
    (await prismaClient.settlementBatch.updateStatus(
      batch.id,
      mergeBatchStatus(batch, {
        status: 'PREPARED',
        failureCategory: null,
        failureCode: null,
        latestMessageSha256Hex: accepted.messageSha256Hex,
        preparedAt: batch.preparedAt ?? now,
      }),
    )) ?? batch;

  const priorAttempts = await prismaClient.settlementSubmissionAttempt.listByBatch(batch.id);
  let attempt = await prismaClient.settlementSubmissionAttempt.create({
    settlementBatchId: batch.id,
    attemptNumber: (priorAttempts.at(-1)?.attemptNumber ?? 0) + 1,
    status: 'STARTED',
    messageSha256Hex: accepted.messageSha256Hex,
  });

  const rawTransaction = Buffer.from(accepted.signedTransactionBase64, 'base64');
  let transactionSignature: string | null = null;

  try {
    transactionSignature = await connection.sendRawTransaction(rawTransaction, {
      preflightCommitment: commitment,
      skipPreflight: false,
      maxRetries: 3,
    });

    attempt =
      (await prismaClient.settlementSubmissionAttempt.update(
        attempt.id,
        mergeAttemptStatus(attempt, {
          status: 'BROADCAST',
          signedTransactionSha256Hex: accepted.signedTransactionSha256Hex,
          transactionSignature,
          submittedAt: now,
        }),
      )) ?? attempt;

    batch =
      (await prismaClient.settlementBatch.updateStatus(
        batch.id,
        mergeBatchStatus(batch, {
          status: 'SUBMITTED',
          failureCategory: null,
          failureCode: null,
          latestMessageSha256Hex: accepted.messageSha256Hex,
          latestSignedTxSha256Hex: accepted.signedTransactionSha256Hex,
          latestTransactionSignature: transactionSignature,
          submittedAt: now,
        }),
      )) ?? batch;

    const confirmation = await connection.confirmTransaction(transactionSignature, commitment);
    if (confirmation.value.err !== null) {
      throw new Error(
        `ERR_SETTLEMENT_CONFIRMATION_FAILED: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    return reconcileSettlementBatch(batch.id, deps);
  } catch (error) {
    if (transactionSignature !== null) {
      const recovered = await reconcileSettlementBatch(batch.id, deps);
      if (recovered.state === 'CONFIRMED' || recovered.state === 'SUBMITTED') {
        return recovered;
      }
    }

    return persistFailure({
      prismaClient,
      batch,
      attempt,
      classification: classifyFailure(error),
      now,
      messageSha256Hex: accepted.messageSha256Hex,
      signedTransactionSha256Hex: accepted.signedTransactionSha256Hex,
      transactionSignature,
    });
  }
}

export async function acknowledgeSettlementBatchClientSubmission(
  input: AcknowledgeSettlementBatchInput,
  deps: SettlementLifecycleDependencies = {},
): Promise<SettlementLifecycleResult> {
  assertNonEmptyString(input.settlementBatchId, 'settlementBatchId');
  assertNonEmptyString(input.transactionSignature, 'transactionSignature');

  const prismaClient = deps.prismaClient ?? prisma;
  const now = (deps.now ?? (() => new Date()))();

  let batch = await requireBatch(prismaClient, input.settlementBatchId);
  await assertOldestUnresolvedBatch(prismaClient, batch);
  if (batch.status === 'CONFIRMED') {
    return reconcileSettlementBatch(batch.id, deps);
  }

  const relay = input.prepared.settlementRelay;
  if (relay === undefined) {
    throw new Error('ERR_INVALID_SETTLEMENT_SUBMISSION: settlement relay metadata was missing');
  }
  if (relay.batchId !== batch.batchId || relay.batchHash !== batch.batchHash) {
    throw new Error('ERR_SETTLEMENT_BATCH_RELAY_MISMATCH: relay metadata did not match the stored batch');
  }
  if (
    relay.startNonce !== batch.startNonce ||
    relay.endNonce !== batch.endNonce ||
    relay.startStateHash !== batch.startStateHash ||
    relay.endStateHash !== batch.endStateHash
  ) {
    throw new Error('ERR_SETTLEMENT_PAYLOAD_RELAY_MISMATCH: relay cursor anchors did not match the stored batch');
  }

  if (batch.latestTransactionSignature === input.transactionSignature && batch.status === 'SUBMITTED') {
    return reconcileSettlementBatch(batch.id, deps);
  }

  batch =
    (await prismaClient.settlementBatch.updateStatus(
      batch.id,
      mergeBatchStatus(batch, {
        status: 'SUBMITTED',
        failureCategory: null,
        failureCode: null,
        latestMessageSha256Hex: input.prepared.messageSha256Hex,
        latestTransactionSignature: input.transactionSignature,
        preparedAt: batch.preparedAt ?? now,
        submittedAt: now,
      }),
    )) ?? batch;

  const priorAttempts = await prismaClient.settlementSubmissionAttempt.listByBatch(batch.id);
  const latestAttempt = priorAttempts.at(-1) ?? null;
  let attempt: SettlementSubmissionAttemptRecord;
  if (
    latestAttempt !== null &&
    latestAttempt.transactionSignature === input.transactionSignature &&
    (latestAttempt.status === 'BROADCAST' || latestAttempt.status === 'CONFIRMED')
  ) {
    attempt = latestAttempt;
  } else {
    attempt = await prismaClient.settlementSubmissionAttempt.create({
      settlementBatchId: batch.id,
      attemptNumber: (latestAttempt?.attemptNumber ?? 0) + 1,
      status: 'BROADCAST',
      messageSha256Hex: input.prepared.messageSha256Hex,
      transactionSignature: input.transactionSignature,
      submittedAt: now,
    });
  }

  const reconciled = await reconcileSettlementBatch(batch.id, deps);
  return reconciled.attempt ?? null ? reconciled : { ...reconciled, attempt };
}

export async function recoverUnresolvedSettlementBatches(
  deps: SettlementLifecycleDependencies & { limit?: number } = {},
): Promise<SettlementLifecycleResult[]> {
  const prismaClient = deps.prismaClient ?? prisma;
  const batches = await prismaClient.settlementBatch.listUnconfirmed(deps.limit);
  const results: SettlementLifecycleResult[] = [];

  for (const batch of batches) {
    const oldest = await prismaClient.settlementBatch.findNextUnconfirmedForCharacter(batch.characterId);
    if (oldest?.id !== batch.id) {
      continue;
    }

    results.push(await reconcileSettlementBatch(batch.id, deps));
  }

  return results;
}
