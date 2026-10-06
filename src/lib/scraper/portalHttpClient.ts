import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

import { normalizeAuthType, type AuthType } from "@/lib/auth/authType";

/**
 * Logs into the college parent portal (https://parents.msrit.edu/newparents/) with plain HTTP —
 * no browser. The portal's login is a two-step Joomla form: USN + DOB (the DOB is submitted as
 * `passwd=yyyy-mm-dd`), then a PIN step (parent's mobile / ABC ID last 4 digits). Each form carries
 * a per-session CSRF hidden input whose *name* is 32 hex characters, so it is discovered from the
 * fetched page rather than hard-coded. The page's own submit handler (`check1()`) is not defined, and
 * the invisible reCAPTCHA token is not verified server-side, so the forms are replayed as-is.
 */

export const PORTAL_BASE_URL = "https://parents.msrit.edu/newparents/";
const PORTAL_ORIGIN = "https://parents.msrit.edu";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/** Per-request cap; the overall login is also bounded by `deadlineMs`. */
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_LOGIN_DEADLINE_MS = 25_000;
const MAX_REDIRECTS = 8;

/**
 * The portal's own login-error page can still contain the literal string "LOGOUT" in its layout, so
 * this is checked on its own rather than relying on a "LOGOUT present" success heuristic.
 */
export const LOGIN_ERROR_TEXT_RE =
  /does not exist|invalid username|invalid password|invalid credentials|incorrect (password|pin)/i;

/** Wrong USN, date of birth or PIN. Safe to show to the student. */
export class PortalAuthError extends Error {
  constructor(message = "Invalid portal credentials or 4-digit PIN. Please verify your USN, Date of Birth, and PIN.") {
    super(message);
    this.name = "PortalAuthError";
  }
}

/** The portal's login page no longer looks like what this client can replay (markup changed, or it now needs a browser). */
export class PortalLoginUnsupportedError extends Error {
  constructor(message = "The college portal's login page changed, so your data can't be synced right now. Please try again later.") {
    super(message);
    this.name = "PortalLoginUnsupportedError";
  }
}

export interface PortalLoginInput {
  usn: string;
  /** Zero-padded or plain numbers; matched against the portal's <select> option values. */
  day: string;
  month: string;
  year: string;
  /** Anything `normalizeAuthType` understands ("Father's Mobile", "mother", "ABC ID", ...). */
  authType: string;
  pin: string;
}

export interface PortalLoginOptions {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Upper bound for the whole login, across both steps. */
  deadlineMs?: number;
  onProgress?: (msg: string) => Promise<void>;
}

export interface PortalLoginResult {
  dashboardHtml: string;
  cookieString: string;
  requestCount: number;
  loginMs: number;
  pinMs: number;
}

/** Minimal cookie jar: the portal is a single host, so name -> value is enough. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(headers: Headers): void {
    for (const raw of headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      const maxAgeZero = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      const expires = attrs.map((a) => a.match(/^\s*expires\s*=\s*(.+)$/i)?.[1]).find(Boolean);
      const expired = expires ? new Date(expires).getTime() < Date.now() : false;

      if (maxAgeZero || expired || value === "deleted") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

interface Transport {
  fetchImpl: typeof fetch;
  jar: CookieJar;
  deadline: number;
  requestCount: number;
}

interface PortalPage {
  html: string;
  url: string;
}

/** One request, following redirects by hand so cookies set on a redirect response are kept. */
async function send(t: Transport, method: "GET" | "POST", url: string, form?: Record<string, string>): Promise<PortalPage> {
  let currentMethod = method;
  let currentUrl = url;
  let body = form ? new URLSearchParams(form).toString() : undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = t.deadline - Date.now();
    if (remaining <= 0) throw new Error("Portal login timed out");

    const res = await t.fetchImpl(currentUrl, {
      method: currentMethod,
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: t.jar.header(),
        ...(body
          ? { "Content-Type": "application/x-www-form-urlencoded", Referer: PORTAL_BASE_URL, Origin: PORTAL_ORIGIN }
          : {}),
      },
      body,
    });
    t.requestCount++;
    t.jar.store(res.headers);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      if (res.status !== 307 && res.status !== 308) {
        currentMethod = "GET";
        body = undefined;
      }
      continue;
    }

    if (!res.ok) throw new Error(`The portal responded with HTTP ${res.status}`);
    return { html: await res.text(), url: currentUrl };
  }
  throw new Error("The portal redirected too many times");
}

/** Every named, non-button <input> in a form: what a browser would submit for it (checkboxes/radios only if checked). */
export function collectFormFields($: CheerioAPI, $form: ReturnType<CheerioAPI>): Record<string, string> {
  const fields: Record<string, string> = {};
  $form.find("input[name]").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "text").toLowerCase();
    if (["submit", "button", "image", "file", "reset"].includes(type)) return;
    if ((type === "checkbox" || type === "radio") && $el.attr("checked") === undefined) return;
    fields[$el.attr("name")!] = $el.attr("value") ?? "";
  });
  return fields;
}

