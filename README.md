# MSR Insight — Student Dashboard

A from-scratch rebuild of MSR-Insight's student-facing dashboard on a different stack:
**Next.js (App Router, frontend + backend), Drizzle ORM, Neon Postgres, JWT auth**.
`MSR-Insight` (the original distributed-monolith app) is read-only reference material —
nothing here depends on it at runtime.

Students log in with **USN + Date of Birth**, plus a one-time secondary-auth step (parent's
mobile or ABC ID + the portal's 4-digit PIN) the first time their account is synced. Once
verified, the dashboard shows their academic data — current-semester performance, exam
history, notes/PYQ resource links, and a what-if grade/attendance simulator — all scraped
from the college's parent portal (`https://parents.msrit.edu/newparents/`) via Puppeteer and
normalized into a single `details` JSONB blob on the student's row.

## Table of contents

- [Features](#features)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Project layout](#project-layout)
- [Setup](#setup)
- [Running it](#running-it)
- [Available scripts](#available-scripts)
- [Auth &amp; retry flow](#auth--retry-flow)
- [Known deviations from MSR-Insight](#known-deviations-from-msr-insight-deliberate-not-oversights)
- [Deployment](#deployment)
- [Git workflow](#git-workflow)

## Features

- **USN + DOB login**, with a first-time (or PIN-change) secondary-auth step that captures
  the portal's 4-digit PIN — required once so the app can authenticate against the portal on
  the student's behalf for every future sync. The PIN field is plain text while typing (not
  masked), and a failed attempt bounces back to the login form with the reason shown and the
  verification section already reopened, so the student can immediately correct and retry.
- **Asynchronous portal sync**: login doesn't block on the scrape. A session is issued
  immediately and the scrape runs in the background via a job queue, with the dashboard
  showing a "verifying & syncing" state until it resolves (success, failure, or a client-side
  timeout backstop — see [Auth & retry flow](#auth--retry-flow)).
- **Current Semester (Performance)** — per-subject marks, attendance (with present/absent
  date breakdowns), and CIE assessment bars; CGPA and credit summary.
- **Exam History** — past-semester SGPA, credits earned, and per-course grades.
- **Simulator** — what-if grade and attendance projections (`src/lib/simulator/`), computed
  entirely client-side against the already-synced data.
- **Notes & PYQs** — a config-driven table of resource links (`src/lib/notes/config.ts`)
  mapped per branch/semester/subject; adding a link is a data change, not a code change.
- **Manual "Sync now"** button with a 5-minute cooldown (`useCooldown`) to avoid hammering the
  portal; if the account predates PIN storage, it asks for a re-login instead of syncing blind.
- **Birthday banner**, mobile-responsive charts/nav, and a re-login flow (`?relogin=1`) for
  accounts with no stored PIN yet.
- An **Analytics** tab exists in code (`AnalyticsSection.tsx`) but is currently disabled in
  the nav — not wired up in the shipped UI yet.
- **Out of scope by design**: no proctor login/dashboard, no Placements data (the portal's
  Placement section is deliberately never scraped — see `schema.ts`), no PDF report / AI
  remarks / email-WhatsApp-to-parents (see [deviations](#known-deviations-from-msr-insight-deliberate-not-oversights)).

## Architecture at a glance

- **Next.js app** (`src/app`) — both the UI and the API. Route handlers under `src/app/api/**`
  handle auth, the dashboard's profile/update endpoints, and scrape-job status polling.
- **Standalone scraper worker** (`worker/scraper-worker.ts`) — a separate long-running Node
  process. Puppeteer is a poor fit for Next.js route handlers/serverless, so scraping never
  runs inline in a request. Instead:
  1. A route handler enqueues a row in the `scrape_jobs` table (Postgres-backed job queue —
     there's no Redis/RabbitMQ in this stack).
  2. The worker polls that table (`FOR UPDATE SKIP LOCKED`), runs the scrape, and writes the
     result onto the student's row.
  3. The frontend polls `GET /api/scrape-jobs/[id]` every ~2s until the job succeeds or fails
     (see `useScrapeJobPolling`), with retry-on-blip and a client-side timeout backstop so a
     lost connection or a stuck job can't leave the UI spinning forever.
- **Drizzle + Neon** (`src/lib/db`) — two tables: `students` (profile + the `details` JSONB
  blob) and `scrape_jobs` (the queue). No sessions table — auth is a stateless JWT in an
  httpOnly cookie (~30-day expiry, `Expires` set alongside `Max-Age` for older mobile
  WebViews), so logout just clears the cookie.

Everything under `src/lib/scraper/` (`puppeteerClient.ts`, `htmlParser.ts`,
`dataNormalizer.ts`) is a near-verbatim TypeScript port of MSR-Insight's scraper pipeline, so
the portal-parsing logic and the `details` shape it produces match the original exactly.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 + hand-written component CSS (`src/styles`, `globals.css`) |
| Data fetching / client cache | TanStack Query (`@tanstack/react-query`) |
| Charts | Recharts |
| Animation | Framer Motion |
| ORM / DB | Drizzle ORM over Neon Postgres (`@neondatabase/serverless` HTTP driver for routes, `pg` pooled client for the worker) |
| Auth | `jose` (JWT), httpOnly cookie session, AES-256-GCM PIN encryption at rest |
| Scraping | Puppeteer + Cheerio, run only in the standalone worker process |
| Validation | Zod |
| Tooling | ESLint 9, Lefthook (git hooks), Commitlint (Conventional Commits), `tsx` (worker dev runner) |
| Observability | Vercel Analytics + Speed Insights |

## Data model

**`students`** — one row per USN. `details` is the normalized scrape result (see
`src/lib/studentDetails.ts` for the full `StudentDetails`/`Subject`/`ExamHistoryEntry`
shape): CGPA, current-semester subjects (marks, attendance, per-assessment breakdown), and
exam history. `encryptedPin` is `iv:authTag:cipher` hex (AES-256-GCM) and is never returned
by any API response.

**`scrape_jobs`** — the job queue. Each row tracks `trigger` (`login` /
`manual_update` / `requires_secondary_auth_retry`), `scope` (`full` fetches everything;
`recurring` skips the exam-history page, since it only changes once per exam cycle, and
merges the previous scrape's history back in), and `status`
(`pending` → `running` → `success` | `failed`). A partial unique index allows at most one
active (`pending`/`running`) job per USN, so repeated login/refresh clicks reuse the
in-flight job instead of queuing duplicates.

Migrations live in `drizzle/` (Drizzle Kit); see [Setup](#setup) for generating/applying them.

## API reference

All routes are under `src/app/api/`. Auth-protected routes read the `student_session` httpOnly
cookie; there is no bearer-token/header auth.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | USN+DOB login. Returns `requiresSecondaryAuth` if no verified PIN exists yet; otherwise mints the session and enqueues a scrape job (`login` trigger). |
| `POST` | `/api/auth/register` | — | Legacy/standalone registration path (USN+DOB only) — not currently wired into the login UI, which handles first-time registration inline via the secondary-auth step. |
| `GET` | `/api/auth/profile` | session | Current student's profile + `details`, with `encryptedPin` stripped. |
| `POST` | `/api/auth/logout` | session | Clears the session cookie. |
| `GET` | `/api/report/student/[usn]` | session (self only) | Fetch a student's report; triggers a scrape if none exists yet. |
| `POST` | `/api/report/update` | session (self only) | Manual "Sync now" — enforces the 5-minute cooldown against `details.last_updated`, enqueues a `manual_update`/`full` job, or returns `requiresRelogin` if no PIN is stored. |
| `GET` | `/api/scrape-jobs/[id]` | session | Poll a job's `status`/`error`/`resultSummary`, used by `useScrapeJobPolling`. |

## Project layout

```
src/
  app/
    (auth)/student-login/           # LoginForm (USN+DOB + secondary-auth/PIN flow)
    (dashboard)/student/dashboard/  # dashboard page + SubjectDetail drill-down
    api/
      auth/{login,register,logout,profile}/
      report/{student/[usn],update}/
      scrape-jobs/[id]/
    error.tsx, global-error.tsx     # App Router error boundaries
  components/dashboard/             # SidebarProfile, LoadingScreen, BirthdayBanner, UpdateButton, CustomSelect, DashboardHeader
    sections/                      # PerformanceSection, HistorySection, SimulatorSection, NotesSection, AnalyticsSection (disabled)
  hooks/                            # useCooldown, useScrapeJobPolling
  lib/
    auth/                          # JWT (jwt.ts), cookies (cookies.ts), session lookup (session.ts), AES-256-GCM PIN crypto (crypto.ts), authType normalization
    db/                            # Drizzle schema + clients (HTTP client for routes, pooled client for the worker)
    scraper/                       # ported puppeteerClient/htmlParser/dataNormalizer + scrapeAndSync orchestration, concurrency helper
    simulator/                     # grade math + CGPA calculator (pure functions)
    notes/                         # resource-link config + resolution logic
    scrapeJobs.ts                  # enqueue/claim helpers shared by routes and the worker
    studentDetails.ts              # the normalized `details` shape + hasScrapedData()
    validation/auth.ts             # Zod request schemas
worker/
  scraper-worker.ts                # the standalone process described above
  Dockerfile                       # system-Chromium image for Render deployment
drizzle/                           # generated SQL migrations + snapshots
```

## Setup

```bash
npm install          # also runs `lefthook install` for git hooks
cp .env.example .env
```

On Windows, `setup.bat` does the same (install, create `.env`, run migrations if
`DATABASE_URL` is already set) and `run.bat` opens the dev server and worker in separate
terminal windows.

Fill in `.env`:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. |
| `JWT_SECRET` | Signs the student session cookie. |
| `ENCRYPTION_SECRET` | Derives the AES-256-GCM key used to encrypt the stored portal PIN at rest — keep separate from `JWT_SECRET`. |
| `MSR_PORTAL_TEST_*` (optional) | Only needed to exercise the live scraper against the real portal during development. |
| `PUPPETEER_SKIP_DOWNLOAD` (deploy-only) | Set on Vercel — the app never launches Chromium, so this skips a pointless download during `npm install`. |
| `PUPPETEER_EXECUTABLE_PATH` (deploy-only) | Set automatically by `worker/Dockerfile`; points Puppeteer at the container's system Chromium. |

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

The dev server works without the worker running (login/update requests will just enqueue jobs
that sit `pending` until a worker picks them up), but nothing will actually get scraped until
`npm run worker` is also running.

## Available scripts

```bash
npm run dev      # Next.js dev server (Turbopack)
npm run build    # production build
npm run start    # run the production build
npm run worker   # scraper worker, watch mode (tsx watch)
npm run lint     # ESLint
npm run db:generate   # generate a Drizzle migration from schema.ts
npm run db:migrate    # apply migrations to DATABASE_URL
npm run db:studio     # Drizzle Studio (DB browser)
```

## Auth & retry flow

- **First-time login / PIN change**: submitting USN+DOB alone returns
  `requiresSecondaryAuth`; the form then asks for the verification method (Father's/Mother's
  Mobile or ABC ID) and the portal's last-4-digit PIN, and resubmits with both.
- **Wrong details**: a DOB mismatch against an already-verified account is rejected
  synchronously (400, shown inline, form stays editable). A wrong PIN or first-time
  USN/DOB/PIN combination is only discoverable by actually attempting the portal login, which
  happens asynchronously in the worker — if that job fails and the account has no prior
  scraped data, the dashboard logs the (still-unverified) session out and redirects to
  `/student-login?error=<reason>`, with the PIN section pre-expanded so the student can
  immediately retype and resubmit.
- **Returning users**: a failed manual "Sync now" (e.g. a stale stored PIN) does *not* log the
  student out — it surfaces an inline error banner on the dashboard, since the previously
  synced data is still valid and displayed.
- **Not stuck forever**: `useScrapeJobPolling` retries transient fetch failures (common on
  mobile — app-switch, screen lock, flaky connection), refetches immediately when the tab/app
  regains focus, and has a 6-minute client-side backstop (`MAX_POLL_MS`) that surfaces a
  timeout error even if the worker itself never responds — independent of the worker's own
  4-minute per-job timeout.

## Known deviations from MSR-Insight (deliberate, not oversights)

- **Session storage**: MSR-Insight uses `localStorage` + an `x-session-id` header +
  Redis-backed sessions, because its frontend and backend are separate origins. Here the API
  is same-origin, so auth is a single httpOnly JWT cookie — no client-side session storage at
  all.
- **Scraping is asynchronous**: MSR-Insight scrapes synchronously inside the login/update
  request. Here, a session is minted immediately and the scrape runs in the background via
  the job queue — the dashboard shows a "syncing" state (via `useScrapeJobPolling`) rather
  than blocking the login screen.
- **The encrypted PIN is never sent to the client.** MSR-Insight's `/api/auth/profile`
  returns it as-is; the equivalent route here strips it before responding.
- **Scope**: this rebuild is student-only. There's no proctor login, proctor dashboard, or
  proctor-viewing-student mode. The printable PDF report page, AI-generated remarks, and
  email/WhatsApp-to-parents features (which depend on FastAPI+Groq, RabbitMQ, Resend,
  Twilio, and Cloudinary) are all out of scope — none of those services exist in this
  project. The Placements section is deliberately never scraped, parsed, or stored either.

## Deployment

See **`DEPLOYMENT.md`** for the full walkthrough. Short version:

- **Next.js app → Vercel** (free/Hobby tier). It never launches Puppeteer, so it deploys as a
  plain Next.js project — set `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_SECRET`, and
  `PUPPETEER_SKIP_DOWNLOAD=1` as project env vars.
- **Worker → Render** (free tier), built from `worker/Dockerfile` (system Chromium). Render's
  free tier only offers Web Services (must bind `$PORT`, sleeps after ~15 min idle), so the
  worker also serves a trivial `/health` endpoint — pair it with a free external pinger
  (UptimeRobot, cron-job.org) hitting `/health` every ~10 minutes. Set `DATABASE_URL`,
  `JWT_SECRET`, `ENCRYPTION_SECRET`, and keep `SCRAPER_WORKER_CONCURRENCY=1` (512MB RAM
  doesn't comfortably fit more than one concurrent Chromium tab).
- **Future iteration**: a paid always-on host removes the idle-sleep workaround; a real queue
  service only matters if scrape volume outgrows a single polling worker; horizontal scaling
  is already safe today thanks to the `FOR UPDATE SKIP LOCKED` claim query — running a second
  worker process needs no code changes.

## Git workflow

- Never commit directly to `main` — work on a `feat/`, `fix/`, `chore/`, `docs/`, or
  `refactor/` branch and open a PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
  enforced by Commitlint via Lefthook's `commit-msg` hook.
- Lefthook runs ESLint on staged files before every commit (`pre-commit`).

See `CLAUDE.md` / `AGENTS.md` for the full project/AI-agent guidelines.
