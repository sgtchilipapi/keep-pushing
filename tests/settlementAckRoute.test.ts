const settlementRelayMock = {
  acknowledgeSolanaSettlement: jest.fn(),
};
const authMock = {
  requireSession: jest.fn(),
};

jest.mock("../lib/solana/settlementRelay", () => ({
  acknowledgeSolanaSettlement: settlementRelayMock.acknowledgeSolanaSettlement,
}));
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSession: authMock.requireSession,
  };
});

import { POST } from "../app/api/solana/settlement/ack/route";

describe("POST /api/solana/settlement/ack", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSession.mockResolvedValue({
      session: {
        id: "session-1",
        userId: "user-1",
        walletAddress: "wallet-1",
        expiresAt: new Date("2026-05-01T00:00:00.000Z"),
        revokedAt: null,
      },
      user: {
        id: "user-1",
        primaryWalletAddress: "wallet-1",
      },
    });
  });

  it("acknowledges a client-submitted settlement transaction", async () => {
    settlementRelayMock.acknowledgeSolanaSettlement.mockResolvedValue({
      phase: "confirmed",
      settlementBatchId: "batch-1",
      transactionSignature: "sig-1",
      cursor: {
        lastCommittedEndNonce: 2,
        lastCommittedBatchId: 1,
        lastCommittedStateHash: "11".repeat(32),
        lastCommittedBattleTs: 1700000001,
        lastCommittedSeasonId: 4,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/solana/settlement/ack", {
        method: "POST",
        body: JSON.stringify({
          settlementBatchId: "batch-1",
          prepared: {
            kind: "battle_settlement",
            authority: "wallet-1",
          },
          transactionSignature: "sig-1",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(settlementRelayMock.acknowledgeSolanaSettlement).toHaveBeenCalled();
    expect(json.phase).toBe("confirmed");
    expect(json.transactionSignature).toBe("sig-1");
  });
});
