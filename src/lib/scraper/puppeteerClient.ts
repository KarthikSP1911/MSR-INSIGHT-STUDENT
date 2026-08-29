import axios from "axios";
import https from "https";
import puppeteer, { type Browser } from "puppeteer-core";

import { mapWithConcurrency } from "./concurrency";

/**
 * Ported from MSR-Insight's backend/express/src/services/scraper/puppeteerClient.js — logs
 * into the college parent portal (https://parents.msrit.edu/newparents/) and pulls the raw
 * HTML needed to build a student's `details` record. Unlike the original (and this project's
 * own earlier standalone-worker version), this never launches a local Chromium: it always
 * connects to a remote browser over a per-student Browserless.io token, so the whole scrape
 * fits inside a single Vercel serverless function invocation — see runJob.ts.
 */

export interface ScrapedData {
  dashboard: string;
  attendance: Record<string, string>;
  cie: Record<string, string>;
  exams?: string;
}

/** Per-phase timing/footprint data for `scrape_jobs.resultSummary` (Phase 0 instrumentation). */
export interface ScrapeTimings {
  browserMs: number;
  loginMs: number;
  dashboardMs: number;
  fetchMs: { p50: number; max: number; total: number };
  requestCount: number;
  bytesDownloaded: number;
}

export interface CompleteStudentData {
  data: ScrapedData;
  timings: ScrapeTimings;
}

/**
 * Thrown when connecting to Browserless itself fails (bad/expired/revoked token, quota
 * exhausted, Browserless unreachable) — distinct from a portal-login failure (wrong
 * USN/DOB/PIN), which throws a plain Error instead. Callers (runJob.ts) use this to flip
 * `students.browserlessTokenValid` and surface a `browserless_token_invalid` job error, so
 * the login flow knows to re-prompt for a fresh token specifically.
 */
export class BrowserlessTokenInvalidError extends Error {
  constructor(message = "Could not connect to Browserless with the provided token.") {
    super(message);
    this.name = "BrowserlessTokenInvalidError";
  }
}

function buildBrowserlessEndpoint(token: string): string {
  return `wss://chrome.browserless.io?token=${encodeURIComponent(token)}`;
}

/** Races `promise` against a timeout without leaving the loser's rejection unhandled. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

/**
 * Test-connects to Browserless with the given token and immediately disconnects. Used by the
 * login route to validate a freshly-submitted token synchronously, before minting a session or
 * enqueuing a scrape — same UX as a bad PIN (reject inline, don't discover it async).
 */
export async function validateBrowserlessToken(token: string, timeoutMs = 5000): Promise<boolean> {
  let browser: Browser | null = null;
  try {
    browser = await withTimeout(
      puppeteer.connect({ browserWSEndpoint: buildBrowserlessEndpoint(token) }),
      timeoutMs,
      "Browserless token validation",
    );
    return true;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

const resolveParentsUrl = (href: string | undefined): string => {
  if (!href) return "";
  const h = href.trim();
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("/")) return `https://parents.msrit.edu${h}`;
  return `https://parents.msrit.edu/newparents/${h.replace(/^\.\//, "")}`;
};

/** Skip these while logging in — the login/dashboard HTML is all we parse, none of the rendered chrome matters. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * The portal's own login-error page still contains the literal string
 * "LOGOUT" somewhere in its static layout, which false-positives the
 * `content.includes("LOGOUT")` success heuristic below. This is checked
 * first and wins regardless of that heuristic, so a wrong USN/DOB/PIN
 * reliably throws instead of silently "succeeding" with an empty record.
 */
const LOGIN_ERROR_TEXT_RE = /does not exist|invalid username|invalid password|invalid credentials|incorrect (password|pin)/i;
const hasLoginErrorText = (html: string): boolean => LOGIN_ERROR_TEXT_RE.test(html);

/** Max simultaneous HTTP requests against the portal for attendance/CIE/exam pages. */
const FETCH_CONCURRENCY = 6;

/**
 * Reused across all sub-page fetches within a single scrape so repeat requests to
 * parents.msrit.edu avoid a fresh TCP+TLS handshake each time. The portal's cert is a valid,
 * CA-signed GoDaddy DV cert (verified via `openssl`/`curl` against the live host —
 * SSL_verify_result:0, not self-signed, not expired) so no `rejectUnauthorized: false` bypass
 * is needed here.
 */
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 15_000 });

/** Retried only on rate-limiting/server errors — not on every request like the old fixed delay. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_FETCH_RETRIES = 2;

async function fetchWithBackoff(instance: ReturnType<typeof axios.create>, url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await instance.get<string>(url);
      return resp.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status && RETRYABLE_STATUS.has(status) && attempt < MAX_FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Given dashboard HTML and a session cookie already known to be valid, fetches the
 * attendance/CIE/exam sub-pages and assembles the final result + timings.
 */
