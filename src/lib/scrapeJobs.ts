import { and, eq, inArray } from "drizzle-orm";

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
  /** `recurring` (cheaper — skips the exam-history fetch, merging it back in from the prior scrape) or `full`. Defaults to `full`. */
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

/**
 * Queues a scrape job to be run by `claimAndRunJob`. The PIN is encrypted at rest immediately,
 * even in this transient queue table — never stored or logged in plain text.
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
