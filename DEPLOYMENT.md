# Deploying to Vercel + Render (free tier)

## Context

The app is a Next.js 16 (App Router) student dashboard already using a serverless-friendly
stack for the web tier: Drizzle ORM over Neon Postgres via the `@neondatabase/serverless`
HTTP driver (`src/lib/db/client.ts`), and JWT-based auth (`src/lib/auth/`) — no code in
`src/app/**` imports Puppeteer (`src/app/api/auth/login/route.ts` only imports
`enqueueScrapeJob` from `@/lib/scrapeJobs`, never `src/lib/scraper/*`). That means the
Next.js app itself deploys to Vercel's free (Hobby) tier essentially as-is.

The one piece that **cannot** run on Vercel is `worker/scraper-worker.ts`: a standalone,
long-lived Node process that keeps one headless Chromium instance alive, holds an open
Postgres `LISTEN/NOTIFY` connection, and polls a `scrape_jobs` queue table indefinitely.
Vercel serverless functions are request-scoped and time-limited — they can't host this.
That worker goes to **Render's free tier** instead; the app connects to the existing Neon
database either way.

**Important caveat on Render's free tier**: it only offers free **Web Services** (must
bind `$PORT`, respond to health checks, and it sleeps after ~15 min with no inbound HTTP
traffic) — there's no free "Background Worker" service type. The worker is adapted to
also serve a tiny HTTP endpoint, and you'll register a free external pinger (UptimeRobot
or cron-job.org) to hit it periodically and keep it awake. This is a known workaround, not
a guarantee of 100% uptime on the free tier — expect occasional cold-start delays.

## Part 1 — Vercel: deploy the Next.js app

No functional code changes needed. Steps:

1. **Vercel dashboard**: vercel.com → Add New → Project → import the GitHub repo.
   Framework preset auto-detects as Next.js; root directory = repo root (no monorepo
   split needed).
2. **Environment variables** (Project Settings → Environment Variables, apply to
   Production + Preview):
   - `DATABASE_URL` — existing Neon connection string (pooled variant, as already
     documented in `.env.example`).
   - `JWT_SECRET` — same value used locally.
   - `ENCRYPTION_SECRET` — same value used locally.
   - `PUPPETEER_SKIP_DOWNLOAD=1` — the app doesn't launch Chromium, but `puppeteer` is
     still a top-level `dependency` in `package.json` (shared with the worker), so
     without this flag Vercel's `npm install` wastes build time downloading a Chromium
     binary the web app never uses.
3. Trigger the deploy (push to the connected branch, or "Deploy" in the dashboard).
4. Verify: build succeeds, `/student-login` loads at the `*.vercel.app` URL.

No `vercel.json` is required — there's no cron, rewrites, or custom headers to configure.

## Part 2 — Render: deploy the scraper worker (free tier)

### Code changes (already done, on `chore/vercel-render-deploy`)

1. **`worker/scraper-worker.ts`** — added a minimal HTTP server bound to
   `process.env.PORT`, only when `PORT` is set (keeps local `npm run worker` behavior
   unchanged), responding `200 OK` at `/health`. This satisfies Render's free-tier
   requirement that a Web Service bind a port and pass health checks, and gives the
   external pinger something to hit.
2. **`worker/scraper-worker.ts`** and **`src/lib/scraper/puppeteerClient.ts`** — both
   `puppeteer.launch(...)` calls now pass
   `executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined`, so the
   container can point Puppeteer at a system-installed Chromium instead of relying on
   Puppeteer's own bundled download (which frequently fails on minimal Linux images due
   to missing shared libraries).
3. **`worker/Dockerfile`** — `node:20-slim` base, `apt-get install chromium` plus the
   shared libs Chromium needs (`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, etc.), copies
   the repo, runs `npm ci`, and starts with `npx tsx worker/scraper-worker.ts`. Sets
   `PUPPETEER_SKIP_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` as
   Dockerfile `ENV`.

### Render dashboard steps (you run these)

1. New → Web Service → connect the same GitHub repo.
2. Environment: **Docker**, Dockerfile path `worker/Dockerfile`. Instance type: **Free**.
3. Environment variables: `DATABASE_URL` (same Neon string — direct/unpooled variant is
   fine here since the worker holds a persistent `pg.Pool`/`Client`), `JWT_SECRET`,
   `ENCRYPTION_SECRET`, `SCRAPER_WORKER_CONCURRENCY=1` (keep this low — Render's free
   instance has 512MB RAM and Chromium is memory-hungry; the default of 3 concurrent
   slots risks OOM kills on the free tier). `PORT` is injected automatically by Render.
4. Deploy, confirm the service goes healthy (logs show the worker's startup + polling
   loop, and `GET <service-url>/health` returns 200).
5. Register `<service-url>/health` with a free uptime pinger (UptimeRobot or
   cron-job.org) on a ~10 minute interval so Render doesn't spin the service down from
   inactivity.

## Part 3 — Database

The existing Neon database and connection string are reused, so no new project is needed.
Just confirm migrations are current against it:

```bash
npm run db:migrate   # DATABASE_URL pointed at your Neon project
```

## Verification checklist

1. Vercel app loads; `/student-login` renders.
2. Log in as a test student → confirm a new row appears in `scrape_jobs` (Drizzle Studio
   via `npm run db:studio`, or the Neon SQL console).
3. Render worker logs show it picking up that job (LISTEN/NOTIFY should fire near-
   instantly since both processes share the same `DATABASE_URL`).
4. Dashboard's polling (`useScrapeJobPolling`) flips from "syncing" to showing scraped
   data once the worker finishes the job.
5. Spot-check Render logs after ~20 minutes of no logins to confirm the uptime pinger is
   keeping the service from sleeping.
