import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { scrapeJobs, students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { createTestDb } from "@/test/pgliteDb";
import { mapWithConcurrency } from "./concurrency";
import { loginToPortalWithBrowserless } from "./browserlessClient";
import { claimAndRunJob } from "./runJob";
import { scrapeAndSyncStudent } from "./scrapeAndSync";
import { runJobAfterResponse } from "./scheduleJob";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as updateRoute } from "@/app/api/report/update/route";
import { getCurrentUsn } from "@/lib/auth/session";

/**
 * Concurrency / load checks. Everything runs in-process against an in-memory Postgres with the portal
 * mocked: no real portal, no real Neon database. In-memory Postgres serialises statements on one
 * connection, so this proves the *logic* (atomic claims, coalescing, error handling under interleaving),
 * not connection-pool limits or network latency.
 */

let db: Db;
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/cookies", () => ({ setSessionCookie: vi.fn() }));
vi.mock("@/lib/auth/jwt", () => ({ signStudentToken: vi.fn(async () => "test-token") }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUsn: vi.fn() }));
vi.mock("./scheduleJob", () => ({ runJobAfterResponse: vi.fn() }));
vi.mock("./scrapeAndSync", () => ({ scrapeAndSyncStudent: vi.fn() }));
vi.mock("./browserlessClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserlessClient")>()),
  loginToPortalWithBrowserless: vi.fn(),
}));

const portal = vi.mocked(loginToPortalWithBrowserless);
const scrape = vi.mocked(scrapeAndSyncStudent);
const schedule = vi.mocked(runJobAfterResponse);
const sessionUsn = vi.mocked(getCurrentUsn);

const timings = { method: "browserless" as const, browserMs: 1, loginMs: 1, pinMs: 2, fetchMs: { p50: 1, max: 2, total: 3 }, requestCount: 4, bytesDownloaded: 5, parseMs: 6, dbMs: 7 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usnFor = (i: number) => `1MS23IS${String(i).padStart(3, "0")}`;

beforeAll(async () => {
  db = (await createTestDb()).db;
});

beforeEach(async () => {
  await db.delete(scrapeJobs);
  await db.delete(students);
  portal.mockReset();
  scrape.mockReset();
  schedule.mockReset();
  sessionUsn.mockReset();
});

describe("mapWithConcurrency", () => {
  it("never runs more than `limit` at once and keeps result order", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 200 }, (_, i) => i);

    const out = await mapWithConcurrency(items, 6, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(Math.random() * 5);
      inFlight--;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
    expect(out).toEqual(items.map((n) => n * 2));
  });
});

describe("enqueueScrapeJob under concurrency", () => {
  it("50 simultaneous enqueues for one student collapse onto a single job", async () => {
    await db.insert(students).values({ usn: usnFor(1), dob: "19-11-2004" });

    const ids = await Promise.all(
      Array.from({ length: 50 }, () =>
        enqueueScrapeJob(db, { usn: usnFor(1), dob: "19-11-2004", authType: "ABC ID", plainPin: "1234", plainBrowserlessToken: "bl-token", trigger: "login" }),
      ),
    );

    expect(new Set(ids).size).toBe(1);
    expect(await db.select().from(scrapeJobs)).toHaveLength(1);
  });

  it("200 different students enqueue independently with no cross-talk", async () => {
    await db.insert(students).values(Array.from({ length: 200 }, (_, i) => ({ usn: usnFor(i), dob: "19-11-2004" })));

    const ids = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        enqueueScrapeJob(db, { usn: usnFor(i), dob: "19-11-2004", authType: "ABC ID", plainPin: "1234", plainBrowserlessToken: "bl-token", trigger: "login" }),
      ),
    );

    expect(new Set(ids).size).toBe(200);
    expect(await db.select().from(scrapeJobs)).toHaveLength(200);
  });
});

describe("claimAndRunJob under concurrency", () => {
  it("25 invocations racing for one job scrape exactly once", async () => {
    await db.insert(students).values({ usn: usnFor(1), dob: "19-11-2004" });
    scrape.mockImplementation(async () => {
      await sleep(20);
      return { subjectsCount: 6, examHistoryCount: 0, timings };
    });
    const id = await enqueueScrapeJob(db, { usn: usnFor(1), dob: "19-11-2004", authType: "ABC ID", plainPin: "1234", plainBrowserlessToken: "bl-token", trigger: "login" });

    await Promise.all(Array.from({ length: 25 }, () => claimAndRunJob(db, id)));

    expect(scrape).toHaveBeenCalledTimes(1);
    expect((await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)))[0].status).toBe("success");
  });

  it("150 students syncing at once all reach a terminal state; failures stay isolated", async () => {
    const N = 150;
    await db.insert(students).values(Array.from({ length: N }, (_, i) => ({ usn: usnFor(i), dob: "19-11-2004" })));
    scrape.mockImplementation(async (_db, usn) => {
      await sleep(Math.random() * 30);
      if (Number(usn.slice(-3)) % 10 === 0) throw new Error("portal 503");
      return { subjectsCount: 6, examHistoryCount: 0, timings };
    });

    const ids = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        enqueueScrapeJob(db, { usn: usnFor(i), dob: "19-11-2004", authType: "ABC ID", plainPin: "1234", plainBrowserlessToken: "bl-token", trigger: "login" }),
      ),
    );
    await Promise.all(ids.map((id) => claimAndRunJob(db, id)));

    const rows = await db.select().from(scrapeJobs);
    expect(rows.filter((r) => r.status === "success")).toHaveLength(N - N / 10);
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(N / 10);
    expect(rows.filter((r) => r.status === "pending" || r.status === "running")).toHaveLength(0);
  });
});

