import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { toSafeStudent } from "@/lib/auth/safeStudent";
import { getCurrentUsn } from "@/lib/auth/session";
import { isDatabaseUnavailable, withDbTimeout } from "@/lib/db/availability";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";

/** Long enough for a cold start of Neon's scaled-to-zero compute, short enough to fall back to the cached copy. */
const PROFILE_DB_TIMEOUT_MS = 8_000;

/**
 * Ported from auth.service.js `getProfile()`. Unlike the source, the
 * encrypted PIN is stripped before the row is returned to the client —
 * MSR-Insight returns it as-is, which the prior research flagged as worth
 * not repeating here.
 *
 * When the database is unreachable this answers 503 with `code: "database_unavailable"` so the dashboard
 * can fall back to the copy it saved on the device instead of treating it as a generic failure.
 */
export async function GET() {
  const usn = await getCurrentUsn();
  if (!usn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  try {
    const db = getDb();
    const [student] = await withDbTimeout(db.select().from(students).where(eq(students.usn, usn)), PROFILE_DB_TIMEOUT_MS);
    if (!student) {
      return NextResponse.json({ success: false, message: "Student not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: toSafeStudent(student) });
  } catch (err) {
    console.error(`[api/auth/profile] failed for USN ${usn}:`, err);
    if (isDatabaseUnavailable(err)) {
      return NextResponse.json(
        { success: false, code: "database_unavailable", message: "Our database is temporarily unavailable." },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: false, message: "Could not load profile." }, { status: 500 });
  }
}