/** The Joomla CSRF token: a hidden input whose name is 32 hex characters and whose value is "1". */
export function findCsrfFieldName(fields: Record<string, string>): string | null {
  return Object.keys(fields).find((name) => /^[0-9a-f]{32}$/i.test(name) && fields[name] === "1") ?? null;
}

/** The option `value` in `<select id=...>` that matches `target` by value, numeric value or label. */
export function pickSelectValue($: CheerioAPI, selectId: string, target: string): string {
  const wanted = target.trim();
  const wantedNumber = parseInt(wanted, 10);
  const match = $(`#${selectId} option`)
    .filter((_, option) => {
      const value = ($(option).attr("value") ?? "").trim();
      const label = $(option).text().trim();
      return value === wanted || label === wanted || (!Number.isNaN(wantedNumber) && parseInt(value, 10) === wantedNumber);
    })
    .first();
  return match.length ? (match.attr("value") ?? wanted).trim() : wanted;
}

const ID_TYPE_VALUE: Record<AuthType, string> = {
  "Father's Mobile": "1",
  "Mother's Mobile": "2",
  "ABC ID": "3",
};

function findPinForm($: CheerioAPI): ReturnType<CheerioAPI> | null {
  const control = $(".digit-input, #enteredid, #id-type-select, select[name='idType']").first();
  if (!control.length) return null;
  const form = control.closest("form");
  return form.length ? form : null;
}

function hasLoginForm($: CheerioAPI): boolean {
  return $("#login-form input[name='username']").length > 0;
}

/** True once the dashboard is showing (not merely a page that mentions "logout"). */
function isLoggedIn($: CheerioAPI, url: string): boolean {
  if (hasLoginForm($) || findPinForm($)) return false;
  if (/dashboard|ksign/i.test(url)) return true;
  return $('a[href*="logout"], a[href*="attendencelist"], a[href*="ciedetails"]').length > 0;
}

function formAction($form: ReturnType<CheerioAPI>, pageUrl: string): string {
  return new URL($form.attr("action") || "index.php", pageUrl).toString();
}

export async function loginToPortal(input: PortalLoginInput, options: PortalLoginOptions = {}): Promise<PortalLoginResult> {
  const { fetchImpl = fetch, deadlineMs = DEFAULT_LOGIN_DEADLINE_MS, onProgress } = options;
  const t: Transport = { fetchImpl, jar: new CookieJar(), deadline: Date.now() + deadlineMs, requestCount: 0 };
  const tStart = Date.now();

  if (onProgress) await onProgress("Opening the student portal...");
  const loginPage = await send(t, "GET", PORTAL_BASE_URL);
  const $login = cheerio.load(loginPage.html);
  const $loginForm = $login("#login-form");
  if (!$loginForm.length) throw new PortalLoginUnsupportedError();

  const loginFields = collectFormFields($login, $loginForm);
  if (!findCsrfFieldName(loginFields)) throw new PortalLoginUnsupportedError();

  const dd = pickSelectValue($login, "dd", input.day);
  const mm = pickSelectValue($login, "mm", input.month);
  const yyyy = pickSelectValue($login, "yyyy", input.year);

  if (onProgress) await onProgress("Logging in with USN and Date of Birth...");
  // `passwd` is what the page's own putdate() builds from the three selects.
  const stage1 = await send(t, "POST", formAction($loginForm, loginPage.url), {
    ...loginFields,
    username: input.usn,
    dd,
    mm,
    yyyy,
    passwd: `${yyyy}-${mm}-${dd}`,
    "captcha-response": "",
  });
  const tAfterLogin = Date.now();
  const $stage1 = cheerio.load(stage1.html);

  if (isLoggedIn($stage1, stage1.url)) {
    return {
      dashboardHtml: stage1.html,
      cookieString: t.jar.header(),
      requestCount: t.requestCount,
      loginMs: tAfterLogin - tStart,
      pinMs: 0,
    };
  }

  const $pinForm = findPinForm($stage1);
  if (!$pinForm) {
    if (hasLoginForm($stage1) || LOGIN_ERROR_TEXT_RE.test(stage1.html)) throw new PortalAuthError();
    throw new PortalLoginUnsupportedError();
  }

  if (onProgress) await onProgress("Verifying secondary PIN...");
  const pinFields = collectFormFields($stage1, $pinForm);
  const digits = input.pin.replace(/\D/g, "");
  const stage2 = await send(t, "POST", formAction($pinForm, stage1.url), {
    ...pinFields,
    idType: ID_TYPE_VALUE[normalizeAuthType(input.authType)],
    enteredid: digits,
  });

  const $stage2 = cheerio.load(stage2.html);
  if (!isLoggedIn($stage2, stage2.url)) throw new PortalAuthError();

  return {
    dashboardHtml: stage2.html,
    cookieString: t.jar.header(),
    requestCount: t.requestCount,
    loginMs: tAfterLogin - tStart,
    pinMs: Date.now() - tAfterLogin,
  };
}
