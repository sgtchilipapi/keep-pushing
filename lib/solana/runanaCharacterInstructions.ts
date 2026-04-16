import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

import { assertValidCharacterName } from '../characterIdentity';
import { getCompactClassId } from '../catalog/classes';
import {
  computeAnchorInstructionDiscriminator,
  deriveClassRegistryPda,
  deriveSeasonPolicyPda,
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
  encodeRunanaCharacterId,
  RUNANA_PROGRAM_ID,
} from './runanaProgram';

const MAX_CHARACTER_NAME_LEN = 16;

export interface CreateCharacterArgs {
  characterIdHex: string;
  initialUnlockedZoneId: number;
  classId: string;
  name: string;
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
  classRegistry: PublicKey;
  characterRoot: PublicKey;
  characterStats: PublicKey;
  characterWorldProgress: PublicKey;
  characterZoneProgressPage: PublicKey;
  characterBatchCursor: PublicKey;
  initialPageIndex: number;
  compactClassId: number;
  canonicalName: string;
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

function fixedAscii16(value: string, field: string): Buffer {
  const canonical = assertValidCharacterName(value);
  if (Buffer.byteLength(canonical, 'ascii') > MAX_CHARACTER_NAME_LEN) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be at most ${MAX_CHARACTER_NAME_LEN} ASCII bytes`,
    );
  }

  const buffer = Buffer.alloc(MAX_CHARACTER_NAME_LEN);
  buffer.write(canonical, 0, 'ascii');
  return buffer;
}

export function serializeCreateCharacterArgs(
  args: CreateCharacterArgs,
): Buffer {
  return Buffer.concat([
    encodeRunanaCharacterId(args.characterIdHex),
    u16(args.initialUnlockedZoneId, 'initialUnlockedZoneId'),
    u16(getCompactClassId(args.classId), 'classId'),
    fixedAscii16(args.name, 'name'),
  ]);
}

export function buildCreateCharacterInstruction(
  args: CreateCharacterArgs & CreateCharacterInstructionAccounts,
): CreateCharacterInstructionEnvelope {
  const programId = args.programId ?? RUNANA_PROGRAM_ID;
  const initialPageIndex = Math.floor(args.initialUnlockedZoneId / 256);
  const seasonPolicy = deriveSeasonPolicyPda(args.seasonId, programId);
  const compactClassId = getCompactClassId(args.classId);
  const classRegistry = deriveClassRegistryPda(compactClassId, programId);
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
  const canonicalName = assertValidCharacterName(args.name);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: seasonPolicy, isSigner: false, isWritable: false },
      { pubkey: classRegistry, isSigner: false, isWritable: false },
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
    seasonPolicy,
    classRegistry,
    characterRoot,
    characterStats,
    characterWorldProgress,
    characterZoneProgressPage,
    characterBatchCursor,
    initialPageIndex,
    compactClassId,
    canonicalName,
  };
}
