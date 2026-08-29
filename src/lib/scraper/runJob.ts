import { and, eq, inArray } from "drizzle-orm";

import { decryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { scrapeJobs, students } from "@/lib/db/schema";
import { BrowserlessTokenInvalidError } from "./puppeteerClient";
import { scrapeAndSyncStudent } from "./scrapeAndSync";

/**
 * Claims a specific pending scrape job and runs it in-process. Called from
 * `POST /api/scrape-jobs/run` which has `maxDuration = 60`.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so concurrent invocations (e.g. two login
 * requests that both enqueued and then both called this route) safely skip
 * an already-claimed job rather than double-processing it.
 *
 * Distinguishes a Browserless auth failure (`BrowserlessTokenInvalidError`)
 * from a portal-login failure (wrong USN/DOB/PIN) so the login UI knows
 * whether to prompt for a new Browserless token specifically.
 */
export async function claimAndRunJob(db: Db, jobId: string): Promise<void> {
  // Claim the job atomically — skip if already running/done.
  const [job] = await db
    .update(scrapeJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(scrapeJobs.id, jobId), eq(scrapeJobs.status, "pending")))
    .returning();

  if (!job) {
    // Already claimed by a concurrent invocation — nothing to do.
    return;
  }

  console.log(`[runJob] processing job ${job.id} (${job.trigger}) for ${job.usn}`);

  try {
    if (!job.authType || !job.encryptedPin) {
      throw new Error("Job is missing authType/PIN — cannot scrape.");
    }
    if (!job.encryptedBrowserlessToken) {
      throw new Error("Job is missing Browserless token — cannot scrape.");
    }

    const plainPin = decryptText(job.encryptedPin);
    if (!plainPin) throw new Error("Failed to decrypt PIN for scrape job.");

    const plainBrowserlessToken = decryptText(job.encryptedBrowserlessToken);
    if (!plainBrowserlessToken) throw new Error("Failed to decrypt Browserless token for scrape job.");

    const onProgress = async (msg: string) => {
      await db.update(scrapeJobs).set({ progress: msg }).where(eq(scrapeJobs.id, job.id));
    };

    const result = await scrapeAndSyncStudent(
      db,
      job.usn,
      job.dob,
      job.authType,
      plainPin,
      plainBrowserlessToken,
      job.scope,
      onProgress,
    );

    await db
      .update(scrapeJobs)
      .set({
        status: "success",
        finishedAt: new Date(),
        resultSummary: {
          subjectsCount: result.subjectsCount,
          examHistoryCount: result.examHistoryCount,
          ...result.timings,
        },
      })
      .where(eq(scrapeJobs.id, job.id));

    console.log(`[runJob] job ${job.id} succeeded`);
  } catch (error) {
    const isBrowserlessError = error instanceof BrowserlessTokenInvalidError;
    const message = error instanceof Error ? error.message : "Unknown scrape error";

    console.error(`[runJob] job ${job.id} failed${isBrowserlessError ? " (Browserless token invalid)" : ""}:`, message);

    // Flip the token-valid flag so the next login re-prompts for a fresh token.
    if (isBrowserlessError) {
      await db
        .update(students)
        .set({ browserlessTokenValid: false })
        .where(eq(students.usn, job.usn))
        .catch((e) => console.error("[runJob] failed to flip browserlessTokenValid:", e));
    }

    await db
      .update(scrapeJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: isBrowserlessError ? "browserless_token_invalid" : message,
      })
      .where(eq(scrapeJobs.id, job.id));
  }
}
