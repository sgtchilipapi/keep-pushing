import { randomBytes } from 'node:crypto';

import { PublicKey, type Commitment, type Connection } from '@solana/web3.js';

import { getPassiveDef } from '../../engine/battle/passiveRegistry';
import { getSkillDef } from '../../engine/battle/skillRegistry';
import { prisma } from '../prisma';
import {
  accountCharacterIdHex,
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
  fetchSeasonPolicyAccount,
  fetchZoneEnemySetAccount,
  fetchZoneRegistryAccount,
  accountStateHashHex,
} from './runanaAccounts';
import {
  acceptSignedPlayerOwnedTransaction,
  prepareCharacterCreationTransaction,
} from './playerOwnedTransactions';
import {
  buildPreparedVersionedTransaction,
  deserializeVersionedTransactionBase64,
  serializeVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';
import { buildCreateCharacterInstruction } from './runanaCharacterInstructions';
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from './runanaClient';
import {
  deriveCharacterBatchCursorPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
} from './runanaProgram';

const STARTER_ACTIVE_SKILLS = ['1001', '1002'];
const STARTER_PASSIVES = ['2001', '2002'];
const DEFAULT_CHARACTER_NAME = 'Rookie';

interface CreatedCharacterRecord {
  id: string;
  userId: string;
  name: string;
  level: number;
  exp: number;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
}

export interface PrepareSolanaCharacterCreationInput {
  userId: string;
  authority: string;
  feePayer?: string;
  name?: string;
  seasonIdAtCreation: number;
  initialUnlockedZoneId: number;
}

export interface SubmitSolanaCharacterCreationInput {
  prepared: Parameters<typeof acceptSignedPlayerOwnedTransaction>[0]['prepared'];
  signedMessageBase64: string;
  signedTransactionBase64: string;
}

export interface SolanaCharacterSummary {
  characterId: string;
  userId: string;
  name: string;
  level: number;
  exp: number;
  stats: {
    hp: number;
    hpMax: number;
    atk: number;
    def: number;
    spd: number;
    accuracyBP: number;
    evadeBP: number;
  };
  activeSkills: string[];
  passiveSkills: string[];
  unlockedSkillIds: string[];
  chain: {
    playerAuthorityPubkey: string;
    chainCharacterIdHex: string;
    characterRootPubkey: string;
    chainCreationStatus: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
    chainCreationTxSignature: string | null;
    chainCreatedAt: string | null;
    chainCreationTs: number;
    chainCreationSeasonId: number;
  };
}

export interface PreparedSolanaCharacterCreationResult {
  character: SolanaCharacterSummary;
  preparedTransaction: ReturnType<typeof prepareCharacterCreationTransaction>;
}

export interface SubmittedSolanaCharacterCreationResult {
  characterId: string;
  chainCreationStatus: 'CONFIRMED';
  transactionSignature: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreatedAt: string;
  cursor: {
    lastCommittedEndNonce: number;
    lastCommittedStateHash: string;
    lastCommittedBatchId: number;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
}

type CharacterCreationConnection = Pick<
  Connection,
  'getAccountInfo' | 'getLatestBlockhash' | 'sendRawTransaction' | 'confirmTransaction'
>;

export interface CharacterCreationServiceDependencies {
  connection?: CharacterCreationConnection;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  generateCharacterIdHex?: () => string;
}

function normalizeName(name?: string): string {
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : DEFAULT_CHARACTER_NAME;
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`);
  }
}

function toPublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a valid public key`);
  }
}

function defaultCharacterIdHex(): string {
  return randomBytes(16).toString('hex');
}

function toUnixTimestampSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

function createStarterCharacter(userId: string, name: string): Promise<CreatedCharacterRecord> {
  STARTER_ACTIVE_SKILLS.forEach((skillId) => getSkillDef(skillId));
  STARTER_PASSIVES.forEach((passiveId) => getPassiveDef(passiveId));

  return prisma.character.create({
    userId,
    name,
    hp: 1200,
    hpMax: 1200,
    atk: 120,
    def: 70,
    spd: 100,
    accuracyBP: 8000,
    evadeBP: 1200,
    activeSkills: STARTER_ACTIVE_SKILLS,
    passiveSkills: STARTER_PASSIVES,
  });
}