async function buildResultFromDashboard(
  dashboardHtml: string,
  cookieString: string,
  scope: "recurring" | "full",
  requestCountSoFar: number,
  browserMs: number,
  loginMs: number,
  dashboardMs: number,
  onProgress?: (msg: string) => Promise<void>,
): Promise<CompleteStudentData> {
  if (onProgress) await onProgress("Parsing dashboard data...");
  const scrapedData: ScrapedData = { dashboard: dashboardHtml, attendance: {}, cie: {} };

  const cheerio = await import("cheerio");
  const { extractCourseRowsFromDashboard } = await import("./htmlParser");
  const $dash = cheerio.load(dashboardHtml);
  const courseRows = extractCourseRowsFromDashboard($dash);

  const urlToTargets = new Map<string, { courseCode: string; type: string }[]>();
  const pushTarget = (href: string, courseCode: string, type: string) => {
    const url = resolveParentsUrl(href);
    if (!url) return;
    if (!urlToTargets.has(url)) urlToTargets.set(url, []);
    urlToTargets.get(url)!.push({ courseCode, type });
  };
  for (const row of courseRows) {
    if (row.attLink) pushTarget(row.attLink, row.code, "attendance");
    // CIE marks change throughout the semester (faculty post new test results), so fetch it
    // every time regardless of scope — unlike exam history below, it's not safe to treat as
    // "doesn't change between logins".
    if (row.cieLink) pushTarget(row.cieLink, row.code, "cie");
  }

  if (scope === "full") {
    // Exam history only updates once per exam cycle, so a `recurring`-scope job skips it and
    // the caller (scrapeAndSync.ts) merges the prior scrape's exam history/CGPA back in.
    const examsUrl = "https://parents.msrit.edu/newparents/index.php?option=com_history&task=getResult";
    urlToTargets.set(examsUrl, [{ courseCode: "EXAMS", type: "exams" }]);
  }

  // Placement pages (com_placement: eligibility/status/results/profile) are deliberately
  // never added to urlToTargets — the placement section is out of scope for this scraper
  // entirely, not just unparsed. Nothing under it is fetched, stored, or processed.

  const axiosInstance = axios.create({
    timeout: 10000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Cookie: cookieString,
    },
    httpsAgent: keepAliveAgent,
  });

  if (onProgress) await onProgress("Downloading attendance and CIE marks...");

  const uniqueUrls = [...urlToTargets.keys()];
  const fetchDurationsMs: number[] = [];
  const fetched = await mapWithConcurrency(uniqueUrls, FETCH_CONCURRENCY, async (url) => {
    const tFetchStart = Date.now();
    try {
      const html = await fetchWithBackoff(axiosInstance, url);
      fetchDurationsMs.push(Date.now() - tFetchStart);
      return { url, html };
    } catch {
      fetchDurationsMs.push(Date.now() - tFetchStart);
      return { url, html: "" };
    }
  });
  const htmlByUrl = new Map(fetched.map((f) => [f.url, f.html]));

  for (const [url, targets] of urlToTargets) {
    const html = htmlByUrl.get(url) ?? "";
    for (const t of targets) {
      if (t.type === "exams") scrapedData.exams = html;
      else if (t.type === "attendance") scrapedData.attendance[t.courseCode] = html;
      else if (t.type === "cie") scrapedData.cie[t.courseCode] = html;
    }
  }

  const requestCount = requestCountSoFar + uniqueUrls.length;
  const sortedFetchMs = [...fetchDurationsMs].sort((a, b) => a - b);
  const bytesDownloaded =
    Buffer.byteLength(dashboardHtml, "utf8") + fetched.reduce((sum, f) => sum + Buffer.byteLength(f.html, "utf8"), 0);

  const timings: ScrapeTimings = {
    browserMs,
    loginMs,
    dashboardMs,
    fetchMs: {
      p50: percentile(sortedFetchMs, 0.5),
      max: sortedFetchMs.length ? sortedFetchMs[sortedFetchMs.length - 1] : 0,
      total: fetchDurationsMs.reduce((a, b) => a + b, 0),
    },
    requestCount,
    bytesDownloaded,
  };

  return { data: scrapedData, timings };
}

