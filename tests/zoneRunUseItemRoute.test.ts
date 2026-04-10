jest.mock("../lib/combat/zoneRunService", () => ({
  useZoneRunConsumableItem: jest.fn(),
}));

import { POST } from "../app/api/zone-runs/use-item/route";
import { useZoneRunConsumableItem } from "../lib/combat/zoneRunService";

async function postUseItem(body: unknown, requestKey = "req-1"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/zone-runs/use-item", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/zone-runs/use-item", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps unsupported item use to a conflict response", async () => {
    (useZoneRunConsumableItem as jest.Mock).mockRejectedValue(
      new Error("ERR_ZONE_RUN_ITEMS_UNSUPPORTED: consumable item potion is not supported during zone runs"),
    );

    const response = await postUseItem({
      characterId: "character-1",
      itemId: "potion",
    });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(useZoneRunConsumableItem).toHaveBeenCalledWith({
      characterId: "character-1",
      itemId: "potion",
    });
    expect(json.error).toContain("ERR_ZONE_RUN_ITEMS_UNSUPPORTED");
  });

  it("rejects a missing idempotency key before hitting the service", async () => {
    const response = await POST(
      new Request("http://localhost/api/zone-runs/use-item", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: "character-1", itemId: "potion" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(useZoneRunConsumableItem).not.toHaveBeenCalled();
  });
});
