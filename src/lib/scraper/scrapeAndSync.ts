import { eq } from "drizzle-orm";
import type { Browser } from "puppeteer";

import { encryptText } from "@/lib/auth/crypto";
import { students } from "@/lib/db/schema";
import type { WorkerDb } from "@/lib/db/workerClient";
import type { StudentDetails } from "@/lib/studentDetails";
import { getCompleteStudentData } from "./puppeteerClient";
import { parseAndProcessData } from "./htmlParser";

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
): Promise<ScrapeAndSyncResult> {
  const { day, month, year } = parseDobParts(dob);

  const scrapedData = await getCompleteStudentData(usn, day, month, year, authType, plainPin, sharedBrowser);
  const details = parseAndProcessData(scrapedData);

  await db
    .update(students)
    .set({
      name: details.name,
      dob,
      authType,
      encryptedPin: encryptText(plainPin),
      currentYear: details.current_year ?? 0,
      details,
      updatedAt: new Date(),
    })
    .where(eq(students.usn, usn));

  return {
    details,
    subjectsCount: details.subjects?.length ?? 0,
    examHistoryCount: details.exam_history?.length ?? 0,
  };
}
