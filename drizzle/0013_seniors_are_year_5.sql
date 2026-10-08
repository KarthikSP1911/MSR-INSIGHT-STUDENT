-- Students past the 4-year programme (batch 22 and earlier during 2026-27) are seniors and get year 5, instead of
-- being lumped in with the final-year students at year 4. 0012 held every year to 1-4; this replaces that rule and
-- applies it. 0012 itself is left as it was applied.
--
-- Safety: like 0012, the only write to "students" is "current_year" (not "updated_at" or any other column), only for
-- rows whose year actually differs, and a USN that does not parse is left alone. A second run changes nothing.
-- Kept equal to currentYearFromUsn() in src/lib/academicYear.ts by a test.

CREATE OR REPLACE FUNCTION "year_from_usn"("usn" text, "as_of" timestamptz DEFAULT now()) RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim("usn")) ~ '^[0-9][A-Z]{2}[0-9]{2}[A-Z]{2,3}[0-9]{3}(-T)?$' THEN
      LEAST(5, GREATEST(1,
        (CASE WHEN extract(month FROM "as_of" AT TIME ZONE 'UTC') >= 8
              THEN extract(year FROM "as_of" AT TIME ZONE 'UTC')
              ELSE extract(year FROM "as_of" AT TIME ZONE 'UTC') - 1 END)::int
        - (2000 + substring(upper(btrim("usn")) from 4 for 2)::int)
        + CASE WHEN upper(btrim("usn")) ~ '^[0-9][A-Z]{2}[0-9]{2}[A-Z]{2,3}4[0-9]{2}(-T)?$' THEN 2 ELSE 1 END))
  END
$$;--> statement-breakpoint

-- Years 0-5 always have a counter, even at zero.
INSERT INTO "app_stats" ("key", "value") VALUES ('students_year_5', 0) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

SELECT "refresh_student_years"();--> statement-breakpoint

-- Absolute recount of the student counters, so they are exact even if a counter update was ever skipped.
SELECT "refresh_app_stats"();
