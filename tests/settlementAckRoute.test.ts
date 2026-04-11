const settlementRelayMock = {
  acknowledgeSolanaSettlement: jest.fn(),
};

jest.mock("../lib/solana/settlementRelay", () => ({
  acknowledgeSolanaSettlement: settlementRelayMock.acknowledgeSolanaSettlement,
}));

import { POST } from "../app/api/solana/settlement/ack/route";

describe("POST /api/solana/settlement/ack", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
          prepared: { kind: "battle_settlement" },
          transactionSignature: "sig-1",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.phase).toBe("confirmed");
    expect(json.transactionSignature).toBe("sig-1");
  });
});
