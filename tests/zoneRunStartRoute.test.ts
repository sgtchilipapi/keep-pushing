jest.mock("../lib/combat/zoneRunService", () => ({
  startZoneRun: jest.fn(),
}));
const authMock = {
  requireSessionCharacterAccess: jest.fn(),
};
jest.mock("../lib/auth/requireSession", () => {
  const actual = jest.requireActual("../lib/auth/requireSession");
  return {
    ...actual,
    requireSessionCharacterAccess: authMock.requireSessionCharacterAccess,
  };
});

import { POST } from "../app/api/zone-runs/start/route";
import { startZoneRun } from "../lib/combat/zoneRunService";

async function postStart(body: unknown, requestKey = "req-1"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/zone-runs/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/zone-runs/start", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.requireSessionCharacterAccess.mockResolvedValue({
      user: { id: "user-1", primaryWalletAddress: "wallet-1" },
    });
  });

  it("returns the started active zone run snapshot", async () => {
    (startZoneRun as jest.Mock).mockResolvedValue({
      activeRun: {
        runId: "run-1",
        characterId: "character-1",
        zoneId: 2,
        seasonId: 1,
        topologyVersion: 1,
        topologyHash: "hash",
        state: "TRAVERSING",
        currentNodeId: "z2-entry",
        currentSubnodeId: "z2-entry-s1",
        currentSubnodeOrdinal: 1,
        totalSubnodesTraversed: 0,
        totalSubnodesInRun: 8,
        branchOptions: [],
        enemyAppearanceCounts: {},
        playerCarryover: {
          hp: 1200,
          hpMax: 1200,
          cooldowns: {},
          statuses: {},
        },
        lastBattle: null,
      },
      closedRunSummary: null,
      battle: null,
    });

    const response = await postStart({ characterId: "character-1", zoneId: 2 });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(authMock.requireSessionCharacterAccess).toHaveBeenCalledWith(
      expect.any(Request),
      "character-1",
    );
    expect(startZoneRun).toHaveBeenCalledWith({
      characterId: "character-1",
      zoneId: 2,
      requestKey: "req-1",
    });
    expect(json.activeRun.runId).toBe("run-1");
  });

  it("rejects a missing idempotency key before hitting the service", async () => {
    const response = await POST(
      new Request("http://localhost/api/zone-runs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: "character-1", zoneId: 2 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(startZoneRun).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads before hitting the service", async () => {
    const response = await postStart({ characterId: "", zoneId: "2" });

    expect(response.status).toBe(400);
    expect(startZoneRun).not.toHaveBeenCalled();
  });

  it("returns 409 when the pending settlement queue is full", async () => {
    (startZoneRun as jest.Mock).mockRejectedValueOnce(
      new Error(
        "ERR_ZONE_RUN_SETTLEMENT_QUEUE_FULL: character character-1 already has 10 pending settlement runs",
      ),
    );

    const response = await postStart({ characterId: "character-1", zoneId: 2 });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toContain("ERR_ZONE_RUN_SETTLEMENT_QUEUE_FULL");
  });
});
