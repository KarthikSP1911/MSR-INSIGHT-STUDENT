import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { scrapeJobs, students } from "@/lib/db/schema";
import { enqueueScrapeJob, hasRecentFailedJob, STALE_JOB_MS } from "@/lib/scrapeJobs";
import { createTestDb } from "@/test/pgliteDb";
import { PortalAuthError, PortalUnavailableError } from "./portalHttpClient";
import { claimAndRunJob } from "./runJob";
import { scrapeAndSyncStudent } from "./scrapeAndSync";

vi.mock("./scrapeAndSync", () => ({ scrapeAndSyncStudent: vi.fn() }));
const scrape = vi.mocked(scrapeAndSyncStudent);

const timings = { method: "http" as const, loginMs: 1, pinMs: 2, fetchMs: { p50: 1, max: 2, total: 3 }, requestCount: 4, bytesDownloaded: 5, parseMs: 6, dbMs: 7 };

// One in-memory database for the file (building it runs every migration); rows are reset per test.
let sharedDb: Db;
beforeAll(async () => {
  sharedDb = (await createTestDb()).db;
});

async function setup() {
  await sharedDb.delete(scrapeJobs);
  await sharedDb.delete(students);
  await sharedDb.insert(students).values({ usn: "1MS23IS051", dob: "19-11-2004" });
  return sharedDb;
}

const enqueue = (db: Db, scope: "current" | "exam_history" | "full" = "full") =>
  enqueueScrapeJob(db, { usn: "1MS23IS051", dob: "19-11-2004", authType: "Mother's Mobile", plainPin: "1234", trigger: "login", scope });

const jobRow = async (db: Db, id: string) => (await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)))[0];

describe("enqueueScrapeJob", () => {
  it("stores the PIN encrypted, never in plain text", async () => {
    const db = await setup();
    const row = await jobRow(db, await enqueue(db, "current"));

    expect(row.status).toBe("pending");
    expect(row.scope).toBe("current");
    expect(row.encryptedPin).not.toContain("1234");
    expect(decryptText(row.encryptedPin)).toBe("1234");
  });

  it("coalesces onto the job already in flight for the same student", async () => {
    const db = await setup();
    const first = await enqueue(db, "current");
    const second = await enqueue(db, "exam_history");

    expect(second).toBe(first);
    expect(await db.select().from(scrapeJobs)).toHaveLength(1);
  });

  it("fails a job stuck past the stale limit so it can no longer block new syncs", async () => {
    const db = await setup();
    const stuck = await enqueue(db);
    await db
      .update(scrapeJobs)
      .set({ status: "running", createdAt: new Date(Date.now() - STALE_JOB_MS - 1000) })
      .where(eq(scrapeJobs.id, stuck));

    const next = await enqueue(db);

    expect(next).not.toBe(stuck);
    expect(await jobRow(db, stuck)).toMatchObject({ status: "failed", error: expect.stringContaining("interrupted") });
    expect((await jobRow(db, next)).status).toBe("pending");
  });

  it("leaves a recent running job alone", async () => {
    const db = await setup();
    const running = await enqueue(db);
    await db.update(scrapeJobs).set({ status: "running" }).where(eq(scrapeJobs.id, running));

    expect(await enqueue(db)).toBe(running);
    expect((await jobRow(db, running)).status).toBe("running");
  });
});

describe("hasRecentFailedJob", () => {
  it("is true only for a failure inside the window", async () => {
    const db = await setup();
    expect(await hasRecentFailedJob(db, "1MS23IS051", 60_000)).toBe(false);

    const id = await enqueue(db);
    await db.update(scrapeJobs).set({ status: "failed", finishedAt: new Date() }).where(eq(scrapeJobs.id, id));
    expect(await hasRecentFailedJob(db, "1MS23IS051", 60_000)).toBe(true);

    await db.update(scrapeJobs).set({ finishedAt: new Date(Date.now() - 120_000) }).where(eq(scrapeJobs.id, id));
    expect(await hasRecentFailedJob(db, "1MS23IS051", 60_000)).toBe(false);
  });
});

describe("claimAndRunJob", () => {
  beforeEach(() => {
    scrape.mockReset();
  });

  it("runs the job with the decrypted PIN and its scope, then records a summary", async () => {
    const db = await setup();
    scrape.mockResolvedValue({ subjectsCount: 6, examHistoryCount: 2, timings });
    const id = await enqueue(db, "exam_history");

    await claimAndRunJob(db, id);

    expect(scrape).toHaveBeenCalledWith(db, "1MS23IS051", "19-11-2004", "Mother's Mobile", "1234", "exam_history", expect.any(Function));
    const row = await jobRow(db, id);
    expect(row.status).toBe("success");
    expect(row.finishedAt).not.toBeNull();
    expect(row.resultSummary).toMatchObject({ subjectsCount: 6, examHistoryCount: 2, method: "http" });
  });

  it("records the error message when the portal rejects the credentials", async () => {
    const db = await setup();
    scrape.mockRejectedValue(new PortalAuthError());
    const id = await enqueue(db);

    await claimAndRunJob(db, id);

    expect(await jobRow(db, id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Invalid portal credentials"),
      resultSummary: { failureKind: "credentials_rejected" },
    });
  });

  it("marks a portal outage so the dashboard can show its saved data instead of an error", async () => {
    const db = await setup();
    scrape.mockRejectedValue(new PortalUnavailableError("The portal responded with HTTP 503"));
    const id = await enqueue(db);

    await claimAndRunJob(db, id);

    expect(await jobRow(db, id)).toMatchObject({ status: "failed", resultSummary: { failureKind: "portal_unavailable" } });
  });

  it("marks any other failure as 'other'", async () => {
    const db = await setup();
    scrape.mockRejectedValue(new Error("boom"));
    const id = await enqueue(db);

    await claimAndRunJob(db, id);

    expect(await jobRow(db, id)).toMatchObject({ status: "failed", resultSummary: { failureKind: "other" } });
  });

  it("does nothing for a job another invocation already claimed", async () => {
    const db = await setup();
    scrape.mockResolvedValue({ subjectsCount: 1, examHistoryCount: 0, timings });
    const id = await enqueue(db);

    await claimAndRunJob(db, id);
    await claimAndRunJob(db, id);

    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it("fails jobs that are missing a PIN instead of scraping", async () => {
    const db = await setup();
    const id = await enqueueScrapeJob(db, { usn: "1MS23IS051", dob: "19-11-2004", authType: "ABC ID", trigger: "login" });

    await claimAndRunJob(db, id);

    expect(scrape).not.toHaveBeenCalled();
    expect((await jobRow(db, id)).status).toBe("failed");
  });
});
