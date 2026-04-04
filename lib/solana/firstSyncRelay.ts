import {
  AddressLookupTableAccount,
  Ed25519Program,
  Keypair,
  PublicKey,
  type Commitment,
  type Connection,
} from '@solana/web3.js';

import type {
  FirstSyncPreparationBase,
  PrepareFirstSyncRouteRequest,
  PrepareFirstSyncRouteResponse,
  SettlementCursorExpectation,
  SettlementPermitDomain,
  SubmitFirstSyncRouteRequest,
  SubmitFirstSyncRouteResponse,
} from '../../types/api/solana';
import { prisma, type SettlementBatchRecord } from '../prisma';
import {
  acceptSignedPlayerOwnedTransaction,
  prepareFirstSyncTransaction,
} from './playerOwnedTransactions';
import {
  type PrepareFirstSyncRebaseInput,
  prepareFirstSyncRebase,
} from './firstSyncRebasing';
import {
  buildPreparedVersionedTransaction,
  deserializeVersionedTransactionBase64,
  serializeVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';
import { buildCreateCharacterInstruction } from './runanaCharacterInstructions';
import {
  accountCharacterIdHex,
  accountStateHashHex,
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
} from './runanaAccounts';
import {
  buildCanonicalSettlementInstructionAccounts,
} from './runanaSettlementEnvelope';
import {
  buildApplyBattleSettlementBatchV1Instruction,
  buildCanonicalSettlementMessages,
} from './runanaSettlementInstructions';
import {
  createRunanaConnection,
  loadRunanaSettlementLookupTables,
  loadRunanaTrustedServerSigner,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from './runanaClient';
import {
  deriveCharacterBatchCursorPda,
  deriveProgramConfigPda,
  RUNANA_CLUSTER_ID_LOCALNET,
} from './runanaProgram';

type FirstSyncRelayConnection = Pick<Connection, 'getAccountInfo' | 'getLatestBlockhash'>;
type FirstSyncSubmissionConnection = Pick<
  Connection,
  'getAccountInfo' | 'sendRawTransaction' | 'confirmTransaction'
>;

export interface FirstSyncRelayDependencies {
  connection?: FirstSyncRelayConnection;
  commitment?: Commitment;
  programId?: PublicKey;
  clusterId?: number;
  serverSigner?: Keypair;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  prepareFirstSyncRebase?: (
    input: PrepareFirstSyncRebaseInput,
    deps?: Parameters<typeof prepareFirstSyncRebase>[1],
  ) => ReturnType<typeof prepareFirstSyncRebase>;
  buildPreparedTransaction?: typeof buildPreparedVersionedTransaction;
}

type FirstSyncPrismaLike = {
  character: Pick<
    typeof prisma.character,
    'findChainState' | 'updateChainIdentity' | 'updateCursorSnapshot'
  >;
  battleOutcomeLedger: Pick<typeof prisma.battleOutcomeLedger, 'markCommittedForBatch'>;
  settlementBatch: Pick<
    typeof prisma.settlementBatch,
    'findByCharacterAndBatchId' | 'createSealed' | 'updateStatus'
  >;
  settlementSubmissionAttempt: Pick<
    typeof prisma.settlementSubmissionAttempt,
    'create' | 'listByBatch' | 'update'
  >;
};

export interface FirstSyncSubmissionDependencies {
  connection?: FirstSyncSubmissionConnection;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  prismaClient?: FirstSyncPrismaLike;
  prepareFirstSyncRebase?: (
    input: PrepareFirstSyncRebaseInput,
    deps?: Parameters<typeof prepareFirstSyncRebase>[1],
  ) => ReturnType<typeof prepareFirstSyncRebase>;
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function toPublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a valid public key`);
  }
}

function decodeEd25519SignatureBase64(signatureBase64: string): Uint8Array {
  assertNonEmptyString(signatureBase64, 'playerAuthorizationSignatureBase64');

  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length !== 64) {
    throw new Error(
      'ERR_INVALID_PLAYER_AUTHORIZATION_SIGNATURE: signature must decode to exactly 64 bytes',
    );
  }

  return new Uint8Array(signature);
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function currentTimestamp(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function expectedCursorFromGenesis(args: {
  genesisCursor: {
    lastCommittedEndNonce: number;
    lastCommittedBatchId: number;
    lastCommittedStateHash: string;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
}): SettlementCursorExpectation {
  return {
    lastCommittedEndNonce: args.genesisCursor.lastCommittedEndNonce,
    lastCommittedBatchId: args.genesisCursor.lastCommittedBatchId,
    lastCommittedStateHash: args.genesisCursor.lastCommittedStateHash,
    lastCommittedBattleTs: args.genesisCursor.lastCommittedBattleTs,
    lastCommittedSeasonId: args.genesisCursor.lastCommittedSeasonId,
  };
}

function permitDomainFromDraft(args: {
  programId: PublicKey;
  clusterId: number;
  authority: string;
  characterRootPubkey: string;
  payload: FirstSyncPreparationBase['payload'];
}): SettlementPermitDomain {
  return {
    programId: args.programId.toBase58(),
    clusterId: args.clusterId,
    playerAuthority: args.authority,
    characterRootPubkey: args.characterRootPubkey,
    batchHash: args.payload.batchHash,
    batchId: args.payload.batchId,
    signatureScheme: args.payload.signatureScheme,
  };
}

function batchDraftToCreateInput(args: {
  characterId: string;
  draft: Awaited<ReturnType<typeof prepareFirstSyncRebase>>['batchDrafts'][number];
}) {
  return {
    characterId: args.characterId,
    batchId: args.draft.payload.batchId,
    startNonce: args.draft.payload.startNonce,
    endNonce: args.draft.payload.endNonce,
    battleCount: args.draft.payload.battleCount,
    firstBattleTs: args.draft.payload.firstBattleTs,
    lastBattleTs: args.draft.payload.lastBattleTs,
    seasonId: args.draft.payload.seasonId,
    startStateHash: args.draft.payload.startStateHash,
    endStateHash: args.draft.payload.endStateHash,
    zoneProgressDelta: args.draft.payload.zoneProgressDelta,
    encounterHistogram: args.draft.payload.encounterHistogram,
    optionalLoadoutRevision: args.draft.payload.optionalLoadoutRevision ?? null,
    batchHash: args.draft.payload.batchHash,
    schemaVersion: args.draft.payload.schemaVersion,
    signatureScheme: args.draft.payload.signatureScheme,
    sealedBattleIds: args.draft.sealedBattleIds,
  };
}

function assertBatchMatchesDraft(
  batch: SettlementBatchRecord,
  draft: Awaited<ReturnType<typeof prepareFirstSyncRebase>>['batchDrafts'][number],
): void {
  if (
    batch.batchHash !== draft.payload.batchHash ||
    batch.startNonce !== draft.payload.startNonce ||
    batch.endNonce !== draft.payload.endNonce ||
    batch.startStateHash !== draft.payload.startStateHash ||
    batch.endStateHash !== draft.payload.endStateHash
  ) {
    throw new Error(
      'ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH: persisted first-sync settlement batch did not match the rebased draft',
    );
  }
}

async function ensureFirstSyncBatchRecords(args: {
  prismaClient: FirstSyncPrismaLike;
  characterId: string;
  batchDrafts: Awaited<ReturnType<typeof prepareFirstSyncRebase>>['batchDrafts'];
}): Promise<SettlementBatchRecord[]> {
  const batches: SettlementBatchRecord[] = [];

  for (const draft of args.batchDrafts) {
    const existing = await args.prismaClient.settlementBatch.findByCharacterAndBatchId(
      args.characterId,
      draft.payload.batchId,
    );
    if (existing !== null) {
      assertBatchMatchesDraft(existing, draft);
      batches.push(existing);
      continue;
    }

    batches.push(
      await args.prismaClient.settlementBatch.createSealed(
        batchDraftToCreateInput({
          characterId: args.characterId,
          draft,
        }),
      ),
    );
  }

  return batches.sort((left, right) => left.batchId - right.batchId);
}

export async function prepareSolanaFirstSync(
  input: PrepareFirstSyncRouteRequest,
  deps: FirstSyncRelayDependencies = {},
): Promise<PrepareFirstSyncRouteResponse> {
  assertNonEmptyString(input.characterId, 'characterId');
  assertNonEmptyString(input.authority, 'authority');

  const authority = toPublicKey(input.authority, 'authority');
  const feePayer = toPublicKey(input.feePayer ?? input.authority, 'feePayer');
  if (!authority.equals(feePayer)) {
    throw new Error('ERR_PLAYER_MUST_PAY: player_owned_instruction requires feePayer to match authority');
  }

  const connection = (deps.connection ?? createRunanaConnection()) as Connection;
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const clusterId = deps.clusterId ?? RUNANA_CLUSTER_ID_LOCALNET;
  const prepareRebase = deps.prepareFirstSyncRebase ?? prepareFirstSyncRebase;
  const rebased = await prepareRebase({
    characterId: input.characterId,
    authority: authority.toBase58(),
    feePayer: feePayer.toBase58(),
  });
  const firstDraft = rebased.batchDrafts[0];

  if (firstDraft === undefined) {
    throw new Error('ERR_NO_FIRST_SYNC_BATCH: first-sync rebasing produced no settlement batches');
  }

  const characterRoot = new PublicKey(rebased.reservedIdentity.characterRootPubkey);
  const expectedCursor = expectedCursorFromGenesis({ genesisCursor: rebased.genesisCursor });
  const permitDomain = permitDomainFromDraft({
    programId,
    clusterId,
    authority: authority.toBase58(),
    characterRootPubkey: rebased.reservedIdentity.characterRootPubkey,
    payload: firstDraft.payload,
  });
  const canonicalMessages = buildCanonicalSettlementMessages({
    payload: firstDraft.payload,
    playerAuthority: authority,
    characterRoot,
    programId,
    clusterId,
  });
  const playerAuthorizationMessageBase64 = toBase64(canonicalMessages.playerAuthorizationMessage);

  if (!input.playerAuthorizationSignatureBase64) {
    return {
      phase: 'authorize',
      payload: firstDraft.payload,
      expectedCursor,
      permitDomain,
      playerAuthorizationMessageBase64,
    };
  }

  const playerAuthorizationSignature = decodeEd25519SignatureBase64(
    input.playerAuthorizationSignatureBase64,
  );
  const programConfig = await fetchProgramConfigAccount(
    connection,
    deriveProgramConfigPda(programId),
    commitment,
  );
  const serverSigner = deps.serverSigner ?? loadRunanaTrustedServerSigner().signer;
  if (!programConfig.trustedServerSigner.equals(serverSigner.publicKey)) {
    throw new Error(
      'ERR_UNTRUSTED_SERVER_SIGNER_KEYPAIR: server signer keypair did not match program config',
    );
  }

  const createInstruction = buildCreateCharacterInstruction({
    payer: feePayer,
    authority,
    programId,
    characterIdHex: rebased.reservedIdentity.chainCharacterIdHex,
    characterCreationTs: rebased.anchor.characterCreationTs,
    seasonIdAtCreation: rebased.anchor.seasonIdAtCreation,
    initialUnlockedZoneId: rebased.anchor.initialUnlockedZoneId,
  });
  const settlementInstructionAccounts = buildCanonicalSettlementInstructionAccounts({
    payload: firstDraft.payload,
    playerAuthority: authority,
    characterRootPubkey: characterRoot,
    programId,
  });
  const serverAttestationInstruction = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: serverSigner.secretKey,
    message: canonicalMessages.serverAttestationMessage,
  });
  const playerAuthorizationInstruction = Ed25519Program.createInstructionWithPublicKey({
    publicKey: authority.toBytes(),
    message: canonicalMessages.playerAuthorizationMessage,
    signature: playerAuthorizationSignature,
  });
  const settlementInstruction = buildApplyBattleSettlementBatchV1Instruction({
    payload: firstDraft.payload,
    instructionAccounts: settlementInstructionAccounts,
    programId,
  });

  const addressLookupTableAccounts =
    deps.addressLookupTableAccounts ?? (await loadRunanaSettlementLookupTables(connection));
  const buildPreparedTx = deps.buildPreparedTransaction ?? buildPreparedVersionedTransaction;

  let preparedVersioned: Awaited<ReturnType<typeof buildPreparedVersionedTransaction>>;
  try {
    preparedVersioned = await buildPreparedTx({
      connection,
      feePayer,
      instructions: [
        createInstruction.instruction,
        serverAttestationInstruction,
        playerAuthorizationInstruction,
        settlementInstruction,
      ],
      addressLookupTableAccounts,
      commitment,
    });
  } catch (error) {
    if (
      error instanceof RangeError &&
      String(error.message).includes('encoding overruns Uint8Array') &&
      addressLookupTableAccounts.length === 0
    ) {
      throw new Error(
        'ERR_SETTLEMENT_LOOKUP_TABLE_REQUIRED: configure settlement lookup tables before preparing this transaction',
      );
    }
    throw error;
  }

  const preparedTransaction = prepareFirstSyncTransaction({
    authority: authority.toBase58(),
    feePayer: feePayer.toBase58(),
    serializedMessageBase64: preparedVersioned.serializedMessageBase64,
    serializedTransactionBase64: preparedVersioned.serializedTransactionBase64,
    characterCreation: {
      localCharacterId: rebased.anchor.characterId,
      chainCharacterIdHex: rebased.reservedIdentity.chainCharacterIdHex,
      characterRootPubkey: rebased.reservedIdentity.characterRootPubkey,
      characterCreationTs: rebased.anchor.characterCreationTs,
      seasonIdAtCreation: rebased.anchor.seasonIdAtCreation,
      initialUnlockedZoneId: rebased.anchor.initialUnlockedZoneId,
      recentBlockhash: preparedVersioned.recentBlockhash,
      lastValidBlockHeight: preparedVersioned.lastValidBlockHeight,
    },
    settlement: {
      characterRootPubkey: rebased.reservedIdentity.characterRootPubkey,
      payload: firstDraft.payload,
      expectedCursor,
      permitDomain,
    },
  });

  return {
    phase: 'sign_transaction',
    payload: firstDraft.payload,
    expectedCursor,
    permitDomain,
    playerAuthorizationMessageBase64,
    playerAuthorizationSignatureBase64: input.playerAuthorizationSignatureBase64,
    serverAttestationMessageBase64: toBase64(canonicalMessages.serverAttestationMessage),
    preparedTransaction,
  };
}

export async function submitSolanaFirstSync(
  input: SubmitFirstSyncRouteRequest,
  deps: FirstSyncSubmissionDependencies = {},
): Promise<SubmitFirstSyncRouteResponse> {
  const accepted = acceptSignedPlayerOwnedTransaction(input);
  if (
    accepted.kind !== 'player_owned_instruction' ||
    accepted.characterCreationRelay === undefined ||
    accepted.settlementRelay === undefined
  ) {
    throw new Error('ERR_INVALID_FIRST_SYNC_SUBMISSION: signed submission was not a first-sync transaction');
  }

  const deserializedTransaction = deserializeVersionedTransactionBase64(accepted.signedTransactionBase64);
  const signedMessageBase64 = serializeVersionedTransactionMessageBase64(deserializedTransaction);
  if (signedMessageBase64 !== input.prepared.serializedMessageBase64) {
    throw new Error(
      'ERR_SIGNED_TRANSACTION_MESSAGE_MISMATCH: signed transaction bytes did not match the prepared first-sync message',
    );
  }

  const prismaClient = deps.prismaClient ?? prisma;
  const connection = (deps.connection ?? createRunanaConnection()) as Connection;
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const now = deps.now ?? (() => new Date());
  const prepareRebase = deps.prepareFirstSyncRebase ?? prepareFirstSyncRebase;
  const chainRelay = accepted.characterCreationRelay;
  const settlementRelay = accepted.settlementRelay;

  const chainState = await prismaClient.character.findChainState(chainRelay.localCharacterId);
  if (chainState === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: local character for first sync was not found');
  }
  if (chainState.playerAuthorityPubkey !== accepted.authority) {
    throw new Error('ERR_CHARACTER_AUTHORITY_MISMATCH: prepared authority does not match persisted chain state');
  }
  if (chainState.chainCharacterIdHex !== chainRelay.chainCharacterIdHex) {
    throw new Error('ERR_CHARACTER_CHAIN_ID_MISMATCH: prepared chain character id does not match persisted state');
  }
  if (chainState.characterRootPubkey !== chainRelay.characterRootPubkey) {
    throw new Error('ERR_CHARACTER_ROOT_MISMATCH: prepared character root does not match persisted state');
  }
  if (chainState.chainCreationStatus === 'CONFIRMED') {
    throw new Error('ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain');
  }
  if (chainState.chainCreationStatus !== 'PENDING' && chainState.chainCreationStatus !== 'FAILED') {
    throw new Error('ERR_CHARACTER_SUBMISSION_STATE: first sync submission requires PENDING or FAILED state');
  }

  const rebased = await prepareRebase({
    characterId: chainRelay.localCharacterId,
    authority: accepted.authority,
    feePayer: accepted.feePayer,
  });
  const persistedBatches = await ensureFirstSyncBatchRecords({
    prismaClient,
    characterId: chainRelay.localCharacterId,
    batchDrafts: rebased.batchDrafts,
  });
  const firstBatch = persistedBatches[0];
  const firstDraft = rebased.batchDrafts[0];
  if (firstBatch === undefined || firstDraft === undefined) {
    throw new Error('ERR_NO_FIRST_SYNC_BATCH: first-sync rebasing produced no settlement batches');
  }
  assertBatchMatchesDraft(firstBatch, firstDraft);
  if (
    settlementRelay.batchId !== firstBatch.batchId ||
    settlementRelay.batchHash !== firstBatch.batchHash ||
    settlementRelay.startNonce !== firstBatch.startNonce ||
    settlementRelay.endNonce !== firstBatch.endNonce
  ) {
    throw new Error(
      'ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH: prepared settlement relay did not match the persisted first-sync batch',
    );
  }

  const preparedAt = now();
  const preparedBatch =
    (await prismaClient.settlementBatch.updateStatus(firstBatch.id, {
      status: 'PREPARED',
      latestMessageSha256Hex: accepted.messageSha256Hex,
      failureCategory: null,
      failureCode: null,
      preparedAt,
    })) ?? firstBatch;
  const priorAttempts = await prismaClient.settlementSubmissionAttempt.listByBatch(firstBatch.id);
  let attempt = await prismaClient.settlementSubmissionAttempt.create({
    settlementBatchId: firstBatch.id,
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

    const submittedAt = now();
    await prismaClient.character.updateChainIdentity(chainRelay.localCharacterId, {
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: chainRelay.chainCharacterIdHex,
      characterRootPubkey: chainRelay.characterRootPubkey,
      chainCreationStatus: 'SUBMITTED',
      chainCreationTxSignature: transactionSignature,
      chainCreatedAt: null,
      chainCreationTs: chainRelay.characterCreationTs,
      chainCreationSeasonId: chainRelay.seasonIdAtCreation,
    });
    attempt =
      (await prismaClient.settlementSubmissionAttempt.update(attempt.id, {
        status: 'BROADCAST',
        messageSha256Hex: accepted.messageSha256Hex,
        signedTransactionSha256Hex: accepted.signedTransactionSha256Hex,
        transactionSignature,
        submittedAt,
      })) ?? attempt;
    await prismaClient.settlementBatch.updateStatus(preparedBatch.id, {
      status: 'SUBMITTED',
      latestMessageSha256Hex: accepted.messageSha256Hex,
      latestSignedTxSha256Hex: accepted.signedTransactionSha256Hex,
      latestTransactionSignature: transactionSignature,
      failureCategory: null,
      failureCode: null,
      preparedAt: preparedBatch.preparedAt ?? preparedAt,
      submittedAt,
    });

    const confirmation = await connection.confirmTransaction(
      {
        signature: transactionSignature,
        blockhash: chainRelay.recentBlockhash,
        lastValidBlockHeight: chainRelay.lastValidBlockHeight,
      },
      commitment,
    );
    if (confirmation.value.err !== null) {
      throw new Error(`ERR_FIRST_SYNC_CONFIRMATION_FAILED: ${JSON.stringify(confirmation.value.err)}`);
    }

    const confirmedAt = now();
    const characterRootPubkey = new PublicKey(chainRelay.characterRootPubkey);
    const characterRoot = await fetchCharacterRootAccount(connection, characterRootPubkey, commitment);
    if (accountCharacterIdHex(characterRoot.characterId) !== chainRelay.chainCharacterIdHex.toLowerCase()) {
      throw new Error('ERR_CHARACTER_CHAIN_ID_MISMATCH: confirmed character root did not match persisted chain id');
    }
    const liveCursor = await fetchCharacterSettlementBatchCursorAccount(
      connection,
      deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      commitment,
    );

    const cursor = {
      lastCommittedEndNonce: Number(liveCursor.lastCommittedEndNonce),
      lastCommittedBatchId: Number(liveCursor.lastCommittedBatchId),
      lastCommittedStateHash: accountStateHashHex(liveCursor.lastCommittedStateHash),
      lastCommittedBattleTs: Number(liveCursor.lastCommittedBattleTs),
      lastCommittedSeasonId: liveCursor.lastCommittedSeasonId,
    };

    await prismaClient.character.updateChainIdentity(chainRelay.localCharacterId, {
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: chainRelay.chainCharacterIdHex,
      characterRootPubkey: chainRelay.characterRootPubkey,
      chainCreationStatus: 'CONFIRMED',
      chainCreationTxSignature: transactionSignature,
      chainCreatedAt: confirmedAt,
      chainCreationTs: chainRelay.characterCreationTs,
      chainCreationSeasonId: chainRelay.seasonIdAtCreation,
    });
    await prismaClient.character.updateCursorSnapshot(chainRelay.localCharacterId, {
      lastReconciledEndNonce: cursor.lastCommittedEndNonce,
      lastReconciledStateHash: cursor.lastCommittedStateHash,
      lastReconciledBatchId: cursor.lastCommittedBatchId,
      lastReconciledBattleTs: cursor.lastCommittedBattleTs,
      lastReconciledSeasonId: cursor.lastCommittedSeasonId,
      lastReconciledAt: confirmedAt,
    });
    await prismaClient.battleOutcomeLedger.markCommittedForBatch(firstBatch.id, confirmedAt);
    await prismaClient.settlementBatch.updateStatus(firstBatch.id, {
      status: 'CONFIRMED',
      latestMessageSha256Hex: accepted.messageSha256Hex,
      latestSignedTxSha256Hex: accepted.signedTransactionSha256Hex,
      latestTransactionSignature: transactionSignature,
      failureCategory: null,
      failureCode: null,
      confirmedAt,
    });
    await prismaClient.settlementSubmissionAttempt.update(attempt.id, {
      status: 'CONFIRMED',
      messageSha256Hex: accepted.messageSha256Hex,
      signedTransactionSha256Hex: accepted.signedTransactionSha256Hex,
      transactionSignature,
      resolvedAt: confirmedAt,
    });

    return {
      characterId: chainRelay.localCharacterId,
      chainCreationStatus: 'CONFIRMED',
      transactionSignature,
      chainCharacterIdHex: chainRelay.chainCharacterIdHex,
      characterRootPubkey: chainRelay.characterRootPubkey,
      firstSettlementBatchId: firstBatch.id,
      remainingSettlementBatchIds: persistedBatches.slice(1).map((batch) => batch.id),
      chainCreatedAt: confirmedAt.toISOString(),
      cursor,
    };
  } catch (error) {
    const failedAt = now();
    await prismaClient.character.updateChainIdentity(chainRelay.localCharacterId, {
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: chainRelay.chainCharacterIdHex,
      characterRootPubkey: chainRelay.characterRootPubkey,
      chainCreationStatus: 'FAILED',
      chainCreationTxSignature: transactionSignature,
      chainCreatedAt: null,
      chainCreationTs: chainRelay.characterCreationTs,
      chainCreationSeasonId: chainRelay.seasonIdAtCreation,
    });
    await prismaClient.settlementBatch.updateStatus(firstBatch.id, {
      status: 'FAILED',
      latestMessageSha256Hex: accepted.messageSha256Hex,
      latestSignedTxSha256Hex: accepted.signedTransactionSha256Hex,
      latestTransactionSignature: transactionSignature,
      failureCategory: 'REBUILD_AND_RETRY',
      failureCode: error instanceof Error ? error.message : 'ERR_FIRST_SYNC_SUBMISSION_FAILED',
      failedAt,
    });
    await prismaClient.settlementSubmissionAttempt.update(attempt.id, {
      status: 'FAILED',
      messageSha256Hex: accepted.messageSha256Hex,
      signedTransactionSha256Hex: accepted.signedTransactionSha256Hex,
      transactionSignature,
      rpcError: error instanceof Error ? error.message : String(error),
      resolvedAt: failedAt,
    });
    throw error;
  }
}
