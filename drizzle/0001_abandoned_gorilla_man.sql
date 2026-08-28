ALTER TABLE "scrape_jobs" DROP CONSTRAINT "scrape_jobs_usn_students_usn_fk";
--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_usn_students_usn_fk" FOREIGN KEY ("usn") REFERENCES "public"."students"("usn") ON DELETE cascade ON UPDATE no action;