import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { claimAndRunJob } from "@/lib/scraper/runJob";

/**
 * Vercel Hobby tier maximum — the scrape (Browserless connect + portal login +
 * HTTP fan-out + DB write) comfortably fits in 60s for both `recurring` and
 * `full` scopes on the happy path (~15-35s typical). A timeout here marks the
 * job failed; the student can retry via "Sync now" once the cooldown expires.
 */
export const maxDuration = 60;

const bodySchema = z.object({
  jobId: z.string().uuid("jobId must be a valid UUID"),
});

/**
 * Internal route — called fire-and-forget from /api/auth/login and
 * /api/report/update after enqueuing a scrape job. Not intended to be called
 * directly from the browser (no auth guard, but also returns no sensitive data).
 *
 * Claims the job with FOR UPDATE SKIP LOCKED (safe against concurrent triggers
 * for the same jobId), runs scrapeAndSyncStudent in-process, and marks the job
 * success or failed. The frontend's useScrapeJobPolling is already polling
 * GET /api/scrape-jobs/[id] and will pick up the terminal status naturally.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { jobId } = parsed.data;

  try {
    const db = getDb();
    await claimAndRunJob(db, jobId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[api/scrape-jobs/run] unhandled error for job ${jobId}:`, err);
    // Even on an unexpected crash here, the job row will be stuck in "running"
    // until the client's MAX_POLL_MS backstop (6 min) surfaces a timeout to the
    // student — acceptable for a fire-and-forget internal route.
    return NextResponse.json({ success: false, message: "Internal scrape error" }, { status: 500 });
  }
}
