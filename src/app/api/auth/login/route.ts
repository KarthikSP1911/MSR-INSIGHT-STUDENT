import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { normalizeAuthType } from "@/lib/auth/authType";
import { decryptText } from "@/lib/auth/crypto";
import { setSessionCookie } from "@/lib/auth/cookies";
import { signStudentToken } from "@/lib/auth/jwt";
import { verifyPortalLogin } from "@/lib/auth/verifyPortalLogin";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { FAILED_SYNC_BACKOFF_MS, scopeForStaleness } from "@/lib/scrapePolicy";
import { enqueueScrapeJob, hasRecentFailedJob } from "@/lib/scrapeJobs";
import { runJobAfterResponse } from "@/lib/scraper/scheduleJob";
import { hasScrapedData } from "@/lib/studentDetails";
import { loginSchema } from "@/lib/validation/auth";

/** The background scrape runs inside this route's budget via `after()`; 60s is the Vercel Hobby maximum. */
export const maxDuration = 60;

/**
 * Student login: USN + DOB, with MSR-Insight's secondary-auth/PIN capture
 * flow preserved (it's what authorizes the portal scrape). Ported from
 * auth.service.js `login()` / auth.controller.js `login()`, with the
 * synchronous scrape replaced by enqueue-and-poll (see /api/scrape-jobs/[id]).
 *
 * Nothing is written for a student until the portal has accepted their USN, date of birth and PIN, so
 * invalid or mistyped USNs never reach the database.
 *
 * A returning student with a saved PIN signs in immediately. If their data is stale
 * (see scrapePolicy.ts) the stale part is refreshed in the background and the dashboard
 * keeps showing the cached data until the job finishes.
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

    const savedPin = existing?.encryptedPin ? decryptText(existing.encryptedPin) : "";
    const hasNewPinProvided = Boolean(last4Digits);

    // Returning student: cached scrape + a saved PIN that still decrypts + no forced re-verification.
    if (existing && hasScrapedData(existing.details) && savedPin && existing.authType && !forceResync && !hasNewPinProvided) {
      const token = await signStudentToken(usn);
      await setSessionCookie(token, Boolean(rememberMe));

      let jobId: string | null = null;
      const scope = scopeForStaleness(existing);
      // After a recent failure (e.g. the saved PIN was changed on the portal) stop retrying on every login.
      if (scope && !(await hasRecentFailedJob(db, usn, FAILED_SYNC_BACKOFF_MS))) {
        try {
          jobId = await enqueueScrapeJob(db, {
            usn,
            dob,
            authType: normalizeAuthType(existing.authType),
            plainPin: savedPin,
            trigger: "login",
            scope,
          });
          runJobAfterResponse(db, jobId);
        } catch (err) {
          // The session is already valid; a failed refresh must not turn into a failed login.
          console.error(`[api/auth/login] could not queue refresh for USN ${usn}:`, err);
          jobId = null;
        }
      }

      return NextResponse.json({
        success: true,
        message: jobId ? "Login successful — refreshing your data" : "Login successful",
        data: { usn, jobId },
      });
    }

    const targetAuthType = authType || existing?.authType || undefined;
    const targetPin = last4Digits || savedPin;

    if (!targetPin || !targetAuthType) {
      return NextResponse.json({
        success: false,
        requiresSecondaryAuth: true,
        message:
          "First-time login or PIN update requires secondary portal verification details (Father/Mother Mobile or ABC ID last 4 digits).",
      });
    }

    // Prove the USN, date of birth and PIN with the portal itself BEFORE writing anything. A mistyped or
    // invented USN must never create a row (it used to be inserted first and only found invalid when the
    // background scrape failed, leaving junk rows behind).
    const verification = await verifyPortalLogin({ usn, dob, authType: targetAuthType, pin: targetPin });
    if (!verification.ok) {
      return NextResponse.json({ success: false, message: verification.message }, { status: verification.status });
    }

    if (!existing) {
      // A second login for the same new USN (double-click, another tab) can insert first; that row is equivalent.
      await db.insert(students).values({ usn, dob, currentYear: 0, details: {} }).onConflictDoNothing({ target: students.usn });
    } else if (existing.dob !== dob) {
      await db.update(students).set({ dob }).where(eq(students.usn, usn));
    }

    // A student who deliberately re-verifies gets at least a current-semester refresh.
    const scope = existing ? (scopeForStaleness(existing) ?? "current") : "full";
    // Canonicalize here rather than trust the stored value as-is.
    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob,
      authType: normalizeAuthType(targetAuthType),
      plainPin: targetPin,
      trigger: "login",
      scope,
    });

    const sessionToken = await signStudentToken(usn);
    await setSessionCookie(sessionToken, Boolean(rememberMe));
    runJobAfterResponse(db, jobId);

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
