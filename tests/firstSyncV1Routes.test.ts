const firstSyncRelayMock = {
  prepareSolanaFirstSync: jest.fn(),
  acknowledgeSolanaFirstSync: jest.fn(),
};
const authMock = {
  requireSession: jest.fn(),
  requireSessionCharacterAccess: jest.fn(),
};

jest.mock("../lib/solana/firstSyncRelay", () => ({
  prepareSolanaFirstSync: firstSyncRelayMock.prepareSolanaFirstSync,
  acknowledgeSolanaFirstSync: firstSyncRelayMock.acknowledgeSolanaFirstSync,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSession: authMock.requireSession,
    requireSessionCharacterAccess: authMock.requireSessionCharacterAccess,
  };
});

import { POST as preparePOST } from "../app/api/v1/characters/first-sync/prepare/route";
import { POST as finalizePOST } from "../app/api/v1/characters/first-sync/finalize/route";

describe("v1 first sync routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSession.mockResolvedValue({
      session: {
        id: "session-1",
        userId: "user-1",
        walletAddress: "wallet",
        expiresAt: new Date("2026-05-01T00:00:00.000Z"),
        revokedAt: null,
      },
      user: {
        id: "user-1",
        primaryWalletAddress: "wallet",
      },
    });
    authMock.requireSessionCharacterAccess.mockResolvedValue({
      session: {
        id: "session-1",
        userId: "user-1",
        walletAddress: "wallet",
        expiresAt: new Date("2026-05-01T00:00:00.000Z"),
        revokedAt: null,
      },
      user: {
        id: "user-1",
        primaryWalletAddress: "wallet",
      },
    });
  });

  it("prepares a first-sync transaction through the v1 route", async () => {
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
      new Request("http://localhost/api/v1/characters/first-sync/prepare", {
        method: "POST",
        body: JSON.stringify({
          characterId: "character-1",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(firstSyncRelayMock.prepareSolanaFirstSync).toHaveBeenCalledWith({
      characterId: "character-1",
      authority: "wallet",
      feePayer: undefined,
    });
    expect(json.ok).toBe(true);
    expect(json.data.phase).toBe("sign_transaction");
  });

  it("finalizes a v1 first-sync submission", async () => {
    firstSyncRelayMock.acknowledgeSolanaFirstSync.mockResolvedValue({
      phase: "submitted",
      characterId: "character-1",
      chainCreationStatus: "SUBMITTED",
      transactionSignature: "sig-1",
      firstSettlementBatchId: "batch-1",
      remainingSettlementBatchIds: [],
    });

    const response = await finalizePOST(
      new Request("http://localhost/api/v1/characters/first-sync/finalize", {
        method: "POST",
        body: JSON.stringify({
          prepared: {
            kind: "player_owned_instruction",
            authority: "wallet",
          },
          transactionSignature: "sig-1",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(firstSyncRelayMock.acknowledgeSolanaFirstSync).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.data.phase).toBe("submitted");
  });
});
