import { eq } from "drizzle-orm";
import type { Browser } from "puppeteer";

import { decryptText, encryptText } from "@/lib/auth/crypto";
import { students, type ScrapeJobScope } from "@/lib/db/schema";
import type { WorkerDb } from "@/lib/db/workerClient";
import type { StudentDetails } from "@/lib/studentDetails";
import {
  getCompleteStudentData,
  tryWarmResync,
  WarmSessionInvalidError,
  type CompleteStudentData,
  type ScrapeTimings,
} from "./puppeteerClient";
import { parseAndProcessData } from "./htmlParser";

/**
 * The portal's session cookie has no known fixed lifetime (see tryWarmResync's own doc
 * comment), so this is a conservative guess at how long it's worth even attempting reuse
 * before just going straight to a full login — not a claim about the portal's real idle
 * timeout. Getting this wrong only costs one extra doomed HTTP request; `tryWarmResync`'s
 * fallback to a full login is what actually guarantees correctness.
 */
const WARM_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * A `recurring`-scope scrape never fetched the exam-history page, so `fresh.exam_history`/
 * `fresh.cgpa` are blank/defaulted — restore them from the previous scrape rather than
 * persist a wipe. CIE/attendance are always freshly fetched regardless of scope (CIE marks
 * are posted throughout the semester, so they're never treated as "doesn't change between
 * logins" — only exam history, which updates once per exam cycle, gets that treatment).
 */
function mergeRecurringScrape(fresh: StudentDetails, previous: StudentDetails | undefined): StudentDetails {
  if (!previous) return fresh;

  return {
    ...fresh,
    exam_history: previous.exam_history ?? fresh.exam_history,
    cgpa: previous.cgpa ?? fresh.cgpa,
  };
}

/** Parses "DD-MM-YYYY" or "YYYY-MM-DD" (also accepts ISO strings) into portal form-field parts. */
export function parseDobParts(dobString: string): { day: string; month: string; year: string } {
  if (!dobString) {
    throw new Error("Date of Birth is missing or invalid.");
  }

  const parts = dobString.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return { day: parts[2].padStart(2, "0"), month: parts[1].padStart(2, "0"), year: parts[0] };
    }
    return { day: parts[0].padStart(2, "0"), month: parts[1].padStart(2, "0"), year: parts[2] };
  }

  const d = new Date(dobString);
  if (!isNaN(d.valueOf())) {
    return {
      day: String(d.getDate()).padStart(2, "0"),
      month: String(d.getMonth() + 1).padStart(2, "0"),
      year: String(d.getFullYear()),
    };
  }

  throw new Error("Invalid DOB format");
}

export interface ScrapeAndSyncResult {
  details: StudentDetails;
  subjectsCount: number;
  examHistoryCount: number;
  timings: ScrapeTimings & { parseMs: number; dbMs: number; warmSession: boolean };
}

/**
 * Ported from puppeteerScraper.service.js `scrapeAndSyncStudent()`: scrapes
 * the portal, normalizes the result, and upserts it onto the student row —
 * including re-encrypting the PIN that was actually used, so future
 * instant-logins/updates can reuse it.
 */
export async function scrapeAndSyncStudent(
  db: WorkerDb,
  usn: string,
  dob: string,
  authType: string,
  plainPin: string,
  /** The worker's long-lived browser, reused across jobs instead of relaunching Chromium per job. */
  sharedBrowser?: Browser,
  /** `recurring` skips only the exam-history fetch and merges it back in from the existing row; `full` re-fetches everything, including exam history. */
  scope: ScrapeJobScope = "full",
): Promise<ScrapeAndSyncResult> {
  const { day, month, year } = parseDobParts(dob);

  const [existing] = await db
    .select({
      details: students.details,
      portalSessionCookie: students.portalSessionCookie,
      portalSessionUpdatedAt: students.portalSessionUpdatedAt,
    })
    .from(students)
    .where(eq(students.usn, usn));

  let result: CompleteStudentData | null = null;
  let warmSession = false;
  const cookieAgeMs = existing?.portalSessionUpdatedAt
    ? Date.now() - existing.portalSessionUpdatedAt.getTime()
    : Infinity;
  if (existing?.portalSessionCookie && cookieAgeMs < WARM_SESSION_MAX_AGE_MS) {
    try {
      result = await tryWarmResync(decryptText(existing.portalSessionCookie), scope);
      warmSession = true;
    } catch (err) {
      if (!(err instanceof WarmSessionInvalidError)) throw err;
      // Fall through to a full Puppeteer login below.
    }
  }

  if (!result) {
    result = await getCompleteStudentData(usn, day, month, year, authType, plainPin, sharedBrowser, scope);
  }
  const { data: scrapedData, timings, sessionCookie } = result;

  const tParseStart = Date.now();
  const freshDetails = parseAndProcessData(scrapedData);
  const parseMs = Date.now() - tParseStart;

  const tDbStart = Date.now();
  const details = scope === "recurring" ? mergeRecurringScrape(freshDetails, existing?.details) : freshDetails;

  await db
    .update(students)
    .set({
      name: details.name,
      dob,
      authType,
      encryptedPin: encryptText(plainPin),
      portalSessionCookie: encryptText(sessionCookie),
      portalSessionUpdatedAt: new Date(),
      currentYear: details.current_year ?? 0,
      details,
      updatedAt: new Date(),
    })
    .where(eq(students.usn, usn));
  const dbMs = Date.now() - tDbStart;

  return {
    details,
    subjectsCount: details.subjects?.length ?? 0,
    examHistoryCount: details.exam_history?.length ?? 0,
    timings: { ...timings, parseMs, dbMs, warmSession },
  };
}
