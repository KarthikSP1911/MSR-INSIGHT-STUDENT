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

export const getCompleteStudentData = async (
  usn: string,
  day: string,
  month: string,
  year: string,
  authType: string | undefined,
  last4Digits: string | undefined,
  /** Reuse a long-lived browser (the worker keeps one alive across jobs) instead of launching a fresh one per call. */
  sharedBrowser?: Browser,
): Promise<ScrapedData> => {
  const ownsBrowser = !sharedBrowser;
  let browser: Browser | null = sharedBrowser ?? null;
  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
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

    await page
      .waitForSelector('#id-type-select, .digit-input, #enteredid, a[href*="logout"], table', { timeout: 15000 })
      .catch(() => {});

    let currentUrl = page.url();
    let content = await page.content();
    let hasLogout = content.toUpperCase().includes("LOGOUT") && !hasLoginErrorText(content);
    let isDashboardUrl = currentUrl.toLowerCase().includes("dashboard") || currentUrl.toLowerCase().includes("ksign");

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

        await page.waitForSelector('a[href*="logout"], .dash_od_row, table', { timeout: 15000 }).catch(() => {});

        currentUrl = page.url();
        content = await page.content();
        hasLogout = content.toUpperCase().includes("LOGOUT") && !hasLoginErrorText(content);
        isDashboardUrl = currentUrl.toLowerCase().includes("dashboard") || currentUrl.toLowerCase().includes("ksign");
      }
    }

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
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const uniqueUrls = [...urlToTargets.keys()];
    const fetched = await mapWithConcurrency(uniqueUrls, FETCH_CONCURRENCY, async (url) => {
      try {
        await new Promise((r) => setTimeout(r, Math.random() * 400 + 100));
        const resp = await axiosInstance.get<string>(url);
        return { url, html: resp.data };
      } catch {
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

    return scrapedData;
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }
};
