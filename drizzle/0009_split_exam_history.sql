ALTER TABLE "students" ADD COLUMN "exam_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "cgpa" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "exam_history_updated_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: move exam history and CGPA out of the `details` blob into their own columns. The
-- timestamp reuses the old blob's last_updated, the best available proxy for when they were scraped.
UPDATE "students"
SET
  "exam_history" = CASE
    WHEN jsonb_typeof("details"->'exam_history') = 'array' THEN "details"->'exam_history'
    ELSE '[]'::jsonb
  END,
  "cgpa" = NULLIF(BTRIM("details"->>'cgpa'), ''),
  "exam_history_updated_at" = CASE
    WHEN jsonb_typeof("details"->'exam_history') = 'array' AND jsonb_exists("details", 'last_updated')
      THEN ("details"->>'last_updated')::timestamptz
    ELSE NULL
  END,
  "details" = "details" - 'exam_history' - 'cgpa'
WHERE jsonb_exists("details", 'exam_history') OR jsonb_exists("details", 'cgpa');--> statement-breakpoint
-- The old cheaper job scope `recurring` is now called `current`.
UPDATE "scrape_jobs" SET "scope" = 'current' WHERE "scope" = 'recurring';
