import { and, eq } from "drizzle-orm";

import { decryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { scrapeJobs } from "@/lib/db/schema";
import { classifyScrapeFailure } from "./failureKind";
import { PortalUnavailableError } from "./portalHttpClient";
import { scrapeAndSyncStudent } from "./scrapeAndSync";

/**
 * Hard stop for one scrape. Vercel kills the function at `maxDuration` (60s) with no chance to
 * update the job row, so this fires first and lets the job fail cleanly with a message instead.
 */
export const JOB_DEADLINE_MS = 45_000;

export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PortalUnavailableError("Syncing took too long. The portal may be slow right now — please try again in a few minutes.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Claims a specific pending scrape job and runs it in-process. Scheduled with `after()` by the
 * route that enqueued it, so it runs inside that route's `maxDuration` budget.
 *
 * The claim is a conditional UPDATE (`status = 'pending'`), so concurrent invocations for the
 * same job safely skip an already-claimed job rather than double-processing it.
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

    const plainPin = decryptText(job.encryptedPin);
    if (!plainPin) throw new Error("Failed to decrypt PIN for scrape job.");

    const onProgress = async (msg: string) => {
      await db.update(scrapeJobs).set({ progress: msg }).where(eq(scrapeJobs.id, job.id));
    };

    const result = await withDeadline(
      scrapeAndSyncStudent(db, job.usn, job.dob, job.authType, plainPin, job.scope, onProgress),
      JOB_DEADLINE_MS,
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
    const message = error instanceof Error ? error.message : "Unknown scrape error";
    console.error(`[runJob] job ${job.id} failed:`, message);

    await db
      .update(scrapeJobs)
      .set({ status: "failed", finishedAt: new Date(), error: message, resultSummary: { failureKind: classifyScrapeFailure(error) } })
      .where(eq(scrapeJobs.id, job.id));
  }
}
