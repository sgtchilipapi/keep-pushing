const firstSyncRelayMock = {
  prepareSolanaFirstSync: jest.fn(),
  acknowledgeSolanaFirstSync: jest.fn(),
};

jest.mock("../lib/solana/firstSyncRelay", () => ({
  prepareSolanaFirstSync: firstSyncRelayMock.prepareSolanaFirstSync,
  acknowledgeSolanaFirstSync: firstSyncRelayMock.acknowledgeSolanaFirstSync,
}));

import { POST as preparePOST } from "../app/api/solana/character/first-sync/prepare/route";
import { POST as ackPOST } from "../app/api/solana/character/first-sync/ack/route";

describe("first sync routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prepares a first-sync transaction", async () => {
    firstSyncRelayMock.prepareSolanaFirstSync.mockResolvedValue({
      phase: "sign_transaction",
      payload: {
        characterId: "11".repeat(16),
        batchId: 1,
        startNonce: 1,
        endNonce: 2,
        battleCount: 2,
        startStateHash: "22".repeat(32),
        endStateHash: "33".repeat(32),
        zoneProgressDelta: [],
        encounterHistogram: [],
        batchHash: "44".repeat(32),
        firstBattleTs: 1700000010,
        lastBattleTs: 1700000040,
        seasonId: 4,
        schemaVersion: 2,
        signatureScheme: 1,
      },
      expectedCursor: {
        lastCommittedEndNonce: 0,
        lastCommittedBatchId: 0,
        lastCommittedStateHash: "22".repeat(32),
        lastCommittedBattleTs: 1700000000,
        lastCommittedSeasonId: 4,
      },
      permitDomain: {
        programId: "program",
        clusterId: 1,
        playerAuthority: "wallet",
        characterRootPubkey: "root",
        batchHash: "44".repeat(32),
        batchId: 1,
        signatureScheme: 1,
      },
      playerAuthorizationMessageBase64: "",
      playerAuthorizationMessageUtf8: "",
      playerAuthorizationMessageEncoding: "utf8",
      serverAttestationMessageBase64: "server",
      preparedTransaction: {
        kind: "player_owned_instruction",
        authority: "wallet",
        feePayer: "wallet",
        serializedMessageBase64: "message",
        serializedTransactionBase64: "tx",
        messageSha256Hex: "hash",
        requiresPlayerSignature: true,
        serverBroadcast: false,
      },
    });

    const response = await preparePOST(
      new Request("http://localhost/api/solana/character/first-sync/prepare", {
        method: "POST",
        body: JSON.stringify({
          characterId: "character-1",
          authority: "wallet",
          feePayer: "wallet",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.phase).toBe("sign_transaction");
    expect(json.preparedTransaction.kind).toBe("player_owned_instruction");
  });

  it("acknowledges a client-submitted first-sync transaction", async () => {
    firstSyncRelayMock.acknowledgeSolanaFirstSync.mockResolvedValue({
      phase: "submitted",
      characterId: "character-1",
      chainCreationStatus: "SUBMITTED",
      transactionSignature: "sig-1",
      firstSettlementBatchId: "batch-1",
      remainingSettlementBatchIds: [],
    });

    const response = await ackPOST(
      new Request("http://localhost/api/solana/character/first-sync/ack", {
        method: "POST",
        body: JSON.stringify({
          prepared: { kind: "player_owned_instruction" },
          transactionSignature: "sig-1",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.phase).toBe("submitted");
    expect(json.transactionSignature).toBe("sig-1");
  });
});
