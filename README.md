# MSR Insight — Student Dashboard

A from-scratch rebuild of MSR-Insight's student-facing dashboard on a different stack: **Next.js (App Router, frontend + backend), Drizzle ORM, Neon Postgres, JWT auth**. `MSR-Insight` (the original distributed-monolith app) is read-only reference material — nothing here depends on it at runtime.

Students log in with USN + DOB (plus a one-time secondary-auth step — parent's mobile or ABC ID + a 4-digit portal PIN) and see 6 tabs of academic data: current-semester Performance, Analytics, Exam History, a what-if grade/attendance Simulator, Notes & PYQs, and Placements. All of it is scraped from the college's parent portal (`https://parents.msrit.edu/newparents/`) via Puppeteer and normalized into a `details` JSONB blob on the student's row.

## Architecture at a glance

- **Next.js app** (`src/app`) — both the UI and the API. Route handlers under `src/app/api/**` handle auth, the dashboard's profile/update endpoints, and scrape-job status polling.
- **Standalone scraper worker** (`worker/scraper-worker.ts`) — a separate long-running Node process. Puppeteer is a poor fit for Next.js route handlers/serverless, so scraping never runs inline in a request. Instead:
  1. A route handler enqueues a row in the `scrape_jobs` table (Postgres-backed job queue — there's no Redis/RabbitMQ in this stack).
  2. The worker polls that table (`FOR UPDATE SKIP LOCKED`), runs the scrape, and writes the result onto the student's row.
  3. The frontend polls `GET /api/scrape-jobs/[id]` every ~2s until the job succeeds or fails (see `useScrapeJobPolling`).
- **Drizzle + Neon** (`src/lib/db`) — two tables: `students` (profile + the `details` JSONB blob) and `scrape_jobs` (the queue). No sessions table — auth is a stateless JWT in an httpOnly cookie (~30-day expiry), so logout just clears the cookie.

See `.claude/plans` history or the git log for the full build-order rationale if you need it; the short version is: everything under `src/lib/scraper/` (`puppeteerClient.ts`, `htmlParser.ts`, `dataNormalizer.ts`) is a near-verbatim TypeScript port of MSR-Insight's scraper pipeline, so the portal-parsing logic and the `details` shape it produces match the original exactly.

## Setup

```bash
npm install          # also runs `lefthook install` for git hooks
cp .env.example .env
```

Fill in `.env`:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. |
| `JWT_SECRET` | Signs the student session cookie. |
| `ENCRYPTION_SECRET` | Derives the AES-256-GCM key used to encrypt the stored portal PIN at rest. |
| `MSR_PORTAL_TEST_*` (optional) | Only needed to exercise the live scraper against the real portal during development. |

Once `DATABASE_URL` is set:

```bash
npm run db:generate   # generate a migration from src/lib/db/schema.ts
npm run db:migrate    # apply it to Neon
npm run db:studio     # optional: browse the DB in Drizzle Studio
```

## Running it

Two processes, in separate terminals:

```bash
npm run dev      # Next.js app — http://localhost:3000
npm run worker   # scraper worker — polls scrape_jobs every 3s
```

The dev server works without the worker running (login/update requests will just enqueue jobs that sit `pending` until a worker picks them up), but nothing will actually get scraped until `npm run worker` is also running.

## Project layout

```
src/
  app/
    (auth)/student-login/        # USN+DOB login form, incl. first-time secondary-auth flow
    (dashboard)/student/dashboard/  # the 6-tab dashboard page + SubjectDetail drill-down
    api/                         # auth, report/update, scrape-jobs route handlers
  components/dashboard/          # SidebarProfile, LoadingScreen, PinVerificationModal, etc.
    sections/                    # the 6 tab components
  hooks/                         # useCooldown, useScrapeJobPolling
  lib/
    auth/                        # JWT, cookies, AES-256-GCM PIN encryption
    db/                          # Drizzle schema + clients (HTTP client for routes, pooled client for the worker)
    scraper/                     # ported puppeteerClient/htmlParser/dataNormalizer + scrapeAndSync orchestration
    simulator/, placement/, notes/  # extracted pure logic (grade/attendance math, event-text parsing, static content)
worker/
  scraper-worker.ts               # the standalone process described above
```

## Commands

```bash
npm run dev      # Next.js dev server
npm run worker   # scraper worker (watch mode)
npm run build    # production build
npm run lint     # ESLint
npm run db:generate / db:migrate / db:studio
```

## Known deviations from MSR-Insight (deliberate, not oversights)

- **Session storage**: MSR-Insight uses `localStorage` + an `x-session-id` header + Redis-backed sessions, because its frontend and backend are separate origins. Here the API is same-origin, so auth is a single httpOnly JWT cookie — no client-side session storage at all.
- **Scraping is asynchronous**: MSR-Insight scrapes synchronously inside the login/update request. Here, a session is minted immediately and the scrape runs in the background via the job queue — the dashboard shows a "syncing" state (via `useScrapeJobPolling`) rather than blocking the login screen.
- **The encrypted PIN is never sent to the client.** MSR-Insight's `/api/auth/profile` returns it as-is; the equivalent route here strips it before responding.
- **Scope**: this rebuild is student-only. There's no proctor login, proctor dashboard, or proctor-viewing-student mode. The printable PDF report page, AI-generated remarks, and email/WhatsApp-to-parents features (which depend on FastAPI+Groq, RabbitMQ, Resend, Twilio, and Cloudinary) are all out of scope — none of those services exist in this project.

## Future iteration: worker deployment

The worker currently runs as a plain long-lived `tsx` process you start yourself (`npm run worker`), polling Postgres on a fixed interval. That's deliberately simple for now. Worth trying later, roughly in order of effort:

1. **Process supervision** — run it under `pm2`/`systemd`/a Docker container with restart-on-crash, instead of a bare terminal.
2. **Faster job pickup** — Postgres `LISTEN/NOTIFY` instead of polling, so a freshly-enqueued job gets picked up immediately rather than waiting up to `POLL_INTERVAL_MS`.
3. **A real queue service** (e.g. a managed queue, or reintroducing something like RabbitMQ) if scrape volume ever grows enough that a single polling worker becomes the bottleneck — not needed at the current scale.
4. **Horizontal scaling** — the `FOR UPDATE SKIP LOCKED` claim query already makes it safe to run more than one worker instance concurrently, so this is mostly "just start a second process" whenever it's needed.
