import { parseDobParts } from "@/lib/scraper/dob";
import { loginToPortal, PortalAuthError, PortalLoginUnsupportedError } from "@/lib/scraper/portalHttpClient";

export type PortalVerification = { ok: true } | { ok: false; status: number; message: string };

export interface VerifyPortalLoginInput {
  usn: string;
  /** DD-MM-YYYY */
  dob: string;
  authType: string;
  pin: string;
}

/**
 * Proves a USN, date of birth and PIN against the college portal itself, by logging in with them.
 *
 * Called by the login route BEFORE it writes anything, so a mistyped or invented USN can never create a
 * `students` row (the row used to be inserted first and only found to be invalid when the background scrape
 * failed). Distinguishes "your details are wrong" (400) from "the portal can't be used right now" (502/503),
 * so a portal outage is never reported to a student as a bad PIN.
 */
export async function verifyPortalLogin({ usn, dob, authType, pin }: VerifyPortalLoginInput): Promise<PortalVerification> {
  try {
    const { day, month, year } = parseDobParts(dob);
    await loginToPortal({ usn, day, month, year, authType, pin }, { deadlineMs: 20_000 });
    return { ok: true };
  } catch (err) {
    if (err instanceof PortalAuthError) return { ok: false, status: 400, message: err.message };
    if (err instanceof PortalLoginUnsupportedError) return { ok: false, status: 503, message: err.message };

    console.error(`[verifyPortalLogin] portal unreachable while verifying ${usn}:`, err);
    return {
      ok: false,
      status: 502,
      message: "Could not reach the college portal right now. Please try again in a moment.",
    };
  }
}
