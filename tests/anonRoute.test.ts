import { POST } from "../app/api/auth/anon/route";

describe("POST /api/auth/anon", () => {
  it("returns a breaking-change removal response", async () => {
    const response = await POST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.error).toMatch(/ERR_ANON_REMOVED/);
  });
});
