import { beforeAll, describe, expect, it } from "vitest";

import { applyMigration, createTestDb, migrationFiles } from "@/test/pgliteDb";

const EXAM_SPLIT = "0009_split_exam_history.sql";

const legacyDetails = (extra: Record<string, unknown>) =>
  JSON.stringify({ usn: "X", name: "N", last_updated: "2026-09-01T10:00:00.000Z", subjects: [{ code: "A" }], ...extra });

describe("migrations", () => {
  it("apply cleanly from scratch", async () => {
    const { pg } = await createTestDb();
    const { rows } = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'students'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toEqual(expect.arrayContaining(["exam_history", "cgpa", "exam_history_updated_at"]));
    expect(columns).toEqual(expect.arrayContaining(["encrypted_browserless_token", "browserless_token_valid"]));
  });

  it("includes the exam history split", () => {
    expect(migrationFiles()).toContain(EXAM_SPLIT);
  });

  describe(EXAM_SPLIT, () => {
    async function migrateLegacyRows() {
      const { pg } = await createTestDb(EXAM_SPLIT);
      await pg.query(
        `INSERT INTO students (usn, details) VALUES ($1, $2::jsonb), ($3, $4::jsonb), ($5, $6::jsonb), ($7, $8::jsonb), ($9, $10::jsonb)`,
        [
          "WITH_HISTORY", legacyDetails({ cgpa: "8.12", exam_history: [{ semester: "Sem 1", sgpa: "8.0", credits_earned: "20", courses: [] }] }),
          "NO_HISTORY_KEYS", legacyDetails({}),
          "EMPTY_HISTORY", legacyDetails({ cgpa: "N/A", exam_history: [] }),
          "BLANK_CGPA", legacyDetails({ cgpa: "  ", exam_history: [{ semester: "Sem 1", sgpa: "7.0", credits_earned: "18", courses: [] }] }),
          "NOT_ARRAY", legacyDetails({ exam_history: null }),
        ],
      );
      await pg.query(
        `INSERT INTO scrape_jobs (usn, dob, trigger, scope, status) VALUES
           ('WITH_HISTORY', '01-01-2004', 'login', 'recurring', 'success'),
           ('NO_HISTORY_KEYS', '01-01-2004', 'login', 'full', 'success')`,
      );
      await applyMigration(pg, EXAM_SPLIT);

      const { rows } = await pg.query<{
        usn: string;
        history_len: number;
        cgpa: string | null;
        stamped: string | null;
        has_history_key: boolean;
        has_cgpa_key: boolean;
        has_subjects: boolean;
      }>(`SELECT usn,
                 jsonb_array_length(exam_history) AS history_len,
                 cgpa,
                 exam_history_updated_at::text AS stamped,
                 jsonb_exists(details, 'exam_history') AS has_history_key,
                 jsonb_exists(details, 'cgpa') AS has_cgpa_key,
                 jsonb_exists(details, 'subjects') AS has_subjects
          FROM students`);
      const scopes = await pg.query<{ usn: string; scope: string }>(`SELECT usn, scope FROM scrape_jobs`);
      return {
        byUsn: Object.fromEntries(rows.map((r) => [r.usn, r])),
        rows,
        scopeOf: (usn: string) => scopes.rows.find((r) => r.usn === usn)?.scope,
      };
    }

    let migrated: Awaited<ReturnType<typeof migrateLegacyRows>>;
    beforeAll(async () => {
      migrated = await migrateLegacyRows();
    });

    it("moves exam history and CGPA out of details and keeps everything else", async () => {
      const { byUsn, rows } = migrated;

      expect(byUsn.WITH_HISTORY).toMatchObject({ history_len: 1, cgpa: "8.12" });
      expect(byUsn.WITH_HISTORY.stamped).toContain("2026-09-01");
      expect(rows.every((r) => !r.has_history_key && !r.has_cgpa_key)).toBe(true);
      expect(rows.every((r) => r.has_subjects)).toBe(true);
    });

    it("leaves rows that never had exam data unstamped so the next login fetches them", async () => {
      const { byUsn } = migrated;
      expect(byUsn.NO_HISTORY_KEYS).toMatchObject({ history_len: 0, cgpa: null, stamped: null });
      expect(byUsn.NOT_ARRAY).toMatchObject({ history_len: 0, cgpa: null, stamped: null });
    });

    it("keeps a stored N/A CGPA, nulls a blank one, and stamps empty-but-present history", async () => {
      const { byUsn } = migrated;
      expect(byUsn.EMPTY_HISTORY).toMatchObject({ history_len: 0, cgpa: "N/A" });
      expect(byUsn.EMPTY_HISTORY.stamped).not.toBeNull();
      expect(byUsn.BLANK_CGPA).toMatchObject({ history_len: 1, cgpa: null });
    });

    it("renames the old recurring scope to current", async () => {
      const { scopeOf } = migrated;
      expect(scopeOf("WITH_HISTORY")).toBe("current");
      expect(scopeOf("NO_HISTORY_KEYS")).toBe("full");
    });
  });
});
