import { createHash, randomBytes } from "node:crypto";

import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type Commitment,
  type Connection,
} from "@solana/web3.js";

import { getPassiveDef } from "../../engine/battle/passiveRegistry";
import { getSkillDef } from "../../engine/battle/skillRegistry";
import { prisma } from "../prisma";
import {
  accountCharacterIdHex,
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
  fetchProgramConfigAccount,
  fetchSeasonPolicyAccount,
  fetchZoneEnemySetAccount,
  fetchZoneRegistryAccount,
  accountStateHashHex,
} from "./runanaAccounts";
import {
  acceptSignedPlayerOwnedTransaction,
  prepareCharacterCreationTransaction,
} from "./playerOwnedTransactions";
import {
  buildPreparedVersionedTransaction,
  deserializeVersionedTransactionBase64,
  serializeVersionedTransactionMessageBase64,
} from "./playerOwnedV0Transactions";
import { buildCreateCharacterInstruction } from "./runanaCharacterInstructions";
import {
  createRunanaConnection,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from "./runanaClient";
import {
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
  computeAnchorInstructionDiscriminator,
} from "./runanaProgram";
import { serializeCreateCharacterArgs } from "./runanaCharacterInstructions";

const STARTER_ACTIVE_SKILLS = ["1001", "1002"];
const STARTER_PASSIVES = ["2001", "2002"];
const DEFAULT_CHARACTER_NAME = "Rookie";
const MAX_CHARACTER_ID_ASSIGNMENT_ATTEMPTS = 5;

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
  characterId: string;
  authority: string;
  feePayer?: string;
  initialUnlockedZoneId: number;
}

export interface SubmitSolanaCharacterCreationInput {
  prepared: Parameters<
    typeof acceptSignedPlayerOwnedTransaction
  >[0]["prepared"];
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
    chainCreationStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
    chainCreationTxSignature: string | null;
    chainCreatedAt: string | null;
    chainCreationTs: number | null;
    chainCreationSeasonId: number | null;
  };
}

export interface PreparedSolanaCharacterCreationResult {
  phase: "sign_transaction";
  character: SolanaCharacterSummary;
  preparedTransaction: ReturnType<typeof prepareCharacterCreationTransaction>;
}

export interface InFlightSolanaCharacterCreationResult {
  phase: "submitted";
  character: SolanaCharacterSummary;
  transactionSignature: string | null;
}

export interface SubmittedSolanaCharacterCreationResult {
  characterId: string;
  chainCreationStatus: "CONFIRMED";
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
  | "getAccountInfo"
  | "getLatestBlockhash"
  | "sendRawTransaction"
  | "confirmTransaction"
>;

type CharacterCreationEnv = {
  RUNANA_ACTIVE_SEASON_ID?: string;
  RUNANA_SEASON_ID?: string;
};

export interface CharacterCreationServiceDependencies {
  connection?: CharacterCreationConnection;
  commitment?: Commitment;
  programId?: PublicKey;
  now?: () => Date;
  generateCharacterIdHex?: () => string;
  env?: CharacterCreationEnv;
}

function normalizeName(name?: string): string {
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : DEFAULT_CHARACTER_NAME;
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ERR_EMPTY_${field.toUpperCase()}: ${field} is required`);
  }
}

function assertInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be an integer >= ${minimum}`,
    );
  }
}

function toPublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be a valid public key`,
    );
  }
}

function defaultCharacterIdHex(): string {
  return randomBytes(16).toString("hex");
}

function isRetryableCharacterIdentityCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybePgError = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  const constraint =
    typeof maybePgError.constraint === "string" ? maybePgError.constraint : "";
  const message =
    typeof maybePgError.message === "string" ? maybePgError.message : "";

  return (
    maybePgError.code === "23505" &&
    (constraint === "Character_chainCharacterIdHex_key" ||
      constraint === "Character_characterRootPubkey_key" ||
      message.includes("chainCharacterIdHex") ||
      message.includes("characterRootPubkey"))
  );
}

function sha256HexFromBase64(base64Value: string): string {
  return createHash("sha256")
    .update(Buffer.from(base64Value, "base64"))
    .digest("hex");
}

function buildCreateMessageDiagnostics(args: {
  preparedMessageBase64: string;
  signedMessageBase64: string;
  localCharacterId: string;
  characterRootPubkey: string;
  walletAuthority: string;
}) {
  return {
    preparedMessageSha256Hex: sha256HexFromBase64(args.preparedMessageBase64),
    signedMessageSha256Hex: sha256HexFromBase64(args.signedMessageBase64),
    transactionVersion: "v0" as const,
    localCharacterId: args.localCharacterId,
    characterRootPubkey: args.characterRootPubkey,
    walletAuthority: args.walletAuthority,
  };
}

function assertAccountMeta(args: {
  actual: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
  expectedPubkey: PublicKey;
  expectedIsSigner: boolean;
  expectedIsWritable: boolean;
  label: string;
  diagnostics: ReturnType<typeof buildCreateMessageDiagnostics>;
}): void {
  if (
    !args.actual.pubkey.equals(args.expectedPubkey) ||
    args.actual.isSigner !== args.expectedIsSigner ||
    args.actual.isWritable !== args.expectedIsWritable
  ) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: ${args.label} does not match the prepared character-create instruction: ${JSON.stringify(args.diagnostics)}`,
    );
  }
}

