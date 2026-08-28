import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { decryptText } from "@/lib/auth/crypto";
import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { updateSchema } from "@/lib/validation/auth";

const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Manual "Sync" button. Ported from report.service.js
 * `handleManualReportUpdate()`: enforces a 5-minute cooldown against
 * details.last_updated (a plain timestamp diff, not a rate limiter), and
 * requires a stored PIN/authType or asks the client to re-login
 * (`requiresRelogin`). The synchronous scrape is replaced by enqueue+poll.
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
  if (usn !== sessionUsn) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [student] = await db.select().from(students).where(eq(students.usn, usn));
    if (!student) {
      return NextResponse.json({ success: false, message: "Student record not found" }, { status: 404 });
    }

    const lastSyncStr = student.details?.last_updated;
    if (lastSyncStr) {
      const lastSync = new Date(lastSyncStr).getTime();
      const diff = Date.now() - lastSync;
      if (diff < COOLDOWN_MS) {
        return NextResponse.json(
          {
            success: false,
            allowed: false,
            requiresRelogin: false,
            message: `Rate limit exceeded. Please wait ${Math.ceil((COOLDOWN_MS - diff) / 60000)}m before updating again.`,
            nextAllowedAt: new Date(lastSync + COOLDOWN_MS).toISOString(),
          },
          { status: 429 },
        );
      }
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

    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob: student.dob,
      authType: targetAuthType,
      plainPin: targetPin,
      trigger: "manual_update",
      scope: "full",
    });

    return NextResponse.json({ success: true, allowed: true, data: { jobId } });
  } catch (err) {
    console.error(`[api/report/update] failed for USN ${usn}:`, err);
    return NextResponse.json({ success: false, message: "Update failed. Please try again." }, { status: 500 });
  }
}
