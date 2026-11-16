import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/demo/profile", () => {
  it("returns a full synthetic student without any secrets", async () => {
    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Demo Student");
    expect(body.data.details.subjects.length).toBeGreaterThan(0);
    expect(body.data.examHistory.length).toBeGreaterThan(0);
    expect(body.data).not.toHaveProperty("encryptedPin");
    expect(body.data).not.toHaveProperty("encryptedBrowserlessToken");
  });
});
