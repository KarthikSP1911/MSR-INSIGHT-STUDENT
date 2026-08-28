import axios from "axios";
import https from "https";
import puppeteer, { type Browser } from "puppeteer";

import { mapWithConcurrency } from "./concurrency";

/**
 * Ported near-verbatim from MSR-Insight's
 * backend/express/src/services/scraper/puppeteerClient.js — logs into the
 * college parent portal (https://parents.msrit.edu/newparents/) and pulls
 * the raw HTML needed to build a student's `details` record. Runs inside the
 * standalone worker process (worker/scraper-worker.ts), never inside a
 * Next.js route handler.
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
 * Shared with worker/scraper-worker.ts's own `puppeteer.launch()` so both launch paths stay
 * in sync. Deliberately does NOT disable JavaScript or block `script` requests — the login
 * form embeds a live reCAPTCHA v2 widget (confirmed via live network capture against
 * parents.msrit.edu) that requires the page's own JS to run, so a pure-HTTP or
 * script-blocked login is not viable here.
 */
export const PUPPETEER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--blink-settings=imagesEnabled=false",
];

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
 * Reused across all sub-page fetches (and across jobs, since the worker process is
 * long-lived) so repeat requests to parents.msrit.edu avoid a fresh TCP+TLS handshake
 * each time. The portal's cert is a valid, CA-signed GoDaddy DV cert (verified via
 * `openssl`/`curl` against the live host — SSL_verify_result:0, not self-signed, not
 * expired) so no `rejectUnauthorized: false` bypass is needed here.
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

export const getCompleteStudentData = async (
  usn: string,
  day: string,
  month: string,
  year: string,
  authType: string | undefined,
  last4Digits: string | undefined,
  /** Reuse a long-lived browser (the worker keeps one alive across jobs) instead of launching a fresh one per call. */
  sharedBrowser?: Browser,
): Promise<CompleteStudentData> => {
  const ownsBrowser = !sharedBrowser;
  let browser: Browser | null = sharedBrowser ?? null;
  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;
  let requestCount = 0;
  const tStart = Date.now();
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: PUPPETEER_LAUNCH_ARGS,
      });
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
    await page.goto("https://parents.msrit.edu/newparents/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    requestCount++;
    const tAfterGoto = Date.now();
    const browserMs = tAfterGoto - tStart;

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

    const scrapedData: ScrapedData = { dashboard: content, attendance: {}, cie: {} };
    const cookies = await page.cookies();
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Puppeteer's job is done — the rest is light HTTP+cheerio, no browser needed.
    // Close just this page; a shared browser stays alive for the worker's next job.
    await page.close();
    page = null;
    if (ownsBrowser) {
      await browser.close();
      browser = null;
    }

    const cheerio = await import("cheerio");
    const { extractCourseRowsFromDashboard } = await import("./htmlParser");
    const $dash = cheerio.load(content);
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
      if (row.cieLink) pushTarget(row.cieLink, row.code, "cie");
    }

    const examsUrl = "https://parents.msrit.edu/newparents/index.php?option=com_history&task=getResult";
    urlToTargets.set(examsUrl, [{ courseCode: "EXAMS", type: "exams" }]);

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

    requestCount += uniqueUrls.length;
    const sortedFetchMs = [...fetchDurationsMs].sort((a, b) => a - b);
    const bytesDownloaded =
      Buffer.byteLength(content, "utf8") +
      fetched.reduce((sum, f) => sum + Buffer.byteLength(f.html, "utf8"), 0);

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
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }
};
