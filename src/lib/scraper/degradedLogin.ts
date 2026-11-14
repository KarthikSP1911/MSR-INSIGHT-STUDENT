import { normalizeAuthType } from "@/lib/auth/authType";
import type { SafeStudent } from "@/lib/auth/safeStudent";
import {
  PortalAuthError,
  PortalLoginUnsupportedError,
  PortalUnavailableError,
} from "./portalHttpClient";
import { BROWSERLESS_TOKEN_MESSAGE, BrowserlessTokenInvalidError } from "./browserlessClient";
import { JOB_DEADLINE_MS, withDeadline } from "./runJob";
import { scrapeStudentUpdate } from "./scrapeAndSync";

export interface DegradedLoginInput {
  usn: string;
  /** DD-MM-YYYY */
  dob: string;
  authType: string;
  pin: string;
  /** Typed by the student: with the database down there is no saved token to use. */
  browserlessToken: string;
}

/**
 * Signs a student in with the college portal as the only authority, for when our database is unreachable.
 * The USN, date of birth and PIN are proven by logging into the portal itself, the full record is scraped
 * in that same login, and it is returned to the caller. Nothing is written anywhere: the PIN is used once
 * and discarded, and the student's row is created later by a normal sign-in once the database is back.
 */
export async function loginWithoutDatabase({ usn, dob, authType, pin, browserlessToken }: DegradedLoginInput): Promise<SafeStudent> {
  const { update } = await withDeadline(
    scrapeStudentUpdate(usn, dob, normalizeAuthType(authType), pin, browserlessToken, "full"),
    JOB_DEADLINE_MS,
  );

  const now = new Date();
  return {
    usn,
    name: update.name ?? null,
    dob,
    phone: null,
    email: null,
    currentYear: update.currentYear ?? 0,
    authType: update.authType ?? null,
    browserlessTokenValid: true,
    details: update.details ?? {},
    examHistory: update.examHistory ?? [],
    cgpa: update.cgpa ?? null,
    examHistoryUpdatedAt: update.examHistoryUpdatedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export type DegradedLoginFailure = { status: number; message: string; browserlessTokenError?: boolean };

/** What to tell the student, and with which status, when the portal login or scrape failed. */
export function describeDegradedLoginFailure(err: unknown): DegradedLoginFailure {
  if (err instanceof BrowserlessTokenInvalidError) return { status: 400, message: BROWSERLESS_TOKEN_MESSAGE, browserlessTokenError: true };
  if (err instanceof PortalAuthError) return { status: 400, message: err.message };
  if (err instanceof PortalLoginUnsupportedError) return { status: 503, message: err.message };
  if (err instanceof PortalUnavailableError) return { status: 502, message: err.message };
  return { status: 502, message: "Could not reach the college portal right now. Please try again in a moment." };
}
