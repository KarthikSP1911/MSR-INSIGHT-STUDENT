import { eq } from "drizzle-orm";

import { encryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { students, type NewStudent, type ScrapeJobScope } from "@/lib/db/schema";
import { getCompleteStudentData, type ScrapeTimings } from "./portalScraper";
import { parseCurrentSemester, parseExamHistory } from "./htmlParser";
import { parseDobParts } from "./dob";

export interface ScrapeAndSyncResult {
  subjectsCount: number;
  examHistoryCount: number;
  timings: ScrapeTimings & { parseMs: number; dbMs: number };
}

/**
 * Ported from MSR-Insight's `scrapeAndSyncStudent()`: scrapes the portal, normalizes the result,
 * and writes it onto the student row — including re-encrypting the PIN that was actually used, so
 * future instant-logins/updates can reuse it.
 *
 * Each scope writes only its own columns: `current` replaces `details`, `exam_history` replaces
 * `examHistory`/`cgpa`, and `full` does both. Nothing is merged back in from a previous scrape.
 *
 * Runs in-process inside a Vercel serverless function (via runJob.ts, scheduled
 * with `after()` from the route that enqueued the job) — no standalone worker process.
 */
export async function scrapeAndSyncStudent(
  db: Db,
  usn: string,
  dob: string,
  authType: string,
  plainPin: string,
  scope: ScrapeJobScope = "full",
  onProgress?: (msg: string) => Promise<void>,
): Promise<ScrapeAndSyncResult> {
  const { day, month, year } = parseDobParts(dob);

  const { data: scrapedData, timings } = await getCompleteStudentData(
    usn,
    day,
    month,
    year,
    authType,
    plainPin,
    scope,
    onProgress,
  );

  const tParseStart = Date.now();
  const update: Partial<NewStudent> = {
    dob,
    authType,
    encryptedPin: encryptText(plainPin),
    updatedAt: new Date(),
  };

  let subjectsCount = 0;
  if (scope !== "exam_history") {
    const details = parseCurrentSemester(scrapedData);
    update.name = details.name;
    update.currentYear = details.current_year ?? 0;
    update.details = details;
    subjectsCount = details.subjects?.length ?? 0;
  }

  let examHistoryCount = 0;
  if (scope !== "current") {
    const { examHistory, cgpa } = parseExamHistory(scrapedData.exams);
    update.examHistory = examHistory;
    update.cgpa = cgpa;
    update.examHistoryUpdatedAt = new Date();
    examHistoryCount = examHistory.length;
  }
  const parseMs = Date.now() - tParseStart;

  const tDbStart = Date.now();
  await db.update(students).set(update).where(eq(students.usn, usn));
  const dbMs = Date.now() - tDbStart;

  return { subjectsCount, examHistoryCount, timings: { ...timings, parseMs, dbMs } };
}
