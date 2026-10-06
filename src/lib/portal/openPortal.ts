import { createHash } from "node:crypto";

import { normalizeAuthType } from "@/lib/auth/authType";
import { ID_TYPE_VALUE, PORTAL_BASE_URL, type DobSelectValues } from "@/lib/scraper/portalHttpClient";

/**
 * "Official Site" button support: signs the student's own browser in to the college portal.
 *
 * A website can't hand a browser a login session for a *different* website, so instead the server
 * returns a tiny page whose only job is to submit the portal's own login form (the same fields the
 * portal's PIN step posts) from the student's browser, which then holds the portal's session cookie.
 * The PIN therefore appears in that one transient response, never in our JavaScript, URLs or stored state.
 */

/** Where the portal's login form posts to. */
export const PORTAL_LOGIN_ACTION = new URL("index.php", PORTAL_BASE_URL).toString();
const PORTAL_ORIGIN = new URL(PORTAL_BASE_URL).origin;

export interface PortalSignInInput {
  usn: string;
  /** The portal's own option values for the date of birth (see fetchDobSelectValues). */
  dob: DobSelectValues;
  /** Anything normalizeAuthType understands. */
  authType: string;
  pin: string;
}

/** The fields the portal's PIN step posts, with the username/password pair it carries along. */
export function buildPortalSignInFields({ usn, dob, authType, pin }: PortalSignInInput): Record<string, string> {
  return {
    option: "com_user",
    task: "loginOtp",
    username: usn,
    dd: dob.dd,
    mm: dob.mm,
    yyyy: dob.yyyy,
    // What the portal page's own putdate() builds from the three date selects.
    passwd: `${dob.yyyy}-${dob.mm}-${dob.dd}`,
    idType: ID_TYPE_VALUE[normalizeAuthType(authType)],
    enteredid: pin.replace(/\D/g, ""),
    remember: "No",
  };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const SUBMIT_SCRIPT = `document.getElementById("portal-login").submit();`;

const PAGE_STYLE = `
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; background: #0a0a0a; color: #ededed;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; }
  p { margin: 0 0 16px; color: #a1a1a1; font-size: 14px; }
  button { padding: 10px 20px; border: 0; border-radius: 8px; background: #f97316; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
`;

const cspHash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** The page can run only its own one-line submit and can only post to the portal. */
export const PORTAL_SIGNIN_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  // Carries the student's PIN: never cache it, never leak our URL to the portal, never index it.
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": [
    "default-src 'none'",
    `script-src ${cspHash(SUBMIT_SCRIPT)}`,
    `style-src ${cspHash(PAGE_STYLE)}`,
    `form-action ${PORTAL_ORIGIN}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

/** The transient page: an invisible form that posts straight to the portal. */
export function buildPortalSignInPage(fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n    ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>Opening the college portal…</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <main>
    <p>Opening the college portal…</p>
    <form id="portal-login" method="post" action="${escapeHtml(PORTAL_LOGIN_ACTION)}" autocomplete="off">
    ${inputs}
    <noscript><button type="submit">Continue to the portal</button></noscript>
    </form>
  </main>
  <script>${SUBMIT_SCRIPT}</script>
</body>
</html>
`;
}
