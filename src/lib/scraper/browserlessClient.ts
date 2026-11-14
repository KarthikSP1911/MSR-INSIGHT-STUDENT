import puppeteer, { type Browser, type Page } from "puppeteer-core";

import { normalizeAuthType } from "@/lib/auth/authType";
import {
  assertPortalAccessAllowed,
  BROWSER_USER_AGENT,
  LOGIN_ERROR_TEXT_RE,
  PORTAL_BASE_URL,
  PortalAuthError,
  PortalUnavailableError,
  type PortalLoginInput,
  type PortalLoginOptions,
  type PortalLoginResult,
} from "./portalHttpClient";

/**
 * Logs into the college parent portal in a remote Chromium on Browserless.io, using the student's own
 * Browserless token, and hands back the dashboard HTML plus the session cookie. Nothing runs locally: the
 * browser is only needed for the login, so the sub-page fetches that follow (portalScraper.ts) are plain HTTP
 * with that cookie. The result has the same shape as `loginToPortal`, so everything downstream is unchanged.
 */

/**
 * Connecting to Browserless itself failed (bad, expired or revoked token, quota used up, Browserless
 * unreachable). Distinct from a portal login failure (wrong USN/DOB/PIN, `PortalAuthError`): runJob uses it to
 * mark the saved token invalid, and the login flow to ask for a fresh one.
 */
export class BrowserlessTokenInvalidError extends Error {
  constructor(message = "Could not connect to Browserless with the provided token.") {
    super(message);
    this.name = "BrowserlessTokenInvalidError";
  }
}

/** Shown to the student when their token is rejected. */
export const BROWSERLESS_TOKEN_MESSAGE =
  "Could not connect to Browserless with this token. Check that it is correct and has not expired.";

export function buildBrowserlessEndpoint(token: string): string {
  return `wss://chrome.browserless.io?token=${encodeURIComponent(token)}`;
}

/** The login and dashboard HTML is all that is parsed, so none of the page chrome needs to load. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

const NAV_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_DEADLINE_MS = 40_000;

/** A portal session plus how long it took to get a remote browser connected. */
export type BrowserlessLoginResult = PortalLoginResult & { browserMs: number };

export interface BrowserlessLoginOptions extends Pick<PortalLoginOptions, "deadlineMs" | "onProgress"> {
  /** Injectable for tests. */
  connect?: typeof puppeteer.connect;
}

const isDashboard = (url: string, html: string): boolean => {
  const u = url.toLowerCase();
  // The portal's error page also contains the word LOGOUT in its layout, so the error text wins.
  const hasLogout = html.toUpperCase().includes("LOGOUT") && !LOGIN_ERROR_TEXT_RE.test(html);
  return u.includes("dashboard") || u.includes("ksign") || hasLogout;
};

