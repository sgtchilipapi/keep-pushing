import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  computeAnchorInstructionDiscriminator,
  deriveSeasonPolicyPda,
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  encodeRunanaCharacterId,
  RUNANA_PROGRAM_ID,
} from "./runanaProgram";

export interface CreateCharacterArgs {
  characterIdHex: string;
  initialUnlockedZoneId: number;
}

export interface CreateCharacterInstructionAccounts {
  payer: PublicKey;
  authority: PublicKey;
  seasonId: number;
  programId?: PublicKey;
}

export interface CreateCharacterInstructionEnvelope {
  instruction: TransactionInstruction;
  seasonPolicy: PublicKey;
  characterRoot: PublicKey;
  characterStats: PublicKey;
  characterWorldProgress: PublicKey;
  characterZoneProgressPage: PublicKey;
  characterBatchCursor: PublicKey;
  initialPageIndex: number;
}

function u16(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`,
    );
  }

  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

export function serializeCreateCharacterArgs(
  args: CreateCharacterArgs,
): Buffer {
  return Buffer.concat([
    encodeRunanaCharacterId(args.characterIdHex),
    u16(args.initialUnlockedZoneId, "initialUnlockedZoneId"),
  ]);
}

export function buildCreateCharacterInstruction(
  args: CreateCharacterArgs & CreateCharacterInstructionAccounts,
): CreateCharacterInstructionEnvelope {
  const programId = args.programId ?? RUNANA_PROGRAM_ID;
  const initialPageIndex = Math.floor(args.initialUnlockedZoneId / 256);
  const seasonPolicy = deriveSeasonPolicyPda(args.seasonId, programId);
  const characterRoot = deriveCharacterRootPda(
    args.authority,
    args.characterIdHex,
    programId,
  );
  const characterStats = deriveCharacterStatsPda(characterRoot, programId);
  const characterWorldProgress = deriveCharacterWorldProgressPda(
    characterRoot,
    programId,
  );
  const characterZoneProgressPage = deriveCharacterZoneProgressPagePda(
    characterRoot,
    initialPageIndex,
    programId,
  );
  const characterBatchCursor = deriveCharacterBatchCursorPda(
    characterRoot,
    programId,
  );

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: seasonPolicy, isSigner: false, isWritable: false },
      { pubkey: characterRoot, isSigner: false, isWritable: true },
      { pubkey: characterStats, isSigner: false, isWritable: true },
      { pubkey: characterWorldProgress, isSigner: false, isWritable: true },
      { pubkey: characterZoneProgressPage, isSigner: false, isWritable: true },
      { pubkey: characterBatchCursor, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      computeAnchorInstructionDiscriminator("create_character"),
      serializeCreateCharacterArgs(args),
    ]),
  });

  return {
    instruction,
    seasonPolicy,
    characterRoot,
    characterStats,
    characterWorldProgress,
    characterZoneProgressPage,
    characterBatchCursor,
    initialPageIndex,
  };
}
