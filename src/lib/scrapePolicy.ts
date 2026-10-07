import type { Student, ScrapeJobScope } from "@/lib/db/schema";
import { hasScrapedData } from "@/lib/studentDetails";

const HOUR_MS = 60 * 60 * 1000;

/** Attendance and CIE marks change daily, so a login after this long refreshes them. */
export const CURRENT_STALE_MS = 24 * HOUR_MS;

/** Exam results change once per exam cycle, so they are refreshed far less often. */
export const EXAM_STALE_MS = 7 * 24 * HOUR_MS;

/** Minimum gap between a manual refresh and the next one for the same data. */
export const MANUAL_COOLDOWN_MS = 60 * 1000;

/** After a failed sync, logins stop auto-syncing for this long (a wrong saved PIN must not hammer the portal). */
export const FAILED_SYNC_BACKOFF_MS = 15 * 60 * 1000;

function isOlderThan(timestamp: string | Date | null | undefined, maxAgeMs: number, now: number): boolean {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) || now - time >= maxAgeMs;
}

/**
 * What a login should refresh, or `null` when everything is fresh enough to just open the dashboard.
 * Both parts stale (a first login, or a long absence) is one `full` job, because only one job per
 * student can be active at a time.
 */
export function scopeForStaleness(
  student: Pick<Student, "details" | "examHistoryUpdatedAt">,
  now: number = Date.now(),
): ScrapeJobScope | null {
  const currentStale = !hasScrapedData(student.details) || isOlderThan(student.details?.last_updated, CURRENT_STALE_MS, now);
  const examStale = isOlderThan(student.examHistoryUpdatedAt, EXAM_STALE_MS, now);

  if (currentStale && examStale) return "full";
  if (currentStale) return "current";
  if (examStale) return "exam_history";
  return null;
}

/** When the next manual refresh of the given data is allowed, or `null` if it is allowed now. */
export function nextManualRefreshAt(lastRefreshed: string | Date | null | undefined, now: number = Date.now()): Date | null {
  if (!lastRefreshed) return null;
  const last = new Date(lastRefreshed).getTime();
  if (Number.isNaN(last)) return null;
  const next = last + MANUAL_COOLDOWN_MS;
  return next > now ? new Date(next) : null;
}
