# Deploying MSR Insight Student Dashboard to Vercel

## Overview

The entire app — UI, API routes, and the portal scraper — deploys as a single Next.js project to
Vercel's free (Hobby) tier. No second host (Render, Fly, Railway, etc.), no browser service, and no
per-student tokens are needed: the scraper logs in to the college portal with plain HTTP `fetch`, so
it is small, fast, and fits comfortably inside a serverless function.

> Vercel's Hobby plan is for personal, non-commercial use. Move to a paid plan if this becomes a
> commercial service.

## Architecture recap

```
Browser → Vercel (Next.js)
                ├─ /api/auth/login        ← signs in, enqueues a refresh if data is stale
                ├─ /api/report/update     ← manual refresh (current semester or exam results)
                ├─ /api/report/student    ← cached report; scrapes if the student has none yet
                │        └─ after(): claimAndRunJob → log in over HTTP, fetch pages, write DB
                └─ /api/scrape-jobs/[id]  ← polled by useScrapeJobPolling
                                   ↕
                         Neon Postgres (scrape_jobs + students)
                                   ↕
                  parents.msrit.edu (plain HTTPS requests)
```

Routes that scrape export `maxDuration = 60` and run the job inside Next's `after()`, which keeps
the invocation alive after the response is sent. Each job also has its own 45-second deadline, so it
fails cleanly with a message instead of being killed by the platform.

## Part 1 — Database

Apply the migrations to your Neon database **before** deploying the new code:

```bash
npm run db:migrate   # DATABASE_URL pointed at your Neon project
```

The two newest migrations change existing data:

| Migration | What it does |
|---|---|
| `0008_drop_browserless_columns.sql` | Drops `students.encrypted_browserless_token`, `students.browserless_token_valid`, `scrape_jobs.encrypted_browserless_token`. **Irreversible**: saved Browserless tokens are deleted (they are no longer used). |
| `0009_split_exam_history.sql` | Adds `students.exam_history`, `students.cgpa`, `students.exam_history_updated_at`, copies each student's existing exam history and CGPA out of `details` into them, and renames the job scope `recurring` to `current`. |

The previous deployment reads the dropped columns, so it will error between migrating and the new
deploy going live; do the two back to back. Take a Neon branch/backup first if you want a rollback
point.

## Part 2 — Vercel: deploy the Next.js app

1. **Vercel dashboard**: vercel.com → Add New → Project → import the GitHub repo.
   Framework preset auto-detects as Next.js; root directory = repo root.

2. **Environment variables** (Project Settings → Environment Variables, apply to
   Production + Preview):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon Postgres connection string (pooled variant). |
   | `JWT_SECRET` | Long random secret — `openssl rand -base64 32`. |
   | `ENCRYPTION_SECRET` | Different long random secret — `openssl rand -base64 32`. |

   That is all. There is no browser to configure and no token to provide.

3. Trigger the deploy (push to the connected branch, or "Deploy" in the dashboard).

4. Verify: build succeeds, `/student-login` loads at the `*.vercel.app` URL.

No `vercel.json` is required.

## Part 3 — How syncing behaves

| When | What is fetched | Target time |
|---|---|---|
| First login | Everything (`full`) | 10–25s |
| Login with data older than 24h | Attendance and CIE marks (`current`) | 8–20s |
| Login with exam results older than 7 days | Exam results (`exam_history`) | 5–10s |
| "Update Dashboard" button (1-minute cooldown) | `current` | 8–20s |
| "Refresh results" button on Exam History (1-minute cooldown) | `exam_history` | 5–10s |
| Login with everything fresh | Nothing; signs in instantly | — |

Target times are goals for staying well inside the 60-second limit, not measurements; check
`scrape_jobs.result_summary` (it records per-phase timings) after your first real syncs.

Logins never wait for a refresh: the session is issued immediately and the dashboard shows the
cached data with a "syncing" state until the job finishes. After a failed sync (for example the
saved PIN was changed on the portal) logins stop auto-syncing for 15 minutes, so the portal is not
hit with a wrong PIN on every login.

If a function is killed before it can record a result, the job is marked failed the next time that
student starts a sync (jobs stuck for more than 2 minutes), so one dead job can never block them.

## Installable app (PWA)

Nothing extra to configure: Vercel serves everything over HTTPS, which installation requires. After deploying, open the site on a phone, sign in, and within a few seconds the install prompt should appear (Android/Chrome: Install button; iPhone: Add to Home Screen steps). It will not reappear for 24 hours, or ever once the app is installed. `/sw.js` is served with `no-cache` so service worker updates are picked up on the next visit.

## Verification checklist

1. Vercel app loads; `/student-login` renders.
2. First-time login asks only for Verification Option and Last 4 Digits (no token field).
3. Wrong PIN → "Invalid portal credentials or 4-digit PIN" and the form reopens with the error.
4. Correct PIN → redirected to the dashboard with a `syncJobId` param; polling goes
   pending → running → success and subjects plus exam history appear.
5. Drizzle Studio (`npm run db:studio`) shows the `scrape_jobs` row `success` with
   `result_summary.method = "http"`, and `students.exam_history_updated_at` set.
6. Log out and in again straight away: instant login, no job.
7. Simulate staleness: set `details.last_updated` to two days ago for a test student, log in
   again — a `current` job runs in the background while the cached data stays visible.
8. Exam History → "Refresh results" works, and is disabled for 1 minute afterwards.
9. Set a job to `running` with an old `created_at`, then sync again — the old job is failed and a
   new one runs.
