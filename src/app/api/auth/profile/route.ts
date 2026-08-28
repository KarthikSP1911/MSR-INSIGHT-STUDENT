import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";

/**
 * Ported from auth.service.js `getProfile()`. Unlike the source, the
 * encrypted PIN is stripped before the row is returned to the client —
 * MSR-Insight returns it as-is, which the prior research flagged as worth
 * not repeating here.
 */
export async function GET() {
  const usn = await getCurrentUsn();
  if (!usn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();
  const [student] = await db.select().from(students).where(eq(students.usn, usn));
  if (!student) {
    return NextResponse.json({ success: false, message: "Student not found" }, { status: 404 });
  }

  const { encryptedPin: _encryptedPin, ...safeStudent } = student;
  return NextResponse.json({ success: true, data: safeStudent });
}
