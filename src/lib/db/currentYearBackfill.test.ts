import fs from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { currentYearFromUsn } from "@/lib/academicYear";
import { applyMigration, createTestDb } from "@/test/pgliteDb";

const BACKFILL = "0012_backfill_current_year_from_usn.sql";

const notice = "More than 85% of Attendance is must in each subject to write final exam.";

describe("year_from_usn() in SQL agrees with currentYearFromUsn() in TypeScript", () => {
  const usns = [
    ...["15", "18", "22", "23", "24", "25", "26", "27"].flatMap((batch) =>
      ["IS", "CS", "CSE", "ME"].flatMap((branch) => ["001", "051", "399", "401", "450", "499"].map((serial) => `1MS${batch}${branch}${serial}`)),
    ),
    "1MS25IS051-T", "1ms25is051", " 1MS25IS051 ", "1MS24IS401-T",
    "", "HELLO", "Attendance", "1MS23IS05", "1MS23IS0511", "MS23IS051", "1MS2IS051", "ODD-USN",
  ];
  const moments = [
    new Date(Date.UTC(2026, 0, 10)),
    new Date(Date.UTC(2026, 6, 31, 23, 59, 59)),
    new Date(Date.UTC(2026, 7, 1)),
    new Date(Date.UTC(2026, 9, 8)),
    new Date(Date.UTC(2027, 5, 30)),
    new Date(Date.UTC(2027, 7, 15)),
    new Date(Date.UTC(2029, 8, 1)),
  ];

  let pg: PGlite;
  beforeAll(async () => {
    pg = (await createTestDb()).pg;
  });

  it.each(moments.map((m) => [m.toISOString(), m] as const))("for every USN shape at %s", async (_label, moment) => {
    const { rows } = await pg.query<{ usn: string; year: number | null }>(
      `SELECT u AS usn, year_from_usn(u, $2::timestamptz) AS year FROM unnest($1::text[]) AS u`,
      [usns, moment.toISOString()],
    );

    expect(rows).toHaveLength(usns.length);
    for (const { usn, year } of rows) expect([usn, year]).toEqual([usn, currentYearFromUsn(usn, moment)]);
  });
});

