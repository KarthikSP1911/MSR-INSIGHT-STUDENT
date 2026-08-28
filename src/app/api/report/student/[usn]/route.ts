import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { hasScrapedData } from "@/lib/studentDetails";

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

  const db = getDb();
  const [student] = await db.select().from(students).where(eq(students.usn, usn));
  if (!student) {
    return NextResponse.json({ success: false, message: "Student not found" }, { status: 404 });
  }

  if (hasScrapedData(student.details)) {
    const { encryptedPin: _encryptedPin, portalSessionCookie: _portalSessionCookie, ...safeStudent } = student;
    return NextResponse.json({ success: true, source: "database", data: safeStudent });
  }

  if (!student.dob || !student.authType || !student.encryptedPin) {
    return NextResponse.json(
      { success: false, message: "No cached data and portal verification is required." },
      { status: 400 },
    );
  }

  const { decryptText } = await import("@/lib/auth/crypto");
  const jobId = await enqueueScrapeJob(db, {
    usn,
    dob: student.dob,
    authType: student.authType,
    plainPin: decryptText(student.encryptedPin),
    trigger: "manual_update",
    scope: "full",
  });

  return NextResponse.json({ success: true, source: "scraper", data: { jobId } }, { status: 202 });
}
