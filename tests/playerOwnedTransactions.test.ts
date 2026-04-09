import {
  acceptSignedPlayerOwnedTransaction,
  prepareCharacterCreationTransaction,
  prepareFirstSyncTransaction,
  prepareSettlementTransaction,
} from "../lib/solana/playerOwnedTransactions";
import type { PrepareSettlementTransactionRequest } from "../types/api/solana";
import type { SettlementBatchPayloadV2 } from "../types/settlement";

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function buildPayload(
  overrides: Partial<SettlementBatchPayloadV2> = {},
): SettlementBatchPayloadV2 {
  return {
    characterId: "char-1",
    batchId: 7,
    startNonce: 8,
    endNonce: 10,
    battleCount: 3,
    startStateHash: "state-hash-6",
    endStateHash: "state-hash-7",
    zoneProgressDelta: [{ zoneId: 3, newState: 1 }],
    encounterHistogram: [{ zoneId: 3, enemyArchetypeId: 22, count: 3 }],
    batchHash: "batch-hash-7",
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_220,
    seasonId: 4,
    schemaVersion: 2,
    signatureScheme: 0,
    ...overrides,
  };
}

function buildSettlementRequest(
  overrides: Partial<PrepareSettlementTransactionRequest> = {},
): PrepareSettlementTransactionRequest {
  const payload = buildPayload();

  return {
    playerAuthority: "player-wallet-1",
    feePayer: "player-wallet-1",
    characterRootPubkey: "character-root-1",
    payload,
    expectedCursor: {
      lastCommittedEndNonce: 7,
      lastCommittedBatchId: 6,
      lastCommittedStateHash: "state-hash-6",
      lastCommittedBattleTs: 1_700_000_090,
      lastCommittedSeasonId: 4,
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
      serializedTransactionBase64: toBase64(
        "unsigned-character-create-transaction",
      ),
      localCharacterId: "local-character-1",
      chainCharacterIdHex: "00112233445566778899aabbccddeeff",
      characterRootPubkey: "character-root-1",
      initialUnlockedZoneId: 1,
      recentBlockhash: "recent-blockhash-1",
      lastValidBlockHeight: 88,
    });

    expect(prepared.kind).toBe("character_create");
    expect(prepared.authority).toBe("player-wallet-1");
    expect(prepared.feePayer).toBe("player-wallet-1");
    expect(prepared.serializedTransactionBase64).toBe(
      toBase64("unsigned-character-create-transaction"),
    );
    expect(prepared.requiresPlayerSignature).toBe(true);
    expect(prepared.serverBroadcast).toBe(true);
    expect(prepared.messageSha256Hex).toHaveLength(64);
    expect(prepared.characterCreationRelay).toEqual({
      localCharacterId: "local-character-1",
      chainCharacterIdHex: "00112233445566778899aabbccddeeff",
      characterRootPubkey: "character-root-1",
      initialUnlockedZoneId: 1,
      recentBlockhash: "recent-blockhash-1",
      lastValidBlockHeight: 88,
    });
  });

  it("rejects sponsored character creation before broadcast", () => {
    expect(() =>
      prepareCharacterCreationTransaction({
        authority: "player-wallet-1",
        feePayer: "server-wallet-1",
        serializedMessageBase64: toBase64("character-create-message"),
        serializedTransactionBase64: toBase64(
          "unsigned-character-create-transaction",
        ),
        localCharacterId: "local-character-1",
        chainCharacterIdHex: "00112233445566778899aabbccddeeff",
        characterRootPubkey: "character-root-1",
        initialUnlockedZoneId: 1,
        recentBlockhash: "recent-blockhash-1",
        lastValidBlockHeight: 88,
      }),
    ).toThrow(/ERR_PLAYER_MUST_PAY/);
  });

  it("prepares settlement with canonical cursor anchors", () => {
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
      endStateHash: "state-hash-7",
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_220,
      seasonId: 4,
      schemaVersion: 2,
      signatureScheme: 0,
      expectedCursor: {
        lastCommittedEndNonce: 7,
        lastCommittedBatchId: 6,
        lastCommittedStateHash: "state-hash-6",
        lastCommittedBattleTs: 1_700_000_090,
        lastCommittedSeasonId: 4,
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

  it("prepares atomic first sync with both character creation and settlement relay metadata", () => {
    const payload = buildPayload({
      batchId: 1,
      startNonce: 1,
      endNonce: 2,
      battleCount: 2,
      firstBattleTs: 1_700_000_010,
      lastBattleTs: 1_700_000_040,
      batchHash: "batch-hash-1",
    });

    const prepared = prepareFirstSyncTransaction({
      authority: "player-wallet-1",
      feePayer: "player-wallet-1",
      serializedMessageBase64: toBase64("first-sync-message"),
      serializedTransactionBase64: toBase64("first-sync-transaction"),
      characterCreation: {
        localCharacterId: "local-character-1",
        chainCharacterIdHex: "00112233445566778899aabbccddeeff",
        characterRootPubkey: "character-root-1",
        characterCreationTs: 1_700_000_000,
        seasonIdAtCreation: 4,
        initialUnlockedZoneId: 1,
        recentBlockhash: "recent-blockhash-1",
        lastValidBlockHeight: 88,
      },
      settlement: {
        characterRootPubkey: "character-root-1",
        payload,
        expectedCursor: {
          lastCommittedEndNonce: 0,
          lastCommittedBatchId: 0,
          lastCommittedStateHash: "state-hash-6",
          lastCommittedBattleTs: 1_700_000_000,
          lastCommittedSeasonId: 4,
        },
        permitDomain: {
          programId: "runana-program-1",
          clusterId: 1,
          playerAuthority: "player-wallet-1",
          characterRootPubkey: "character-root-1",
          batchHash: "batch-hash-1",
          batchId: 1,
          signatureScheme: 0,
        },
      },
    });

    expect(prepared.kind).toBe("player_owned_instruction");
    expect(prepared.characterCreationRelay?.localCharacterId).toBe(
      "local-character-1",
    );
    expect(prepared.settlementRelay?.batchId).toBe(1);
  });

  it("rejects out-of-order settlement before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          payload: buildPayload({
            startNonce: 9,
          }),
        }),
      ),
    ).toThrow(/ERR_BATCH_OUT_OF_ORDER/);
  });

  it("rejects a batch id gap before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          payload: buildPayload({
            batchId: 8,
          }),
        }),
      ),
    ).toThrow(/ERR_BATCH_ID_GAP/);
  });

  it("rejects a start-state hash mismatch before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          payload: buildPayload({
            startStateHash: "state-hash-mutated",
          }),
        }),
      ),
    ).toThrow(/ERR_START_STATE_HASH_MISMATCH/);
  });

  it("rejects battle timestamp regression before broadcast", () => {
    expect(() =>
      prepareSettlementTransaction(
        buildSettlementRequest({
          payload: buildPayload({
            firstBattleTs: 1_700_000_080,
          }),
        }),
      ),
    ).toThrow(/ERR_BATTLE_TS_REGRESSION/);
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

  it("accepts an unchanged player-signed transaction for server broadcast", () => {
    const prepared = prepareSettlementTransaction(
      buildSettlementRequest({
        payload: buildPayload({
          batchId: 8,
          batchHash: "batch-hash-8",
          startNonce: 11,
          endNonce: 12,
          battleCount: 2,
          startStateHash: "state-hash-7",
          endStateHash: "state-hash-8",
          firstBattleTs: 1_700_000_230,
          lastBattleTs: 1_700_000_260,
        }),
        expectedCursor: {
          lastCommittedEndNonce: 10,
          lastCommittedBatchId: 7,
          lastCommittedStateHash: "state-hash-7",
          lastCommittedBattleTs: 1_700_000_220,
          lastCommittedSeasonId: 4,
        },
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
    expect(accepted.settlementRelay?.reconciliationKey).toBe(
      "char-1:8:batch-hash-8",
    );
  });

  it("accepts browser-submitted transactions even if the echoed signed message differs", () => {
    const prepared = prepareSettlementTransaction(
      buildSettlementRequest({
        payload: buildPayload({
          batchId: 9,
          batchHash: "batch-hash-9",
          startNonce: 13,
          endNonce: 14,
          battleCount: 2,
          startStateHash: "state-hash-8",
          endStateHash: "state-hash-9",
          firstBattleTs: 1_700_000_230,
          lastBattleTs: 1_700_000_260,
        }),
        expectedCursor: {
          lastCommittedEndNonce: 12,
          lastCommittedBatchId: 8,
          lastCommittedStateHash: "state-hash-8",
          lastCommittedBattleTs: 1_700_000_220,
          lastCommittedSeasonId: 4,
        },
        permitDomain: {
          ...buildSettlementRequest().permitDomain,
          batchId: 9,
          batchHash: "batch-hash-9",
        },
      }),
    );

    const accepted = acceptSignedPlayerOwnedTransaction({
      prepared,
      signedMessageBase64: toBase64("browser-echoed-message"),
      signedTransactionBase64: toBase64("signed-settlement-transaction"),
    });

    expect(accepted.acceptedForBroadcast).toBe(true);
    expect(accepted.signedTransactionSha256Hex).toHaveLength(64);
  });
});
