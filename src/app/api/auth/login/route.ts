import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { decryptText } from "@/lib/auth/crypto";
import { setSessionCookie } from "@/lib/auth/cookies";
import { signStudentToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { hasScrapedData } from "@/lib/studentDetails";
import { loginSchema } from "@/lib/validation/auth";

/**
 * Student login: USN + DOB, with MSR-Insight's secondary-auth/PIN capture
 * flow preserved (it's what authorizes the portal scrape). Ported from
 * auth.service.js `login()` / auth.controller.js `login()`, with the
 * synchronous scrape replaced by enqueue-and-poll (see /api/scrape-jobs/[id]).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { dob, authType, last4Digits, forceResync } = parsed.data;
  const usn = parsed.data.usn.toUpperCase();

  const db = getDb();
  const [existing] = await db.select().from(students).where(eq(students.usn, usn));

  if (existing && existing.dob !== dob) {
    return NextResponse.json(
      { success: false, message: "Invalid USN or Date of Birth." },
      { status: 400 },
    );
  }

  const hasStoredPin = Boolean(existing?.encryptedPin);
  const hasNewPinProvided = Boolean(last4Digits);

  // Instant login: cached scrape + stored PIN + no forced/new re-verification needed.
  if (
    existing &&
    hasScrapedData(existing.details) &&
    hasStoredPin &&
    !forceResync &&
    !hasNewPinProvided
  ) {
    const token = await signStudentToken(usn);
    await setSessionCookie(token);
    return NextResponse.json({
      success: true,
      message: "Login successful",
      data: { usn, jobId: null },
    });
  }

  const targetAuthType = authType || existing?.authType || undefined;
  const targetPin = last4Digits || (existing?.encryptedPin ? decryptText(existing.encryptedPin) : "");

  if (!targetPin || !targetAuthType) {
    return NextResponse.json({
      success: false,
      requiresSecondaryAuth: true,
      message:
        "First-time login or PIN update requires secondary portal verification details (Father/Mother Mobile or ABC ID last 4 digits).",
    });
  }

  if (!existing) {
    await db.insert(students).values({ usn, dob, currentYear: 0, details: {} });
  }

  const jobId = await enqueueScrapeJob(db, {
    usn,
    dob,
    authType: targetAuthType,
    plainPin: targetPin,
    trigger: "login",
  });

  const token = await signStudentToken(usn);
  await setSessionCookie(token);

  return NextResponse.json({
    success: true,
    message: "Login successful — syncing your portal data",
    data: { usn, jobId },
  });
}
