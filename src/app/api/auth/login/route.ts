import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { normalizeAuthType } from "@/lib/auth/authType";
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
  const { dob, authType, last4Digits, forceResync, rememberMe } = parsed.data;
  const usn = parsed.data.usn.toUpperCase();

  try {
    const db = getDb();
    const [existing] = await db.select().from(students).where(eq(students.usn, usn));

    // Only reject on a DOB mismatch once we have confirmed (successfully scraped) data to
    // trust — an existing row with no scraped data is just an unverified placeholder.
    if (existing && existing.dob !== dob && hasScrapedData(existing.details)) {
      return NextResponse.json(
        { success: false, message: "Invalid USN or Date of Birth." },
        { status: 400 },
      );
    }

    const hasStoredPin = Boolean(existing?.encryptedPin);
    const hasNewPinProvided = Boolean(last4Digits);

    // Instant login: cached scrape + stored PIN + no forced re-verification.
    if (existing && hasScrapedData(existing.details) && hasStoredPin && !forceResync && !hasNewPinProvided) {
      const token = await signStudentToken(usn);
      await setSessionCookie(token, Boolean(rememberMe));
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
    } else if (existing.dob !== dob) {
      await db.update(students).set({ dob }).where(eq(students.usn, usn));
    }

    // Canonicalize here rather than trust the stored value as-is.
    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob,
      authType: normalizeAuthType(targetAuthType),
      plainPin: targetPin,
      trigger: "login",
      scope: hasScrapedData(existing?.details) ? "recurring" : "full",
    });

    const sessionToken = await signStudentToken(usn);
    await setSessionCookie(sessionToken, Boolean(rememberMe));

    // Fire-and-forget: trigger the scrape in-process so the login response returns
    // immediately while the scrape runs in the background via Vercel's extended
    // execution (maxDuration=60 on the run route). No await — response goes back now.
    const runUrl = new URL("/api/scrape-jobs/run", request.url);
    fetch(runUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch((e) => console.error("[api/auth/login] fire-and-forget scrape trigger failed:", e));

    return NextResponse.json({
      success: true,
      message: "Login successful — syncing your portal data",
      data: { usn, jobId },
    });
  } catch (err) {
    console.error(`[api/auth/login] failed for USN ${usn}:`, err);
    return NextResponse.json({ success: false, message: "Login failed. Please try again." }, { status: 500 });
  }
}
