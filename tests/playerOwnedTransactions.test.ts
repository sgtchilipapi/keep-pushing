import {
  acceptSignedPlayerOwnedTransaction,
  prepareCharacterCreationTransaction,
  prepareSettlementTransaction,
} from "../lib/solana/playerOwnedTransactions";
import type { PrepareSettlementTransactionRequest } from "../types/api/solana";

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function buildSettlementRequest(
  overrides: Partial<PrepareSettlementTransactionRequest> = {},
): PrepareSettlementTransactionRequest {
  return {
    playerAuthority: "player-wallet-1",
    feePayer: "player-wallet-1",
    characterId: "char-1",
    characterRootPubkey: "character-root-1",
    batchId: 7,
    batchHash: "batch-hash-7",
    startNonce: 8,
    endNonce: 10,
    startStateHash: "state-hash-6",
    expectedCursor: {
      lastCommittedEndNonce: 7,
      lastCommittedBatchId: 6,
      lastCommittedStateHash: "state-hash-6",
    },
    permitDomain: {
      programId: "runana-program-1",
      clusterId: 1,
      playerAuthority: "player-wallet-1",
      characterRootPubkey: "character-root-1",
      batchHash: "batch-hash-7",
      batchId: 7,
      signatureScheme: 0,
    },
    relayRequestId: "relay-request-1",
    serializedMessageBase64: toBase64("settlement-message"),
    ...overrides,
  };
}

describe("player-owned Solana transaction flow", () => {
  it("prepares character creation with the player as fee payer", () => {
    const prepared = prepareCharacterCreationTransaction({
      authority: "player-wallet-1",
      feePayer: "player-wallet-1",
      serializedMessageBase64: toBase64("character-create-message"),
    });

    expect(prepared.kind).toBe("character_create");
    expect(prepared.authority).toBe("player-wallet-1");
    expect(prepared.feePayer).toBe("player-wallet-1");
    expect(prepared.requiresPlayerSignature).toBe(true);
    expect(prepared.serverBroadcast).toBe(true);
    expect(prepared.messageSha256Hex).toHaveLength(64);
  });

  it("rejects sponsored character creation before broadcast", () => {
    expect(() =>
      prepareCharacterCreationTransaction({
        authority: "player-wallet-1",
        feePayer: "server-wallet-1",
        serializedMessageBase64: toBase64("character-create-message"),
      }),
    ).toThrow(/ERR_PLAYER_MUST_PAY/);
  });

  it("prepares settlement with the player as fee payer", () => {
    const prepared = prepareSettlementTransaction(buildSettlementRequest());

    expect(prepared.kind).toBe("battle_settlement");
    expect(prepared.authority).toBe("player-wallet-1");
    expect(prepared.feePayer).toBe("player-wallet-1");
    expect(prepared.settlementRelay).toEqual({
      relayRequestId: "relay-request-1",
      characterId: "char-1",
      characterRootPubkey: "character-root-1",
      batchId: 7,
      batchHash: "batch-hash-7",
      startNonce: 8,
      endNonce: 10,
      startStateHash: "state-hash-6",
      expectedCursor: {
        lastCommittedEndNonce: 7,
        lastCommittedBatchId: 6,
        lastCommittedStateHash: "state-hash-6",
      },
      permitDomain: {
        programId: "runana-program-1",
        clusterId: 1,
        playerAuthority: "player-wallet-1",
        characterRootPubkey: "character-root-1",
        batchHash: "batch-hash-7",
        batchId: 7,
        signatureScheme: 0,
      },
      continuityKey: "char-1:7->10",
      reconciliationKey: "char-1:7:batch-hash-7",
    });
  });

  it("rejects out-of-order settlement before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          startNonce: 9,
        }),
      ),
    ).toThrow(/ERR_BATCH_OUT_OF_ORDER/);
  });

  it("rejects a batch id gap before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          batchId: 8,
        }),
      ),
    ).toThrow(/ERR_BATCH_ID_GAP/);
  });

  it("rejects a start-state hash mismatch before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          startStateHash: "state-hash-mutated",
        }),
      ),
    ).toThrow(/ERR_START_STATE_HASH_MISMATCH/);
  });

  it("rejects player permit batch hash mismatches before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          permitDomain: {
            ...buildSettlementRequest().permitDomain,
            batchHash: "batch-hash-mutated",
          },
        }),
      ),
    ).toThrow(/ERR_PLAYER_PERMIT_DOMAIN_MISMATCH/);
  });

  it("rejects player permit batch id mismatches before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          permitDomain: {
            ...buildSettlementRequest().permitDomain,
            batchId: 8,
          },
        }),
      ),
    ).toThrow(/ERR_PLAYER_PERMIT_DOMAIN_MISMATCH/);
  });

  it("rejects player permit character root mismatches before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          permitDomain: {
            ...buildSettlementRequest().permitDomain,
            characterRootPubkey: "character-root-other",
          },
        }),
      ),
    ).toThrow(/ERR_PLAYER_PERMIT_DOMAIN_MISMATCH/);
  });

  it("accepts an unchanged player-signed transaction for server broadcast", () => {
    const prepared = prepareSettlementTransaction(
      buildSettlementRequest({
        batchId: 8,
        batchHash: "batch-hash-8",
        startNonce: 11,
        endNonce: 12,
        expectedCursor: {
          lastCommittedEndNonce: 10,
          lastCommittedBatchId: 7,
          lastCommittedStateHash: "state-hash-7",
        },
        startStateHash: "state-hash-7",
        permitDomain: {
          ...buildSettlementRequest().permitDomain,
          batchId: 8,
          batchHash: "batch-hash-8",
        },
      }),
    );

    const accepted = acceptSignedPlayerOwnedTransaction({
      prepared,
      signedMessageBase64: prepared.serializedMessageBase64,
      signedTransactionBase64: toBase64("signed-settlement-transaction"),
    });

    expect(accepted.acceptedForBroadcast).toBe(true);
    expect(accepted.messageSha256Hex).toBe(prepared.messageSha256Hex);
    expect(accepted.signedTransactionSha256Hex).toHaveLength(64);
    expect(accepted.settlementRelay?.reconciliationKey).toBe("char-1:8:batch-hash-8");
  });

  it("rejects a mutated message after player signing", () => {
    const prepared = prepareSettlementTransaction(
      buildSettlementRequest({
        batchId: 9,
        batchHash: "batch-hash-9",
        startNonce: 13,
        endNonce: 14,
        expectedCursor: {
          lastCommittedEndNonce: 12,
          lastCommittedBatchId: 8,
          lastCommittedStateHash: "state-hash-8",
        },
        startStateHash: "state-hash-8",
        permitDomain: {
          ...buildSettlementRequest().permitDomain,
          batchId: 9,
          batchHash: "batch-hash-9",
        },
      }),
    );

    expect(() =>
      acceptSignedPlayerOwnedTransaction({
        prepared,
        signedMessageBase64: toBase64("mutated-settlement-message"),
        signedTransactionBase64: toBase64("signed-settlement-transaction"),
      }),
    ).toThrow(/ERR_SIGNED_MESSAGE_MISMATCH/);
  });
});
