import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigration, createTestDb } from "@/test/pgliteDb";

const ADD_TABLE = "0010_add_app_stats.sql";
const ADD_TRIGGERS = "0011_app_stats_triggers.sql";

const table = async (pg: PGlite, from: "app_stats" | "app_stats_summary") => {
  const { rows } = await pg.query<{ key: string; value: number }>(`SELECT key, value::int AS value FROM ${from} ORDER BY key`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};
const counters = (pg: PGlite) => table(pg, "app_stats");
const summary = (pg: PGlite) => table(pg, "app_stats_summary");

const addStudent = (pg: PGlite, usn: string, year: number) =>
  pg.query(`INSERT INTO students (usn, current_year) VALUES ($1, $2)`, [usn, year]);

const addJob = (pg: PGlite, usn: string, status = "success") =>
  pg.query(`INSERT INTO scrape_jobs (usn, dob, trigger, status) VALUES ($1, '01-01-2004', 'login', $2)`, [usn, status]);

/** `count` finished jobs for one student, in a single statement. */
const addFinishedJobs = (pg: PGlite, usn: string, count: number) =>
  pg.query(
    `INSERT INTO scrape_jobs (usn, dob, trigger, status)
     SELECT $1, '01-01-2004', 'login', 'success' FROM generate_series(1, $2::int)`,
    [usn, count],
  );

// Building a database runs every migration, so non-destructive tests share one and reset it. Tests that break
// the database on purpose build their own with `isolated()`.
const isolated = async () => (await createTestDb()).pg;

const SEED_KEYS = ["students_total", "students_year_0", "students_year_1", "students_year_2", "students_year_3", "students_year_4", "scrape_jobs_purged"];

async function resetToFreshState(db: PGlite) {
  // Rows first (the triggers adjust the counters), then wipe and re-seed the counters themselves.
  await db.exec(`DELETE FROM scrape_jobs; DELETE FROM students; DELETE FROM app_stats;`);
  await db.exec(`INSERT INTO app_stats (key, value) VALUES ${SEED_KEYS.map((k) => `('${k}', 0)`).join(", ")}`);
}

let pg: PGlite;
beforeAll(async () => {
  pg = await isolated();
});
beforeEach(async () => {
  await resetToFreshState(pg);
});

describe("student counters", () => {
  it("start at zero, with a row for every year from 0 to 4", async () => {
    expect(await counters(pg)).toEqual({
      scrape_jobs_purged: 0,
      students_total: 0,
      students_year_0: 0,
      students_year_1: 0,
      students_year_2: 0,
      students_year_3: 0,
      students_year_4: 0,
    });
  });

  it("count students in total and per year as they are added", async () => {
    await addStudent(pg, "A", 3);
    await addStudent(pg, "B", 3);
    await addStudent(pg, "C", 1);
    await addStudent(pg, "D", 0);

    expect(await counters(pg)).toMatchObject({ students_total: 4, students_year_0: 1, students_year_1: 1, students_year_3: 2 });
  });

  it("create a counter for a year outside the seeded range", async () => {
    await addStudent(pg, "A", 5);

    expect((await counters(pg)).students_year_5).toBe(1);
  });

  it("move a student between years when current_year changes, leaving the total alone", async () => {
    await addStudent(pg, "A", 0);
    await pg.query(`UPDATE students SET current_year = 3 WHERE usn = 'A'`);

    expect(await counters(pg)).toMatchObject({ students_total: 1, students_year_0: 0, students_year_3: 1 });
  });

  it("are not touched at all by an update that leaves current_year unchanged", async () => {
    await addStudent(pg, "A", 3);
    const before = await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`);

    // What every sync does: rewrite the same year along with the other columns.
    await pg.query(`UPDATE students SET current_year = 3, name = 'Asha', details = '{"subjects":[1]}'::jsonb WHERE usn = 'A'`);
    await pg.query(`UPDATE students SET name = 'Asha R' WHERE usn = 'A'`);

    expect((await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`)).rows).toEqual(before.rows);
  });

  it("drop when a student is deleted", async () => {
    await addStudent(pg, "A", 2);
    await addStudent(pg, "B", 2);
    await pg.query(`DELETE FROM students WHERE usn = 'A'`);

    expect(await counters(pg)).toMatchObject({ students_total: 1, students_year_2: 1 });
  });

  it("ignore an insert that ON CONFLICT DO NOTHING skips", async () => {
    await addStudent(pg, "A", 1);
    await pg.query(`INSERT INTO students (usn, current_year) VALUES ('A', 1) ON CONFLICT (usn) DO NOTHING`);

    expect(await counters(pg)).toMatchObject({ students_total: 1, students_year_1: 1 });
  });
});

