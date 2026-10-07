import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { decryptText } from "@/lib/auth/crypto";
import { toSafeStudent } from "@/lib/auth/safeStudent";
import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { runJobAfterResponse } from "@/lib/scraper/scheduleJob";
import { hasScrapedData } from "@/lib/studentDetails";

/** The scrape runs inside this route's budget via `after()`; 60s is the Vercel Hobby maximum. */
export const maxDuration = 60;

/**
 * Ported from report.controller.js `getStudentDashboardReport()`: serves
 * cached details from the DB when present, otherwise enqueues a scrape (the
 * source scraped inline; here the caller polls /api/scrape-jobs/[id]).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ usn: string }> }) {
  const sessionUsn = await getCurrentUsn();
  if (!sessionUsn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  const usn = (await params).usn.toUpperCase();
  if (usn !== sessionUsn) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [student] = await db.select().from(students).where(eq(students.usn, usn));
    if (!student) {
      return NextResponse.json({ success: false, message: "Student not found" }, { status: 404 });
    }

    if (hasScrapedData(student.details)) {
      return NextResponse.json({ success: true, source: "database", data: toSafeStudent(student) });
    }

    if (!student.dob || !student.authType || !student.encryptedPin) {
      return NextResponse.json(
        { success: false, message: "No cached data and portal verification is required." },
        { status: 400 },
      );
    }

    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob: student.dob,
      authType: student.authType,
      plainPin: decryptText(student.encryptedPin),
      trigger: "manual_update",
      scope: "full",
    });

    runJobAfterResponse(db, jobId);

    return NextResponse.json({ success: true, source: "scraper", data: { jobId } }, { status: 202 });
  } catch (err) {
    console.error(`[api/report/student/${usn}] failed:`, err);
    return NextResponse.json({ success: false, message: "Could not load student report." }, { status: 500 });
  }
}
