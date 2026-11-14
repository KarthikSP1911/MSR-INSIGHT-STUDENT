import { eq } from "drizzle-orm";

import { currentYearFromUsn } from "@/lib/academicYear";
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

export interface ScrapedStudentUpdate {
  /** The columns this scope would write. Never contains the PIN. */
  update: Partial<NewStudent>;
  subjectsCount: number;
  examHistoryCount: number;
  timings: ScrapeTimings & { parseMs: number };
}

/**
 * Scrapes the portal and normalizes the result into the `students` columns the scope owns, without touching
 * the database. Shared by the normal sync (which writes it) and the database-down login (which returns it).
 *
 * Each scope covers only its own columns: `current` is `details`, `exam_history` is `examHistory`/`cgpa`,
 * and `full` is both. Nothing is merged back in from a previous scrape.
 */
export async function scrapeStudentUpdate(
  usn: string,
  dob: string,
  authType: string,
  plainPin: string,
  browserlessToken: string,
  scope: ScrapeJobScope = "full",
  onProgress?: (msg: string) => Promise<void>,
): Promise<ScrapedStudentUpdate> {
  const { day, month, year } = parseDobParts(dob);

  const { data: scrapedData, timings } = await getCompleteStudentData(
    usn,
    day,
    month,
    year,
    authType,
    plainPin,
    browserlessToken,
    scope,
    onProgress,
  );

  const tParseStart = Date.now();
  const update: Partial<NewStudent> = {
    dob,
    authType,
    updatedAt: new Date(),
  };

  let subjectsCount = 0;
  if (scope !== "exam_history") {
    const details = parseCurrentSemester(scrapedData);
    // The page layout is not a reliable source for either: the portal once put "Attendance" where the USN was
    // and a notice where the class line was, which reset every student's year to 0. The USN we logged in with is
    // authoritative, and the year is worked out from its batch (the page's class line is only the fallback).
    const year = currentYearFromUsn(usn) ?? details.current_year ?? 0;
    details.usn = usn;
    details.current_year = year;
    update.name = details.name;
    update.currentYear = year;
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

  return { update, subjectsCount, examHistoryCount, timings: { ...timings, parseMs } };
}

/**
 * Ported from MSR-Insight's `scrapeAndSyncStudent()`: scrapes the portal, normalizes the result,
 * and writes it onto the student row — including re-encrypting the PIN that was actually used, so
 * future instant-logins/updates can reuse it.
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
  /** Decrypted per-student Browserless.io token, passed through to the portal login. */
  browserlessToken: string,
  scope: ScrapeJobScope = "full",
  onProgress?: (msg: string) => Promise<void>,
): Promise<ScrapeAndSyncResult> {
  const { update, subjectsCount, examHistoryCount, timings } = await scrapeStudentUpdate(
    usn,
    dob,
    authType,
    plainPin,
    browserlessToken,
    scope,
    onProgress,
  );

  const tDbStart = Date.now();
  await db
    .update(students)
    .set({ ...update, encryptedPin: encryptText(plainPin) })
    .where(eq(students.usn, usn));
  const dbMs = Date.now() - tDbStart;

  return { subjectsCount, examHistoryCount, timings: { ...timings, dbMs } };
}
