import { z } from "zod";

/**
 * A VTU-style USN: 1 digit, 2-letter college code, 2-digit admission year, 2-3 letter branch code and a
 * 3-digit serial, e.g. 1MS23IS051. This only rejects input that can't be a USN at all; whether the USN
 * really exists is proven against the portal before anything is saved (see verifyPortalLogin).
 */
export const USN_PATTERN = /^[0-9][A-Z]{2}[0-9]{2}[A-Z]{2,3}[0-9]{3}$/;

const usn = z.string().trim().toUpperCase().regex(USN_PATTERN, "Enter a valid USN, for example 1MS23IS051");

/** DD-MM-YYYY, the format the login form sends, and a date that exists on the calendar. */
const dob = z
  .string()
  .trim()
  .regex(/^\d{2}-\d{2}-\d{4}$/, "Enter a valid Date of Birth")
  .refine((value) => {
    const [day, month, year] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Enter a valid Date of Birth");

export const loginSchema = z.object({
  usn,
  dob,
  authType: z.string().trim().optional(),
  last4Digits: z.string().trim().optional(),
  forceResync: z.boolean().optional(),
  /** When true, sets a persistent 160-day cookie; when false/absent, sets a session cookie. */
  rememberMe: z.boolean().optional(),
});

export const updateSchema = z.object({
  usn,
  /** Which data a manual refresh re-fetches; defaults to the current semester. */
  scope: z.enum(["current", "exam_history"]).optional(),
});
