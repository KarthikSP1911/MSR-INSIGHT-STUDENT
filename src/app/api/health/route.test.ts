import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Db } from "@/lib/db/client";
import { createTestDb } from "@/test/pgliteDb";
import { GET } from "./route";

let db: Db;
let failing = false;
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    if (failing) throw new Error("DATABASE_URL is not set");
    return db;
  },
}));

beforeAll(async () => {
  db = (await createTestDb()).db;
});

describe("GET /api/health", () => {
  it("answers 200 and uncacheable when the database is reachable", async () => {
    failing = false;
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers 503 without leaking error details when the database cannot be used", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failing = true;
    const res = await GET();
    const body = JSON.stringify(await res.json());

    expect(res.status).toBe(503);
    expect(body).toContain("unavailable");
    expect(body).not.toContain("DATABASE_URL");
  });
});
