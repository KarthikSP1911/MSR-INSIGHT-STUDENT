import axios from "axios";
import https from "https";

import { mapWithConcurrency } from "./concurrency";
import { loginToPortal } from "./portalHttpClient";

/**
 * Pulls the raw HTML needed to build a student's `details` record from the college parent portal
 * (https://parents.msrit.edu/newparents/). Logging in is plain HTTP (see portalHttpClient.ts) — no
 * browser — so the whole scrape fits inside one Vercel serverless invocation.
 */

export interface ScrapedData {
  dashboard: string;
  attendance: Record<string, string>;
  cie: Record<string, string>;
  exams?: string;
}

/** Per-phase timing/footprint data for `scrape_jobs.resultSummary`. */
export interface ScrapeTimings {
  method: "http";
  loginMs: number;
  pinMs: number;
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

/** Max simultaneous HTTP requests against the portal for attendance/CIE/exam pages. */
const FETCH_CONCURRENCY = 6;

/** Per sub-page request timeout; keeps the whole scrape well inside the serverless function limit. */
const SUBPAGE_TIMEOUT_MS = 10_000;

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
 *
 * A sub-page that still fails after its retries aborts the scrape: parsing an empty page yields
 * "0 classes attended / no marks", which would silently overwrite the student's good data.
 */
async function buildResultFromDashboard(
  dashboardHtml: string,
  cookieString: string,
  scope: "recurring" | "full",
  requestCountSoFar: number,
  loginMs: number,
  pinMs: number,
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
    timeout: SUBPAGE_TIMEOUT_MS,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Cookie: cookieString,
    },
    httpsAgent: keepAliveAgent,
  });

  if (onProgress) await onProgress("Downloading attendance and CIE marks...");

  const uniqueUrls = [...urlToTargets.keys()];
  const fetchDurationsMs: number[] = [];
  let failedFetches = 0;
  const fetched = await mapWithConcurrency(uniqueUrls, FETCH_CONCURRENCY, async (url) => {
    const tFetchStart = Date.now();
    try {
      const html = await fetchWithBackoff(axiosInstance, url);
      fetchDurationsMs.push(Date.now() - tFetchStart);
      return { url, html };
    } catch {
      failedFetches++;
      fetchDurationsMs.push(Date.now() - tFetchStart);
      return { url, html: "" };
    }
  });

  if (failedFetches > 0) {
    throw new Error(
      `Could not download ${failedFetches} of ${uniqueUrls.length} portal pages. Your saved data was left unchanged — please try again.`,
    );
  }

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
    method: "http",
    loginMs,
    pinMs,
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
  authType: string,
  pin: string,
  /** `recurring` skips only the exam-history fetch (caller merges it back in from the prior scrape); CIE is always fetched — see scrapeAndSync.ts. */
  scope: "recurring" | "full" = "full",
  onProgress?: (msg: string) => Promise<void>,
): Promise<CompleteStudentData> => {
  const session = await loginToPortal({ usn, day, month, year, authType, pin }, { onProgress });

  return buildResultFromDashboard(
    session.dashboardHtml,
    session.cookieString,
    scope,
    session.requestCount,
    session.loginMs,
    session.pinMs,
    onProgress,
  );
};
