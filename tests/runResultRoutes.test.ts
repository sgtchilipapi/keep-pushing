const serviceMock = {
  getRunResult: jest.fn(),
  createRunSharePayload: jest.fn(),
};

jest.mock("../lib/runResultService", () => ({
  getRunResult: serviceMock.getRunResult,
  createRunSharePayload: serviceMock.createRunSharePayload,
}));

import { GET } from "../app/api/runs/[runId]/route";
import { POST } from "../app/api/runs/[runId]/share/route";

describe("GET /api/runs/[runId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the run result read model", async () => {
    serviceMock.getRunResult.mockResolvedValue({
      runId: "run-1",
      characterId: "character-1",
      characterName: "Aegis",
      classId: "soldier",
      zoneId: 2,
      seasonId: 1,
      topologyVersion: 3,
      topologyHash: "hash-3",
      terminalStatus: "COMPLETED",
      shareStatus: "PENDING",
      shareStatusLabel: "Pending",
      shareStatusDetail: "Pending sync",
      battleCount: 2,
      rewardedBattleCount: 2,
      rewardedEncounterHistogram: { "101": 1, "102": 1 },
      zoneProgressDelta: [],
      closedAt: "2026-04-11T12:00:00.000Z",
      resultUrl: "/runs/run-1",
      shareUrl: "/share/runs/run-1",
      battles: [],
    });

    const response = await GET(
      new Request("http://localhost/api/runs/run-1"),
      { params: { runId: "run-1" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.run.runId).toBe("run-1");
  });
});

describe("POST /api/runs/[runId]/share", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a public share payload", async () => {
    serviceMock.createRunSharePayload.mockResolvedValue({
      runId: "run-1",
      shareUrl: "http://localhost:3000/share/runs/run-1",
      resultUrl: "http://localhost:3000/runs/run-1",
      shareText: "Aegis finished Zone 2 in RUNANA. http://localhost:3000/share/runs/run-1",
      shareStatus: "PENDING",
    });

    const response = await POST(
      new Request("http://localhost/api/runs/run-1/share", {
        method: "POST",
      }),
      { params: { runId: "run-1" } },
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.shareUrl).toContain("/share/runs/run-1");
  });
});
