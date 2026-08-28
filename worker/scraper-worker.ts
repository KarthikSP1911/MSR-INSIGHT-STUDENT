import "dotenv/config";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import puppeteer, { type Browser } from "puppeteer";

import { decryptText } from "@/lib/auth/crypto";
import { getWorkerDb, type WorkerDb } from "@/lib/db/workerClient";
import { scrapeJobs } from "@/lib/db/schema";
import { scrapeAndSyncStudent } from "@/lib/scraper/scrapeAndSync";
import { PUPPETEER_LAUNCH_ARGS } from "@/lib/scraper/puppeteerClient";

/**
 * Standalone scraper worker. Runs Puppeteer against the college portal
 * outside the Next.js request/response cycle — polls the Postgres-backed
 * scrape_jobs queue (no Redis/RabbitMQ in this stack) and processes jobs
 * across a small number of concurrent slots, each claiming and scraping one
 * job at a time.
 *
 * Keeps a single Chromium instance alive across jobs (one `newPage()` per
 * job, not one `launch()` per job) — browser boot is the most expensive part
 * of each scrape, so reusing it is the biggest win available here. All
 * concurrent slots share that one browser instance (Puppeteer supports
 * multiple concurrent pages on one browser natively).
 *
 * Run alongside `npm run dev` with `npm run worker`.
 */

/** Safety-net poll interval — a `LISTEN`/`NOTIFY` wake-up (below) normally fires long before this elapses. */
const POLL_INTERVAL_MS = 3000;
/** Concurrent claim+scrape slots; `claimNextJob`'s `FOR UPDATE SKIP LOCKED` already makes this safe. */
const CONCURRENT_SLOTS = Number(process.env.SCRAPER_WORKER_CONCURRENCY) || 3;

// A scrape's own internal timeouts (nav/selector waits in puppeteerClient.ts) sum to well
// under this in the worst case, so anything past it means Chromium itself has wedged rather
// than the portal being slow — see JOB_TIMEOUT_MS usage in processJob below.
const JOB_TIMEOUT_MS = 4 * 60 * 1000;
// Bounds every individual CDP round-trip (evaluate/content/cookies/close/...), none of which
// otherwise have a timeout of their own — without this, an unresponsive Chromium process can
// leave one of those calls (and the job awaiting it) hanging indefinitely.
const PROTOCOL_TIMEOUT_MS = 2 * 60 * 1000;

let sharedBrowser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;

/** Single-flight browser launch/reuse shared by every concurrent slot — concurrent callers await the same in-flight launch instead of racing to start two. */
async function getOrLaunchBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  if (!browserLaunch) {
    browserLaunch = puppeteer
      .launch({ headless: true, args: PUPPETEER_LAUNCH_ARGS, protocolTimeout: PROTOCOL_TIMEOUT_MS })
      .then((b) => {
        sharedBrowser = b;
        browserLaunch = null;
        return b;
      });
  }
  return browserLaunch;
}

/** `browser.close()` talks to the same wedged process we're trying to escape, so it would just hang too — kill it directly and let the next slot's `getOrLaunchBrowser()` start a clean one. */
function discardWedgedBrowser(browser: Browser) {
  if (sharedBrowser === browser) sharedBrowser = null;
  browser.process()?.kill("SIGKILL");
}

let running = true;
let wakeResolvers: Array<() => void> = [];
/** Woken early by `NOTIFY scrape_jobs` (see setupNotifyListener) or on shutdown; POLL_INTERVAL_MS is the safety-net ceiling. */
function sleepOrWake(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      wakeResolvers = wakeResolvers.filter((r) => r !== wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    wakeResolvers.push(wake);
  });
}
function wakeAllSlots() {
  wakeResolvers.slice().forEach((r) => r());
}

/** Dedicated (non-pooled) connection for LISTEN — pg only delivers NOTIFY events on the exact connection that issued LISTEN, so this can't share the query Pool. */
async function setupNotifyListener(): Promise<Client> {
  const listenClient = new Client({ connectionString: process.env.DATABASE_URL });
  await listenClient.connect();
  await listenClient.query("LISTEN scrape_jobs");
  listenClient.on("notification", () => wakeAllSlots());
  listenClient.on("error", (err) => console.error("[scraper-worker] LISTEN connection error:", err));
  return listenClient;
}

