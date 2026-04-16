jest.mock("../engine/battle/skillRegistry", () => ({
  getSkillDef: jest.fn(() => ({})),
}));

jest.mock("../engine/battle/passiveRegistry", () => ({
  getPassiveDef: jest.fn(() => ({})),
}));

const prismaMock = {
  character: {
    findById: jest.fn(),
    findChainState: jest.fn(),
    updateChainIdentity: jest.fn(),
    updateCursorSnapshot: jest.fn(),
  },
};

jest.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

jest.mock("../lib/solana/runanaAccounts", () => ({
  fetchProgramConfigAccount: jest.fn(async () => ({})),
  fetchSeasonPolicyAccount: jest.fn(async () => ({})),
  fetchClassRegistryAccount: jest.fn(async () => ({})),
  fetchCharacterRootAccount: jest.fn(),
  fetchCharacterSettlementBatchCursorAccount: jest.fn(),
  accountCharacterIdHex: jest.requireActual("../lib/solana/runanaAccounts")
    .accountCharacterIdHex,
  accountStateHashHex: jest.requireActual("../lib/solana/runanaAccounts")
    .accountStateHashHex,
}));

jest.mock("../lib/solana/playerOwnedV0Transactions", () => ({
  ...jest.requireActual("../lib/solana/playerOwnedV0Transactions"),
  buildPreparedVersionedTransaction: jest.fn(async () => ({
    serializedMessageBase64: Buffer.from("message").toString("base64"),
    serializedTransactionBase64: Buffer.from("tx").toString("base64"),
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 42,
  })),
}));
jest.mock("../lib/solana/runanaClient", () => ({
  ...jest.requireActual("../lib/solana/runanaClient"),
  loadRunanaSponsorPayer: jest.fn(() => ({
    signer: jest.requireActual("@solana/web3.js").Keypair.generate(),
    sourcePath: "/workspaces/keep-pushing/tests/fixtures/sponsor.json",
  })),
}));

import {
  ComputeBudgetProgram,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
} from "../lib/solana/runanaAccounts";
import {
  prepareSolanaCharacterCreation,
  submitSolanaCharacterCreation,
} from "../lib/solana/characterCreation";
import { prepareCharacterCreationTransaction } from "../lib/solana/playerOwnedTransactions";
import { buildCreateCharacterInstruction } from "../lib/solana/runanaCharacterInstructions";
import {
  deriveSeasonPolicyPda,
  RUNANA_PROGRAM_ID,
} from "../lib/solana/runanaProgram";

