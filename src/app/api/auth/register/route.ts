import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/auth/cookies";
import { signStudentToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { registerSchema } from "@/lib/validation/auth";

/**
 * Internal/parity route ported from auth.service.js `register()`. Not called
 * by the student login page (login() creates a shell row itself when needed)
 * — kept for completeness/future use.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { dob } = parsed.data;
  const usn = parsed.data.usn.toUpperCase();

  const db = getDb();
  const [existing] = await db.select().from(students).where(eq(students.usn, usn));
  if (existing) {
    return NextResponse.json({ success: false, message: "User already exists" }, { status: 400 });
  }

  await db.insert(students).values({ usn, dob, currentYear: 1, details: {} });

  const token = await signStudentToken(usn);
  await setSessionCookie(token);

  return NextResponse.json(
    { success: true, message: "User registered successfully", data: { usn } },
    { status: 201 },
  );
}
