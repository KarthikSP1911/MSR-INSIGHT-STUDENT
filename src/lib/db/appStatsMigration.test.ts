import fs from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigration, createTestDb, migrationStatements } from "@/test/pgliteDb";

/**
 * Applying the app_stats migrations to a database that already holds students and jobs must change none of that
 * data, nor the shape of the two tables it lives in.
 */

const ADD_TABLE = "0010_add_app_stats.sql";
const ADD_TRIGGERS = "0011_app_stats_triggers.sql";

const details = JSON.stringify({ usn: "1MS23IS051", name: "Asha Rao", last_updated: "2026-09-30T10:00:00.000Z", subjects: [{ code: "23IS62", marks: 41, attendance: 88 }] });
const examHistory = JSON.stringify([{ semester: "Sem 5", sgpa: "8.5", credits_earned: "22", courses: [{ code: "X", grade: "A" }] }]);

/** A realistic spread: every year, a filled-in student, a bare placeholder, and jobs in every state. */
async function seed(pg: PGlite) {
  await pg.query(
    `INSERT INTO students (usn, name, dob, phone, email, current_year, auth_type, encrypted_pin, details, exam_history, cgpa, exam_history_updated_at, created_at, updated_at)
     VALUES
       ('1MS23IS051', 'Asha Rao', '19-11-2004', '9999999999', 'a@example.com', 3, 'Mother''s Mobile', 'aa11:bb22:cc33', $1::jsonb, $2::jsonb, '8.52', '2026-09-30T10:00:00Z', '2026-01-02T03:04:05Z', '2026-09-30T10:00:00Z'),
       ('1MS24CS010', 'Ravi', '01-02-2005', NULL, NULL, 2, 'ABC ID', 'dd44:ee55:ff66', '{"subjects":[]}'::jsonb, '[]'::jsonb, NULL, NULL, now(), now()),
       ('1MS25EC033', NULL, '03-04-2006', NULL, NULL, 1, NULL, NULL, '{}'::jsonb, '[]'::jsonb, NULL, NULL, now(), now()),
       ('1MS22ME001', 'Old Timer', '05-06-2003', NULL, NULL, 4, 'Father''s Mobile', 'g1:h2:i3', '{}'::jsonb, '[]'::jsonb, 'N/A', NULL, now(), now()),
       ('1MS26IS099-T', NULL, '07-08-2007', NULL, NULL, 0, NULL, NULL, '{}'::jsonb, '[]'::jsonb, NULL, NULL, now(), now())`,
    [details, examHistory],
  );
  await pg.query(
    `INSERT INTO scrape_jobs (usn, dob, auth_type, encrypted_pin, trigger, scope, status, progress, error, result_summary, created_at, started_at, finished_at)
     VALUES
       ('1MS23IS051', '19-11-2004', 'Mother''s Mobile', 'aa11:bb22:cc33', 'login', 'full', 'success', NULL, NULL, '{"subjectsCount":6,"loginMs":812}'::jsonb, '2026-09-30T10:00:00Z', '2026-09-30T10:00:01Z', '2026-09-30T10:00:20Z'),
       ('1MS23IS051', '19-11-2004', 'Mother''s Mobile', 'aa11:bb22:cc33', 'manual_update', 'current', 'failed', NULL, 'Portal down', '{"failureKind":"portal_unavailable"}'::jsonb, '2026-09-29T10:00:00Z', NULL, '2026-09-29T10:00:05Z'),
       ('1MS24CS010', '01-02-2005', 'ABC ID', 'dd44:ee55:ff66', 'login', 'current', 'running', 'Downloading attendance...', NULL, NULL, now(), now(), NULL),
       ('1MS25EC033', '03-04-2006', NULL, NULL, 'login', 'full', 'pending', NULL, NULL, NULL, now(), NULL, NULL)`,
  );
}