describe("scrape job totals", () => {
  beforeEach(async () => {
    await addStudent(pg, "A", 1);
  });

  it("do not write to app_stats when jobs are created or change status", async () => {
    const before = await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`);

    await addJob(pg, "A", "pending");
    await pg.query(`UPDATE scrape_jobs SET status = 'running'`);
    await pg.query(`UPDATE scrape_jobs SET status = 'success', progress = 'done'`);
    await addJob(pg, "A", "failed");

    expect((await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`)).rows).toEqual(before.rows);
  });

  it("still report every job through the summary view while none have been purged", async () => {
    await addJob(pg, "A");
    await addJob(pg, "A", "failed");

    expect(await summary(pg)).toMatchObject({ scrape_jobs_total: 2 });
    expect((await counters(pg)).scrape_jobs_purged).toBe(0);
  });

  it("add a whole purge to the counter at once, and the total keeps counting them", async () => {
    await addFinishedJobs(pg, "A", 50);
    await addJob(pg, "A", "pending");

    await pg.query(`DELETE FROM scrape_jobs WHERE status IN ('success', 'failed')`);

    expect((await counters(pg)).scrape_jobs_purged).toBe(50);
    expect(await summary(pg)).toMatchObject({ scrape_jobs_total: 51 });
  });

  it("make a single counter write for a batch, however many jobs it removes", async () => {
    const own = await isolated();
    await addStudent(own, "A", 1);
    await addFinishedJobs(own, "A", 100);
    // Logs every write to app_stats, so the number of counter writes can be counted exactly.
    await own.exec(`
      CREATE TABLE bump_log (key text);
      CREATE FUNCTION log_bump() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO bump_log VALUES (NEW.key); RETURN NULL; END $$;
      CREATE TRIGGER log_bump AFTER INSERT OR UPDATE ON app_stats FOR EACH ROW EXECUTE FUNCTION log_bump();
    `);

    await own.query(`DELETE FROM scrape_jobs`);

    const { rows } = await own.query<{ key: string }>(`SELECT key FROM bump_log`);
    expect(rows).toEqual([{ key: "scrape_jobs_purged" }]);
    expect((await counters(own)).scrape_jobs_purged).toBe(100);
  });

  it("write nothing when a delete removes no jobs", async () => {
    await addJob(pg, "A", "pending");
    const before = await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`);

    await pg.query(`DELETE FROM scrape_jobs WHERE status = 'success'`);

    expect((await pg.query(`SELECT key, value, updated_at FROM app_stats ORDER BY key`)).rows).toEqual(before.rows);
  });

  it("count jobs that disappear when their student is deleted, so the total does not drop", async () => {
    await addJob(pg, "A");
    await pg.query(`DELETE FROM students WHERE usn = 'A'`);

    expect((await counters(pg)).scrape_jobs_purged).toBe(1);
    expect(await summary(pg)).toMatchObject({ scrape_jobs_total: 1 });
  });

  it("do not count a job insert refused by the one-active-job-per-student rule", async () => {
    await addJob(pg, "A", "pending");
    await expect(addJob(pg, "A", "pending")).rejects.toThrow();

    expect(await summary(pg)).toMatchObject({ scrape_jobs_total: 1 });
  });
});

describe("app_stats_summary", () => {
  it("lists the student counters unchanged and replaces the purge counter with the job total", async () => {
    await addStudent(pg, "A", 2);

    const all = await summary(pg);

    expect(all).toMatchObject({ students_total: 1, students_year_2: 1, scrape_jobs_total: 0 });
    expect(all).not.toHaveProperty("scrape_jobs_purged");
  });
});

describe("a stats problem never gets in the way of the real write", () => {
  it("lets students and jobs be written and removed even if the stats table is gone", async () => {
    const own = await isolated();
    await own.query(`DROP TABLE app_stats CASCADE`);

    await expect(addStudent(own, "A", 1)).resolves.toBeDefined();
    await expect(addJob(own, "A")).resolves.toBeDefined();
    await expect(own.query(`UPDATE students SET current_year = 2 WHERE usn = 'A'`)).resolves.toBeDefined();
    await expect(own.query(`DELETE FROM scrape_jobs`)).resolves.toBeDefined();
    await expect(own.query(`DELETE FROM students WHERE usn = 'A'`)).resolves.toBeDefined();
  });

  it("lets writes through when a counter update is rejected", async () => {
    const own = await isolated();
    // NOT VALID: existing (seeded) rows are not checked, but every new or updated counter row is, and fails.
    await own.query(`ALTER TABLE app_stats ADD CONSTRAINT stats_must_be_negative CHECK (value < 0) NOT VALID`);

    await expect(addStudent(own, "A", 1)).resolves.toBeDefined();
    await addFinishedJobs(own, "A", 3);
    await expect(own.query(`DELETE FROM scrape_jobs`)).resolves.toBeDefined();

    expect((await own.query<{ usn: string }>(`SELECT usn FROM students`)).rows).toEqual([{ usn: "A" }]);
    expect((await own.query(`SELECT 1 FROM scrape_jobs`)).rows).toHaveLength(0);
  });
});

describe("refresh_app_stats()", () => {
  it("repairs drifted student counters, including a year nobody is in any more", async () => {
    await addStudent(pg, "A", 2);
    await addStudent(pg, "B", 3);
    await pg.query(`UPDATE app_stats SET value = 99 WHERE key IN ('students_total', 'students_year_2', 'students_year_4')`);

    await pg.query(`SELECT refresh_app_stats()`);

    expect(await counters(pg)).toMatchObject({ students_total: 2, students_year_2: 1, students_year_3: 1, students_year_4: 0 });
  });

  it("leaves the purged-jobs counter alone", async () => {
    await addStudent(pg, "A", 1);
    await addFinishedJobs(pg, "A", 4);
    await pg.query(`DELETE FROM scrape_jobs`);

    await pg.query(`SELECT refresh_app_stats()`);

    expect((await counters(pg)).scrape_jobs_purged).toBe(4);
  });
});

describe(ADD_TRIGGERS, () => {
  it("backfills the student counters and counts the jobs that already exist", async () => {
    const legacy = (await createTestDb(ADD_TABLE)).pg;
    await legacy.query(`INSERT INTO students (usn, current_year) VALUES ('A', 1), ('B', 1), ('C', 4), ('D', 0)`);
    await legacy.query(`INSERT INTO scrape_jobs (usn, dob, trigger, status) VALUES ('A', '01-01-2004', 'login', 'success'), ('B', '01-01-2004', 'login', 'failed')`);

    await applyMigration(legacy, ADD_TABLE);
    await applyMigration(legacy, ADD_TRIGGERS);

    expect(await counters(legacy)).toMatchObject({
      students_total: 4,
      students_year_0: 1,
      students_year_1: 2,
      students_year_2: 0,
      students_year_4: 1,
      scrape_jobs_purged: 0,
    });
    expect(await summary(legacy)).toMatchObject({ scrape_jobs_total: 2 });
  });
});
