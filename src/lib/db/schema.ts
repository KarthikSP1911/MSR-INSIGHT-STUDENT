import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { ExamHistoryEntry, StudentDetails } from "@/lib/studentDetails";

/**
 * A student row. The scrape is stored in two independently refreshed parts, because the portal's
 * data changes at very different rates:
 *  - `details` (current semester): { usn, name, class_details, last_updated, current_year,
 *    subjects: [{ code, name, marks, attendance, attendance_details, assessments }] } — attendance
 *    and CIE marks change daily, refreshed at most every 24h on login (see scrapePolicy.ts).
 *  - `examHistory` + `cgpa` (stamped by `examHistoryUpdatedAt`): results change once per exam
 *    cycle, so they are fetched on first login, on demand, and when older than 7 days.
 * The portal's Placement section is deliberately never scraped, parsed, or stored —
 * see portalScraper.ts/htmlParser.ts — so no `placement` key exists here.
 */
export const students = pgTable("students", {
  usn: text("usn").primaryKey(),
  name: text("name"),
  dob: text("dob"), // "DD-MM-YYYY", matches the source portal's format
  phone: text("phone"),
  email: text("email"),
  currentYear: integer("current_year").notNull().default(0),
  authType: text("auth_type"), // "Father's Mobile" | "Mother's Mobile" | "ABC ID"
  encryptedPin: text("encrypted_pin"), // AES-256-GCM "iv:authTag:cipher" hex
  encryptedBrowserlessToken: text("encrypted_browserless_token"), // the student's own Browserless.io token, same encryption
  /** False once Browserless rejected the saved token; the next login asks for a fresh one. */
  browserlessTokenValid: boolean("browserless_token_valid").notNull().default(true),
  details: jsonb("details").$type<StudentDetails>().notNull().default({}),
  examHistory: jsonb("exam_history").$type<ExamHistoryEntry[]>().notNull().default([]),
  cgpa: text("cgpa"),
  examHistoryUpdatedAt: timestamp("exam_history_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;

export const scrapeJobTriggers = [
  "login",
  "manual_update",
  "requires_secondary_auth_retry",
] as const;
export type ScrapeJobTrigger = (typeof scrapeJobTriggers)[number];

export const scrapeJobStatuses = ["pending", "running", "success", "failed"] as const;
export type ScrapeJobStatus = (typeof scrapeJobStatuses)[number];

/**
 * What a job fetches and writes:
 *  - `current`: dashboard + per-course attendance + CIE pages -> `students.details`.
 *  - `exam_history`: only the exam-results page -> `students.examHistory` / `cgpa`.
 *  - `full`: both (first login). Each scope writes only its own columns, so there is nothing to merge.
 */
export const scrapeJobScopes = ["current", "exam_history", "full"] as const;
export type ScrapeJobScope = (typeof scrapeJobScopes)[number];

/**
 * A queued scrape request, claimed and run in-process by an API route
 * (src/lib/scraper/runJob.ts) rather than a standalone worker. `encryptedPin` is a snapshot of
 * the credential to use for this job, always encrypted at rest — never store the plaintext value,
 * even transiently, in this table.
 */
export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usn: text("usn")
      .notNull()
      .references(() => students.usn, { onDelete: "cascade" }),
    dob: text("dob").notNull(),
    authType: text("auth_type"),
    encryptedPin: text("encrypted_pin"),
    encryptedBrowserlessToken: text("encrypted_browserless_token"),
    trigger: text("trigger").notNull().$type<ScrapeJobTrigger>(),
    scope: text("scope").notNull().$type<ScrapeJobScope>().default("full"),
    status: text("status").notNull().$type<ScrapeJobStatus>().default("pending"),
    progress: text("progress"),
    error: text("error"),
    resultSummary: jsonb("result_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("scrape_jobs_status_created_at_idx").on(table.status, table.createdAt),
    index("scrape_jobs_usn_status_idx").on(table.usn, table.status),
    // Job coalescing: at most one pending/running job per USN, so a burst of
    // logins/refreshes for the same student reuses the in-flight job instead of
    // queuing duplicates the worker would redundantly scrape one after another.
    uniqueIndex("scrape_jobs_active_usn_idx")
      .on(table.usn)
      .where(sql`${table.status} IN ('pending', 'running')`),
  ],
);

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type NewScrapeJob = typeof scrapeJobs.$inferInsert;

/**
 * Running totals, so "how many students / jobs" never needs a table scan. One row per counter:
 *  - `students_total`: rows in `students`.
 *  - `students_year_<n>`: students whose `current_year` is n: 1-4 are the programme years, 5 is a senior (past
 *    the 4 years) and 0 means the year is not known (a USN that does not parse). See src/lib/academicYear.ts.
 *  - `scrape_jobs_purged`: jobs already deleted (the 7-day purge, or removed with their student). It is added to
 *    in ONE write per delete statement, never per job, and nothing happens when a job is created. Total jobs
 *    ever = this + the jobs still in `scrape_jobs`, which the `app_stats_summary` view reports as
 *    `scrape_jobs_total`.
 *
 * Maintained entirely by database triggers (see drizzle/0011_app_stats_triggers.sql), never by application
 * code: the triggers add no round trip, cannot drift from the write they follow, and are written so a stats
 * problem can never fail or noticeably delay a student or job write. `refresh_app_stats()` recomputes the
 * student counters from the table if they ever drift.
 */
export const appStats = pgTable("app_stats", {
  key: text("key").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
