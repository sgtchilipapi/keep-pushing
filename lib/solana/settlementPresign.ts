import { ComputeBudgetProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createHash } from 'node:crypto';

import { prisma } from '../prisma';
import { resolveRunanaProgramId, loadRunanaSponsorPayer } from './runanaClient';
import {
  prepareSolanaSettlement,
} from './settlementRelay';
import { buildPreparedSettlementVersionedTransaction } from './settlementTransactionAssembly';
import {
  deserializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';
import { reconcileSettlementBatch } from './settlementLifecycle';

const SETTLEMENT_REQUEST_TTL_MS = 5 * 60 * 1000;
const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId.toBase58();

function sha256HexFromBase64(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
}

function requireNonEmptyString(value: string, code: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${code}: required value must not be empty`);
  }
  return value;
}

function buildPresignToken(requestId: string): string {
  return requestId;
}

function requireRunSettlementRequestOwnership(
  request: Awaited<ReturnType<typeof prisma.runSettlementRequest.findById>>,
  walletAddress: string,
  options: { allowExpired?: boolean } = {},
) {
  if (request === null) {
    throw new Error('ERR_SETTLEMENT_REQUEST_NOT_FOUND: settlement request was not found');
  }
  if (request.walletAddress !== walletAddress) {
    throw new Error(
      'ERR_AUTH_WALLET_FORBIDDEN: settlement request wallet does not match the active session wallet',
    );
  }
  if (
    !options.allowExpired &&
    request.expiresAt !== null &&
    request.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error('ERR_SETTLEMENT_REQUEST_EXPIRED: settlement request has expired');
  }
  return request;
}

async function ensurePreparedRunSettlement(args: {
  characterId: string;
  zoneRunId: string;
  closedRunSequence: number;
  payloadHash: string;
  prepareMessageHash: string;
  preparedAt: Date;
}) {
  const existing = await prisma.runSettlement.findByZoneRunId(args.zoneRunId);
  if (existing === null) {
    return prisma.runSettlement.create({
      characterId: args.characterId,
      zoneRunId: args.zoneRunId,
      closedRunSequence: args.closedRunSequence,
      settlementSequence: args.closedRunSequence,
      payloadHash: args.payloadHash,
      prepareMessageHash: args.prepareMessageHash,
      status: 'PREPARED',
      preparedAt: args.preparedAt,
    });
  }

  return prisma.runSettlement.update(existing.id, {
    payloadHash: args.payloadHash,
    prepareMessageHash: args.prepareMessageHash,
    status: 'PREPARED',
    failureCode: null,
    latestTransactionSignature: null,
    preparedAt: args.preparedAt,
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
  });
}

function signSponsorTransaction(
  transaction: Transaction | VersionedTransaction,
  sponsorSigner: ReturnType<typeof loadRunanaSponsorPayer>['signer'],
): Transaction | VersionedTransaction {
  if (transaction instanceof Transaction) {
    transaction.partialSign(sponsorSigner);
    return transaction;
  }

  transaction.sign([sponsorSigner]);
  return transaction;
}

function getTransactionFeePayer(transaction: Transaction | VersionedTransaction): string {
  if (transaction instanceof Transaction) {
    return transaction.feePayer?.toBase58() ?? '';
  }
  return transaction.message.staticAccountKeys[0]?.toBase58() ?? '';
}

function getTransactionProgramIds(transaction: Transaction | VersionedTransaction): string[] {
  if (transaction instanceof Transaction) {
    return transaction.instructions.map((instruction) => instruction.programId.toBase58());
  }

  return transaction.message.compiledInstructions.map((instruction) =>
    transaction.message.staticAccountKeys[instruction.programIdIndex]?.toBase58() ?? '',
  );
}

async function invalidateSettlementRequest(
  requestId: string,
  request: Awaited<ReturnType<typeof prisma.runSettlementRequest.findById>>,
  invalidReasonCode: string,
) {
  await prisma.runSettlementRequest.update(requestId, {
    status: 'INVALIDATED',
    invalidReasonCode,
    preparedAt: request?.preparedAt ?? null,
    presignedAt: request?.presignedAt ?? null,
    finalizedAt: request?.finalizedAt ?? null,
    expiresAt: request?.expiresAt ?? null,
  });
}

async function verifyCanonicalSettlementTransaction(args: {
  request: NonNullable<Awaited<ReturnType<typeof prisma.runSettlementRequest.findById>>>;
  transaction: Transaction | VersionedTransaction;
  sponsorFeePayer: string;
}) {
  const feePayer = getTransactionFeePayer(args.transaction);
  if (feePayer !== args.sponsorFeePayer) {
    await invalidateSettlementRequest(
      args.request.id,
      args.request,
      'SETTLEMENT_TX_MISMATCH_FEE_PAYER',
    );
    throw new Error(
      'ERR_SETTLEMENT_TX_MISMATCH_FEE_PAYER: transaction fee payer did not match sponsor signer',
    );
  }

  const allowedProgramId = resolveRunanaProgramId().toBase58();
  const programIds = getTransactionProgramIds(args.transaction);
  const nonComputeProgramIds = programIds.filter((programId) => programId !== COMPUTE_BUDGET_PROGRAM_ID);
  if (nonComputeProgramIds.length !== 1) {
    await invalidateSettlementRequest(
      args.request.id,
      args.request,
      'SETTLEMENT_TX_MISMATCH_INSTRUCTION_SET',
    );
    throw new Error(
      'ERR_SETTLEMENT_TX_MISMATCH_INSTRUCTION_SET: settlement transaction instruction set was not canonical',
    );
  }
  if (nonComputeProgramIds[0] !== allowedProgramId) {
    await invalidateSettlementRequest(
      args.request.id,
      args.request,
      'SETTLEMENT_TX_MISMATCH_PROGRAM_ID',
    );
    throw new Error(
      'ERR_SETTLEMENT_TX_MISMATCH_PROGRAM_ID: settlement transaction program id did not match Runana',
    );
  }
}

export async function prepareSettlementPresignRequest(input: {
  characterId: string;
  zoneRunId: string;
  walletAddress: string;
  sessionId: string;
  idempotencyKey: string;
}) {
  const characterId = requireNonEmptyString(input.characterId, 'ERR_EMPTY_CHARACTER_ID');
  const zoneRunId = requireNonEmptyString(input.zoneRunId, 'ERR_EMPTY_ZONE_RUN_ID');
  const walletAddress = requireNonEmptyString(input.walletAddress, 'ERR_EMPTY_WALLET_ADDRESS');
  const sessionId = requireNonEmptyString(input.sessionId, 'ERR_EMPTY_SESSION_ID');
  const idempotencyKey = requireNonEmptyString(input.idempotencyKey, 'ERR_EMPTY_IDEMPOTENCY_KEY');
  const pendingRuns = await prisma.closedZoneRunSummary.listNextSettleableForCharacter(characterId, 11);
  const oldestPendingRun = pendingRuns[0] ?? null;
  if (oldestPendingRun === null) {
    throw new Error('ERR_NO_PENDING_RUNS: no pending closed runs were available to settle');
  }
  if (oldestPendingRun.zoneRunId !== zoneRunId) {
    throw new Error(
      'ERR_SETTLEMENT_RUN_NOT_OLDEST_PENDING: requested run is not the oldest pending settlement run',
    );
  }
  const existing = await prisma.runSettlementRequest.findByCharacterZoneRunAndIdempotencyKey(
    characterId,
    zoneRunId,
    idempotencyKey,
  );
  if (existing !== null) {
    if (existing.walletAddress !== walletAddress) {
      throw new Error(
        'ERR_AUTH_WALLET_FORBIDDEN: settlement request wallet does not match the active session wallet',
      );
    }
    if (existing.status !== 'INVALIDATED' && existing.status !== 'FAILED') {
      throw new Error(
        'ERR_SETTLEMENT_REQUEST_ALREADY_EXISTS: settlement idempotency key is already in use',
      );
    }
  }

  const prepared = await prepareSolanaSettlement({
    characterId,
    authority: walletAddress,
  }, {
    buildPreparedSettlement: (args) =>
      buildPreparedSettlementVersionedTransaction({
        ...args,
        partialSignSponsor: false,
      }),
  });

  if (prepared.phase === 'submitted') {
    throw new Error('ERR_SETTLEMENT_ALREADY_SUBMITTED: settlement batch is already in flight');
  }

  if (prepared.phase !== 'sign_transaction') {
    throw new Error('ERR_SETTLEMENT_PREPARE_INTERNAL: unexpected settlement preparation phase');
  }

  const now = new Date();
  const closedRunSequence = oldestPendingRun.closedRunSequence;
  if (closedRunSequence === null) {
    throw new Error('ERR_SETTLEMENT_PREPARE_INTERNAL: pending run did not carry a closed sequence');
  }
  const runSettlement = await ensurePreparedRunSettlement({
    characterId,
    zoneRunId,
    closedRunSequence,
    payloadHash: prepared.payload.batchHash,
    prepareMessageHash: prepared.preparedTransaction.messageSha256Hex,
    preparedAt: now,
  });
  if (runSettlement === null) {
    throw new Error('ERR_SETTLEMENT_PREPARE_INTERNAL: failed to persist run settlement');
  }
  const activeRequest = await prisma.runSettlementRequest.findActiveByRunSettlementId(runSettlement.id);
  if (activeRequest !== null && activeRequest.id !== existing?.id) {
    throw new Error(
      'ERR_SETTLEMENT_REQUEST_ALREADY_EXISTS: settlement idempotency key is already in use',
    );
  }
  const requestExpiresAt = new Date(now.getTime() + SETTLEMENT_REQUEST_TTL_MS);
  const request =
    existing === null
      ? await prisma.runSettlementRequest.create({
          runSettlementId: runSettlement.id,
          characterId,
          sessionId,
          walletAddress,
          zoneRunId,
          settlementSequence: runSettlement.settlementSequence,
          payloadHash: runSettlement.payloadHash,
          prepareMessageHash: runSettlement.prepareMessageHash,
          idempotencyKey,
          preparedAt: now,
          expiresAt: requestExpiresAt,
        })
      : await prisma.runSettlementRequest.update(existing.id, {
          runSettlementId: runSettlement.id,
          sessionId,
          walletAddress,
          zoneRunId,
          settlementSequence: runSettlement.settlementSequence,
          payloadHash: runSettlement.payloadHash,
          prepareMessageHash: runSettlement.prepareMessageHash,
          status: 'PREPARED',
          presignedMessageHash: null,
          invalidReasonCode: null,
          preparedAt: now,
          presignedAt: null,
          finalizedAt: null,
          expiresAt: requestExpiresAt,
        });
  if (request === null) {
    throw new Error('ERR_SETTLEMENT_PREPARE_INTERNAL: failed to persist settlement request');
  }

  return {
    prepareRequestId: request.id,
    zoneRunId,
    runSettlementId: runSettlement.id,
    payload: prepared.payload,
    preparedTransaction: prepared.preparedTransaction,
    presignToken: buildPresignToken(request.id),
    expiresAt: request.expiresAt?.toISOString() ?? null,
  };
}

export async function presignSettlementTransaction(input: {
  prepareRequestId: string;
  presignToken: string;
  walletAddress: string;
  transactionBase64: string;
}) {
  const prepareRequestId = requireNonEmptyString(
    input.prepareRequestId,
    'ERR_EMPTY_PREPARE_REQUEST_ID',
  );
  const presignToken = requireNonEmptyString(input.presignToken, 'ERR_EMPTY_PRESIGN_TOKEN');
  const walletAddress = requireNonEmptyString(input.walletAddress, 'ERR_EMPTY_WALLET_ADDRESS');
  const transactionBase64 = requireNonEmptyString(
    input.transactionBase64,
    'ERR_EMPTY_TRANSACTION_BASE64',
  );
  if (presignToken !== buildPresignToken(prepareRequestId)) {
    throw new Error('ERR_SETTLEMENT_PRESIGN_TOKEN_INVALID: presign token did not match request');
  }

  const request = requireRunSettlementRequestOwnership(
    await prisma.runSettlementRequest.findById(prepareRequestId),
    walletAddress,
  );

  if (
    request.status !== 'PREPARED' &&
    request.status !== 'PRESIGNED'
  ) {
    throw new Error(
      'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement request is not in a presignable state',
    );
  }

  const transaction = deserializeLegacyOrVersionedTransactionBase64(transactionBase64);
  const messageBase64 = serializeLegacyOrVersionedTransactionMessageBase64(transaction);
  const messageSha256Hex = sha256HexFromBase64(messageBase64);
  if (request.status === 'PRESIGNED') {
    if (request.presignedMessageHash !== messageSha256Hex) {
      await invalidateSettlementRequest(
        request.id,
        request,
        'SETTLEMENT_TX_MISMATCH_REPLAY_HASH',
      );
      throw new Error(
        'ERR_SETTLEMENT_TX_MISMATCH_REPLAY_HASH: settlement request was already presigned for a different transaction message',
      );
    }

    const sponsorSigner = loadRunanaSponsorPayer().signer;
    const signedTransaction = signSponsorTransaction(transaction, sponsorSigner);
    return {
      prepareRequestId: request.id,
      transactionBase64: serializeLegacyOrVersionedTransactionBase64(signedTransaction),
      messageSha256Hex,
    };
  }

  if (messageSha256Hex !== request.prepareMessageHash) {
    await invalidateSettlementRequest(request.id, request, 'SETTLEMENT_TX_MISMATCH_MESSAGE_HASH');
    throw new Error(
      'ERR_SETTLEMENT_TX_MISMATCH_MESSAGE_HASH: transaction message did not match prepared settlement request',
    );
  }

  const sponsorSigner = loadRunanaSponsorPayer().signer;
  await verifyCanonicalSettlementTransaction({
    request,
    transaction,
    sponsorFeePayer: sponsorSigner.publicKey.toBase58(),
  });
  const signedTransaction = signSponsorTransaction(transaction, sponsorSigner);
  const signedTransactionBase64 = serializeLegacyOrVersionedTransactionBase64(signedTransaction);
  const now = new Date();

  await prisma.runSettlementRequest.update(request.id, {
    status: 'PRESIGNED',
    presignedMessageHash: messageSha256Hex,
    preparedAt: request.preparedAt,
    presignedAt: now,
    finalizedAt: request.finalizedAt,
    expiresAt: request.expiresAt,
  });

  return {
    prepareRequestId: request.id,
    transactionBase64: signedTransactionBase64,
    messageSha256Hex,
  };
}

export async function finalizeSettlementPresignRequest(input: {
  prepareRequestId: string;
  walletAddress: string;
  transactionSignature: string;
}) {
  const prepareRequestId = requireNonEmptyString(
    input.prepareRequestId,
    'ERR_EMPTY_PREPARE_REQUEST_ID',
  );
  const walletAddress = requireNonEmptyString(input.walletAddress, 'ERR_EMPTY_WALLET_ADDRESS');
  const transactionSignature = requireNonEmptyString(
    input.transactionSignature,
    'ERR_EMPTY_TRANSACTION_SIGNATURE',
  );
  const request = requireRunSettlementRequestOwnership(
    await prisma.runSettlementRequest.findById(prepareRequestId),
    walletAddress,
    { allowExpired: true },
  );
  if (
    request.status !== 'PRESIGNED' &&
    request.status !== 'SUBMITTED' &&
    request.status !== 'CONFIRMED'
  ) {
    throw new Error(
      'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement request is not in a finalizable state',
    );
  }
  const runSettlement = await prisma.runSettlement.findById(request.runSettlementId);
  if (runSettlement === null || runSettlement.zoneRunId !== request.zoneRunId) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch was not found');
  }
  const batch = await prisma.settlementBatch.findByCharacterAndBatchHash(
    request.characterId,
    request.payloadHash,
  );
  if (batch === null) {
    throw new Error('ERR_SETTLEMENT_BATCH_NOT_FOUND: settlement batch was not found');
  }
  if (
    request.status === 'PRESIGNED' &&
    batch.latestTransactionSignature !== null &&
    batch.latestTransactionSignature !== transactionSignature
  ) {
    throw new Error(
      'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement batch was already submitted with a different transaction signature',
    );
  }
  if (request.status === 'SUBMITTED' || request.status === 'CONFIRMED') {
    if (batch.latestTransactionSignature !== transactionSignature) {
      throw new Error(
        'ERR_SETTLEMENT_REQUEST_STATE_INVALID: settlement request was already finalized with a different transaction signature',
      );
    }
    return {
      phase: batch.status === 'CONFIRMED' ? 'confirmed' : 'submitted',
      runSettlementId: runSettlement.id,
      transactionSignature,
    } as const;
  }

  const now = new Date();
  await prisma.settlementBatch.updateStatus(batch.id, {
    status: 'SUBMITTED',
    failureCategory: null,
    failureCode: null,
    latestMessageSha256Hex: request.presignedMessageHash ?? request.prepareMessageHash,
    latestTransactionSignature: transactionSignature,
    preparedAt: batch.preparedAt ?? request.preparedAt ?? now,
    submittedAt: now,
  });
  await prisma.runSettlement.update(runSettlement.id, {
    status: 'SUBMITTED',
    payloadHash: request.payloadHash,
    prepareMessageHash: request.prepareMessageHash,
    failureCode: null,
    latestTransactionSignature: transactionSignature,
    preparedAt: runSettlement.preparedAt ?? request.preparedAt ?? now,
    submittedAt: now,
    confirmedAt: null,
    failedAt: null,
  });

  const attempts = await prisma.settlementSubmissionAttempt.listByBatch(batch.id);
  const latest = attempts.at(-1) ?? null;
  if (latest === null || latest.transactionSignature !== transactionSignature) {
    await prisma.settlementSubmissionAttempt.create({
      settlementBatchId: batch.id,
      attemptNumber: (latest?.attemptNumber ?? 0) + 1,
      status: 'BROADCAST',
      messageSha256Hex: request.presignedMessageHash ?? request.prepareMessageHash,
      transactionSignature,
      submittedAt: now,
    });
  }

  const reconciled = await reconcileSettlementBatch(batch.id);
  const isConfirmed = reconciled.state === 'CONFIRMED';
  await prisma.runSettlementRequest.update(request.id, {
    status: isConfirmed ? 'CONFIRMED' : 'SUBMITTED',
    presignedMessageHash: request.presignedMessageHash ?? request.prepareMessageHash,
    preparedAt: request.preparedAt,
    presignedAt: request.presignedAt ?? now,
    finalizedAt: now,
    expiresAt: request.expiresAt,
  });
  await prisma.runSettlement.update(runSettlement.id, {
    status: isConfirmed ? 'CONFIRMED' : 'SUBMITTED',
    payloadHash: request.payloadHash,
    prepareMessageHash: request.prepareMessageHash,
    failureCode: isConfirmed ? null : runSettlement.failureCode,
    latestTransactionSignature: transactionSignature,
    preparedAt: runSettlement.preparedAt ?? request.preparedAt ?? now,
    submittedAt: runSettlement.submittedAt ?? now,
    confirmedAt: isConfirmed ? now : null,
    failedAt: isConfirmed ? null : runSettlement.failedAt,
  });

  return {
    phase: isConfirmed ? 'confirmed' : 'submitted',
    runSettlementId: runSettlement.id,
    transactionSignature,
  } as const;
}