/** Races `promise` against a timeout without cancelling it — the loser's eventual settlement is still handled by this function's own `.then`, so it never becomes an unhandled rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
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

/** Returns `browserWedged: true` when the caller should force-kill and discard `browser` rather than reuse it for the next job. */
async function processJob(
  db: WorkerDb,
  browser: Browser,
  job: Awaited<ReturnType<typeof claimNextJob>>,
): Promise<{ browserWedged: boolean }> {
  if (!job) return { browserWedged: false };

  console.log(`[scraper-worker] processing job ${job.id} (${job.trigger}) for ${job.usn}`);

  try {
    if (!job.authType || !job.encryptedPin) {
      throw new Error("Job is missing authType/PIN — cannot scrape.");
    }
    const plainPin = decryptText(job.encryptedPin);
    if (!plainPin) {
      throw new Error("Failed to decrypt PIN for scrape job.");
    }

    const result = await withTimeout(
      scrapeAndSyncStudent(db, job.usn, job.dob, job.authType, plainPin, browser, job.scope),
      JOB_TIMEOUT_MS,
      `Scrape job ${job.id}`,
    );

    await db
      .update(scrapeJobs)
      .set({
        status: "success",
        finishedAt: new Date(),
        resultSummary: {
          subjectsCount: result.subjectsCount,
          examHistoryCount: result.examHistoryCount,
          ...result.timings,
        },
      })
      .where(eq(scrapeJobs.id, job.id));

    console.log(`[scraper-worker] job ${job.id} succeeded`);
    return { browserWedged: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scrape error";
    const timedOut = message.includes("timed out after");
    console.error(`[scraper-worker] job ${job.id} failed:`, message);

    await db
      .update(scrapeJobs)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(scrapeJobs.id, job.id));

    return { browserWedged: timedOut };
  }
}

/** A worker killed (crash, machine restart, `taskkill`) mid-job leaves that job stuck in "running" forever — `claimNextJob` only ever looks at "pending", so nothing would retry it. Reset any such leftovers back to "pending" on startup. */
async function recoverOrphanedJobs(db: WorkerDb) {
  const recovered = await db
    .update(scrapeJobs)
    .set({ status: "pending", startedAt: null })
    .where(eq(scrapeJobs.status, "running"))
    .returning({ id: scrapeJobs.id });

  if (recovered.length > 0) {
    console.log(`[scraper-worker] recovered ${recovered.length} job(s) stuck in "running" from a previous run`);
  }
}

/** One concurrent claim+scrape slot: claims a job, processes it, repeats — sleeping (subject to early wake-up) only when the queue is empty. */
async function workerSlot(db: WorkerDb, slotId: number) {
  while (running) {
    const job = await claimNextJob(db);
    if (job) {
      // Launched lazily (not before the loop) so an idle worker never pays Chromium's
      // boot cost, and relaunched automatically if a previous job left it disconnected.
      const browser = await getOrLaunchBrowser();
      const { browserWedged } = await processJob(db, browser, job);
      if (browserWedged) {
        console.error(`[scraper-worker] slot ${slotId}: browser appears wedged after a job timeout — force-killing it`);
        discardWedgedBrowser(browser);
      }
    } else {
      await sleepOrWake(POLL_INTERVAL_MS);
    }
  }
}

async function main() {
  const db = getWorkerDb();

  const shutdown = () => {
    console.log("[scraper-worker] shutting down...");
    running = false;
    wakeAllSlots();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // A wedged Chromium process can leave some other, unrelated promise's rejection
  // unhandled well after processJob's own timeout has already moved on from it — log
  // rather than let the whole worker crash (and every job behind it stall with it).
  process.on("unhandledRejection", (reason) => {
    console.error("[scraper-worker] unhandled rejection:", reason);
  });

  await recoverOrphanedJobs(db);

  let listenClient: Client | null = null;
  try {
    listenClient = await setupNotifyListener();
  } catch (err) {
    console.error("[scraper-worker] failed to set up LISTEN/NOTIFY — falling back to poll-only:", err);
  }

  console.log(
    "[scraper-worker] started, %d concurrent slot(s), %dms poll as fallback%s",
    CONCURRENT_SLOTS,
    POLL_INTERVAL_MS,
    listenClient ? " (LISTEN/NOTIFY active)" : "",
  );

  try {
    await Promise.all(Array.from({ length: CONCURRENT_SLOTS }, (_, i) => workerSlot(db, i)));
  } finally {
    if (listenClient) await listenClient.end().catch(() => {});
    if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[scraper-worker] fatal error:", error);
  process.exit(1);
});
