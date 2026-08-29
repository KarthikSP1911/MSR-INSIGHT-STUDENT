ALTER TABLE "scrape_jobs" ADD COLUMN "encrypted_browserless_token" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "encrypted_browserless_token" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "browserless_token_valid" boolean DEFAULT true NOT NULL;