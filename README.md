# MSR Insight — Student Dashboard

A from-scratch rebuild of MSR-Insight's student-facing dashboard on a different stack:
**Next.js (App Router, frontend + backend), Drizzle ORM, Neon Postgres, JWT auth**.
`MSR-Insight` (the original distributed-monolith app) is read-only reference material —
nothing here depends on it at runtime.

Students log in with **USN + Date of Birth**, plus a one-time secondary-auth step (parent's
mobile or ABC ID + the portal's 4-digit PIN) the first time their account is synced. Once
verified, the dashboard shows their academic data — current-semester performance, exam
history, notes/PYQ resource links, and a what-if grade/attendance simulator — all scraped from
the college's parent portal (`https://parents.msrit.edu/newparents/`) with plain HTTP requests
(no browser, no third-party scraping service) and stored on the student's row: the current
semester in a `details` JSONB blob, exam results in their own columns.

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
- [Installable app (PWA)](#installable-app-pwa)
- [Auth & retry flow](#auth--retry-flow)
- [Known deviations from MSR-Insight](#known-deviations-from-msr-insight-deliberate-not-oversights)
- [Deployment](#deployment)
- [Git workflow](#git-workflow)

## Features

- **USN + DOB login**, with a first-time (or PIN-change) secondary-auth step that captures
  the verification method and the portal's last-4-digit PIN. The PIN is encrypted at rest and
  reused for later syncs.
- **Asynchronous portal sync**: login doesn't block on the scrape. A session is issued
  immediately and the scrape runs in the background via a job queue, with the dashboard
  showing a "syncing" state until it resolves (success, failure, or a client-side
  timeout backstop — see [Auth & retry flow](#auth--retry-flow)).
- **Automatic refresh on login**: a returning student with a saved PIN signs in instantly.
  If their attendance/CIE data is older than **24 hours** it is refreshed in the background; if
  their exam results are older than **7 days** those are refreshed too (`src/lib/scrapePolicy.ts`).
  The dashboard keeps showing the cached data meanwhile.
- **Current Semester (Performance)** — per-subject marks, attendance (with present/absent
  date breakdowns), and CIE assessment bars; CGPA and credit summary.
- **Exam History** — past-semester SGPA, credits earned, and per-course grades.
- **Simulator** — what-if grade and attendance projections (`src/lib/simulator/`), computed
  entirely client-side against the already-synced data.
- **Notes & PYQs** — a config-driven table of resource links (`src/lib/notes/config.ts`)
  mapped per branch/semester/subject; adding a link is a data change, not a code change.
- **Manual refresh** with a 1-minute cooldown (`useCooldown`): "Update Dashboard" refreshes
  attendance and CIE marks, and "Refresh results" on the Exam History tab refreshes exam
  results. If the account predates PIN storage, it asks for a re-login instead of syncing blind.
- **Installable app (PWA)**: the dashboard can be added to the home screen and opens as a standalone app. A signed-in student is offered the install **at most once every 24 hours** (Chrome/Edge/Android get an Install button; iOS gets the Share → Add to Home Screen steps; nothing is shown inside the installed app). See [Installable app](#installable-app-pwa).
- **Birthday banner**, mobile-responsive charts/nav, and a re-login flow (`?relogin=1`) for
  accounts with no stored PIN yet.
- An **Analytics** tab exists in code (`AnalyticsSection.tsx`) but is currently disabled in
  the nav — not wired up in the shipped UI yet.
- **Out of scope by design**: no proctor login/dashboard, no Placements data (the portal's
  Placement section is deliberately never scraped — see `schema.ts`), no PDF report / AI
  remarks / email-WhatsApp-to-parents.

## Architecture at a glance

- **Next.js app** (`src/app`) — both the UI and the API. Route handlers under `src/app/api/**`
  handle auth, the dashboard's profile/update endpoints, and scrape-job status polling.
- **In-process scrape runner** — scraping runs inside the Vercel serverless function that
  enqueued it, scheduled with Next's `after()` so it continues after the response is sent:
  1. `/api/auth/login`, `/api/report/update` or `/api/report/student/[usn]` inserts a row in the
     `scrape_jobs` queue table and calls `runJobAfterResponse` (`src/lib/scraper/scheduleJob.ts`).
  2. `claimAndRunJob` (`src/lib/scraper/runJob.ts`, 45s deadline inside the routes' `maxDuration = 60`)
     claims the job with a conditional update, decrypts the PIN, calls `scrapeAndSyncStudent`, and
     marks the job `success` or `failed`.
  3. The frontend polls `GET /api/scrape-jobs/[id]` every ~2s until the job succeeds or fails
     (see `useScrapeJobPolling`), with retry-on-blip and a 6-minute client-side backstop.
- **Plain-HTTP portal login** (`src/lib/scraper/portalHttpClient.ts`) — replays the portal's
  two-step login form (USN + DOB, then the PIN) with `fetch` and a small cookie jar. The per-session
  CSRF field is discovered from the page; the invisible reCAPTCHA token is not verified by the
  portal, so none is sent. If the portal changes its login page the client throws
  `PortalLoginUnsupportedError` and the job fails with a clear message.
- **Drizzle + Neon** (`src/lib/db`) — two tables: `students` (profile, the `details` JSONB blob,
  and the exam-history columns) and `scrape_jobs` (the queue). No sessions table — auth is a
  stateless JWT in an httpOnly cookie. A single `@neondatabase/serverless` HTTP client is used
  everywhere — no persistent connection pool, no `pg` driver.

The parsing code under `src/lib/scraper/` (`htmlParser.ts`, `dataNormalizer.ts`) is a near-verbatim
TypeScript port of MSR-Insight's scraper pipeline, so the portal-parsing logic and the `details` shape
it produces match the original.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 + hand-written component CSS (`src/styles`, `globals.css`) |
| Data fetching / client cache | TanStack Query (`@tanstack/react-query`) |
| Charts | Recharts |
| Animation | Framer Motion |
| ORM / DB | Drizzle ORM over Neon Postgres (`@neondatabase/serverless` HTTP driver) |
| Auth | `jose` (JWT), httpOnly cookie session, AES-256-GCM PIN encryption at rest |
| Scraping | Plain HTTP (`fetch` + `axios`) and Cheerio — no browser, no third-party scraping service |
| Validation | Zod |
| Tooling | ESLint 9, Vitest (+ in-memory Postgres via pglite for DB tests), Lefthook (git hooks), Commitlint (Conventional Commits) |
| Observability | Vercel Analytics + Speed Insights |

## Data model

**`students`** — one row per USN, stored as two independently refreshed parts:

- `details` (JSONB) — the current semester: name, class, `last_updated`, and subjects (marks,
  attendance, per-assessment breakdown). See `src/lib/studentDetails.ts` for the `StudentDetails` /
  `Subject` shape. Refreshed when older than 24h on login, or by "Update Dashboard".
- `examHistory` (JSONB array), `cgpa` and `examHistoryUpdatedAt` — past-semester results.
  Refreshed on first login, by "Refresh results", or on login when older than 7 days.

`encryptedPin` is `iv:authTag:cipher` hex (AES-256-GCM) and is never returned by any API response
(`toSafeStudent` strips it).

**`scrape_jobs`** — the job queue. Each row tracks `trigger` (`login` / `manual_update` /
`requires_secondary_auth_retry`), `scope` (`current` = attendance + CIE into `details`,
`exam_history` = results into the exam columns, `full` = both; each scope writes only its own
columns), and `status` (`pending` → `running` → `success` | `failed`). A partial unique index allows at
most one active (`pending`/`running`) job per USN; a job stuck for more than 2 minutes is failed on the
next enqueue so it cannot block that student. `encryptedPin` is snapshotted into the job row at enqueue
time and decrypted in-process.

**`app_stats`** — running totals, so "how many students / jobs" never needs a table scan. Maintained only by
database triggers (`drizzle/0011_app_stats_triggers.sql`), never by application code, and built so it cannot slow
or fail the writes it follows (a stats error is logged and skipped; a counter row is never waited on for more
than 250 ms):

| `key` | Meaning |
|---|---|
| `students_total` | Rows in `students`. |
| `students_year_<n>` | Students whose `current_year` is `n`: `1`–`4` are the programme years, **`5` = senior** (past the 4 years, e.g. batches below 23 in 2026-27), `0` = year not known (a USN that does not parse). Years 0 to 5 always exist. The year is worked out from the USN's batch and rolls forward every 1 August. |
| `scrape_jobs_purged` | Jobs already deleted by the 7-day purge (or with their student). Added to **once per delete statement** with the batch size, never per job; creating a job writes nothing. |

Read them through the `app_stats_summary` view, which also reports **`scrape_jobs_total`** (jobs ever created =
purged + the jobs still stored, at most a week's worth):

```sql
select * from app_stats_summary order by key;
select refresh_app_stats();   -- only if the student counters ever drift; recomputes them from `students`
```

Migrations live in `drizzle/` (Drizzle Kit); see [Setup](#setup) for generating/applying them.

## API reference

All routes are under `src/app/api/`. Auth-protected routes read the `student_session` httpOnly
cookie; there is no bearer-token/header auth.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | USN+DOB login. Returns `requiresSecondaryAuth` if no saved PIN exists yet; otherwise mints a session and, when data is stale, queues a background refresh (returns its `jobId`). |
| `GET` | `/api/auth/profile` | session | Current student's profile + `details`, with encrypted fields stripped. |
| `POST` | `/api/auth/logout` | session | Clears the session cookie. |
| `GET` | `/api/report/student/[usn]` | session (self only) | Fetch a student's report; triggers a scrape if none exists yet. |
| `POST` | `/api/report/update` | session (self only) | Manual refresh. Body `{ usn, scope? }` with `scope` `current` (default) or `exam_history`; enforces a 1-minute cooldown per scope, enqueues a job and runs it after the response. |
| `GET` | `/api/scrape-jobs/[id]` | session | Poll job `status`/`error`/`resultSummary`, used by `useScrapeJobPolling`. |

## Project layout

```
src/
  app/
    (auth)/student-login/           # LoginForm (USN+DOB + secondary-auth/PIN flow)
    (dashboard)/student/dashboard/  # dashboard page + SubjectDetail drill-down
    api/
      auth/{login,register,logout,profile}/
      report/{student/[usn],update}/
      scrape-jobs/[id]/             # job status polling
    error.tsx, global-error.tsx     # App Router error boundaries
  components/dashboard/             # SidebarProfile, LoadingScreen, BirthdayBanner, UpdateButton, CustomSelect, DashboardHeader
    sections/                      # PerformanceSection, HistorySection, SimulatorSection, NotesSection, AnalyticsSection (disabled)
  hooks/                            # useCooldown, useScrapeJobPolling
  lib/
    auth/                          # JWT (jwt.ts), cookies (cookies.ts), session lookup (session.ts), AES-256-GCM crypto (crypto.ts), authType normalization
    db/                            # Drizzle schema + HTTP client (client.ts)
    scraper/                       # portalHttpClient (login), portalScraper (page fetching), htmlParser, dataNormalizer, scrapeAndSync, runJob, scheduleJob, concurrency helper
    simulator/                     # grade math + CGPA calculator (pure functions)
    notes/                         # resource-link config + resolution logic
    scrapeJobs.ts                  # enqueue helper (coalescing, stale-job recovery) shared by the scrape routes
    scrapePolicy.ts                # when data counts as stale (24h / 7d) and manual-refresh cooldowns
    studentDetails.ts              # the normalized `details` shape + hasScrapedData()
    validation/auth.ts             # Zod request schemas
drizzle/                           # generated SQL migrations + snapshots
.scratch/                          # git-ignored space for throwaway experiments (never committed)
```

## Setup

```bash
npm install          # also runs `lefthook install` for git hooks
cp .env.example .env
```

On Windows, `setup.bat` does the same (install, create `.env`, run migrations if
`DATABASE_URL` is already set).

Fill in `.env`:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. |
| `JWT_SECRET` | Signs the student session cookie. |
| `ENCRYPTION_SECRET` | Derives the AES-256-GCM key used to encrypt the stored portal PIN at rest — keep separate from `JWT_SECRET`. |

Once `DATABASE_URL` is set:

```bash
npm run db:generate   # generate a migration from src/lib/db/schema.ts
npm run db:migrate    # apply it to Neon
npm run db:studio     # optional: browse the DB in Drizzle Studio
```

## Running it

Single process — no worker needed:

```bash
npm run dev      # Next.js app — http://localhost:3000
```

The dev server is fully self-contained. The scrape runs in-process (scheduled with `after()`)
when a login or sync is triggered. In development the `maxDuration = 60` export is ignored (no
Vercel runtime), but each job still has its own 45-second deadline.

## Available scripts

```bash
npm run dev      # Next.js dev server (Turbopack)
npm run build    # production build
npm run start    # run the production build
npm run lint     # ESLint
npm test         # Vitest (unit tests + in-memory Postgres tests; never contacts the portal)
npm run db:generate   # generate a Drizzle migration from schema.ts
npm run db:migrate    # apply migrations to DATABASE_URL
npm run db:studio     # Drizzle Studio (DB browser)
```

## Installable app (PWA)

- **Manifest** (`src/app/manifest.ts`): `display: standalone`, with 192px, 512px and maskable icons rendered at build time by `src/app/icons/[name]/route.tsx`.
- **Service worker** (`public/sw.js`): only shows `public/offline.html` when a page navigation fails. It never caches API responses or dashboard pages, so student data is never stored or served stale. Registered in production only (`ServiceWorkerRegistration`), served with `no-cache` headers (`next.config.ts`).
- **Install prompt** (`src/components/pwa/InstallPrompt.tsx`, mounted by `src/app/(dashboard)/layout.tsx` so it exists only for signed-in pages): appears about 4 seconds after the dashboard is visible (it waits for the loading splash to clear), at most once per 24 hours (`LAST_SHOWN` is stored in `localStorage` when it appears, so reloads never nag), never after the app is installed. The rules live in `src/lib/pwa/installPrompt.ts` and are unit-tested.
- **"Install App" button** (`InstallAppButton`, beside "Update Dashboard" on Current Semester): always available, unlike the once-a-day prompt. It opens the browser's install dialog (Chrome/Edge/Android), or the Add to Home Screen steps on iOS. It is hidden inside the installed app, once the app is installed (Chromium only offers installation while it isn't), and in browsers that can't install it. The install event is captured once by `InstallProvider` and shared by the button and the prompt. It is deliberately plain (no glow or hover lift) and sits at the right edge on phones.
- **Trying it locally**: the worker and prompt need a production build, `npm run build && npm start`, then open `http://localhost:3000` (localhost counts as a secure context). Clear the `msr-install-prompt-last-shown` key in DevTools → Application → Local Storage to see the prompt again.

## Auth & retry flow

- **First-time login / PIN change**: submitting USN+DOB alone returns
  `requiresSecondaryAuth`; the form then asks for the verification method (Father's/Mother's
  Mobile or ABC ID) and the portal's last-4-digit PIN, submitted together. The PIN is
  encrypted and saved after the first successful sync.
- **Returning students**: with a saved PIN, login is instant. Stale data (see
  [Features](#features)) is refreshed in the background and the dashboard keeps showing cached
  data until the job finishes. After a failed sync, logins don't auto-sync again for 15 minutes,
  so a PIN that was changed on the portal isn't retried on every login.
- **Invalid details are never stored**: the USN and date of birth are format-checked, and a first-time (or
  PIN-change) login is proven against the portal itself *before* anything is written. A wrong USN, date of
  birth or PIN is rejected on the spot and leaves no row in `students`; a portal outage gets its own "could
  not reach the portal" error rather than being reported as a bad PIN. A date-of-birth mismatch against an
  already-verified account is rejected as well. There is no public registration route.
- **Partial scrapes never overwrite good data**: if any attendance/CIE page still fails after its
  retries, the whole job fails and the previously saved data is left untouched.
- **Not stuck forever**: `useScrapeJobPolling` retries transient fetch failures (common on
  mobile), refetches on tab focus, and has a 6-minute client-side backstop (`MAX_POLL_MS`)
  that surfaces a timeout error even if the scrape route itself never responds.

## Known deviations from MSR-Insight (deliberate, not oversights)

- **Session storage**: MSR-Insight uses `localStorage` + an `x-session-id` header +
  Redis-backed sessions. Here auth is a single httpOnly JWT cookie — no client-side session
  storage at all.
- **Scraping is asynchronous**: MSR-Insight scrapes synchronously inside the login/update
  request. Here, a session is minted immediately and the scrape runs in the background via
  the job queue — the dashboard shows a "syncing" state (via `useScrapeJobPolling`).
- **Plain-HTTP scraping**: MSR-Insight drives a shared Puppeteer process with a
  locally-managed Chromium. Here the portal login is replayed with plain HTTP requests, so there
  is no browser to run and no per-student scraping token.
- **The encrypted PIN is never sent to the client.** MSR-Insight's
  `/api/auth/profile` returns the encrypted PIN as-is; the equivalent route here strips it
  before responding.
- **Scope**: student-only. No proctor login, dashboard, PDF report, AI remarks, or
  email/WhatsApp-to-parents. The Placements section is deliberately never scraped.

## Deployment

See **`DEPLOYMENT.md`** for the full walkthrough. Short version:

- **Vercel (free/Hobby tier), single service** — the entire app including the scrape runner.
  Set `DATABASE_URL`, `JWT_SECRET`, and `ENCRYPTION_SECRET` as project env vars. No browser,
  no scraping-service token, no second host.
- Scraping routes (`login`, `report/update`, `report/student`) have `maxDuration = 60`, and each
  job stops itself after 45 seconds. If a scrape fails or times out the job is marked `failed`
  and the student can retry with the refresh buttons.
- Apply the new migrations (`npm run db:migrate`) before deploying; `0008` permanently drops the
  old Browserless token columns. Details in `DEPLOYMENT.md`.

## Git workflow

- Never commit directly to `main` — work on a `feat/`, `fix/`, `chore/`, `docs/`, or
  `refactor/` branch and open a PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
  enforced by Commitlint via Lefthook's `commit-msg` hook.
- Lefthook runs ESLint on staged files before every commit (`pre-commit`).

See `CLAUDE.md` / `AGENTS.md` for the full project/AI-agent guidelines.