function buildCharacterSummary(args: {
  character: CreatedCharacterRecord;
  playerAuthorityPubkey: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreationStatus: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: number;
  chainCreationSeasonId: number;
}): SolanaCharacterSummary {
  return {
    characterId: args.character.id,
    userId: args.character.userId,
    name: args.character.name,
    level: args.character.level,
    exp: args.character.exp,
    stats: {
      hp: args.character.hp,
      hpMax: args.character.hpMax,
      atk: args.character.atk,
      def: args.character.def,
      spd: args.character.spd,
      accuracyBP: args.character.accuracyBP,
      evadeBP: args.character.evadeBP,
    },
    activeSkills: STARTER_ACTIVE_SKILLS,
    passiveSkills: STARTER_PASSIVES,
    unlockedSkillIds: STARTER_ACTIVE_SKILLS,
    chain: {
      playerAuthorityPubkey: args.playerAuthorityPubkey,
      chainCharacterIdHex: args.chainCharacterIdHex,
      characterRootPubkey: args.characterRootPubkey,
      chainCreationStatus: args.chainCreationStatus,
      chainCreationTxSignature: args.chainCreationTxSignature,
      chainCreatedAt: args.chainCreatedAt?.toISOString() ?? null,
      chainCreationTs: args.chainCreationTs,
      chainCreationSeasonId: args.chainCreationSeasonId,
    },
  };
}

async function validateBootstrapPreconditions(args: {
  connection: CharacterCreationConnection;
  commitment?: Commitment;
  programId: PublicKey;
  seasonIdAtCreation: number;
  initialUnlockedZoneId: number;
}): Promise<void> {
  const { connection, commitment, programId, seasonIdAtCreation, initialUnlockedZoneId } = args;

  await fetchProgramConfigAccount(connection as Connection, deriveProgramConfigPda(programId), commitment);
  await fetchSeasonPolicyAccount(
    connection as Connection,
    deriveSeasonPolicyPda(seasonIdAtCreation, programId),
    commitment,
  );
  await fetchZoneRegistryAccount(
    connection as Connection,
    deriveZoneRegistryPda(initialUnlockedZoneId, programId),
    commitment,
  );
  await fetchZoneEnemySetAccount(
    connection as Connection,
    deriveZoneEnemySetPda(initialUnlockedZoneId, programId),
    commitment,
  );
}

async function updateCharacterChainState(args: {
  characterId: string;
  playerAuthorityPubkey: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreationStatus: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  chainCreationTxSignature?: string | null;
  chainCreatedAt?: Date | null;
  chainCreationTs: number;
  chainCreationSeasonId: number;
}) {
  return prisma.character.updateChainIdentity(args.characterId, {
    playerAuthorityPubkey: args.playerAuthorityPubkey,
    chainCharacterIdHex: args.chainCharacterIdHex,
    characterRootPubkey: args.characterRootPubkey,
    chainCreationStatus: args.chainCreationStatus,
    chainCreationTxSignature: args.chainCreationTxSignature ?? null,
    chainCreatedAt: args.chainCreatedAt ?? null,
    chainCreationTs: args.chainCreationTs,
    chainCreationSeasonId: args.chainCreationSeasonId,
  });
}

