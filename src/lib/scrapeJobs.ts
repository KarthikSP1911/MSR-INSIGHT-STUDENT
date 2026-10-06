import { and, eq, gt, inArray, lt } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { scrapeJobs, type ScrapeJobScope, type ScrapeJobTrigger } from "@/lib/db/schema";
import { encryptText } from "@/lib/auth/crypto";

export interface EnqueueScrapeJobInput {
  usn: string;
  dob: string;
  authType?: string | null;
  /** Plain-text PIN — encrypted before it ever touches the row. */
  plainPin?: string | null;
  trigger: ScrapeJobTrigger;
  /** What to fetch: `current`, `exam_history` or `full`. Defaults to `full`. */
  scope?: ScrapeJobScope;
}

/** Postgres SQLSTATE for a unique-constraint violation — surfaced as `.code` by the `@neondatabase/serverless` driver. */
const UNIQUE_VIOLATION = "23505";

interface ErrorWithCode {
  code?: unknown;
  message?: unknown;
  cause?: { code?: unknown; message?: unknown };
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as ErrorWithCode;
  if (e.code === UNIQUE_VIOLATION || e.cause?.code === UNIQUE_VIOLATION) return true;
  const msg = String(e.message ?? e.cause?.message ?? "");
  return msg.includes("duplicate key value violates unique constraint");
}

/** A job still pending/running after this long was killed (e.g. by the platform time limit) and will never finish. */
export const STALE_JOB_MS = 2 * 60 * 1000;

/**
 * Fails jobs that can no longer finish. Without this a killed job stays `running` forever, and the
 * one-active-job-per-USN index would then block every later sync for that student.
 */
async function failStaleJobs(db: Db, usn: string): Promise<void> {
  await db
    .update(scrapeJobs)
    .set({ status: "failed", finishedAt: new Date(), error: "The previous sync was interrupted. Please try again." })
    .where(
      and(
        eq(scrapeJobs.usn, usn),
        inArray(scrapeJobs.status, ["pending", "running"]),
        lt(scrapeJobs.createdAt, new Date(Date.now() - STALE_JOB_MS)),
      ),
    );
}

/** True if a sync for this student failed within the last `withinMs`. */
export async function hasRecentFailedJob(db: Db, usn: string, withinMs: number): Promise<boolean> {
  const [recent] = await db
    .select({ id: scrapeJobs.id })
    .from(scrapeJobs)
    .where(
      and(eq(scrapeJobs.usn, usn), eq(scrapeJobs.status, "failed"), gt(scrapeJobs.finishedAt, new Date(Date.now() - withinMs))),
    )
    .limit(1);
  return Boolean(recent);
}

/**
 * Queues a scrape job to be run by `claimAndRunJob`. The PIN is encrypted at rest immediately,
 * even in this transient queue table — never stored or logged in plain text.
 *
 * Coalesced against `scrape_jobs_active_usn_idx` (a partial unique index on
 * `usn` where status is pending/running): if a job for this USN is already
 * in flight, that job's id is returned instead of queuing a duplicate scrape.
 */
export async function enqueueScrapeJob(db: Db, input: EnqueueScrapeJobInput): Promise<string> {
  await failStaleJobs(db, input.usn);

  try {
    const [job] = await db
      .insert(scrapeJobs)
      .values({
        usn: input.usn,
        dob: input.dob,
        authType: input.authType ?? null,
        encryptedPin: input.plainPin ? encryptText(input.plainPin) : null,
        trigger: input.trigger,
        scope: input.scope ?? "full",
        status: "pending",
      })
      .returning({ id: scrapeJobs.id });

    return job.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const [existing] = await db
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(and(eq(scrapeJobs.usn, input.usn), inArray(scrapeJobs.status, ["pending", "running"])));
    if (!existing) throw err;
    return existing.id;
  }
}
