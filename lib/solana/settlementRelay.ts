import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  type Commitment,
  type Connection,
} from '@solana/web3.js';

import type {
  AcknowledgeSettlementRouteRequest,
  AcknowledgeSettlementRouteResponse,
  PrepareSettlementRouteRequest,
  PrepareSettlementRouteResponse,
  SettlementCursorExpectation,
  SettlementPermitDomain,
  SubmitSettlementRouteRequest,
} from '../../types/api/solana';
import { prisma, type SettlementBatchRecord } from '../prisma';
import {
  type SettlementLifecycleDependencies,
  acknowledgeSettlementBatchClientSubmission,
  reconcileSettlementBatch,
  submitSettlementBatch,
  markSettlementBatchPrepared,
} from './settlementLifecycle';
import { prepareSettlementTransaction } from './playerOwnedTransactions';
import { loadSettlementInstructionAccountEnvelope } from './runanaSettlementEnvelope';
import { loadOrSealNextSettlementBatchForCharacter } from './settlementSealingService';
import {
  buildPreparedSettlementVersionedTransaction,
  type PreparedSettlementVersionedTransaction,
} from './settlementTransactionAssembly';
import {
  createRunanaConnection,
  loadRunanaSponsorPayer,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from './runanaClient';
import { resolveRunanaSettlementLookupTablesOrAutoCreate } from './autoSettlementLookupTables';
import { RUNANA_CLUSTER_ID_LOCALNET } from './runanaProgram';
import type { SettlementBatchPayloadV2 } from '../../types/settlement';

type SettlementRelayConnection = Pick<
  Connection,
  'getAccountInfo' | 'getMultipleAccountsInfo' | 'getLatestBlockhash'
>;

type PrepareSettlementDependencies = SettlementLifecycleDependencies & {
  connection?: SettlementRelayConnection;
  clusterId?: number;
  serverSigner?: Keypair;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  sealNextSettlementBatch?: typeof loadOrSealNextSettlementBatchForCharacter;
  loadEnvelope?: typeof loadSettlementInstructionAccountEnvelope;
  reconcileBatch?: typeof reconcileSettlementBatch;
  buildPreparedSettlement?: (args: {
    connection: Connection;
    envelope: Awaited<ReturnType<typeof loadSettlementInstructionAccountEnvelope>>;
    payload: SettlementBatchPayloadV2;
    feePayer: PublicKey;
    serverSigner: Keypair;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
    commitment?: Commitment;
    clusterId?: number;
  }) => Promise<PreparedSettlementVersionedTransaction>;
};

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

function expectedCursorFromBatch(batch: Awaited<ReturnType<typeof loadSettlementInstructionAccountEnvelope>>['characterBatchCursor']): SettlementCursorExpectation {
  return {
    lastCommittedEndNonce: Number(batch.lastCommittedEndNonce),
    lastCommittedBatchId: Number(batch.lastCommittedBatchId),
    lastCommittedStateHash: batch.lastCommittedStateHash.toString('hex'),
    lastCommittedBattleTs: Number(batch.lastCommittedBattleTs),
    lastCommittedSeasonId: batch.lastCommittedSeasonId,
  };
}

function permitDomainFromBatch(args: {
  programId: PublicKey;
  clusterId: number;
  playerAuthority: string;
  characterRootPubkey: string;
  batch: SettlementBatchRecord;
}): SettlementPermitDomain {
  return {
    programId: args.programId.toBase58(),
    clusterId: args.clusterId,
    playerAuthority: args.playerAuthority,
    characterRootPubkey: args.characterRootPubkey,
    batchHash: args.batch.batchHash,
    batchId: args.batch.batchId,
    signatureScheme: args.batch.signatureScheme as 0 | 1,
  };
}

function isRetryableFailure(batch: SettlementBatchRecord): boolean {
  return (
    batch.failureCategory === 'SAFE_SAME_PAYLOAD_RETRY' ||
    batch.failureCategory === 'REBUILD_AND_RETRY'
  );
}

function assertBatchCanBePrepared(batch: SettlementBatchRecord): void {
  if (batch.status === 'FAILED' && !isRetryableFailure(batch)) {
    throw new Error(
      'ERR_SETTLEMENT_NOT_RETRYABLE: settlement batch failed and requires remediation before retry',
    );
  }
}

type NextPreparationResolution =
  | {
      kind: 'ready';
      sealed: Awaited<ReturnType<typeof loadOrSealNextSettlementBatchForCharacter>>;
    }
  | {
      kind: 'in_flight';
      sealed: Awaited<ReturnType<typeof loadOrSealNextSettlementBatchForCharacter>>;
      reconciliation: Awaited<ReturnType<typeof reconcileSettlementBatch>>;
    };

async function resolveNextBatchForPreparation(
  characterId: string,
  lifecycleDeps: SettlementLifecycleDependencies,
  sealingDeps: Parameters<typeof loadOrSealNextSettlementBatchForCharacter>[1],
  sealNextSettlementBatch: typeof loadOrSealNextSettlementBatchForCharacter,
  reconcileBatch: typeof reconcileSettlementBatch,
): Promise<NextPreparationResolution> {
  let prepared = await sealNextSettlementBatch(characterId, sealingDeps);

  if (prepared.batch.status === 'SUBMITTED') {
    const reconciled = await reconcileBatch(prepared.batch.id, lifecycleDeps);
    if (reconciled.state === 'CONFIRMED') {
      prepared = await sealNextSettlementBatch(characterId, sealingDeps);
    } else {
      prepared = {
        ...prepared,
        batch: reconciled.batch,
      };
      if (reconciled.state === 'SUBMITTED') {
        return {
          kind: 'in_flight',
          sealed: prepared,
          reconciliation: reconciled,
        };
      }
    }
  }

  assertBatchCanBePrepared(prepared.batch);
  return {
    kind: 'ready',
    sealed: prepared,
  };
}

export async function prepareSolanaSettlement(
  input: PrepareSettlementRouteRequest,
  deps: PrepareSettlementDependencies = {},
): Promise<PrepareSettlementRouteResponse> {
  assertNonEmptyString(input.characterId, 'characterId');
  assertNonEmptyString(input.authority, 'authority');

  const authority = toPublicKey(input.authority, 'authority');
  const sponsorSigner = deps.serverSigner ?? loadRunanaSponsorPayer().signer;
  const feePayer = toPublicKey(
    input.feePayer ?? sponsorSigner.publicKey.toBase58(),
    'feePayer',
  );

  const connection = (deps.connection ?? createRunanaConnection()) as Connection;
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const clusterId = deps.clusterId ?? RUNANA_CLUSTER_ID_LOCALNET;
  const lifecycleDeps: SettlementLifecycleDependencies = {
    connection,
    commitment,
    programId,
    now: deps.now,
    prismaClient: deps.prismaClient,
  };
  const sealingDeps = {
    connection,
    commitment,
    programId,
    now: deps.now,
  };
  const chainState = await (deps.prismaClient ?? prisma).character.findChainState(input.characterId);
  if (chainState === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: character was not found');
  }
  if (chainState.playerAuthorityPubkey === null || chainState.characterRootPubkey === null) {
    throw new Error('ERR_CHARACTER_CHAIN_IDENTITY_MISSING: character is not chain-enabled');
  }
  if (chainState.playerAuthorityPubkey !== authority.toBase58()) {
    throw new Error(
      'ERR_CHARACTER_AUTHORITY_MISMATCH: requested authority did not match the persisted chain authority',
    );
  }

  const sealNextSettlementBatch = deps.sealNextSettlementBatch ?? loadOrSealNextSettlementBatchForCharacter;
  const reconcileBatch = deps.reconcileBatch ?? reconcileSettlementBatch;
  const nextBatch = await resolveNextBatchForPreparation(
    input.characterId,
    lifecycleDeps,
    sealingDeps,
    sealNextSettlementBatch,
    reconcileBatch,
  );
  const sealed = nextBatch.sealed;
  const loadEnvelope = deps.loadEnvelope ?? loadSettlementInstructionAccountEnvelope;
  const envelope = await loadEnvelope({
    reader: connection,
    payload: sealed.payload,
    playerAuthority: authority,
    characterRootPubkey: chainState.characterRootPubkey,
    commitment,
    programId,
  });

  const expectedCursor = expectedCursorFromBatch(envelope.characterBatchCursor);
  const permitDomain = permitDomainFromBatch({
    programId,
    clusterId,
    playerAuthority: authority.toBase58(),
    characterRootPubkey: chainState.characterRootPubkey,
    batch: sealed.batch,
  });
  if (nextBatch.kind === 'in_flight') {
    return {
      phase: 'submitted',
      settlementBatchId: sealed.batch.id,
      payload: sealed.payload,
      expectedCursor,
      permitDomain,
      transactionSignature: nextBatch.reconciliation.batch.latestTransactionSignature,
    };
  }

  const addressLookupTableAccounts =
    deps.addressLookupTableAccounts ??
    (await resolveRunanaSettlementLookupTablesOrAutoCreate({
      connection,
      commitment,
      payload: sealed.payload,
      playerAuthority: authority,
      characterRootPubkey: envelope.characterRoot.pubkey,
      programId,
    }));
  const buildPreparedSettlement =
    deps.buildPreparedSettlement ??
    ((args: Parameters<typeof buildPreparedSettlementVersionedTransaction>[0]) =>
      buildPreparedSettlementVersionedTransaction(args));

  let preparedVersioned: PreparedSettlementVersionedTransaction;
  try {
    preparedVersioned = await buildPreparedSettlement({
      connection,
      envelope,
      payload: sealed.payload,
      feePayer,
      serverSigner: sponsorSigner,
      addressLookupTableAccounts,
      commitment,
      clusterId,
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

  const preparedTransaction = prepareSettlementTransaction({
    playerAuthority: authority.toBase58(),
    feePayer: feePayer.toBase58(),
    characterRootPubkey: chainState.characterRootPubkey,
    payload: sealed.payload,
    expectedCursor,
    permitDomain,
    relayRequestId: input.relayRequestId,
    serializedMessageBase64: preparedVersioned.serializedMessageBase64,
    serializedTransactionBase64: preparedVersioned.serializedTransactionBase64,
  });
  await markSettlementBatchPrepared(
    {
      settlementBatchId: sealed.batch.id,
      messageSha256Hex: preparedTransaction.messageSha256Hex,
    },
    lifecycleDeps,
  );

  return {
    phase: 'sign_transaction',
    settlementBatchId: sealed.batch.id,
    payload: sealed.payload,
    expectedCursor,
    permitDomain,
    playerAuthorizationMessageBase64: '',
    playerAuthorizationMessageUtf8: '',
    playerAuthorizationMessageEncoding: 'utf8',
    playerAuthorizationSignatureBase64: undefined,
    serverAttestationMessageBase64: preparedVersioned.serverAttestationMessageBase64,
    preparedTransaction,
  };
}

export async function submitSolanaSettlement(
  input: SubmitSettlementRouteRequest,
  deps: SettlementLifecycleDependencies = {},
) {
  assertNonEmptyString(input.settlementBatchId, 'settlementBatchId');

  return submitSettlementBatch(
    {
      settlementBatchId: input.settlementBatchId,
      prepared: input.prepared,
      signedMessageBase64: input.signedMessageBase64,
      signedTransactionBase64: input.signedTransactionBase64,
    },
    deps,
  );
}

export async function acknowledgeSolanaSettlement(
  input: AcknowledgeSettlementRouteRequest,
  deps: SettlementLifecycleDependencies = {},
): Promise<AcknowledgeSettlementRouteResponse> {
  const result = await acknowledgeSettlementBatchClientSubmission(
    {
      settlementBatchId: input.settlementBatchId,
      prepared: input.prepared,
      transactionSignature: input.transactionSignature,
    },
    deps,
  );

  return result.state === 'CONFIRMED'
    ? {
        phase: 'confirmed',
        settlementBatchId: result.batch.id,
        transactionSignature: input.transactionSignature,
        cursor: result.cursor ?? undefined,
      }
    : {
        phase: 'submitted',
        settlementBatchId: result.batch.id,
        transactionSignature: input.transactionSignature,
      };
}
