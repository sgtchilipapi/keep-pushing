import { POST as preparePOST } from "../app/api/solana/character/first-sync/prepare/route";
import { POST as finalizePOST } from "../app/api/solana/character/first-sync/ack/route";

describe("legacy first sync routes", () => {
  it("returns a breaking-change error for legacy first-sync prepare", async () => {
    const response = await preparePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("ERR_LEGACY_FIRST_SYNC_ROUTE_REMOVED");
  });

  it("returns a breaking-change error for legacy first-sync finalize", async () => {
    const response = await finalizePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("ERR_LEGACY_FIRST_SYNC_ROUTE_REMOVED");
  });
});
