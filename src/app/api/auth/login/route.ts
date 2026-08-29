import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { normalizeAuthType } from "@/lib/auth/authType";
import { decryptText, encryptText } from "@/lib/auth/crypto";
import { setSessionCookie } from "@/lib/auth/cookies";
import { signStudentToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { enqueueScrapeJob } from "@/lib/scrapeJobs";
import { hasScrapedData } from "@/lib/studentDetails";
import { validateBrowserlessToken } from "@/lib/scraper/puppeteerClient";
import { loginSchema } from "@/lib/validation/auth";

/**
 * Student login: USN + DOB, with MSR-Insight's secondary-auth/PIN capture
 * flow preserved (it's what authorizes the portal scrape). Ported from
 * auth.service.js `login()` / auth.controller.js `login()`, with the
 * synchronous scrape replaced by enqueue-and-poll (see /api/scrape-jobs/[id]).
 *
 * When secondary auth is submitted, a Browserless.io token must also be
 * provided. It is validated synchronously (5s timeout) before minting a
 * session — invalid token is a 400 just like a missing PIN, keeping the
 * form open with an inline error.
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
  const { dob, authType, last4Digits, browserlessToken, forceResync } = parsed.data;
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
    const hasStoredToken = Boolean(existing?.encryptedBrowserlessToken);
    const tokenStillValid = existing?.browserlessTokenValid !== false;
    const hasNewPinProvided = Boolean(last4Digits);
    const hasNewTokenProvided = Boolean(browserlessToken);

    // Instant login: cached scrape + stored PIN + valid Browserless token + no forced re-verification.
    if (
      existing &&
      hasScrapedData(existing.details) &&
      hasStoredPin &&
      hasStoredToken &&
      tokenStillValid &&
      !forceResync &&
      !hasNewPinProvided &&
      !hasNewTokenProvided
    ) {
      const token = await signStudentToken(usn);
      await setSessionCookie(token);
      return NextResponse.json({
        success: true,
        message: "Login successful",
        data: { usn, jobId: null },
      });
    }

    // If the stored Browserless token was marked invalid (bad/expired) and no new token was
    // provided, re-prompt specifically for the token — PIN can be skipped if still valid.
    if (existing && !tokenStillValid && !hasNewTokenProvided) {
      return NextResponse.json({
        success: false,
        requiresSecondaryAuth: true,
        requiresTokenRefresh: true,
        message: "Your Browserless API token is no longer valid. Please re-enter it to continue syncing.",
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

    // A new Browserless token was submitted — validate it synchronously before storing.
    let resolvedEncryptedToken: string | null = existing?.encryptedBrowserlessToken ?? null;
    if (hasNewTokenProvided) {
      const tokenValid = await validateBrowserlessToken(browserlessToken!, 5000);
      if (!tokenValid) {
        return NextResponse.json(
          {
            success: false,
            requiresSecondaryAuth: true,
            browserlessTokenError:
              "Could not connect to Browserless with this token. Check that it is correct and has not expired.",
          },
          { status: 400 },
        );
      }
      resolvedEncryptedToken = encryptText(browserlessToken!);
    }

    // If we still have no token at all (first-time user who hasn't provided one yet), prompt.
    if (!resolvedEncryptedToken) {
      return NextResponse.json({
        success: false,
        requiresSecondaryAuth: true,
        message: "A Browserless.io API token is required for portal scraping.",
      });
    }

    if (!existing) {
      await db.insert(students).values({
        usn,
        dob,
        currentYear: 0,
        details: {},
        encryptedBrowserlessToken: resolvedEncryptedToken,
        browserlessTokenValid: true,
      });
    } else {
      const updates: Partial<typeof students.$inferInsert> = {};
      if (existing.dob !== dob) updates.dob = dob;
      if (hasNewTokenProvided) {
        updates.encryptedBrowserlessToken = resolvedEncryptedToken;
        updates.browserlessTokenValid = true;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(students).set(updates).where(eq(students.usn, usn));
      }
    }

    // Canonicalize here rather than trust the stored value as-is.
    const jobId = await enqueueScrapeJob(db, {
      usn,
      dob,
      authType: normalizeAuthType(targetAuthType),
      plainPin: targetPin,
      plainBrowserlessToken: resolvedEncryptedToken ? decryptText(resolvedEncryptedToken) : null,
      trigger: "login",
      scope: hasScrapedData(existing?.details) ? "recurring" : "full",
    });

    const sessionToken = await signStudentToken(usn);
    await setSessionCookie(sessionToken);

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