/** Races `promise` against a deadline; the loser's later rejection is swallowed. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PortalUnavailableError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function selectDob(page: Page, day: string, month: string, year: string): Promise<void> {
  // Inlined (no named helper): tsx/esbuild wraps named functions with `__name(...)` under keepNames, and
  // page.evaluate stringifies this callback to run in the page, where that helper does not exist.
  await page.evaluate(
    (dStr: string, mStr: string, yStr: string) => {
      for (const [id, val] of [
        ["dd", dStr],
        ["mm", mStr],
        ["yyyy", yStr],
      ] as const) {
        const sel = document.getElementById(id) as HTMLSelectElement | null;
        if (!sel) continue;
        const target = String(val).trim();
        const opt = Array.from(sel.options).find(
          (o) =>
            o.value.trim() === target ||
            o.text.trim() === target ||
            (!isNaN(parseInt(o.value, 10)) && parseInt(o.value, 10) === parseInt(target, 10)),
        );
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    },
    day,
    month,
    year,
  );
}

async function clickAndSettle(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS }).catch(() => {}),
    page.evaluate((sel: string) => {
      document.querySelector<HTMLElement>(sel)?.click();
    }, selector),
  ]);
}

async function runLogin(
  browser: Browser,
  input: PortalLoginInput,
  onProgress: ((msg: string) => Promise<void>) | undefined,
  tStart: number,
): Promise<BrowserlessLoginResult> {
  const page = await browser.newPage();
  await page.setUserAgent(BROWSER_USER_AGENT);
  let requestCount = 0;

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) void req.abort().catch(() => {});
    else void req.continue().catch(() => {});
  });

  if (onProgress) await onProgress("Opening the student portal...");
  let response: Awaited<ReturnType<Page["goto"]>>;
  try {
    response = await page.goto(PORTAL_BASE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  } catch {
    throw new PortalUnavailableError();
  }
  // Without this a blocked page falls through to "login form not found" and surfaces as an unknown error.
  if (response?.status() === 403) {
    throw new PortalUnavailableError(
      "The college portal blocked the remote browser, so your data can't be synced right now. Please try again later.",
    );
  }
  requestCount++;
  const tAfterGoto = Date.now();

  if (onProgress) await onProgress("Logging in with USN and Date of Birth...");
  await page.type("#username", input.usn);
  await selectDob(page, input.day, input.month, input.year);
  await clickAndSettle(page, '.cn-login-btn, input[type="submit"], button[type="submit"]');
  requestCount++;
  await page
    .waitForSelector('#id-type-select, .digit-input, #enteredid, a[href*="logout"], table', { timeout: 15_000 })
    .catch(() => {});

  let url = page.url();
  let html = await page.content();
  const tAfterFirstStage = Date.now();
  let pinMs = 0;

  if (!isDashboard(url, html) && !LOGIN_ERROR_TEXT_RE.test(html)) {
    const hasSelect = await page.$('#id-type-select, select[name="idType"]').catch(() => null);
    const hasDigits = await page.$(".digit-input, #enteredid").catch(() => null);

    if ((hasSelect || hasDigits) && input.pin) {
      if (onProgress) await onProgress("Verifying secondary PIN...");
      if (hasSelect) {
        const authType = normalizeAuthType(input.authType);
        const optionValue = authType === "Mother's Mobile" ? "2" : authType === "ABC ID" ? "3" : "1";
        await page.evaluate((value: string) => {
          const sel = document.querySelector<HTMLSelectElement>('#id-type-select, select[name="idType"]');
          if (sel) {
            sel.value = value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, optionValue);
      }

      await page.evaluate((digits: string) => {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".digit-input"));
        const clean = String(digits).replace(/\D/g, "");
        for (let i = 0; i < inputs.length && i < clean.length; i++) {
          inputs[i].value = clean[i];
          inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
          inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
        }
        const hidden = document.getElementById("enteredid") as HTMLInputElement | null;
        if (hidden) hidden.value = clean;
      }, input.pin);

      await clickAndSettle(page, '#btn-submit, input[type="submit"], button[type="submit"]');
      requestCount++;
      await page.waitForSelector('a[href*="logout"], .dash_od_row, table', { timeout: 15_000 }).catch(() => {});

      url = page.url();
      html = await page.content();
      pinMs = Date.now() - tAfterFirstStage;
    }
  }

  if (!isDashboard(url, html) || LOGIN_ERROR_TEXT_RE.test(html)) throw new PortalAuthError();

  const cookies = await page.cookies();
  return {
    dashboardHtml: html,
    cookieString: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    requestCount,
    loginMs: tAfterFirstStage - tAfterGoto,
    pinMs,
    browserMs: tAfterGoto - tStart,
  };
}

/**
 * Connects to Browserless with `browserlessToken`, logs into the portal and returns the session. Always
 * closes the remote browser, including on failure or timeout, so no Browserless session is left running.
 *
 * Throws `BrowserlessTokenInvalidError` if Browserless can't be reached with the token, `PortalAuthError` for
 * a wrong USN/DOB/PIN and `PortalUnavailableError` if the portal doesn't answer in time.
 */
export async function loginToPortalWithBrowserless(
  input: PortalLoginInput,
  browserlessToken: string,
  options: BrowserlessLoginOptions = {},
): Promise<BrowserlessLoginResult> {
  assertPortalAccessAllowed();
  const { connect = puppeteer.connect.bind(puppeteer), deadlineMs = DEFAULT_LOGIN_DEADLINE_MS, onProgress } = options;
  const tStart = Date.now();

  if (onProgress) await onProgress("Connecting to Browserless...");
  let browser: Browser;
  try {
    browser = await connect({ browserWSEndpoint: buildBrowserlessEndpoint(browserlessToken) });
  } catch (err) {
    throw new BrowserlessTokenInvalidError(
      err instanceof Error ? `Could not connect to Browserless: ${err.message}` : undefined,
    );
  }

  try {
    return await withTimeout(
      runLogin(browser, input, onProgress, tStart),
      deadlineMs,
      "Logging in to the portal took too long. The portal may be slow right now — please try again in a few minutes.",
    );
  } finally {
    await browser.close().catch(() => {});
  }
}
