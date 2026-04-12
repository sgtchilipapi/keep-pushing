import { createHash } from "node:crypto";

import { Keypair, SystemProgram } from "@solana/web3.js";

import { buildPreparedVersionedTransaction } from "../lib/solana/playerOwnedV0Transactions";
import { buildCreateCharacterInstruction } from "../lib/solana/runanaCharacterInstructions";
import {
  deriveClassRegistryPda,
  deriveSeasonPolicyPda,
  deriveCharacterBatchCursorPda,
  deriveCharacterRootPda,
  deriveCharacterStatsPda,
  deriveCharacterWorldProgressPda,
  deriveCharacterZoneProgressPagePda,
} from "../lib/solana/runanaProgram";

function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

describe("runanaCharacterInstructions", () => {
  it("builds create_character with the canonical PDA order and argument bytes", () => {
    const authority = Keypair.generate().publicKey;
    const payer = authority;
    const characterIdHex = "00112233445566778899aabbccddeeff";
    const seasonId = 4;
    const expectedRoot = deriveCharacterRootPda(authority, characterIdHex);
    const expectedSeasonPolicy = deriveSeasonPolicyPda(seasonId);
    const expectedClassRegistry = deriveClassRegistryPda(1);

    const envelope = buildCreateCharacterInstruction({
      payer,
      authority,
      seasonId,
      characterIdHex,
      initialUnlockedZoneId: 300,
      classId: "soldier",
      name: "Rookie One",
    });

    expect(envelope.seasonPolicy.equals(expectedSeasonPolicy)).toBe(true);
    expect(envelope.classRegistry.equals(expectedClassRegistry)).toBe(true);
    expect(envelope.characterRoot.equals(expectedRoot)).toBe(true);
    expect(
      envelope.characterStats.equals(deriveCharacterStatsPda(expectedRoot)),
    ).toBe(true);
    expect(
      envelope.characterWorldProgress.equals(
        deriveCharacterWorldProgressPda(expectedRoot),
      ),
    ).toBe(true);
    expect(
      envelope.characterZoneProgressPage.equals(
        deriveCharacterZoneProgressPagePda(expectedRoot, 1),
      ),
    ).toBe(true);
    expect(
      envelope.characterBatchCursor.equals(
        deriveCharacterBatchCursorPda(expectedRoot),
      ),
    ).toBe(true);
    expect(envelope.initialPageIndex).toBe(1);
    expect(envelope.compactClassId).toBe(1);
    expect(envelope.canonicalName).toBe("Rookie One");

    expect(envelope.instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: expectedSeasonPolicy, isSigner: false, isWritable: false },
      { pubkey: expectedClassRegistry, isSigner: false, isWritable: false },
      { pubkey: expectedRoot, isSigner: false, isWritable: true },
      {
        pubkey: deriveCharacterStatsPda(expectedRoot),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: deriveCharacterWorldProgressPda(expectedRoot),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: deriveCharacterZoneProgressPagePda(expectedRoot, 1),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: deriveCharacterBatchCursorPda(expectedRoot),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(
      envelope.instruction.data.equals(
        Buffer.concat([
          discriminator("create_character"),
          Buffer.from(characterIdHex, "hex"),
          u16(300),
          u16(1),
          Buffer.concat([Buffer.from("Rookie One", "ascii"), Buffer.alloc(6)]),
        ]),
      ),
    ).toBe(true);
  });

  it("builds a signable versioned transaction from the create_character instruction", async () => {
    const authority = Keypair.generate().publicKey;
    const envelope = buildCreateCharacterInstruction({
      payer: authority,
      authority,
      seasonId: 4,
      characterIdHex: "00112233445566778899aabbccddeeff",
      initialUnlockedZoneId: 1,
      classId: "soldier",
      name: "Rookie One",
    });

    const prepared = await buildPreparedVersionedTransaction({
      connection: {
        async getLatestBlockhash() {
          return {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 42,
          };
        },
      } as never,
      feePayer: authority,
      instructions: [envelope.instruction],
    });

    expect(typeof prepared.serializedMessageBase64).toBe("string");
    expect(typeof prepared.serializedTransactionBase64).toBe("string");
    expect(prepared.recentBlockhash).toBe("11111111111111111111111111111111");
    expect(prepared.lastValidBlockHeight).toBe(42);
  });
});
