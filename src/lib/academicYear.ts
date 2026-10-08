/**
 * A student's current year, worked out from the batch encoded in their USN (1MS23IS051 is the 2023 batch), so it
 * does not depend on anything scraped from the portal's page layout. That layout changed on 2026-10-07 (the first
 * `<h2>` became "Attendance" and a notice became the first `<p>`), which silently reset every student's year to 0.
 *
 * Rules, mirrored by `year_from_usn()` in drizzle/0012_backfill_current_year_from_usn.sql (a test keeps them equal):
 *  - the academic year starts on 1 August (UTC) and is named by the calendar year it starts in;
 *  - year = academic year - batch year + 1, so the 2023 batch is in year 4 during 2026-27;
 *  - a lateral-entry student (serial 4xx) joins in the 2nd year, so for them it is + 2;
 *  - years 1 to 4 are the programme itself; a student still on the rolls after it (batch 22 and earlier during
 *    2026-27) is a senior and is year 5, whatever their batch, so seniors are counted apart from final-years;
 *  - a batch that has not started yet counts as year 1.
 */

/** 1-based month the academic year starts in. */
export const ACADEMIC_YEAR_START_MONTH = 8;
export const PROGRAMME_YEARS = 4;
/** The stored year for a student past the 4-year programme. */
export const SENIOR_YEAR = PROGRAMME_YEARS + 1;

// 1 digit, 2-letter college code, 2-digit batch, 2-3 letter branch, 3-digit serial, optional temporary "-T" suffix.
const USN_PARTS = /^\d[A-Z]{2}(\d{2})[A-Z]{2,3}(\d)\d{2}(?:-T)?$/;

/** The calendar year the academic year containing `now` started in. */
export function academicYearStart(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= ACADEMIC_YEAR_START_MONTH ? year : year - 1;
}

/** 1-4, or 5 for a senior; null when `usn` is not shaped like a USN (the caller falls back to something else). */
export function currentYearFromUsn(usn: string, now: Date = new Date()): number | null {
  const match = USN_PARTS.exec(usn.trim().toUpperCase());
  if (!match) return null;

  const batchYear = 2000 + Number(match[1]);
  const isLateralEntry = match[2] === "4";
  const year = academicYearStart(now) - batchYear + (isLateralEntry ? 2 : 1);
  return Math.min(SENIOR_YEAR, Math.max(1, year));
}