describe("POST /api/report/update under concurrency", () => {
  it("a double-click (10 parallel requests) starts one job and one scrape", async () => {
    await db.insert(students).values({
      usn: usnFor(1),
      dob: "19-11-2004",
      authType: "Mother's Mobile",
      encryptedPin: encryptText("1234"),
      encryptedBrowserlessToken: encryptText("bl-token"),
    });
    sessionUsn.mockResolvedValue(usnFor(1));

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        updateRoute(
          new NextRequest("http://localhost:3000/api/report/update", {
            method: "POST",
            body: JSON.stringify({ usn: usnFor(1), scope: "current" }),
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(bodies.map((b) => b.data.jobId)).size).toBe(1);
    expect(await db.select().from(scrapeJobs)).toHaveLength(1);
  });

  it("an exam-results refresh requested while a 'current' job is waiting widens that job", async () => {
    await db.insert(students).values({
      usn: usnFor(1),
      dob: "19-11-2004",
      authType: "Mother's Mobile",
      encryptedPin: encryptText("1234"),
      encryptedBrowserlessToken: encryptText("bl-token"),
    });
    sessionUsn.mockResolvedValue(usnFor(1));
    const post = (scope: string) =>
      updateRoute(
        new NextRequest("http://localhost:3000/api/report/update", {
          method: "POST",
          body: JSON.stringify({ usn: usnFor(1), scope }),
          headers: { "content-type": "application/json" },
        }),
      );

    const first = await (await post("current")).json();
    const second = await (await post("exam_history")).json();

    expect(second.data.jobId).toBe(first.data.jobId);
    const [job] = await db.select().from(scrapeJobs);
    expect(job.scope).toBe("full");
  });

  it("an exam-results refresh requested while a 'current' job is already running gets a 409, not a job that skips it", async () => {
    await db.insert(students).values({
      usn: usnFor(1),
      dob: "19-11-2004",
      authType: "Mother's Mobile",
      encryptedPin: encryptText("1234"),
      encryptedBrowserlessToken: encryptText("bl-token"),
    });
    sessionUsn.mockResolvedValue(usnFor(1));
    const post = (scope: string) =>
      updateRoute(
        new NextRequest("http://localhost:3000/api/report/update", {
          method: "POST",
          body: JSON.stringify({ usn: usnFor(1), scope }),
          headers: { "content-type": "application/json" },
        }),
      );

    const first = await (await post("current")).json();
    await db.update(scrapeJobs).set({ status: "running" }).where(eq(scrapeJobs.id, first.data.jobId));
    const res = await post("exam_history");

    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/already running/);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/login under concurrency", () => {
  const firstTime = { usn: usnFor(7), dob: "19-11-2004", authType: "Mother's Mobile", last4Digits: "1234", browserlessToken: "bl-token" };
  const login = () =>
    loginRoute(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify(firstTime),
        headers: { "content-type": "application/json" },
      }),
    );

  it("the same new student logging in from 5 tabs/devices at once never gets an error", async () => {
    portal.mockImplementation(async () => {
      await sleep(5);
      return { dashboardHtml: "", cookieString: "", requestCount: 3, loginMs: 1, pinMs: 1, browserMs: 1 };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responses = await Promise.all(Array.from({ length: 5 }, login));

    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(await db.select().from(students)).toHaveLength(1);
    expect(await db.select().from(scrapeJobs)).toHaveLength(1);
  });

  it("100 different new students logging in at once all succeed", async () => {
    portal.mockImplementation(async () => {
      await sleep(Math.random() * 10);
      return { dashboardHtml: "", cookieString: "", requestCount: 3, loginMs: 1, pinMs: 1, browserMs: 1 };
    });
    const loginAs = (i: number) =>
      loginRoute(
        new NextRequest("http://localhost:3000/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ ...firstTime, usn: usnFor(i) }),
          headers: { "content-type": "application/json" },
        }),
      );

    const responses = await Promise.all(Array.from({ length: 100 }, (_, i) => loginAs(i)));

    expect(responses.filter((r) => r.status !== 200)).toHaveLength(0);
    expect(await db.select().from(students)).toHaveLength(100);
    expect(await db.select().from(scrapeJobs)).toHaveLength(100);
  });
});
