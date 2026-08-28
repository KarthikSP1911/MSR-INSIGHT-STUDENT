CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usn" text NOT NULL,
	"dob" text NOT NULL,
	"auth_type" text,
	"encrypted_pin" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"result_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "students" (
	"usn" text PRIMARY KEY NOT NULL,
	"name" text,
	"dob" text,
	"phone" text,
	"email" text,
	"current_year" integer DEFAULT 0 NOT NULL,
	"auth_type" text,
	"encrypted_pin" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_usn_students_usn_fk" FOREIGN KEY ("usn") REFERENCES "public"."students"("usn") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_created_at_idx" ON "scrape_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "scrape_jobs_usn_status_idx" ON "scrape_jobs" USING btree ("usn","status");