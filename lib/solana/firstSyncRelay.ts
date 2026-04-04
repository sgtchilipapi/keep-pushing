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
} from '../../types/api/solana';
import { prepareFirstSyncTransaction } from './playerOwnedTransactions';
import {
  type PrepareFirstSyncRebaseInput,
  prepareFirstSyncRebase,
} from './firstSyncRebasing';
import { buildPreparedVersionedTransaction } from './playerOwnedV0Transactions';
import { buildCreateCharacterInstruction } from './runanaCharacterInstructions';
import { fetchProgramConfigAccount } from './runanaAccounts';
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
import { deriveProgramConfigPda, RUNANA_CLUSTER_ID_LOCALNET } from './runanaProgram';

type FirstSyncRelayConnection = Pick<Connection, 'getAccountInfo' | 'getLatestBlockhash'>;

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