describe(BACKFILL, () => {
  // Shaped like production on 2026-10-08: some students parsed before the layout change (right year), most since
  // (year 0, "Attendance" in details.usn, the notice as the class line).
  const rows: { usn: string; year: number; broken: boolean }[] = [
    ...["1MS23IS001", "1MS23IS002", "1MS23IS003"].map((usn) => ({ usn, year: 4, broken: false })),
    ...["1MS24CS010", "1MS24CS011"].map((usn) => ({ usn, year: 3, broken: false })),
    { usn: "1MS24IS401", year: 4, broken: false }, // lateral entry, parsed correctly
    ...["1MS23IS051", "1MS23IS052", "1MS23IS053"].map((usn) => ({ usn, year: 0, broken: true })),
    ...["1MS24IS101", "1MS24IS102"].map((usn) => ({ usn, year: 0, broken: true })),
    ...["1MS24IS402", "1MS24IS403"].map((usn) => ({ usn, year: 0, broken: true })), // lateral entry
    ...["1MS25IS101", "1MS25IS102", "1MS25IS103"].map((usn) => ({ usn, year: 0, broken: true })),
    ...["1MS26IS101", "1MS26IS102"].map((usn) => ({ usn, year: 0, broken: true })),
    ...["1MS22ME001", "1MS18IS007"].map((usn) => ({ usn, year: 0, broken: true })), // past the 4 years
    { usn: "1MS26IS201-T", year: 0, broken: true }, // temporary first-year USN
    { usn: "ODD-USN", year: 2, broken: false }, // not a USN: must be left alone
  ];

  async function seed(pg: PGlite) {
    for (const { usn, year, broken } of rows) {
      const details = JSON.stringify({
        usn: broken ? "Attendance" : usn,
        name: `Student ${usn}`,
        class_details: broken ? notice : "B.E-IS,  SEM 07,  SEC A",
        current_year: year,
        subjects: [{ code: "23IS62", marks: 40, attendance: 90 }],
      });
      await pg.query(
        `INSERT INTO students (usn, name, dob, phone, email, current_year, auth_type, encrypted_pin, details, exam_history, cgpa, exam_history_updated_at, created_at, updated_at)
         VALUES ($1, $2, '19-11-2004', '9999999999', 'x@example.com', $3, 'Mother''s Mobile', 'aa:bb:cc', $4::jsonb, '[{"semester":"Sem 5","sgpa":"8.5","credits_earned":"22","courses":[]}]'::jsonb, '8.52', '2026-09-30T10:00:00Z', '2026-01-02T03:04:05Z', '2026-10-07T05:06:09Z')`,
        [usn, `Student ${usn}`, year, details],
      );
    }
    await pg.query(
      `INSERT INTO scrape_jobs (usn, dob, auth_type, encrypted_pin, trigger, scope, status, result_summary, created_at)
       VALUES ('1MS23IS051', '19-11-2004', 'Mother''s Mobile', 'aa:bb:cc', 'login', 'full', 'success', '{"subjectsCount":6}'::jsonb, '2026-10-07T05:06:09Z')`,
    );
  }

  const everythingExceptYear = async (pg: PGlite) => ({
    students: (await pg.query(`SELECT to_jsonb(s) - 'current_year' AS row FROM students s ORDER BY usn`)).rows,
    jobs: (await pg.query(`SELECT to_jsonb(j) AS row FROM scrape_jobs j ORDER BY id`)).rows,
  });
  const yearsByUsn = async (pg: PGlite) =>
    Object.fromEntries((await pg.query<{ usn: string; current_year: number }>(`SELECT usn, current_year FROM students`)).rows.map((r) => [r.usn, r.current_year]));
  const counters = async (pg: PGlite) =>
    Object.fromEntries((await pg.query<{ key: string; value: number }>(`SELECT key, value::int AS value FROM app_stats`)).rows.map((r) => [r.key, r.value]));

  let before: Awaited<ReturnType<typeof everythingExceptYear>>;
  let yearsBefore: Record<string, number>;
  let migrated: PGlite;
  let changedByRerun: number;

  beforeAll(async () => {
    migrated = (await createTestDb(BACKFILL)).pg;
    await seed(migrated);
    before = await everythingExceptYear(migrated);
    yearsBefore = await yearsByUsn(migrated);

    await applyMigration(migrated, BACKFILL);
    changedByRerun = (await migrated.query<{ n: number }>(`SELECT refresh_student_years() AS n`)).rows[0].n;
  });

  it("sets every student's year from the batch in their USN", async () => {
    const years = await yearsByUsn(migrated);

    for (const { usn } of rows.filter((r) => r.usn !== "ODD-USN")) expect([usn, years[usn]]).toEqual([usn, currentYearFromUsn(usn)]);
    expect(Object.values(years).every((y) => y >= 1 && y <= 4)).toBe(true);
  });

  it("changes only the year: every other column of every student, and every job, is identical", async () => {
    expect(await everythingExceptYear(migrated)).toEqual(before);
  });

  it("does not touch updated_at, so 'last updated' keeps meaning the last sync", async () => {
    const { rows: stamped } = await migrated.query<{ updated_at: string }>(`SELECT DISTINCT updated_at::text FROM students`);

    expect(stamped.every((r) => r.updated_at.startsWith("2026-10-07"))).toBe(true);
  });

  it("leaves years that were already right, and a USN that does not parse, alone", async () => {
    const years = await yearsByUsn(migrated);

    expect(years["ODD-USN"]).toBe(yearsBefore["ODD-USN"]);
    for (const usn of ["1MS23IS001", "1MS24CS010", "1MS24IS401"]) expect(years[usn]).toBe(yearsBefore[usn]);
  });

  it("keeps the per-year counters in app_stats equal to what is in the students table", async () => {
    const actual = (await migrated.query<{ year: number; n: number }>(`SELECT current_year AS year, count(*)::int AS n FROM students GROUP BY 1`)).rows;
    const stored = await counters(migrated);

    expect(stored.students_total).toBe(rows.length);
    for (const year of [0, 1, 2, 3, 4]) expect([year, stored[`students_year_${year}`]]).toEqual([year, actual.find((r) => r.year === year)?.n ?? 0]);
  });

  it("is safe to run again: the second run changes nothing", () => {
    expect(changedByRerun).toBe(0);
  });

  it("counts how many students it changed when run for a later academic year", async () => {
    const nextAugust = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 7, 1)).toISOString();

    const { rows: result } = await migrated.query<{ n: number }>(`SELECT refresh_student_years($1::timestamptz) AS n`, [nextAugust]);

    expect(result[0].n).toBeGreaterThan(0);
  });
});

describe("the migration file itself", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "drizzle", BACKFILL), "utf8").replace(/--[^\n]*/g, "");

  it("starts with no byte-order mark", () => {
    expect([...fs.readFileSync(path.join(process.cwd(), "drizzle", BACKFILL)).subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes only the current_year column of students, and nothing destructive", () => {
    expect(sql).not.toMatch(/\b(TRUNCATE|DROP\s+(TABLE|COLUMN|SCHEMA)|DELETE\s+FROM|ALTER\s+TABLE|INSERT\s+INTO\s+"students")/i);
    const updates = [...sql.matchAll(/UPDATE\s+"(\w+)"\s+SET\s+([^;]*?)\s+WHERE/gi)];

    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe("students");
    // One assignment: commas inside a function call's parentheses do not separate columns.
    expect(updates[0][2].replace(/\([^()]*\)/g, "")).toMatch(/^"current_year"\s*=[^,]*$/);
  });
});
