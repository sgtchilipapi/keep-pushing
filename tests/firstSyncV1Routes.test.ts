import { POST as preparePOST } from "../app/api/v1/characters/first-sync/prepare/route";
import { POST as finalizePOST } from "../app/api/v1/characters/first-sync/finalize/route";

describe("v1 first sync routes", () => {
  it("returns a breaking-change error for v1 first-sync prepare", async () => {
    const response = await preparePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("ERR_V1_FIRST_SYNC_ROUTE_REMOVED");
  });

  it("returns a breaking-change error for v1 first-sync finalize", async () => {
    const response = await finalizePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("ERR_V1_FIRST_SYNC_ROUTE_REMOVED");
  });
});
