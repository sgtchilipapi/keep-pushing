import { createHash } from 'node:crypto';

import { Keypair, SystemProgram } from '@solana/web3.js';

import { buildPreparedVersionedTransaction } from '../lib/solana/playerOwnedV0Transactions';
import { buildCreateCharacterInstruction } from '../lib/solana/runanaCharacterInstructions';
import {
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
} from '../lib/solana/runanaProgram';

function discriminator(name: string): Buffer {
  return createHash('sha256')
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

describe('runanaCharacterInstructions', () => {
  it('builds create_character with the canonical PDA order and argument bytes', () => {
    const authority = Keypair.generate().publicKey;
    const payer = authority;
    const characterIdHex = '00112233445566778899aabbccddeeff';
    const expectedRoot = deriveCharacterRootPda(authority, characterIdHex);

    const envelope = buildCreateCharacterInstruction({
      payer,
      authority,
      characterIdHex,
      characterCreationTs: 1_700_000_000,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 300,
    });

    expect(envelope.characterRoot.equals(expectedRoot)).toBe(true);
    expect(envelope.characterStats.equals(deriveCharacterStatsPda(expectedRoot))).toBe(true);
    expect(envelope.characterWorldProgress.equals(deriveCharacterWorldProgressPda(expectedRoot))).toBe(
      true,
    );
    expect(envelope.characterZoneProgressPage.equals(deriveCharacterZoneProgressPagePda(expectedRoot, 1))).toBe(
      true,
    );
    expect(envelope.characterBatchCursor.equals(deriveCharacterBatchCursorPda(expectedRoot))).toBe(true);
    expect(envelope.initialPageIndex).toBe(1);

    expect(envelope.instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: expectedRoot, isSigner: false, isWritable: true },
      { pubkey: deriveCharacterStatsPda(expectedRoot), isSigner: false, isWritable: true },
      { pubkey: deriveCharacterWorldProgressPda(expectedRoot), isSigner: false, isWritable: true },
      { pubkey: deriveCharacterZoneProgressPagePda(expectedRoot, 1), isSigner: false, isWritable: true },
      { pubkey: deriveCharacterBatchCursorPda(expectedRoot), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(
      envelope.instruction.data.equals(
        Buffer.concat([
          discriminator('create_character'),
          Buffer.from(characterIdHex, 'hex'),
          u64(1_700_000_000n),
          u32(4),
          u16(300),
        ]),
      ),
    ).toBe(true);
  });

  it('builds a signable versioned transaction from the create_character instruction', async () => {
    const authority = Keypair.generate().publicKey;
    const envelope = buildCreateCharacterInstruction({
      payer: authority,
      authority,
      characterIdHex: '00112233445566778899aabbccddeeff',
      characterCreationTs: 1_700_000_000,
      seasonIdAtCreation: 4,
      initialUnlockedZoneId: 1,
    });

    const prepared = await buildPreparedVersionedTransaction({
      connection: {
        async getLatestBlockhash() {
          return {
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 42,
          };
        },
      } as never,
      feePayer: authority,
      instructions: [envelope.instruction],
    });

    expect(typeof prepared.serializedMessageBase64).toBe('string');
    expect(typeof prepared.serializedTransactionBase64).toBe('string');
    expect(prepared.recentBlockhash).toBe('11111111111111111111111111111111');
    expect(prepared.lastValidBlockHeight).toBe(42);
  });
});
