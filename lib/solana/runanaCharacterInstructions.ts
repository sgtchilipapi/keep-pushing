import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

import {
  computeAnchorInstructionDiscriminator,
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  encodeRunanaCharacterId,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

type U64Like = number | bigint;

export interface CreateCharacterArgs {
  characterIdHex: string;
  characterCreationTs: U64Like;
  seasonIdAtCreation: number;
  initialUnlockedZoneId: number;
}

export interface CreateCharacterInstructionAccounts {
  payer: PublicKey;
  authority: PublicKey;
  programId?: PublicKey;
}

export interface CreateCharacterInstructionEnvelope {
  instruction: TransactionInstruction;
  characterRoot: PublicKey;
  characterStats: PublicKey;
  characterWorldProgress: PublicKey;
  characterZoneProgressPage: PublicKey;
  characterBatchCursor: PublicKey;
  initialPageIndex: number;
}

function u16(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u16`);
  }

  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u32`);
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: U64Like, field: string): Buffer {
  const normalized =
    typeof value === 'bigint'
      ? value
      : (() => {
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(
              `ERR_INVALID_${field.toUpperCase()}: ${field} must be a safe integer or bigint >= 0`,
            );
          }

          return BigInt(value);
        })();

  if (normalized < 0n || normalized > 0xffffffffffffffffn) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must fit in u64`);
  }

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(normalized, 0);
  return buffer;
}

export function serializeCreateCharacterArgs(args: CreateCharacterArgs): Buffer {
  return Buffer.concat([
    encodeRunanaCharacterId(args.characterIdHex),
    u64(args.characterCreationTs, 'characterCreationTs'),
    u32(args.seasonIdAtCreation, 'seasonIdAtCreation'),
    u16(args.initialUnlockedZoneId, 'initialUnlockedZoneId'),
  ]);
}

export function buildCreateCharacterInstruction(
  args: CreateCharacterArgs & CreateCharacterInstructionAccounts,
): CreateCharacterInstructionEnvelope {
  const programId = args.programId ?? RUNANA_PROGRAM_ID;
  const initialPageIndex = Math.floor(args.initialUnlockedZoneId / 256);
  const characterRoot = deriveCharacterRootPda(args.authority, args.characterIdHex, programId);
  const characterStats = deriveCharacterStatsPda(characterRoot, programId);
  const characterWorldProgress = deriveCharacterWorldProgressPda(characterRoot, programId);
  const characterZoneProgressPage = deriveCharacterZoneProgressPagePda(
    characterRoot,
    initialPageIndex,
    programId,
  );
  const characterBatchCursor = deriveCharacterBatchCursorPda(characterRoot, programId);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: characterRoot, isSigner: false, isWritable: true },
      { pubkey: characterStats, isSigner: false, isWritable: true },
      { pubkey: characterWorldProgress, isSigner: false, isWritable: true },
      { pubkey: characterZoneProgressPage, isSigner: false, isWritable: true },
      { pubkey: characterBatchCursor, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      computeAnchorInstructionDiscriminator('create_character'),
      serializeCreateCharacterArgs(args),
    ]),
  });

  return {
    instruction,
    characterRoot,
    characterStats,
    characterWorldProgress,
    characterZoneProgressPage,
    characterBatchCursor,
    initialPageIndex,
  };
}
