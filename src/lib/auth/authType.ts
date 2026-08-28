export const AUTH_TYPES = ["Father's Mobile", "Mother's Mobile", "ABC ID"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/**
 * Canonicalizes a portal secondary-auth type to one of the 3 values above.
 * Older data (pre-dating this app's own login form) stored free-text variants
 * like "mother" or "mobile" — this mirrors the same loose matching
 * puppeteerClient.ts already uses to pick the portal's dropdown option
 * (`cleanTarget.includes("mother")` etc., defaulting to Father's Mobile), so
 * a stored value and the behavior it actually produces stay in agreement.
 */
export function normalizeAuthType(raw: string | null | undefined): AuthType {
  const cleaned = (raw || "").trim().toLowerCase();
  if (cleaned.includes("mother")) return "Mother's Mobile";
  if (cleaned.includes("abc")) return "ABC ID";
  return "Father's Mobile";
}
