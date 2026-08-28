import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { StudentDetails } from "@/lib/studentDetails";

/**
 * A student row. `details` mirrors MSR-Insight's normalized scrape shape:
 * { usn, name, class_details, cgpa, last_updated, current_year,
 *   subjects: [{ code, name, marks, attendance, attendance_details, assessments }],
 *   exam_history: [{ semester, sgpa, credits_earned, courses }] }
 * The portal's Placement section is deliberately never scraped, parsed, or stored —
 * see puppeteerClient.ts/htmlParser.ts — so no `placement` key exists here.
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
  details: jsonb("details").$type<StudentDetails>().notNull().default({}),
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
 * A queued scrape request, picked up by the standalone worker (worker/scraper-worker.ts).
 * `encryptedPin` is a snapshot of the PIN to use for this job, always encrypted at rest —
 * never store the plaintext PIN, even transiently, in this table.
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
    trigger: text("trigger").notNull().$type<ScrapeJobTrigger>(),
    status: text("status").notNull().$type<ScrapeJobStatus>().default("pending"),
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
