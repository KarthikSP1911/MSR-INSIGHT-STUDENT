import type { Db } from "@/lib/db/client";
import { scrapeJobs, type ScrapeJobTrigger } from "@/lib/db/schema";
import { encryptText } from "@/lib/auth/crypto";

export interface EnqueueScrapeJobInput {
  usn: string;
  dob: string;
  authType?: string | null;
  /** Plain-text PIN — encrypted before it ever touches the row. */
  plainPin?: string | null;
  trigger: ScrapeJobTrigger;
}

/**
 * Queues a scrape job for the standalone worker (worker/scraper-worker.ts) to
 * pick up. The PIN is encrypted at rest immediately, even in this transient
 * queue table — it's never stored or logged in plain text.
 */
export async function enqueueScrapeJob(db: Db, input: EnqueueScrapeJobInput): Promise<string> {
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      usn: input.usn,
      dob: input.dob,
      authType: input.authType ?? null,
      encryptedPin: input.plainPin ? encryptText(input.plainPin) : null,
      trigger: input.trigger,
      status: "pending",
    })
    .returning({ id: scrapeJobs.id });

  return job.id;
}