/** Everything about the two existing tables: every row as JSON, plus their columns, indexes and constraints. */
async function snapshot(pg: PGlite) {
  const rows = async (sql: string) => (await pg.query(sql)).rows;
  return {
    students: await rows(`SELECT to_jsonb(s) AS row FROM students s ORDER BY usn`),
    jobs: await rows(`SELECT to_jsonb(j) AS row FROM scrape_jobs j ORDER BY id`),
    columns: await rows(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_name IN ('students', 'scrape_jobs') ORDER BY table_name, ordinal_position`,
    ),
    indexes: await rows(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('students', 'scrape_jobs') ORDER BY indexname`),
    constraints: await rows(
      `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid IN ('students'::regclass, 'scrape_jobs'::regclass) ORDER BY conname`,
    ),
  };
}

const counters = async (pg: PGlite) => {
  const { rows } = await pg.query<{ key: string; value: number }>(`SELECT key, value::int AS value FROM app_stats_summary`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

/** SQL that could delete, rewrite or reshape the existing tables. No `\b` after the quote: it never matches there. */
const DESTRUCTIVE =
  /\b(TRUNCATE|DROP\s+(TABLE|COLUMN|SCHEMA|INDEX|CONSTRAINT)|DELETE\s+FROM|ALTER\s+TABLE|UPDATE\s+"(students|scrape_jobs)"|INSERT\s+INTO\s+"(students|scrape_jobs)")/i;

const EXPECTED_AFTER_BACKFILL = {
  students_total: 5,
  students_year_0: 1,
  students_year_1: 1,
  students_year_2: 1,
  students_year_3: 1,
  students_year_4: 1,
  scrape_jobs_total: 4,
};

describe("migrating a database that already has data", () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  let migrated: PGlite;

  beforeAll(async () => {
    migrated = (await createTestDb(ADD_TABLE)).pg;
    await seed(migrated);
    before = await snapshot(migrated);

    await applyMigration(migrated, ADD_TABLE);
    await applyMigration(migrated, ADD_TRIGGERS);
  });

  it("starts from the data it is supposed to protect", () => {
    expect(before.students).toHaveLength(5);
    expect(before.jobs).toHaveLength(4);
  });

  it("leaves every student and job row exactly as it was, down to each JSON value and timestamp", async () => {
    const after = await snapshot(migrated);

    expect(after.students).toEqual(before.students);
    expect(after.jobs).toEqual(before.jobs);
  });

  it("changes nothing about the two tables' columns, indexes or constraints", async () => {
    const after = await snapshot(migrated);

    expect(after.columns).toEqual(before.columns);
    expect(after.indexes).toEqual(before.indexes);
    expect(after.constraints).toEqual(before.constraints);
  });

  it("counts the existing rows correctly", async () => {
    expect(await counters(migrated)).toMatchObject(EXPECTED_AFTER_BACKFILL);
  });
});

describe("running the migrations again, or after an interruption", () => {
  it("is harmless when both migrations are applied a second time", async () => {
    const pg = (await createTestDb(ADD_TABLE)).pg;
    await seed(pg);
    await applyMigration(pg, ADD_TABLE);
    await applyMigration(pg, ADD_TRIGGERS);
    const once = await snapshot(pg);

    await applyMigration(pg, ADD_TABLE);
    await applyMigration(pg, ADD_TRIGGERS);

    expect(await snapshot(pg)).toEqual(once);
    expect(await counters(pg)).toMatchObject(EXPECTED_AFTER_BACKFILL);
  });

  const statementCount = migrationStatements(ADD_TRIGGERS).length;

  it.each([2, Math.floor(statementCount / 2), statementCount - 1])(
    "recovers when the trigger migration stopped after %i statements and is run again in full",
    async (completed) => {
      const pg = (await createTestDb(ADD_TABLE)).pg;
      await seed(pg);
      const original = await snapshot(pg);
      await applyMigration(pg, ADD_TABLE);
      for (const statement of migrationStatements(ADD_TRIGGERS).slice(0, completed)) await pg.exec(statement);

      await applyMigration(pg, ADD_TRIGGERS);

      expect(await snapshot(pg)).toEqual(original);
      expect(await counters(pg)).toMatchObject(EXPECTED_AFTER_BACKFILL);
    },
  );
});

/** The SQL blocks in DEPLOYMENT.md, so what the docs tell the operator to run is what is tested. */
const documentedSql = (marker: RegExp): string => {
  const blocks = [...fs.readFileSync(path.join(process.cwd(), "DEPLOYMENT.md"), "utf8").matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const block = blocks.find((b) => marker.test(b));
  if (!block) throw new Error(`No SQL block matching ${marker} in DEPLOYMENT.md`);
  return block;
};

describe("the SQL documented for the operator in DEPLOYMENT.md", () => {
  it("fingerprint query is valid and identical before and after the migrations", async () => {
    const fingerprint = documentedSql(/md5\(/);
    const pg = (await createTestDb(ADD_TABLE)).pg;
    await seed(pg);
    const beforeMigrating = (await pg.query(fingerprint)).rows;

    await applyMigration(pg, ADD_TABLE);
    await applyMigration(pg, ADD_TRIGGERS);

    expect(beforeMigrating).toHaveLength(2);
    expect((await pg.query(fingerprint)).rows).toEqual(beforeMigrating);
  });

  it("rollback removes only the stats, keeps every row, and lets the migrations be applied again", async () => {
    const rollback = documentedSql(/drop view if exists app_stats_summary/i);
    const pg = (await createTestDb(ADD_TABLE)).pg;
    await seed(pg);
    const original = await snapshot(pg);
    await applyMigration(pg, ADD_TABLE);
    await applyMigration(pg, ADD_TRIGGERS);
    // Stand-in for drizzle's bookkeeping table: twelve applied migrations, the last two being these.
    await pg.exec(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
                   INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'h' || n, n FROM generate_series(1, 12) n;`);

    await pg.exec(rollback);

    expect(await snapshot(pg)).toEqual(original);
    const { rows: leftover } = await pg.query<{ name: string }>(
      `SELECT relname AS name FROM pg_class WHERE relname IN ('app_stats', 'app_stats_summary')
       UNION ALL SELECT proname FROM pg_proc WHERE proname IN ('app_stats_bump', 'refresh_app_stats', 'students_stats_trigger', 'scrape_jobs_purged_trigger')
       UNION ALL SELECT tgname FROM pg_trigger WHERE tgname LIKE '%\\_stats\\_%'`,
    );
    expect(leftover).toEqual([]);
    const { rows: remaining } = await pg.query<{ n: number }>(`SELECT max(id)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(remaining[0].n).toBe(10);

    await applyMigration(pg, ADD_TABLE);
    await applyMigration(pg, ADD_TRIGGERS);
    expect(await counters(pg)).toMatchObject(EXPECTED_AFTER_BACKFILL);
    expect(await snapshot(pg)).toEqual(original);
  });
});

describe("the migration files themselves", () => {
  const sql = [ADD_TABLE, ADD_TRIGGERS]
    .map((file) => fs.readFileSync(path.join(process.cwd(), "drizzle", file), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  it("start with no byte-order mark, which would break the first statement", () => {
    for (const file of [ADD_TABLE, ADD_TRIGGERS]) {
      const bytes = fs.readFileSync(path.join(process.cwd(), "drizzle", file));
      expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it("contain nothing that can delete or rewrite existing data", () => {
    expect(sql).not.toMatch(DESTRUCTIVE);
  });

  it("have a destructive-SQL check that actually catches destructive SQL", () => {
    for (const bad of [
      'TRUNCATE "students";',
      'DROP TABLE "scrape_jobs";',
      'ALTER TABLE "students" DROP COLUMN "dob";',
      'DELETE FROM "students";',
      'UPDATE "students" SET "dob" = NULL;',
      'INSERT INTO "scrape_jobs" ("usn") VALUES (\'x\');',
    ]) {
      expect(bad).toMatch(DESTRUCTIVE);
    }
    for (const fine of [
      'INSERT INTO "app_stats" ("key") VALUES (\'k\');',
      'UPDATE "app_stats" SET "value" = 0;',
      'DROP TRIGGER IF EXISTS "students_stats_insert" ON "students";',
      'CREATE TRIGGER "t" AFTER DELETE ON "scrape_jobs"',
    ]) {
      expect(fine).not.toMatch(DESTRUCTIVE);
    }
  });

  it("only drop the triggers they create themselves", () => {
    const dropped = [...sql.matchAll(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+"(\w+)"/gi)].map((m) => m[1]);

    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((name) => /^(students|scrape_jobs)_stats_/.test(name))).toBe(true);
  });
});
