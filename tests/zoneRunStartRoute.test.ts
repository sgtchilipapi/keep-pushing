jest.mock("../lib/combat/zoneRunService", () => ({
  startZoneRun: jest.fn(),
}));

import { POST } from "../app/api/zone-runs/start/route";
import { startZoneRun } from "../lib/combat/zoneRunService";

async function postStart(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/zone-runs/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/zone-runs/start", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(startZoneRun).toHaveBeenCalledWith({
      characterId: "character-1",
      zoneId: 2,
    });
    expect(json.activeRun.runId).toBe("run-1");
  });

  it("rejects malformed payloads before hitting the service", async () => {
    const response = await postStart({ characterId: "", zoneId: "2" });

    expect(response.status).toBe(400);
    expect(startZoneRun).not.toHaveBeenCalled();
  });
});
