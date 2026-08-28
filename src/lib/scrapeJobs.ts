import { and, eq, inArray, sql } from "drizzle-orm";

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
  /** `attendance` (cheaper — skips CIE/exam fetches, merging them back in from the prior scrape) or `full`. Defaults to `full`. */
  scope?: ScrapeJobScope;
}

/** Postgres SQLSTATE for a unique-constraint violation — surfaced as `.code` by both the `pg` and `@neondatabase/serverless` drivers. */
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * Queues a scrape job for the standalone worker (worker/scraper-worker.ts) to
 * pick up. The PIN is encrypted at rest immediately, even in this transient
 * queue table — it's never stored or logged in plain text.
 *
 * Coalesced against `scrape_jobs_active_usn_idx` (a partial unique index on
 * `usn` where status is pending/running): if a job for this USN is already
 * in flight, that job's id is returned instead of queuing a duplicate scrape.
 */
export async function enqueueScrapeJob(db: Db, input: EnqueueScrapeJobInput): Promise<string> {
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

    // Best-effort wake-up for the worker's LISTEN/NOTIFY (worker/scraper-worker.ts) — NOTIFY
    // doesn't require a persistent connection to send, only to receive, so this works fine
    // over the stateless neon-http client too. The worker's 3s poll is the fallback if this
    // is ever missed (e.g. no listener currently connected).
    await db.execute(sql`NOTIFY scrape_jobs`).catch(() => {});

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