export async function prepareSolanaCharacterCreation(
  input: PrepareSolanaCharacterCreationInput,
  deps: CharacterCreationServiceDependencies = {},
): Promise<PreparedSolanaCharacterCreationResult> {
  assertNonEmptyString(input.userId, 'userId');
  assertNonEmptyString(input.authority, 'authority');
  assertInteger(input.seasonIdAtCreation, 'seasonIdAtCreation', 0);
  assertInteger(input.initialUnlockedZoneId, 'initialUnlockedZoneId', 0);

  const authority = toPublicKey(input.authority, 'authority');
  const feePayer = toPublicKey(input.feePayer ?? input.authority, 'feePayer');
  if (!authority.equals(feePayer)) {
    throw new Error('ERR_PLAYER_MUST_PAY: character_create requires feePayer to match authority');
  }
  const name = normalizeName(input.name);
  const user = await prisma.user.findUnique(input.userId);

  if (user === null) {
    throw new Error('ERR_USER_NOT_FOUND: user was not found');
  }

  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const now = (deps.now ?? (() => new Date()))();
  const characterCreationTs = toUnixTimestampSeconds(now);
  const chainCharacterIdHex = (deps.generateCharacterIdHex ?? defaultCharacterIdHex)();

  await validateBootstrapPreconditions({
    connection,
    commitment,
    programId,
    seasonIdAtCreation: input.seasonIdAtCreation,
    initialUnlockedZoneId: input.initialUnlockedZoneId,
  });

  const createInstruction = buildCreateCharacterInstruction({
    payer: feePayer,
    authority,
    programId,
    characterIdHex: chainCharacterIdHex,
    characterCreationTs,
    seasonIdAtCreation: input.seasonIdAtCreation,
    initialUnlockedZoneId: input.initialUnlockedZoneId,
  });

  const preparedTransactionBytes = await buildPreparedVersionedTransaction({
    connection: connection as Connection,
    feePayer,
    instructions: [createInstruction.instruction],
    commitment,
  });

  const character = await createStarterCharacter(input.userId, name);
  await updateCharacterChainState({
    characterId: character.id,
    playerAuthorityPubkey: authority.toBase58(),
    chainCharacterIdHex,
    characterRootPubkey: createInstruction.characterRoot.toBase58(),
    chainCreationStatus: 'PENDING',
    chainCreationTs: characterCreationTs,
    chainCreationSeasonId: input.seasonIdAtCreation,
  });

  const preparedTransaction = prepareCharacterCreationTransaction({
    authority: authority.toBase58(),
    feePayer: feePayer.toBase58(),
    serializedMessageBase64: preparedTransactionBytes.serializedMessageBase64,
    serializedTransactionBase64: preparedTransactionBytes.serializedTransactionBase64,
    localCharacterId: character.id,
    chainCharacterIdHex,
    characterRootPubkey: createInstruction.characterRoot.toBase58(),
    characterCreationTs,
    seasonIdAtCreation: input.seasonIdAtCreation,
    initialUnlockedZoneId: input.initialUnlockedZoneId,
    recentBlockhash: preparedTransactionBytes.recentBlockhash,
    lastValidBlockHeight: preparedTransactionBytes.lastValidBlockHeight,
  });

  return {
    character: buildCharacterSummary({
      character,
      playerAuthorityPubkey: authority.toBase58(),
      chainCharacterIdHex,
      characterRootPubkey: createInstruction.characterRoot.toBase58(),
      chainCreationStatus: 'PENDING',
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: characterCreationTs,
      chainCreationSeasonId: input.seasonIdAtCreation,
    }),
    preparedTransaction,
  };
}

