# MSR Insight — Student Dashboard

A from-scratch rebuild of MSR-Insight's student-facing dashboard on a different stack:
**Next.js (App Router, frontend + backend), Drizzle ORM, Neon Postgres, JWT auth**.
`MSR-Insight` (the original distributed-monolith app) is read-only reference material —
nothing here depends on it at runtime.

Students log in with **USN + Date of Birth**, plus a one-time secondary-auth step (parent's
mobile or ABC ID + the portal's 4-digit PIN + a personal **Browserless.io API token**) the
first time their account is synced. Once verified, the dashboard shows their academic data —
current-semester performance, exam history, notes/PYQ resource links, and a what-if
grade/attendance simulator — all scraped from the college's parent portal
(`https://parents.msrit.edu/newparents/`) via a remote Browserless.io browser and normalized
into a single `details` JSONB blob on the student's row.

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
- [Auth & retry flow](#auth--retry-flow)
- [Known deviations from MSR-Insight](#known-deviations-from-msr-insight-deliberate-not-oversights)
- [Deployment](#deployment)
- [Git workflow](#git-workflow)

## Features

- **USN + DOB login**, with a first-time (or PIN-change) secondary-auth step that captures
  the verification method, the portal's last-4-digit PIN, and a
  **[Browserless.io](https://www.browserless.io) API token** — required once so the app can
  authenticate against the portal on the student's behalf using a remote browser, without ever
  launching a local Chromium process. The token is validated synchronously on submission (5s
  test-connect); an invalid token is rejected immediately with an inline field error.
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
  portal; if the account predates PIN/token storage, it asks for a re-login instead of syncing
  blind.
- **Birthday banner**, mobile-responsive charts/nav, and a re-login flow (`?relogin=1`) for
  accounts with no stored PIN yet.
- An **Analytics** tab exists in code (`AnalyticsSection.tsx`) but is currently disabled in
  the nav — not wired up in the shipped UI yet.
- **Out of scope by design**: no proctor login/dashboard, no Placements data (the portal's
  Placement section is deliberately never scraped — see `schema.ts`), no PDF report / AI
  remarks / email-WhatsApp-to-parents.

## Architecture at a glance

- **Next.js app** (`src/app`) — both the UI and the API. Route handlers under `src/app/api/**`
  handle auth, the dashboard's profile/update endpoints, scrape-job status polling, and the
  in-process scrape runner.
- **In-process scrape runner** (`POST /api/scrape-jobs/run`) — scraping now runs directly
  inside a Vercel serverless function. Since the app connects to a remote browser via
  Browserless.io (`puppeteer.connect({ browserWSEndpoint: 'wss://chrome.browserless.io?token=...' })`)
  rather than launching a local Chromium, the whole scrape fits comfortably inside Vercel's
  60-second function window:
  1. `/api/auth/login` or `/api/report/update` inserts a row in the `scrape_jobs` queue table,
     then fires a **fire-and-forget** internal `fetch` to `POST /api/scrape-jobs/run`.
  2. `/api/scrape-jobs/run` (`maxDuration = 60`) claims the job with `FOR UPDATE SKIP LOCKED`,
     decrypts the PIN and Browserless token, calls `scrapeAndSyncStudent`, and marks the job
     `success` or `failed`.
  3. The frontend polls `GET /api/scrape-jobs/[id]` every ~2s until the job succeeds or fails
     (see `useScrapeJobPolling`), with retry-on-blip and a 6-minute client-side backstop.
- **Drizzle + Neon** (`src/lib/db`) — two tables: `students` (profile + the `details` JSONB
  blob) and `scrape_jobs` (the queue). No sessions table — auth is a stateless JWT in an
  httpOnly cookie (~30-day expiry). A single `@neondatabase/serverless` HTTP client is used
  everywhere — no persistent connection pool, no `pg` driver.

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
| ORM / DB | Drizzle ORM over Neon Postgres (`@neondatabase/serverless` HTTP driver) |
| Auth | `jose` (JWT), httpOnly cookie session, AES-256-GCM PIN + token encryption at rest |
| Scraping | `puppeteer-core` + Cheerio, connecting to a per-student **Browserless.io** remote browser — no local Chromium ever launched |
| Validation | Zod |
| Tooling | ESLint 9, Lefthook (git hooks), Commitlint (Conventional Commits) |
| Observability | Vercel Analytics + Speed Insights |

## Data model

**`students`** — one row per USN. `details` is the normalized scrape result (see
`src/lib/studentDetails.ts` for the full `StudentDetails`/`Subject`/`ExamHistoryEntry`
shape): CGPA, current-semester subjects (marks, attendance, per-assessment breakdown), and
exam history. `encryptedPin` is `iv:authTag:cipher` hex (AES-256-GCM) and is never returned
by any API response.

`encryptedBrowserlessToken` — the student's personal Browserless.io API token, stored with
the same AES-256-GCM scheme as `encryptedPin`. Never returned by any API response, never
logged, never included in error messages.

`browserlessTokenValid` — flips `false` when a scrape fails because Browserless rejected the
token (bad/expired/revoked), as opposed to a portal-login failure. The login flow checks this
on load: if `false` and no new token is provided, it returns `requiresTokenRefresh: true` so
the form re-prompts specifically for the Browserless token without requiring the PIN again.

**`scrape_jobs`** — the job queue. Each row tracks `trigger` (`login` /
`manual_update` / `requires_secondary_auth_retry`), `scope` (`full` fetches everything;
`recurring` skips the exam-history page, since it only changes once per exam cycle, and
merges the previous scrape's history back in), and `status`
(`pending` → `running` → `success` | `failed`). A partial unique index allows at most one
active (`pending`/`running`) job per USN. Both `encryptedPin` and `encryptedBrowserlessToken`
are snapshotted into the job row at enqueue time — the run route decrypts them in-process.

Migrations live in `drizzle/` (Drizzle Kit); see [Setup](#setup) for generating/applying them.

## API reference

All routes are under `src/app/api/`. Auth-protected routes read the `student_session` httpOnly
cookie; there is no bearer-token/header auth.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | USN+DOB login. Returns `requiresSecondaryAuth` if no verified PIN/token exists yet; validates Browserless token synchronously; mints session and triggers scrape. |
| `POST` | `/api/auth/register` | — | Legacy/standalone registration path — not wired into the login UI. |
| `GET` | `/api/auth/profile` | session | Current student's profile + `details`, with encrypted fields stripped. |
| `POST` | `/api/auth/logout` | session | Clears the session cookie. |
| `GET` | `/api/report/student/[usn]` | session (self only) | Fetch a student's report; triggers a scrape if none exists yet. |
| `POST` | `/api/report/update` | session (self only) | Manual "Sync now" — enforces 5-min cooldown, checks `browserlessTokenValid`, enqueues job + triggers run. |
| `GET` | `/api/scrape-jobs/[id]` | session | Poll job `status`/`error`/`resultSummary`, used by `useScrapeJobPolling`. |
| `POST` | `/api/scrape-jobs/run` | internal | In-process scrape runner (`maxDuration = 60`). Called fire-and-forget from login/update routes. |

## Project layout

```
src/
  app/
    (auth)/student-login/           # LoginForm (USN+DOB + secondary-auth/PIN/token flow)
    (dashboard)/student/dashboard/  # dashboard page + SubjectDetail drill-down
    api/
      auth/{login,register,logout,profile}/
      report/{student/[usn],update}/
      scrape-jobs/[id]/             # job status polling
      scrape-jobs/run/              # in-process scrape runner (maxDuration=60)
    error.tsx, global-error.tsx     # App Router error boundaries
  components/dashboard/             # SidebarProfile, LoadingScreen, BirthdayBanner, UpdateButton, CustomSelect, DashboardHeader
    sections/                      # PerformanceSection, HistorySection, SimulatorSection, NotesSection, AnalyticsSection (disabled)
  hooks/                            # useCooldown, useScrapeJobPolling
  lib/
    auth/                          # JWT (jwt.ts), cookies (cookies.ts), session lookup (session.ts), AES-256-GCM crypto (crypto.ts), authType normalization
    db/                            # Drizzle schema + HTTP client (client.ts)
    scraper/                       # puppeteerClient (Browserless connect), htmlParser, dataNormalizer, scrapeAndSync, runJob, concurrency helper
    simulator/                     # grade math + CGPA calculator (pure functions)
    notes/                         # resource-link config + resolution logic
    scrapeJobs.ts                  # enqueue helper shared by login + update routes
    studentDetails.ts              # the normalized `details` shape + hasScrapedData()
    validation/auth.ts             # Zod request schemas
drizzle/                           # generated SQL migrations + snapshots
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
| `ENCRYPTION_SECRET` | Derives the AES-256-GCM key used to encrypt the stored portal PIN and Browserless token at rest — keep separate from `JWT_SECRET`. |
| `MSR_PORTAL_TEST_BROWSERLESS_TOKEN` (optional) | Only needed to exercise the live scraper during development — a real Browserless token with an active session. |

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

The dev server is fully self-contained. The scrape runs in-process inside
`/api/scrape-jobs/run` when a login or sync is triggered. In development the
`maxDuration = 60` export is ignored (no Vercel runtime), so scrapes can run
as long as needed.

## Available scripts

```bash
npm run dev      # Next.js dev server (Turbopack)
npm run build    # production build
npm run start    # run the production build
npm run lint     # ESLint
npm run db:generate   # generate a Drizzle migration from schema.ts
npm run db:migrate    # apply migrations to DATABASE_URL
npm run db:studio     # Drizzle Studio (DB browser)
```

## Auth & retry flow

- **First-time login / PIN change**: submitting USN+DOB alone returns
  `requiresSecondaryAuth`; the form then asks for the verification method (Father's/Mother's
  Mobile or ABC ID), the portal's last-4-digit PIN, and a **Browserless.io API token** (see
  [Browserless.io](https://www.browserless.io) — free accounts are available). All three are
  submitted together and the token is validated synchronously (5s test-connect) before a
  session is minted. An invalid token is rejected with an inline field error; the form stays
  open so the student can correct and resubmit immediately.
- **Browserless token expiry**: if a scrape job fails because Browserless rejected the token,
  `browserlessTokenValid` is set `false` on the student row. The next login detects this and
  returns `requiresTokenRefresh: true` — the secondary-auth section reopens showing only the
  token field (PIN is skipped since it is still valid).
- **Wrong portal credentials**: a DOB mismatch against an already-verified account is rejected
  synchronously (400). A wrong PIN or USN/DOB/PIN combination is only discoverable by actually
  attempting the portal login. If that job fails and the account has no prior scraped data,
  the dashboard redirects to `/student-login?error=<reason>` with the PIN section
  pre-expanded.
- **Not stuck forever**: `useScrapeJobPolling` retries transient fetch failures (common on
  mobile), refetches on tab focus, and has a 6-minute client-side backstop (`MAX_POLL_MS`)
  that surfaces a timeout error even if the scrape route itself never responds — independent
  of the route's own `maxDuration`.

## Known deviations from MSR-Insight (deliberate, not oversights)

- **Session storage**: MSR-Insight uses `localStorage` + an `x-session-id` header +
  Redis-backed sessions. Here auth is a single httpOnly JWT cookie — no client-side session
  storage at all.
- **Scraping is asynchronous**: MSR-Insight scrapes synchronously inside the login/update
  request. Here, a session is minted immediately and the scrape runs in the background via
  the job queue — the dashboard shows a "syncing" state (via `useScrapeJobPolling`).
- **Per-student Browserless token**: MSR-Insight uses a single shared Puppeteer process with
  a locally-managed Chromium. Here each student provides their own Browserless.io token, which
  is stored encrypted and used per-scrape — no shared browser state, no local process.
- **The encrypted PIN and Browserless token are never sent to the client.** MSR-Insight's
  `/api/auth/profile` returns the encrypted PIN as-is; the equivalent route here strips both
  before responding.
- **Scope**: student-only. No proctor login, dashboard, PDF report, AI remarks, or
  email/WhatsApp-to-parents. The Placements section is deliberately never scraped.

## Deployment

See **`DEPLOYMENT.md`** for the full walkthrough. Short version:

- **Vercel (free/Hobby tier), single service** — the entire app including the scrape runner.
  Set `DATABASE_URL`, `JWT_SECRET`, and `ENCRYPTION_SECRET` as project env vars. No
  `PUPPETEER_SKIP_DOWNLOAD`, no `PUPPETEER_EXECUTABLE_PATH`, no second host.
- Each student provides their own [Browserless.io](https://www.browserless.io) token at
  first login. Free-tier tokens cover the scrape volume of a single student easily.
- The scrape route (`/api/scrape-jobs/run`) has `maxDuration = 60` (Vercel Hobby limit).
  A full scrape typically completes in 15–35s. If a scrape times out the job is marked
  `failed` and the student can retry via "Sync now".

## Git workflow

- Never commit directly to `main` — work on a `feat/`, `fix/`, `chore/`, `docs/`, or
  `refactor/` branch and open a PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
  enforced by Commitlint via Lefthook's `commit-msg` hook.
- Lefthook runs ESLint on staged files before every commit (`pre-commit`).

See `CLAUDE.md` / `AGENTS.md` for the full project/AI-agent guidelines.