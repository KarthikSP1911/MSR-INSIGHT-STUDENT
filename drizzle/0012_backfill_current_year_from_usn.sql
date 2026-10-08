-- Sets every student's "current_year" from the batch in their USN (1MS23IS051 is the 2023 batch).
--
-- Why: on 2026-10-07 the portal's dashboard layout changed, the scraper stopped finding the class line, and every
-- sync since then wrote current_year = 0 (67 of 76 students at the time of writing). The code now works the year
-- out from the USN (src/lib/academicYear.ts); this brings the existing rows in line and keeps the per-year
-- counters in "app_stats" correct (the students_stats triggers fire for each changed row).
--
-- Safety: the UPDATE sets ONLY "current_year". It does not touch "updated_at" or any other column, only rows
-- whose year actually differs, and leaves a USN that does not look like one alone. It can be run again at any
-- time (a second run changes 0 rows).
--
-- Rules, kept equal to currentYearFromUsn() in TypeScript by a test:
--   academic year starts 1 August (UTC); year = academic year - batch + 1; lateral entry (serial 4xx) is + 2;
--   held to 1-4.
-- Re-run `select refresh_student_years();` each August so students who do not sign in move up a year.

CREATE OR REPLACE FUNCTION "year_from_usn"("usn" text, "as_of" timestamptz DEFAULT now()) RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim("usn")) ~ '^[0-9][A-Z]{2}[0-9]{2}[A-Z]{2,3}[0-9]{3}(-T)?$' THEN
      LEAST(4, GREATEST(1,
        (CASE WHEN extract(month FROM "as_of" AT TIME ZONE 'UTC') >= 8
              THEN extract(year FROM "as_of" AT TIME ZONE 'UTC')
              ELSE extract(year FROM "as_of" AT TIME ZONE 'UTC') - 1 END)::int
        - (2000 + substring(upper(btrim("usn")) from 4 for 2)::int)
        + CASE WHEN upper(btrim("usn")) ~ '^[0-9][A-Z]{2}[0-9]{2}[A-Z]{2,3}4[0-9]{2}(-T)?$' THEN 2 ELSE 1 END))
  END
$$;--> statement-breakpoint

-- Returns how many students changed.
CREATE OR REPLACE FUNCTION "refresh_student_years"("as_of" timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  "changed" integer;
BEGIN
  UPDATE "students" SET "current_year" = "year_from_usn"("usn", "as_of")
  WHERE "year_from_usn"("usn", "as_of") IS NOT NULL
    AND "current_year" IS DISTINCT FROM "year_from_usn"("usn", "as_of");
  GET DIAGNOSTICS "changed" = ROW_COUNT;
  RETURN "changed";
END;
$$;--> statement-breakpoint

SELECT "refresh_student_years"();--> statement-breakpoint

-- Absolute recount of the student counters, so they are exact even if a counter update was ever skipped.
SELECT "refresh_app_stats"();