function assertSemanticallyValidSignedCreateTransaction(args: {
  authority: string;
  relay: NonNullable<
    ReturnType<
      typeof acceptSignedPlayerOwnedTransaction
    >["characterCreationRelay"]
  >;
  programId: PublicKey;
  transaction: ReturnType<typeof deserializeVersionedTransactionBase64>;
  diagnostics: ReturnType<typeof buildCreateMessageDiagnostics>;
}): void {
  if (
    args.relay.seasonPolicyPubkey === undefined ||
    args.relay.seasonPolicyPubkey.length === 0
  ) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: season policy relay metadata is missing: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  if (args.transaction.message.addressTableLookups.length > 0) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: character creation does not support address table lookups: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  let message;
  try {
    message = TransactionMessage.decompile(args.transaction.message);
  } catch {
    throw new Error(
      `ERR_INVALID_SIGNED_TRANSACTION: could not decompile the signed character creation transaction: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  const authority = new PublicKey(args.authority);
  if (!message.payerKey.equals(authority)) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: signed fee payer does not match authority: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  const executableInstructions = message.instructions.filter(
    (instruction) =>
      !instruction.programId.equals(ComputeBudgetProgram.programId),
  );
  if (executableInstructions.length !== 1) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: expected exactly one non-compute instruction in the signed transaction: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  const instruction = executableInstructions[0]!;
  if (!instruction.programId.equals(args.programId)) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: signed instruction program does not match Runana: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  const expectedSeasonPolicy = new PublicKey(args.relay.seasonPolicyPubkey);
  const expectedCharacterRoot = deriveCharacterRootPda(
    authority,
    args.relay.chainCharacterIdHex,
    args.programId,
  );
  const expectedCharacterStats = deriveCharacterStatsPda(
    expectedCharacterRoot,
    args.programId,
  );
  const expectedCharacterWorldProgress = deriveCharacterWorldProgressPda(
    expectedCharacterRoot,
    args.programId,
  );
  const expectedInitialPageIndex = Math.floor(
    args.relay.initialUnlockedZoneId / 256,
  );
  const expectedCharacterZoneProgressPage = deriveCharacterZoneProgressPagePda(
    expectedCharacterRoot,
    expectedInitialPageIndex,
    args.programId,
  );
  const expectedCharacterBatchCursor = deriveCharacterBatchCursorPda(
    expectedCharacterRoot,
    args.programId,
  );
  const expectedInstructionData = Buffer.concat([
    computeAnchorInstructionDiscriminator("create_character"),
    serializeCreateCharacterArgs({
      characterIdHex: args.relay.chainCharacterIdHex,
      initialUnlockedZoneId: args.relay.initialUnlockedZoneId,
    }),
  ]);

  const expectedAccounts = [
    {
      pubkey: authority,
      isSigner: true,
      isWritable: true,
      label: "payer",
    },
    {
      pubkey: authority,
      isSigner: true,
      isWritable: true,
      label: "authority",
    },
    {
      pubkey: expectedSeasonPolicy,
      isSigner: false,
      isWritable: false,
      label: "season_policy",
    },
    {
      pubkey: expectedCharacterRoot,
      isSigner: false,
      isWritable: true,
      label: "character_root",
    },
    {
      pubkey: expectedCharacterStats,
      isSigner: false,
      isWritable: true,
      label: "character_stats",
    },
    {
      pubkey: expectedCharacterWorldProgress,
      isSigner: false,
      isWritable: true,
      label: "character_world_progress",
    },
    {
      pubkey: expectedCharacterZoneProgressPage,
      isSigner: false,
      isWritable: true,
      label: "character_zone_progress_page",
    },
    {
      pubkey: expectedCharacterBatchCursor,
      isSigner: false,
      isWritable: true,
      label: "character_batch_cursor",
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
      label: "system_program",
    },
  ];

  if (instruction.keys.length !== expectedAccounts.length) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: signed instruction account count does not match the canonical create_character layout: ${JSON.stringify(args.diagnostics)}`,
    );
  }

  expectedAccounts.forEach((expectedAccount, index) => {
    assertAccountMeta({
      actual: instruction.keys[index]!,
      expectedPubkey: expectedAccount.pubkey,
      expectedIsSigner: expectedAccount.isSigner,
      expectedIsWritable: expectedAccount.isWritable,
      label: expectedAccount.label,
      diagnostics: args.diagnostics,
    });
  });

  if (!Buffer.from(instruction.data).equals(expectedInstructionData)) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: signed instruction data does not match the prepared create_character payload: ${JSON.stringify(args.diagnostics)}`,
    );
  }
}

function resolveConfiguredActiveSeasonId(env: CharacterCreationEnv): number {
  const configured =
    env.RUNANA_ACTIVE_SEASON_ID?.trim() ??
    env.RUNANA_SEASON_ID?.trim() ??
    undefined;
  const candidate =
    configured === undefined || configured.length === 0
      ? Number.NaN
      : Number(configured);

  if (!Number.isInteger(candidate) || candidate < 0) {
    throw new Error(
      "ERR_ACTIVE_SEASON_UNRESOLVED: configure RUNANA_ACTIVE_SEASON_ID before preparing character creation",
    );
  }

  return candidate;
}

function buildCharacterSummary(args: {
  character: CreatedCharacterRecord;
  playerAuthorityPubkey: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreationStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  chainCreationTxSignature: string | null;
  chainCreatedAt: Date | null;
  chainCreationTs: number | null;
  chainCreationSeasonId: number | null;
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
  activeSeasonId: number;
  initialUnlockedZoneId: number;
}): Promise<void> {
  const {
    connection,
    commitment,
    programId,
    activeSeasonId,
    initialUnlockedZoneId,
  } = args;

  await fetchProgramConfigAccount(
    connection as Connection,
    deriveProgramConfigPda(programId),
    commitment,
  );
  await fetchSeasonPolicyAccount(
    connection as Connection,
    deriveSeasonPolicyPda(activeSeasonId, programId),
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
  chainCreationStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  chainCreationTxSignature?: string | null;
  chainCreatedAt?: Date | null;
  chainCreationTs?: number | null;
  chainCreationSeasonId?: number | null;
}) {
  return prisma.character.updateChainIdentity(args.characterId, {
    playerAuthorityPubkey: args.playerAuthorityPubkey,
    chainCharacterIdHex: args.chainCharacterIdHex,
    characterRootPubkey: args.characterRootPubkey,
    chainCreationStatus: args.chainCreationStatus,
    chainCreationTxSignature: args.chainCreationTxSignature ?? null,
    chainCreatedAt: args.chainCreatedAt ?? null,
    chainCreationTs: args.chainCreationTs ?? null,
    chainCreationSeasonId: args.chainCreationSeasonId ?? null,
  });
}

function assertCharacterReadyForFirstChainBinding(args: {
  characterId: string;
  chainState: Awaited<ReturnType<typeof prisma.character.findChainState>>;
  authority: string;
}):
  | { mode: "reserve_new" }
  | {
      mode: "reuse_reserved";
      chainCharacterIdHex: string;
      characterRootPubkey: string;
    }
  | {
      mode: "in_flight";
      chainCharacterIdHex: string;
      characterRootPubkey: string;
      transactionSignature: string | null;
      chainCreationTs: number | null;
      chainCreationSeasonId: number | null;
      chainCreatedAt: Date | null;
    } {
  if (args.chainState === null) {
    throw new Error(
      `ERR_CHARACTER_NOT_FOUND: local character ${args.characterId} was not found`,
    );
  }

  if (args.chainState.chainCreationStatus === "NOT_STARTED") {
    if (
      args.chainState.playerAuthorityPubkey !== null ||
      args.chainState.chainCharacterIdHex !== null ||
      args.chainState.characterRootPubkey !== null
    ) {
      throw new Error(
        "ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT: character has partial chain identity data while still marked NOT_STARTED",
      );
    }

    return { mode: "reserve_new" };
  }

  if (
    args.chainState.playerAuthorityPubkey === null ||
    args.chainState.chainCharacterIdHex === null ||
    args.chainState.characterRootPubkey === null
  ) {
    throw new Error(
      "ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT: character has incomplete reserved chain identity state",
    );
  }

  if (args.chainState.playerAuthorityPubkey !== args.authority) {
    throw new Error(
      "ERR_CHARACTER_AUTHORITY_MISMATCH: prepared authority does not match persisted chain state",
    );
  }

  if (args.chainState.chainCreationStatus === "CONFIRMED") {
    throw new Error(
      "ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain",
    );
  }

  if (args.chainState.chainCreationStatus === "SUBMITTED") {
    return {
      mode: "in_flight",
      chainCharacterIdHex: args.chainState.chainCharacterIdHex,
      characterRootPubkey: args.chainState.characterRootPubkey,
      transactionSignature: args.chainState.chainCreationTxSignature,
      chainCreationTs: args.chainState.chainCreationTs,
      chainCreationSeasonId: args.chainState.chainCreationSeasonId,
      chainCreatedAt: args.chainState.chainCreatedAt,
    };
  }

  return {
    mode: "reuse_reserved",
    chainCharacterIdHex: args.chainState.chainCharacterIdHex,
    characterRootPubkey: args.chainState.characterRootPubkey,
  };
}

export async function prepareSolanaCharacterCreation(
  input: PrepareSolanaCharacterCreationInput,
  deps: CharacterCreationServiceDependencies = {},
): Promise<
  PreparedSolanaCharacterCreationResult | InFlightSolanaCharacterCreationResult
> {
  assertNonEmptyString(input.characterId, "characterId");
  assertNonEmptyString(input.authority, "authority");
  assertInteger(input.initialUnlockedZoneId, "initialUnlockedZoneId", 0);

  const authority = toPublicKey(input.authority, "authority");
  const feePayer = toPublicKey(input.feePayer ?? input.authority, "feePayer");
  if (!authority.equals(feePayer)) {
    throw new Error(
      "ERR_PLAYER_MUST_PAY: character_create requires feePayer to match authority",
    );
  }
  const character = await prisma.character.findById(input.characterId);
  if (character === null) {
    throw new Error(
      `ERR_CHARACTER_NOT_FOUND: local character ${input.characterId} was not found`,
    );
  }
  STARTER_ACTIVE_SKILLS.forEach((skillId) => getSkillDef(skillId));
  STARTER_PASSIVES.forEach((passiveId) => getPassiveDef(passiveId));
  const createPreparation = assertCharacterReadyForFirstChainBinding({
    characterId: character.id,
    chainState: await prisma.character.findChainState(character.id),
    authority: authority.toBase58(),
  });

  if (createPreparation.mode === "in_flight") {
    return {
      phase: "submitted",
      character: buildCharacterSummary({
        character,
        playerAuthorityPubkey: authority.toBase58(),
        chainCharacterIdHex: createPreparation.chainCharacterIdHex,
        characterRootPubkey: createPreparation.characterRootPubkey,
        chainCreationStatus: "SUBMITTED",
        chainCreationTxSignature: createPreparation.transactionSignature,
        chainCreatedAt: createPreparation.chainCreatedAt,
        chainCreationTs: createPreparation.chainCreationTs,
        chainCreationSeasonId: createPreparation.chainCreationSeasonId,
      }),
      transactionSignature: createPreparation.transactionSignature,
    };
  }

  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();
  const env: CharacterCreationEnv = {
    RUNANA_ACTIVE_SEASON_ID:
      deps.env?.RUNANA_ACTIVE_SEASON_ID ?? process.env.RUNANA_ACTIVE_SEASON_ID,
    RUNANA_SEASON_ID:
      deps.env?.RUNANA_SEASON_ID ?? process.env.RUNANA_SEASON_ID,
  };
  const activeSeasonId = resolveConfiguredActiveSeasonId(env);

  await validateBootstrapPreconditions({
    connection,
    commitment,
    programId,
    activeSeasonId,
    initialUnlockedZoneId: input.initialUnlockedZoneId,
  });

  const generateCharacterIdHex =
    deps.generateCharacterIdHex ?? defaultCharacterIdHex;

  let chainCharacterIdHex =
    createPreparation.mode === "reuse_reserved"
      ? createPreparation.chainCharacterIdHex
      : "";
  let createInstruction: ReturnType<
    typeof buildCreateCharacterInstruction
  > | null = null;
  let preparedTransactionBytes: Awaited<
    ReturnType<typeof buildPreparedVersionedTransaction>
  > | null = null;

  for (
    let attempt = 1;
    attempt <= MAX_CHARACTER_ID_ASSIGNMENT_ATTEMPTS;
    attempt += 1
  ) {
    if (createPreparation.mode === "reserve_new") {
      chainCharacterIdHex = generateCharacterIdHex();
    }
    createInstruction = buildCreateCharacterInstruction({
      payer: feePayer,
      authority,
      seasonId: activeSeasonId,
      programId,
      characterIdHex: chainCharacterIdHex,
      initialUnlockedZoneId: input.initialUnlockedZoneId,
    });

    preparedTransactionBytes = await buildPreparedVersionedTransaction({
      connection: connection as Connection,
      feePayer,
      instructions: [createInstruction.instruction],
      commitment,
    });

    if (createPreparation.mode === "reuse_reserved") {
      if (
        createInstruction.characterRoot.toBase58() !==
        createPreparation.characterRootPubkey
      ) {
        throw new Error(
          "ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT: reserved character root does not match the canonical PDA for the persisted chain id",
        );
      }

      await updateCharacterChainState({
        characterId: character.id,
        playerAuthorityPubkey: authority.toBase58(),
        chainCharacterIdHex,
        characterRootPubkey: createPreparation.characterRootPubkey,
        chainCreationStatus: "PENDING",
      });
      break;
    }

    try {
      await updateCharacterChainState({
        characterId: character.id,
        playerAuthorityPubkey: authority.toBase58(),
        chainCharacterIdHex,
        characterRootPubkey: createInstruction.characterRoot.toBase58(),
        chainCreationStatus: "PENDING",
      });
      break;
    } catch (error) {
      if (
        attempt < MAX_CHARACTER_ID_ASSIGNMENT_ATTEMPTS &&
        isRetryableCharacterIdentityCollision(error)
      ) {
        continue;
      }

      if (
        attempt >= MAX_CHARACTER_ID_ASSIGNMENT_ATTEMPTS &&
        isRetryableCharacterIdentityCollision(error)
      ) {
        throw new Error(
          "ERR_CHARACTER_ID_COLLISION_EXHAUSTED: could not assign a unique character identity after repeated collisions",
        );
      }

      throw error;
    }
  }

  if (
    createInstruction === null ||
    preparedTransactionBytes === null ||
    chainCharacterIdHex.length === 0
  ) {
    throw new Error(
      "ERR_CHARACTER_PREPARE_INTERNAL: character creation prepare did not produce a chain identity",
    );
  }

  const preparedTransaction = prepareCharacterCreationTransaction({
    authority: authority.toBase58(),
    feePayer: feePayer.toBase58(),
    serializedMessageBase64: preparedTransactionBytes.serializedMessageBase64,
    serializedTransactionBase64:
      preparedTransactionBytes.serializedTransactionBase64,
    localCharacterId: character.id,
    chainCharacterIdHex,
    characterRootPubkey: createInstruction.characterRoot.toBase58(),
    seasonPolicyPubkey: createInstruction.seasonPolicy.toBase58(),
    initialUnlockedZoneId: input.initialUnlockedZoneId,
    recentBlockhash: preparedTransactionBytes.recentBlockhash,
    lastValidBlockHeight: preparedTransactionBytes.lastValidBlockHeight,
  });

  return {
    phase: "sign_transaction",
    character: buildCharacterSummary({
      character,
      playerAuthorityPubkey: authority.toBase58(),
      chainCharacterIdHex,
      characterRootPubkey: createInstruction.characterRoot.toBase58(),
      chainCreationStatus: "PENDING",
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
    }),
    preparedTransaction,
  };
}

export async function submitSolanaCharacterCreation(
  input: SubmitSolanaCharacterCreationInput,
  deps: CharacterCreationServiceDependencies = {},
): Promise<SubmittedSolanaCharacterCreationResult> {
  const accepted = acceptSignedPlayerOwnedTransaction(input);

  if (
    accepted.kind !== "character_create" ||
    accepted.characterCreationRelay === undefined
  ) {
    throw new Error(
      "ERR_INVALID_CHARACTER_CREATE_SUBMISSION: missing character creation relay metadata",
    );
  }

  const relay = accepted.characterCreationRelay;
  const connection = deps.connection ?? createRunanaConnection();
  const commitment = deps.commitment ?? resolveRunanaCommitment();
  const programId = deps.programId ?? resolveRunanaProgramId();

  const rawTransaction = Buffer.from(
    accepted.signedTransactionBase64,
    "base64",
  );
  let deserializedTransaction;
  try {
    deserializedTransaction = deserializeVersionedTransactionBase64(
      accepted.signedTransactionBase64,
    );
  } catch {
    throw new Error(
      "ERR_INVALID_SIGNED_TRANSACTION: character creation requires a versioned transaction payload",
    );
  }
  const signedMessageBase64 = serializeVersionedTransactionMessageBase64(
    deserializedTransaction,
  );
  const messageDiagnostics = buildCreateMessageDiagnostics({
    preparedMessageBase64: input.prepared.serializedMessageBase64,
    signedMessageBase64,
    localCharacterId: relay.localCharacterId,
    characterRootPubkey: relay.characterRootPubkey,
    walletAuthority: accepted.authority,
  });
  assertSemanticallyValidSignedCreateTransaction({
    authority: accepted.authority,
    relay,
    programId,
    transaction: deserializedTransaction,
    diagnostics: messageDiagnostics,
  });

  const chainState = await prisma.character.findChainState(
    relay.localCharacterId,
  );
  if (chainState === null) {
    throw new Error(
      "ERR_CHARACTER_NOT_FOUND: local character for submission was not found",
    );
  }

  if (chainState.playerAuthorityPubkey !== accepted.authority) {
    throw new Error(
      "ERR_CHARACTER_AUTHORITY_MISMATCH: prepared authority does not match persisted chain state",
    );
  }
  if (chainState.chainCharacterIdHex !== relay.chainCharacterIdHex) {
    throw new Error(
      "ERR_CHARACTER_CHAIN_ID_MISMATCH: prepared chain character id does not match persisted state",
    );
  }
  if (chainState.characterRootPubkey !== relay.characterRootPubkey) {
    throw new Error(
      "ERR_CHARACTER_ROOT_MISMATCH: prepared character root does not match persisted state",
    );
  }
  if (chainState.chainCreationStatus === "CONFIRMED") {
    throw new Error(
      "ERR_CHARACTER_ALREADY_CONFIRMED: character is already confirmed on chain",
    );
  }
  if (
    chainState.chainCreationStatus !== "PENDING" &&
    chainState.chainCreationStatus !== "FAILED"
  ) {
    throw new Error(
      "ERR_CHARACTER_SUBMISSION_STATE: character creation submission requires PENDING or FAILED state",
    );
  }
  if (
    relay.seasonPolicyPubkey === undefined ||
    relay.seasonPolicyPubkey.length === 0
  ) {
    throw new Error(
      `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH: season policy relay metadata is missing: ${JSON.stringify(messageDiagnostics)}`,
    );
  }

  let transactionSignature: string | null = null;

  try {
    transactionSignature = await (connection as Connection).sendRawTransaction(
      rawTransaction,
      {
        preflightCommitment: commitment,
        skipPreflight: false,
        maxRetries: 3,
      },
    );

    await updateCharacterChainState({
      characterId: relay.localCharacterId,
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreationStatus: "SUBMITTED",
      chainCreationTxSignature: transactionSignature,
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
      throw new Error(
        `ERR_CHARACTER_CREATE_CONFIRMATION_FAILED: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    const characterRootPubkey = new PublicKey(relay.characterRootPubkey);
    const characterRoot = await fetchCharacterRootAccount(
      connection as Connection,
      characterRootPubkey,
      commitment,
    );
    const cursor = await fetchCharacterSettlementBatchCursorAccount(
      connection as Connection,
      deriveCharacterBatchCursorPda(characterRootPubkey, programId),
      commitment,
    );
    const chainCreationTs = Number(characterRoot.characterCreationTs);
    const chainCreationSeasonId = cursor.lastCommittedSeasonId;

    if (!characterRoot.authority.equals(new PublicKey(accepted.authority))) {
      throw new Error(
        "ERR_CHARACTER_ROOT_CONFIRMATION_MISMATCH: confirmed character root authority mismatch",
      );
    }
    if (
      accountCharacterIdHex(characterRoot.characterId) !==
      relay.chainCharacterIdHex.toLowerCase()
    ) {
      throw new Error(
        "ERR_CHARACTER_ID_CONFIRMATION_MISMATCH: confirmed character id did not match prepared relay metadata",
      );
    }

    const chainCreatedAt = (deps.now ?? (() => new Date()))();
    await updateCharacterChainState({
      characterId: relay.localCharacterId,
      playerAuthorityPubkey: accepted.authority,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreationStatus: "CONFIRMED",
      chainCreationTxSignature: transactionSignature,
      chainCreatedAt,
      chainCreationTs,
      chainCreationSeasonId,
    });
    await prisma.character.updateCursorSnapshot(relay.localCharacterId, {
      lastReconciledEndNonce: Number(cursor.lastCommittedEndNonce),
      lastReconciledStateHash: accountStateHashHex(
        cursor.lastCommittedStateHash,
      ),
      lastReconciledBatchId: Number(cursor.lastCommittedBatchId),
      lastReconciledBattleTs: Number(cursor.lastCommittedBattleTs),
      lastReconciledSeasonId: cursor.lastCommittedSeasonId,
      lastReconciledAt: chainCreatedAt,
    });

    return {
      characterId: relay.localCharacterId,
      chainCreationStatus: "CONFIRMED",
      transactionSignature,
      chainCharacterIdHex: relay.chainCharacterIdHex,
      characterRootPubkey: relay.characterRootPubkey,
      chainCreatedAt: chainCreatedAt.toISOString(),
      cursor: {
        lastCommittedEndNonce: Number(cursor.lastCommittedEndNonce),
        lastCommittedStateHash: accountStateHashHex(
          cursor.lastCommittedStateHash,
        ),
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
      chainCreationStatus: "FAILED",
      chainCreationTxSignature: transactionSignature,
    });
    throw error;
  }
}