export async function submitSolanaCharacterCreation(
  input: SubmitSolanaCharacterCreationInput,
  deps: CharacterCreationServiceDependencies = {},
): Promise<SubmittedSolanaCharacterCreationResult> {
  const accepted = acceptSignedPlayerOwnedTransaction(input);

  if (accepted.kind !== 'character_create' || accepted.characterCreationRelay === undefined) {
    throw new Error('ERR_INVALID_CHARACTER_CREATE_SUBMISSION: missing character creation relay metadata');
  }

  const relay = accepted.characterCreationRelay;
  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();

  const rawTransaction = Buffer.from(accepted.signedTransactionBase64, 'base64');
  const deserializedTransaction = deserializeVersionedTransactionBase64(accepted.signedTransactionBase64);
  const signedMessageBase64 = serializeVersionedTransactionMessageBase64(deserializedTransaction);

  if (signedMessageBase64 !== input.prepared.serializedMessageBase64) {
    throw new Error(
      'ERR_SIGNED_TRANSACTION_MESSAGE_MISMATCH: signed transaction bytes do not match the prepared message',
    );
  }

  const chainState = await prisma.character.findChainState(relay.localCharacterId);
  if (chainState === null) {
    throw new Error('ERR_CHARACTER_NOT_FOUND: local character for submission was not found');
  }

  if (chainState.playerAuthorityPubkey !== accepted.authority) {
    throw new Error('ERR_CHARACTER_AUTHORITY_MISMATCH: prepared authority does not match persisted chain state');
  }
  if (chainState.chainCharacterIdHex !== relay.chainCharacterIdHex) {
    throw new Error('ERR_CHARACTER_CHAIN_ID_MISMATCH: prepared chain character id does not match persisted state');
  }
  if (chainState.characterRootPubkey !== relay.characterRootPubkey) {
    throw new Error('ERR_CHARACTER_ROOT_MISMATCH: prepared character root does not match persisted state');
  }
  if (chainState.chainCreationStatus === 'CONFIRMED') {
    throw new Error('ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain');
  }
  if (chainState.chainCreationStatus !== 'PENDING' && chainState.chainCreationStatus !== 'FAILED') {
    throw new Error('ERR_CHARACTER_SUBMISSION_STATE: character creation submission requires PENDING or FAILED state');
  }

  let transactionSignature: string | null = null;

  try {
    transactionSignature = await (connection as Connection).sendRawTransaction(rawTransaction, {
      preflightCommitment: commitment,
      skipPreflight: false,
      maxRetries: 3,
    });

    await updateCharacterChainState({
      characterId: relay.localCharacterId,
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreationStatus: 'SUBMITTED',
      chainCreationTxSignature: transactionSignature,
      chainCreationTs: relay.characterCreationTs,
      chainCreationSeasonId: relay.seasonIdAtCreation,
    });

    const confirmation = await (connection as Connection).confirmTransaction(
      {
        signature: transactionSignature,
        blockhash: relay.recentBlockhash,
        lastValidBlockHeight: relay.lastValidBlockHeight,
      },
      commitment,
    );

    if (confirmation.value.err !== null) {
      throw new Error(`ERR_CHARACTER_CREATE_CONFIRMATION_FAILED: ${JSON.stringify(confirmation.value.err)}`);
    }

    const characterRootPubkey = new PublicKey(relay.characterRootPubkey);
    const characterRoot = await fetchCharacterRootAccount(connection as Connection, characterRootPubkey, commitment);
    const cursor = await fetchCharacterSettlementBatchCursorAccount(
      connection as Connection,
      deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      commitment,
    );

    if (!characterRoot.authority.equals(new PublicKey(accepted.authority))) {
      throw new Error('ERR_CHARACTER_ROOT_CONFIRMATION_MISMATCH: confirmed character root authority mismatch');
    }
    if (accountCharacterIdHex(characterRoot.characterId) !== relay.chainCharacterIdHex.toLowerCase()) {
      throw new Error('ERR_CHARACTER_ID_CONFIRMATION_MISMATCH: confirmed character id did not match prepared relay metadata');
    }

    const chainCreatedAt = (deps.now ?? (() => new Date()))();
    await updateCharacterChainState({
      characterId: relay.localCharacterId,
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreationStatus: 'CONFIRMED',
      chainCreationTxSignature: transactionSignature,
      chainCreatedAt,
      chainCreationTs: relay.characterCreationTs,
      chainCreationSeasonId: relay.seasonIdAtCreation,
    });
    await prisma.character.updateCursorSnapshot(relay.localCharacterId, {
      lastReconciledEndNonce: Number(cursor.lastCommittedEndNonce),
      lastReconciledStateHash: accountStateHashHex(cursor.lastCommittedStateHash),
      lastReconciledBatchId: Number(cursor.lastCommittedBatchId),
      lastReconciledBattleTs: Number(cursor.lastCommittedBattleTs),
      lastReconciledSeasonId: cursor.lastCommittedSeasonId,
      lastReconciledAt: chainCreatedAt,
    });

    return {
      characterId: relay.localCharacterId,
      chainCreationStatus: 'CONFIRMED',
      transactionSignature,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreatedAt: chainCreatedAt.toISOString(),
      cursor: {
        lastCommittedEndNonce: Number(cursor.lastCommittedEndNonce),
        lastCommittedStateHash: accountStateHashHex(cursor.lastCommittedStateHash),
        lastCommittedBatchId: Number(cursor.lastCommittedBatchId),
        lastCommittedBattleTs: Number(cursor.lastCommittedBattleTs),
        lastCommittedSeasonId: cursor.lastCommittedSeasonId,
      },
    };
  } catch (error) {
    await updateCharacterChainState({
      characterId: relay.localCharacterId,
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreationStatus: 'FAILED',
      chainCreationTxSignature: transactionSignature,
      chainCreationTs: relay.characterCreationTs,
      chainCreationSeasonId: relay.seasonIdAtCreation,
    });
    throw error;
  }
}
