import { after } from "next/server";

import type { Db } from "@/lib/db/client";
import { claimAndRunJob } from "./runJob";

/**
 * Runs a queued scrape after the response has been sent. On Vercel, `after()` extends the
 * invocation (via `waitUntil`) up to the route's `maxDuration`, so every route that calls this must
 * export `maxDuration = 60`. A plain un-awaited promise would be frozen once the response returns.
 */
export function runJobAfterResponse(db: Db, jobId: string): void {
  after(() =>
    claimAndRunJob(db, jobId).catch((err) => {
      console.error(`[scheduleJob] job ${jobId} crashed before it could record a result:`, err);
    }),
  );
}