describe("characterCreation", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.character.findById.mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      name: "Rookie",
      classId: "soldier",
      level: 1,
      exp: 0,
      hp: 1200,
      hpMax: 1200,
      atk: 120,
      def: 70,
      spd: 100,
      accuracyBP: 8000,
      evadeBP: 1200,
    });
    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: null,
      chainCharacterIdHex: null,
      characterRootPubkey: null,
      chainCreationStatus: "NOT_STARTED",
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });
    prismaMock.character.updateChainIdentity.mockResolvedValue({});
    prismaMock.character.updateCursorSnapshot.mockResolvedValue({});
  });

  it("retries character identity assignment when the generated chain id collides", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    prismaMock.character.updateChainIdentity
      .mockRejectedValueOnce({
        code: "23505",
        constraint: "Character_chainCharacterIdHex_key",
        message:
          'duplicate key value violates unique constraint "Character_chainCharacterIdHex_key"',
      })
      .mockResolvedValueOnce({
        id: "character-1",
        playerAuthorityPubkey: authority,
        chainCharacterIdHex: "22".repeat(16),
        characterRootPubkey: Keypair.generate().publicKey.toBase58(),
        chainCreationStatus: "PENDING",
        chainCreationTxSignature: null,
        chainCreatedAt: null,
        chainCreationTs: null,
        chainCreationSeasonId: null,
        lastReconciledEndNonce: null,
        lastReconciledStateHash: null,
        lastReconciledBatchId: null,
        lastReconciledBattleTs: null,
        lastReconciledSeasonId: null,
        lastReconciledAt: null,
      });

    const result = await prepareSolanaCharacterCreation(
      {
        characterId: "character-1",
        authority,
        initialUnlockedZoneId: 1,
      },
      {
        connection: {} as never,
        env: {
          RUNANA_ACTIVE_SEASON_ID: "4",
        },
        generateCharacterIdHex: jest
          .fn()
          .mockReturnValueOnce("11".repeat(16))
          .mockReturnValueOnce("22".repeat(16)),
      },
    );

    expect(result.phase).toBe("sign_transaction");
    if (result.phase !== "sign_transaction") {
      throw new Error("expected sign_transaction phase");
    }
    expect(prismaMock.character.findById).toHaveBeenCalledWith("character-1");
    expect(prismaMock.character.updateChainIdentity).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.character.updateChainIdentity.mock.calls[0]?.[1],
    ).toMatchObject({
      chainCharacterIdHex: "11".repeat(16),
    });
    expect(
      prismaMock.character.updateChainIdentity.mock.calls[1]?.[1],
    ).toMatchObject({
      chainCharacterIdHex: "22".repeat(16),
    });
    expect(result.character.chain.chainCharacterIdHex).toBe("22".repeat(16));
    expect(result.character.chain.chainCreationTs).toBeNull();
    expect(result.character.chain.chainCreationSeasonId).toBeNull();
    expect(
      result.preparedTransaction.characterCreationRelay?.chainCharacterIdHex,
    ).toBe("22".repeat(16));
    expect(
      result.preparedTransaction.characterCreationRelay?.seasonPolicyPubkey,
    ).toBeDefined();
    expect(
      result.preparedTransaction.characterCreationRelay?.characterCreationTs,
    ).toBeUndefined();
    expect(
      result.preparedTransaction.characterCreationRelay?.seasonIdAtCreation,
    ).toBeUndefined();
  });

  it("reuses the reserved chain identity when character creation is pending", async () => {
    const authority = Keypair.generate();
    const chainCharacterIdHex = "11".repeat(16);
    const characterRootPubkey = buildCreateCharacterInstruction({
      payer: authority.publicKey,
      authority: authority.publicKey,
      seasonId: 4,
      programId: RUNANA_PROGRAM_ID,
      characterIdHex: chainCharacterIdHex,
      initialUnlockedZoneId: 1,
      classId: "soldier",
      name: "Rookie",
    }).characterRoot.toBase58();

    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: authority.publicKey.toBase58(),
      chainCharacterIdHex,
      characterRootPubkey,
      chainCreationStatus: "PENDING",
      chainCreationTxSignature: null,
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });

    const result = await prepareSolanaCharacterCreation(
      {
        characterId: "character-1",
        authority: authority.publicKey.toBase58(),
        initialUnlockedZoneId: 1,
      },
      {
        connection: {} as never,
        env: {
          RUNANA_ACTIVE_SEASON_ID: "4",
        },
        generateCharacterIdHex: jest.fn().mockReturnValue("22".repeat(16)),
      },
    );

    expect(result.phase).toBe("sign_transaction");
    if (result.phase !== "sign_transaction") {
      throw new Error("expected sign_transaction phase");
    }
    expect(prismaMock.character.updateChainIdentity).toHaveBeenCalledWith(
      "character-1",
      expect.objectContaining({
        playerAuthorityPubkey: authority.publicKey.toBase58(),
        chainCharacterIdHex,
        characterRootPubkey,
        chainCreationStatus: "PENDING",
      }),
    );
    expect(result.character.chain.chainCharacterIdHex).toBe(chainCharacterIdHex);
    expect(result.character.chain.characterRootPubkey).toBe(characterRootPubkey);
    expect(
      result.preparedTransaction.characterCreationRelay?.chainCharacterIdHex,
    ).toBe(chainCharacterIdHex);
  });

  it("returns an in-flight response when the character create transaction is already submitted", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const chainCharacterIdHex = "11".repeat(16);
    const characterRootPubkey = Keypair.generate().publicKey.toBase58();

    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: authority,
      chainCharacterIdHex,
      characterRootPubkey,
      chainCreationStatus: "SUBMITTED",
      chainCreationTxSignature: "submitted-sig-1",
      chainCreatedAt: null,
      chainCreationTs: null,
      chainCreationSeasonId: null,
      lastReconciledEndNonce: null,
      lastReconciledStateHash: null,
      lastReconciledBatchId: null,
      lastReconciledBattleTs: null,
      lastReconciledSeasonId: null,
      lastReconciledAt: null,
    });

    const result = await prepareSolanaCharacterCreation(
      {
        characterId: "character-1",
        authority,
        initialUnlockedZoneId: 1,
      },
      {
        connection: {} as never,
        env: {
          RUNANA_ACTIVE_SEASON_ID: "4",
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        phase: "submitted",
        transactionSignature: "submitted-sig-1",
      }),
    );
    expect(prismaMock.character.updateChainIdentity).not.toHaveBeenCalled();
  });

  it("rejects prepare when the local character is already confirmed on chain", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: authority,
      chainCharacterIdHex: "11".repeat(16),
      characterRootPubkey: Keypair.generate().publicKey.toBase58(),
      chainCreationStatus: "CONFIRMED",
      chainCreationTxSignature: "sig",
      chainCreatedAt: new Date("2026-04-09T13:00:00.000Z"),
      chainCreationTs: 1_700_000_000,
      chainCreationSeasonId: 4,
      lastReconciledEndNonce: 0,
      lastReconciledStateHash: "11".repeat(32),
      lastReconciledBatchId: 0,
      lastReconciledBattleTs: 1_700_000_000,
      lastReconciledSeasonId: 4,
      lastReconciledAt: new Date("2026-04-09T13:00:01.000Z"),
    });

    await expect(
      prepareSolanaCharacterCreation(
        {
          characterId: "character-1",
          authority,
          initialUnlockedZoneId: 1,
        },
        {
          connection: {} as never,
          env: {
            RUNANA_ACTIVE_SEASON_ID: "4",
          },
        },
      ),
    ).rejects.toThrow(/ERR_CHARACTER_ALREADY_CONFIRMED/);
  });

  it("accepts a wallet-signed create transaction when only the message bytes differ", async () => {
    const authority = Keypair.generate();
    const seasonId = 4;
    const chainCharacterIdHex = "22".repeat(16);
    const initialUnlockedZoneId = 1;
    const createInstruction = buildCreateCharacterInstruction({
      payer: authority.publicKey,
      authority: authority.publicKey,
      seasonId,
      programId: RUNANA_PROGRAM_ID,
      characterIdHex: chainCharacterIdHex,
      initialUnlockedZoneId,
      classId: "soldier",
      name: "Rookie",
    });

    const preparedMessage = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [createInstruction.instruction],
    }).compileToV0Message();
    const preparedTransaction = new VersionedTransaction(preparedMessage);

    const signedMessage = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        createInstruction.instruction,
      ],
    }).compileToV0Message();
    const signedTransaction = new VersionedTransaction(signedMessage);
    signedTransaction.sign([authority]);

    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: authority.publicKey.toBase58(),
      chainCharacterIdHex,
      characterRootPubkey: createInstruction.characterRoot.toBase58(),
      chainCreationStatus: "PENDING",
    });
    (fetchCharacterRootAccount as jest.Mock).mockResolvedValue({
      authority: authority.publicKey,
      characterId: Buffer.from(chainCharacterIdHex, "hex"),
      characterCreationTs: 1_700_000_000n,
    });
    (fetchCharacterSettlementBatchCursorAccount as jest.Mock).mockResolvedValue(
      {
        lastCommittedEndNonce: 0n,
        lastCommittedStateHash: Buffer.alloc(32, 7),
        lastCommittedBatchId: 0n,
        lastCommittedBattleTs: 1_699_999_900n,
        lastCommittedSeasonId: seasonId,
      },
    );

    const connection = {
      sendRawTransaction: jest.fn().mockResolvedValue("tx-signature-1"),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    };

    const prepared = prepareCharacterCreationTransaction({
      authority: authority.publicKey.toBase58(),
      feePayer: authority.publicKey.toBase58(),
      serializedMessageBase64: Buffer.from(
        preparedMessage.serialize(),
      ).toString("base64"),
      serializedTransactionBase64: Buffer.from(
        preparedTransaction.serialize(),
      ).toString("base64"),
      localCharacterId: "character-1",
      chainCharacterIdHex,
      characterRootPubkey: createInstruction.characterRoot.toBase58(),
      classId: "soldier",
      name: "Rookie",
      seasonPolicyPubkey: deriveSeasonPolicyPda(
        seasonId,
        RUNANA_PROGRAM_ID,
      ).toBase58(),
      initialUnlockedZoneId,
      recentBlockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 42,
    });

    const result = await submitSolanaCharacterCreation(
      {
        prepared,
        signedMessageBase64: Buffer.from(signedMessage.serialize()).toString(
          "base64",
        ),
        signedTransactionBase64: Buffer.from(
          signedTransaction.serialize(),
        ).toString("base64"),
      },
      {
        connection: connection as never,
        now: () => new Date("2026-04-09T13:30:00.000Z"),
      },
    );

    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(result.chainCreationStatus).toBe("CONFIRMED");
  });

  it("rejects a semantically mutated signed create transaction", async () => {
    const authority = Keypair.generate();
    const seasonId = 4;
    const chainCharacterIdHex = "33".repeat(16);
    const initialUnlockedZoneId = 1;
    const mutatedInstruction = buildCreateCharacterInstruction({
      payer: authority.publicKey,
      authority: authority.publicKey,
      seasonId,
      programId: RUNANA_PROGRAM_ID,
      characterIdHex: chainCharacterIdHex,
      initialUnlockedZoneId: 2,
      classId: "soldier",
      name: "Rookie",
    });
    const signedMessage = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [mutatedInstruction.instruction],
    }).compileToV0Message();
    const signedTransaction = new VersionedTransaction(signedMessage);
    signedTransaction.sign([authority]);

    const prepared = prepareCharacterCreationTransaction({
      authority: authority.publicKey.toBase58(),
      feePayer: authority.publicKey.toBase58(),
      serializedMessageBase64:
        Buffer.from("prepared-message").toString("base64"),
      serializedTransactionBase64: Buffer.from("prepared-transaction").toString(
        "base64",
      ),
      localCharacterId: "character-1",
      chainCharacterIdHex,
      characterRootPubkey: mutatedInstruction.characterRoot.toBase58(),
      classId: "soldier",
      name: "Rookie",
      seasonPolicyPubkey: deriveSeasonPolicyPda(
        seasonId,
        RUNANA_PROGRAM_ID,
      ).toBase58(),
      initialUnlockedZoneId,
      recentBlockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 42,
    });
    prismaMock.character.findChainState.mockResolvedValue({
      id: "character-1",
      playerAuthorityPubkey: authority.publicKey.toBase58(),
      chainCharacterIdHex,
      characterRootPubkey: mutatedInstruction.characterRoot.toBase58(),
      chainCreationStatus: "PENDING",
    });

    await expect(
      submitSolanaCharacterCreation(
        {
          prepared,
          signedMessageBase64: Buffer.from(signedMessage.serialize()).toString(
            "base64",
          ),
          signedTransactionBase64: Buffer.from(
            signedTransaction.serialize(),
          ).toString("base64"),
        },
        {
          connection: {
            sendRawTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
          } as never,
        },
      ),
    ).rejects.toThrow(/ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH/);
  });
});
