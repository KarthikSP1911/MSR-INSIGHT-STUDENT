import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { currentYearFromUsn } from "@/lib/academicYear";
import type { Db } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { createTestDb } from "@/test/pgliteDb";
import { GET } from "./route";

let db: Db;
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));

const SECRET = "test-cron-secret-value";
const call = (authorization?: string) =>
  GET(new Request("http://localhost:3000/api/cron/refresh-student-years", { headers: authorization ? { authorization } : {} }));

const seed = (usn: string, year: number) => db.insert(students).values({ usn, dob: "19-11-2004", name: `Student ${usn}`, currentYear: year, encryptedPin: "aa:bb:cc" });
const exceptYear = (rows: Record<string, unknown>[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "currentYear")));
const years = async () => Object.fromEntries((await db.select().from(students)).map((s) => [s.usn, s.currentYear]));

beforeAll(async () => {
  db = (await createTestDb()).db;
});

beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await db.delete(students);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/refresh-student-years: who may run it", () => {
  it("refuses to run at all when no secret is configured, so it can never be open to the public", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await seed("1MS23IS051", 0);

    const res = await call(`Bearer ${SECRET}`);

    expect(res.status).toBe(503);
    expect((await years())["1MS23IS051"]).toBe(0);
  });

  it.each([
    ["no Authorization header", undefined],
    ["the wrong secret", "Bearer not-the-secret-at-all!"],
    ["a wrong secret of the same length", `Bearer ${"x".repeat(SECRET.length)}`],
    ["the secret without 'Bearer '", SECRET],
    ["an empty bearer token", "Bearer "],
  ])("answers 401 and changes nothing with %s", async (_label, header) => {
    await seed("1MS23IS051", 0);

    const res = await call(header);

    expect(res.status).toBe(401);
    expect((await years())["1MS23IS051"]).toBe(0);
  });
});

describe("GET /api/cron/refresh-student-years: the update", () => {
  it("moves each student to the year their USN implies today, seniors to 5", async () => {
    await seed("1MS23IS051", 0);
    await seed("1MS26IS101", 0);
    await seed("1MS21IS007", 4);
    await seed("ODD-USN", 2);

    const res = await call(`Bearer ${SECRET}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    const result = await years();
    for (const usn of ["1MS23IS051", "1MS26IS101", "1MS21IS007"]) expect([usn, result[usn]]).toEqual([usn, currentYearFromUsn(usn)]);
    expect(result["ODD-USN"]).toBe(2);
    expect(body).toEqual({ success: true, changed: 3 });
  });

  it("changes only the year: every other column of every student is identical", async () => {
    await seed("1MS23IS051", 0);
    await seed("1MS22ME001", 3);
    const before = exceptYear(await db.select().from(students));

    await call(`Bearer ${SECRET}`);

    expect(exceptYear(await db.select().from(students))).toEqual(before);
  });

  it("is safe to repeat: the second run changes nothing", async () => {
    await seed("1MS23IS051", 0);

    await call(`Bearer ${SECRET}`);
    const second = await (await call(`Bearer ${SECRET}`)).json();

    expect(second).toEqual({ success: true, changed: 0 });
  });

  it("returns no student data, only whether it worked and how many changed", async () => {
    await seed("1MS23IS051", 0);

    const body = await (await call(`Bearer ${SECRET}`)).json();

    expect(Object.keys(body).sort()).toEqual(["changed", "success"]);
  });

  it("is not cached", async () => {
    const res = await call(`Bearer ${SECRET}`);

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/cron/refresh-student-years: when the database fails", () => {
  it("answers a plain 500 without leaking details, so the next day's run can retry", async () => {
    const failing = { execute: () => Promise.reject(new Error("connection string postgres://user:secret@host")) } as unknown as Db;
    const real = db;
    db = failing;

    const res = await call(`Bearer ${SECRET}`);
    db = real;

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/postgres|secret/i);
  });
});
