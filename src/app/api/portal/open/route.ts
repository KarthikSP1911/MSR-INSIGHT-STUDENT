import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { decryptText } from "@/lib/auth/crypto";
import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import {
  buildPortalSignInFields,
  buildPortalSignInPage,
  PORTAL_SIGNIN_HEADERS,
} from "@/lib/portal/openPortal";
import { parseDobParts } from "@/lib/scraper/dob";
import { fetchDobSelectValues, PORTAL_BASE_URL } from "@/lib/scraper/portalHttpClient";

const NO_STORE = { "Cache-Control": "no-store" };

/** Falls back to the portal's normal login page: the student just signs in there by hand. */
const portalLoginPage = () => NextResponse.redirect(PORTAL_BASE_URL, { status: 303, headers: NO_STORE });

/**
 * "Official Site" button: opens the college portal in a new tab, already signed in as this student.
 *
 * POST-only on purpose. The session cookie is SameSite=Lax, so other sites can't make the browser send
 * it on a cross-site POST, and the Sec-Fetch-Site check below is defence in depth. A GET would carry the
 * cookie on a cross-site link click and could leak the PIN page to a malicious site.
 *
 * Responds with a transient auto-submitting form (see src/lib/portal/openPortal.ts). If the student has
 * no saved PIN, or anything goes wrong, they land on the portal's own login page instead.
 */
export async function POST(request: NextRequest) {
  const usn = await getCurrentUsn();
  if (!usn) return new NextResponse("Not authenticated", { status: 401, headers: NO_STORE });

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new NextResponse("Forbidden", { status: 403, headers: NO_STORE });

  try {
    const [student] = await getDb().select().from(students).where(eq(students.usn, usn));
    if (!student?.dob || !student.authType || !student.encryptedPin) return portalLoginPage();

    const pin = decryptText(student.encryptedPin);
    if (!pin) return portalLoginPage();

    const dob = await fetchDobSelectValues(parseDobParts(student.dob));
    const fields = buildPortalSignInFields({ usn, dob, authType: student.authType, pin });

    return new NextResponse(buildPortalSignInPage(fields), { status: 200, headers: PORTAL_SIGNIN_HEADERS });
  } catch (err) {
    console.error(`[api/portal/open] failed for USN ${usn}:`, err);
    return portalLoginPage();
  }
}