export const getCompleteStudentData = async (
  usn: string,
  day: string,
  month: string,
  year: string,
  authType: string | undefined,
  last4Digits: string | undefined,
  /** Decrypted per-student Browserless.io token — the only way a browser is ever obtained here. */
  browserlessToken: string,
  /** `recurring` skips only the exam-history fetch (caller merges it back in from the prior scrape); CIE is always fetched — see scrapeAndSync.ts. */
  scope: "recurring" | "full" = "full",
  onProgress?: (msg: string) => Promise<void>,
): Promise<CompleteStudentData> => {
  let browser: Browser | null = null;
  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;
  let requestCount = 0;
  const tStart = Date.now();

  if (onProgress) await onProgress("Connecting to browserless server...");
  try {
    try {
      browser = await puppeteer.connect({ browserWSEndpoint: buildBrowserlessEndpoint(browserlessToken) });
    } catch (err) {
      throw new BrowserlessTokenInvalidError(
        err instanceof Error ? `Could not connect to Browserless: ${err.message}` : undefined,
      );
    }

    page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    if (onProgress) await onProgress("Navigating to student portal...");
    await page.goto("https://parents.msrit.edu/newparents/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    requestCount++;
    const tAfterGoto = Date.now();
    const browserMs = tAfterGoto - tStart;

    if (onProgress) await onProgress("Logging in with USN and Date of Birth...");
    await page.type("#username", usn);

    await page.evaluate(
      (dStr: string, mStr: string, yStr: string) => {
        // Inlined deliberately (no local named helper function): tsx/esbuild
        // wraps named function declarations with a `__name(fn, "name")` call
        // for keepNames, and since page.evaluate() stringifies this callback
        // to run inside the page's own JS context, that helper reference
        // doesn't exist there and throws "__name is not defined".
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

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>(
          '.cn-login-btn, input[type="submit"], button[type="submit"]',
        );
        if (btn) btn.click();
      }),
    ]);
    requestCount++;

    await page
      .waitForSelector('#id-type-select, .digit-input, #enteredid, a[href*="logout"], table', { timeout: 15000 })
      .catch(() => {});

    let currentUrl = page.url();
    let content = await page.content();
    let hasLogout = content.toUpperCase().includes("LOGOUT") && !hasLoginErrorText(content);
    let isDashboardUrl = currentUrl.toLowerCase().includes("dashboard") || currentUrl.toLowerCase().includes("ksign");
    const tAfterFirstStage = Date.now();
    const loginMs = tAfterFirstStage - tAfterGoto;

    if (!isDashboardUrl && !hasLogout) {
      if (onProgress) await onProgress("Verifying secondary PIN...");
      const hasSelect = await page.$('#id-type-select, select[name="idType"]').catch(() => null);
      const hasDigits = await page.$(".digit-input, #enteredid").catch(() => null);

      if ((hasSelect || hasDigits) && last4Digits) {
        if (hasSelect) {
          await page.evaluate((targetAuthType: string) => {
            const sel = document.querySelector<HTMLSelectElement>('#id-type-select, select[name="idType"]');
            if (sel) {
              const cleanTarget = (targetAuthType || "").toLowerCase();
              let targetValue = "1"; // Default: Father Mobile
              if (cleanTarget.includes("mother") || cleanTarget === "2") {
                targetValue = "2";
              } else if (cleanTarget.includes("abc") || cleanTarget === "3") {
                targetValue = "3";
              }
              sel.value = targetValue;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, authType || "");
        }

        await page.evaluate((digits: string) => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".digit-input"));
          const cleanDigits = String(digits).replace(/\D/g, "");

          for (let i = 0; i < inputs.length && i < cleanDigits.length; i++) {
            inputs[i].value = cleanDigits[i];
            inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
            inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
          }

          const hiddenField = document.getElementById("enteredid") as HTMLInputElement | null;
          if (hiddenField) {
            hiddenField.value = cleanDigits;
          }
        }, last4Digits);

        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
          page.evaluate(() => {
            const btn = document.querySelector<HTMLElement>('#btn-submit, input[type="submit"], button[type="submit"]');
            if (btn) btn.click();
          }),
        ]);
        requestCount++;

        await page.waitForSelector('a[href*="logout"], .dash_od_row, table', { timeout: 15000 }).catch(() => {});

        currentUrl = page.url();
        content = await page.content();
        hasLogout = content.toUpperCase().includes("LOGOUT") && !hasLoginErrorText(content);
        isDashboardUrl = currentUrl.toLowerCase().includes("dashboard") || currentUrl.toLowerCase().includes("ksign");
      }
    }
    const dashboardMs = Date.now() - tAfterFirstStage;

    if ((!isDashboardUrl && !hasLogout) || hasLoginErrorText(content)) {
      throw new Error("Invalid portal credentials or 4-digit PIN. Please verify your USN, Date of Birth, and PIN.");
    }

    const cookies = await page.cookies();
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Puppeteer's job is done — the rest is light HTTP+cheerio, no browser needed. Every
    // invocation owns its own connection now (no shared/reused browser across jobs), so always
    // close it once we have the cookie we need.
    await page.close();
    page = null;
    await browser.close();
    browser = null;

    return buildResultFromDashboard(content, cookieString, scope, requestCount, browserMs, loginMs, dashboardMs, onProgress);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
};
