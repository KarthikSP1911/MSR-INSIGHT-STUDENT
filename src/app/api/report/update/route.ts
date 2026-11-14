import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { decryptText } from "@/lib/auth/crypto";
import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { nextManualRefreshAt } from "@/lib/scrapePolicy";
import { enqueueScrapeJob, ScrapeInProgressError } from "@/lib/scrapeJobs";
import { runJobAfterResponse } from "@/lib/scraper/scheduleJob";
import { updateSchema } from "@/lib/validation/auth";

/** The scrape runs inside this route's budget via `after()`; 60s is the Vercel Hobby maximum. */
export const maxDuration = 60;

/**
 * Manual refresh buttons. Ported from report.service.js `handleManualReportUpdate()`: enforces a
 * 1-minute cooldown (a plain timestamp diff, not a rate limiter) and requires a stored PIN/authType
 * or asks the client to re-login (`requiresRelogin`). The synchronous scrape is replaced by
 * enqueue+poll.
 *
 * `scope: "current"` (default) refreshes attendance and CIE marks, cooling down against
 * `details.last_updated`. `scope: "exam_history"` refreshes exam results, cooling down against
 * `examHistoryUpdatedAt`.
 */
export async function POST(request: NextRequest) {
  const sessionUsn = await getCurrentUsn();
  if (!sessionUsn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const usn = parsed.data.usn.toUpperCase();
  const scope = parsed.data.scope ?? "current";
  if (usn !== sessionUsn) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [student] = await db.select().from(students).where(eq(students.usn, usn));
    if (!student) {
      return NextResponse.json({ success: false, message: "Student record not found" }, { status: 404 });
    }

    const lastRefreshed = scope === "exam_history" ? student.examHistoryUpdatedAt : student.details?.last_updated;
    const nextAllowedAt = nextManualRefreshAt(lastRefreshed);
    if (nextAllowedAt) {
      const secondsLeft = Math.ceil((nextAllowedAt.getTime() - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          requiresRelogin: false,
          message: `Rate limit exceeded. Please wait ${secondsLeft}s before updating again.`,
          nextAllowedAt: nextAllowedAt.toISOString(),
        },
        { status: 429 },
      );
    }

    if (!student.dob) {
      return NextResponse.json(
        { success: false, message: "Student Date of Birth is missing from records." },
        { status: 400 },
      );
    }

    const targetAuthType = student.authType;
    const targetPin = student.encryptedPin ? decryptText(student.encryptedPin) : "";

    if (!targetPin || !targetAuthType) {
      return NextResponse.json(
        {
          success: false,
          requiresRelogin: true,
          message:
            "Portal PIN verification required for old accounts. Please sign in again with your 4-digit PIN to save your PIN for future syncs.",
        },
        { status: 401 },
      );
    }

    const targetToken = student.encryptedBrowserlessToken ? decryptText(student.encryptedBrowserlessToken) : "";
    if (!targetToken || !student.browserlessTokenValid) {
      return NextResponse.json(
        {
          success: false,
          requiresRelogin: true,
          requiresTokenRefresh: true,
          message:
            "Your Browserless API token is missing or no longer valid. Please sign in again and enter a new token.",
        },
        { status: 401 },
      );
    }

    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob: student.dob,
      authType: targetAuthType,
      plainPin: targetPin,
      plainBrowserlessToken: targetToken,
      trigger: "manual_update",
      scope,
      strictScope: true,
    });
    runJobAfterResponse(db, jobId);

    return NextResponse.json({ success: true, allowed: true, data: { jobId } });
  } catch (err) {
    if (err instanceof ScrapeInProgressError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 409 });
    }
    console.error(`[api/report/update] failed for USN ${usn}:`, err);
    return NextResponse.json({ success: false, message: "Update failed. Please try again." }, { status: 500 });
  }
}
