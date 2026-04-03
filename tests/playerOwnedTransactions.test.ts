import {
  acceptSignedPlayerOwnedTransaction,
  prepareCharacterCreationTransaction,
  prepareSettlementTransaction,
} from "../lib/solana/playerOwnedTransactions";

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
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
    const prepared = prepareSettlementTransaction({
      playerAuthority: "player-wallet-1",
      feePayer: "player-wallet-1",
      characterId: "char-1",
      batchId: 7,
      serializedMessageBase64: toBase64("settlement-message"),
    });

    expect(prepared.kind).toBe("battle_settlement");
    expect(prepared.authority).toBe("player-wallet-1");
    expect(prepared.feePayer).toBe("player-wallet-1");
  });

  it("accepts an unchanged player-signed transaction for server broadcast", () => {
    const prepared = prepareSettlementTransaction({
      playerAuthority: "player-wallet-1",
      feePayer: "player-wallet-1",
      characterId: "char-1",
      batchId: 8,
      serializedMessageBase64: toBase64("settlement-message"),
    });

    const accepted = acceptSignedPlayerOwnedTransaction({
      prepared,
      signedMessageBase64: prepared.serializedMessageBase64,
      signedTransactionBase64: toBase64("signed-settlement-transaction"),
    });

    expect(accepted.acceptedForBroadcast).toBe(true);
    expect(accepted.messageSha256Hex).toBe(prepared.messageSha256Hex);
    expect(accepted.signedTransactionSha256Hex).toHaveLength(64);
  });

  it("rejects a mutated message after player signing", () => {
    const prepared = prepareSettlementTransaction({
      playerAuthority: "player-wallet-1",
      feePayer: "player-wallet-1",
      characterId: "char-1",
      batchId: 9,
      serializedMessageBase64: toBase64("settlement-message"),
    });

    expect(() =>
      acceptSignedPlayerOwnedTransaction({
        prepared,
        signedMessageBase64: toBase64("mutated-settlement-message"),
        signedTransactionBase64: toBase64("signed-settlement-transaction"),
      }),
    ).toThrow(/ERR_SIGNED_MESSAGE_MISMATCH/);
  });
});
