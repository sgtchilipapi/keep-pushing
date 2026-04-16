import { GET as getClasses } from "../app/api/classes/route";
import { GET as getCurrentSeason } from "../app/api/seasons/current/route";

describe("catalog routes", () => {
  it("returns enabled classes", async () => {
    const response = await getClasses();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(json.classes)).toBe(true);
    expect(json.classes.length).toBeGreaterThan(0);
  });

  it("returns the current season summary", async () => {
    const response = await getCurrentSeason();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.seasonId).toBeDefined();
    expect(json.phase).toBeDefined();
  });
});
