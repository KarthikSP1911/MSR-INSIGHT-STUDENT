import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Db } from "@/lib/db/client";
import { createTestDb } from "@/test/pgliteDb";
import { checkHealth } from "./health";

let db: Db;
beforeAll(async () => {
  db = (await createTestDb()).db;
});

const fakeDb = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Db;

describe("checkHealth", () => {
  it("is healthy when the database answers", async () => {
    expect(await checkHealth(db)).toEqual({ ok: true });
  });

  it("reports the database as unreachable when the query throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = fakeDb(async () => {
      throw new Error("connection refused");
    });

    expect(await checkHealth(down)).toEqual({ ok: false, reason: "database_unreachable" });
  });

  it("gives up on a database that never answers instead of hanging the monitor", async () => {
    const hanging = fakeDb(() => new Promise(() => {}));

    expect(await checkHealth(hanging, 20)).toEqual({ ok: false, reason: "database_timeout" });
  });
});
