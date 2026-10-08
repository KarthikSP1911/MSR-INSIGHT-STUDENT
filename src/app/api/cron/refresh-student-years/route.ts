import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Constant-time comparison, so the secret cannot be guessed from how quickly a wrong one is rejected. */
function isAuthorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Yearly job (see vercel.json): moves every student to the year their USN's batch implies for the current
 * academic year, which starts on 1 August. A student who signs in is updated by their own sync; this covers
 * everyone who does not, so the per-year counts in `app_stats` stay right without anyone running anything.
 *
 * Vercel calls it with `Authorization: Bearer $CRON_SECRET`. It refuses to run without that secret being
 * configured, so a missing variable can never leave it open to the public. It changes only each student's
 * `current_year` (see drizzle/0012 and 0013), only where it differs, so running it again is harmless, which is why
 * it is scheduled on several days: a run that fails (say the database is down) is simply retried the next day.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[api/cron/refresh-student-years] CRON_SECRET is not set, so the job will not run.");
    return NextResponse.json({ success: false, message: "Not configured" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const result = await getDb().execute(sql`select refresh_student_years() as changed`);
    const changed = Number(result.rows[0]?.changed ?? 0);
    console.log(`[api/cron/refresh-student-years] updated the year of ${changed} students`);
    return NextResponse.json({ success: true, changed }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/cron/refresh-student-years] failed:", err);
    return NextResponse.json({ success: false, message: "Could not refresh student years." }, { status: 500, headers: NO_STORE });
  }
}
