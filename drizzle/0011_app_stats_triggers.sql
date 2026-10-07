-- Keeps "app_stats" in step with "students" and "scrape_jobs" using triggers, so counts never need a table scan
-- and application code needs no extra round trip. Designed so that stats can never get in the way of real work:
--   * AFTER triggers: they run once the student/job row change is already done.
--   * The student trigger only fires for an UPDATE when "current_year" actually changes. A normal sync rewrites
--     that column with the same value, which must not cost anything.
--   * Job creation has NO trigger at all. Jobs are only counted when they are deleted (the 7-day purge, or a
--     cascade from deleting a student), and then with ONE write for the whole batch, however many rows went.
--   * Each trigger swallows its own errors (a warning is logged) and may wait at most 250ms for a counter row,
--     so a stats problem is skipped rather than failing or stalling the write. "refresh_app_stats()" repairs drift.
--   * Counter changes go in as ONE statement in key order, so two writers can never lock the same pair of rows
--     in opposite orders (deadlock).
-- Total scrape jobs ever = "scrape_jobs_purged" (jobs already deleted, folded in per batch) + the jobs still in
-- "scrape_jobs" (at most a week's worth, so counting them is cheap). The "app_stats_summary" view adds them up.

-- Adds each delta to its counter, creating the counter on first use. The value is clamped at 0 when updating.
CREATE FUNCTION "app_stats_bump"("keys" text[], "deltas" bigint[]) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO "app_stats" ("key", "value", "updated_at")
  SELECT t."key", t."delta", now()
  FROM unnest("keys", "deltas") AS t("key", "delta")
  ORDER BY t."key"
  ON CONFLICT ("key") DO UPDATE
    SET "value" = GREATEST("app_stats"."value" + EXCLUDED."value", 0),
        "updated_at" = now();
$$;--> statement-breakpoint

CREATE FUNCTION "students_stats_trigger"() RETURNS trigger
LANGUAGE plpgsql
SET lock_timeout = '250ms'
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM "app_stats_bump"(ARRAY['students_total', 'students_year_' || NEW."current_year"], ARRAY[1, 1]::bigint[]);
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM "app_stats_bump"(ARRAY['students_total', 'students_year_' || OLD."current_year"], ARRAY[-1, -1]::bigint[]);
    ELSE
      PERFORM "app_stats_bump"(ARRAY['students_year_' || OLD."current_year", 'students_year_' || NEW."current_year"], ARRAY[-1, 1]::bigint[]);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_stats was not updated after % on students: %', TG_OP, SQLERRM;
  END;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Statement-level: runs once per DELETE statement and reads the deleted rows from a transition table, so purging
-- a thousand jobs is one counter write, and a DELETE that removes nothing writes nothing.
CREATE FUNCTION "scrape_jobs_purged_trigger"() RETURNS trigger
LANGUAGE plpgsql
SET lock_timeout = '250ms'
AS $$
DECLARE
  "removed" bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO "removed" FROM "deleted_jobs";
    IF "removed" > 0 THEN
      PERFORM "app_stats_bump"(ARRAY['scrape_jobs_purged'], ARRAY["removed"]);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_stats was not updated after DELETE on scrape_jobs: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Recomputes the student counters from the table, for repairing drift. It cannot rebuild "scrape_jobs_purged":
-- the jobs it counts no longer exist.
CREATE FUNCTION "refresh_app_stats"() RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO "app_stats" ("key", "value", "updated_at")
  SELECT c."key", c."value", now()
  FROM (
    SELECT 'students_total' AS "key", count(*)::bigint AS "value" FROM "students"
    UNION ALL
    SELECT 'students_year_' || "current_year", count(*)::bigint FROM "students" GROUP BY "current_year"
  ) AS c
  ORDER BY c."key"
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now();

  UPDATE "app_stats" SET "value" = 0, "updated_at" = now()
  WHERE "key" LIKE 'students\_year\_%'
    AND "value" <> 0
    AND "key" NOT IN (SELECT 'students_year_' || "current_year" FROM "students");
$$;--> statement-breakpoint

CREATE TRIGGER "students_stats_insert" AFTER INSERT ON "students"
  FOR EACH ROW EXECUTE FUNCTION "students_stats_trigger"();--> statement-breakpoint
CREATE TRIGGER "students_stats_delete" AFTER DELETE ON "students"
  FOR EACH ROW EXECUTE FUNCTION "students_stats_trigger"();--> statement-breakpoint
CREATE TRIGGER "students_stats_year_change" AFTER UPDATE OF "current_year" ON "students"
  FOR EACH ROW WHEN (OLD."current_year" IS DISTINCT FROM NEW."current_year")
  EXECUTE FUNCTION "students_stats_trigger"();--> statement-breakpoint
CREATE TRIGGER "scrape_jobs_stats_delete" AFTER DELETE ON "scrape_jobs"
  REFERENCING OLD TABLE AS "deleted_jobs"
  FOR EACH STATEMENT EXECUTE FUNCTION "scrape_jobs_purged_trigger"();--> statement-breakpoint

-- Every counter at a glance, with the job total worked out: purged + still stored.
CREATE VIEW "app_stats_summary" AS
SELECT "key", "value" FROM "app_stats" WHERE "key" <> 'scrape_jobs_purged'
UNION ALL
SELECT 'scrape_jobs_total',
       COALESCE((SELECT "value" FROM "app_stats" WHERE "key" = 'scrape_jobs_purged'), 0)
         + (SELECT count(*) FROM "scrape_jobs");--> statement-breakpoint

-- Backfill from the existing students. The triggers already exist and every value is absolute rather than an
-- increment, so a row written while this runs cannot be counted twice. Years 0-4 always have a row (even at 0).
-- No job backfill is needed: the jobs that exist now are counted live, and none have been purged yet.
INSERT INTO "app_stats" ("key", "value") VALUES
  ('students_total', 0),
  ('students_year_0', 0),
  ('students_year_1', 0),
  ('students_year_2', 0),
  ('students_year_3', 0),
  ('students_year_4', 0),
  ('scrape_jobs_purged', 0)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
SELECT "refresh_app_stats"();
