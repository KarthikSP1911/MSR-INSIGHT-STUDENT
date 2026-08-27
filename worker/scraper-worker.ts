import "dotenv/config";
import { eq } from "drizzle-orm";
import puppeteer, { type Browser } from "puppeteer";

import { decryptText } from "@/lib/auth/crypto";
import { getWorkerDb, type WorkerDb } from "@/lib/db/workerClient";
import { scrapeJobs } from "@/lib/db/schema";
import { scrapeAndSyncStudent } from "@/lib/scraper/scrapeAndSync";

/**
 * Standalone scraper worker. Runs Puppeteer against the college portal
 * outside the Next.js request/response cycle — polls the Postgres-backed
 * scrape_jobs queue (no Redis/RabbitMQ in this stack) and processes jobs one
 * at a time.
 *
 * Keeps a single Chromium instance alive across jobs (one `newPage()` per
 * job, not one `launch()` per job) — browser boot is the most expensive part
 * of each scrape, so reusing it is the biggest win available here.
 *
 * Run alongside `npm run dev` with `npm run worker`.
 */

const POLL_INTERVAL_MS = 3000;

async function getOrLaunchBrowser(current: Browser | null): Promise<Browser> {
  if (current && current.connected) return current;
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function claimNextJob(db: WorkerDb) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scrapeJobs)
      .where(eq(scrapeJobs.status, "pending"))
      .orderBy(scrapeJobs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });

    if (!job) return null;

    await tx
      .update(scrapeJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(scrapeJobs.id, job.id));

    return job;
  });
}

async function processJob(db: WorkerDb, browser: Browser, job: Awaited<ReturnType<typeof claimNextJob>>) {
  if (!job) return;

  console.log(`[scraper-worker] processing job ${job.id} (${job.trigger}) for ${job.usn}`);

  try {
    if (!job.authType || !job.encryptedPin) {
      throw new Error("Job is missing authType/PIN — cannot scrape.");
    }
    const plainPin = decryptText(job.encryptedPin);
    if (!plainPin) {
      throw new Error("Failed to decrypt PIN for scrape job.");
    }

    const result = await scrapeAndSyncStudent(db, job.usn, job.dob, job.authType, plainPin, browser);

    await db
      .update(scrapeJobs)
      .set({
        status: "success",
        finishedAt: new Date(),
        resultSummary: {
          subjectsCount: result.subjectsCount,
          examHistoryCount: result.examHistoryCount,
        },
      })
      .where(eq(scrapeJobs.id, job.id));

    console.log(`[scraper-worker] job ${job.id} succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scrape error";
    console.error(`[scraper-worker] job ${job.id} failed:`, message);

    await db
      .update(scrapeJobs)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(scrapeJobs.id, job.id));
  }
}

async function main() {
  const db = getWorkerDb();
  let running = true;
  let browser: Browser | null = null;

  const shutdown = () => {
    console.log("[scraper-worker] shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[scraper-worker] started, polling scrape_jobs every %dms", POLL_INTERVAL_MS);

  try {
    while (running) {
      const job = await claimNextJob(db);
      if (job) {
        // Launched lazily (not before the loop) so an idle worker never pays Chromium's
        // boot cost, and relaunched automatically if a previous job left it disconnected.
        browser = await getOrLaunchBrowser(browser);
        await processJob(db, browser, job);
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[scraper-worker] fatal error:", error);
  process.exit(1);
});
