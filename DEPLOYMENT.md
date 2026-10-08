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

`npm run db:migrate` applies **every migration that is still pending**, not only the newest. Check what your
database has already had before you run it (the repo has 12 migrations, `0000` to `0011`):

```sql
select id, created_at from drizzle.__drizzle_migrations order by id;   -- one row per migration applied
```

If that shows fewer than 12 rows, the missing ones run too, in order, including the irreversible `0008` above.

### The stats table (`0010`, `0011`) loses nothing

| Migration | What it does |
|---|---|
| `0010_add_app_stats.sql` | Creates the new `app_stats` table. |
| `0011_app_stats_triggers.sql` | Creates functions, triggers and a view, then fills `app_stats` from the current students. |

They only **add** objects. Neither touches a row, column, index or constraint of `students` or `scrape_jobs`:
the tests snapshot every existing row as JSON plus both tables' columns, indexes and constraints before and after,
and require them to be identical (`src/lib/db/appStatsMigration.test.ts`). `drizzle-kit migrate` runs all pending
migrations in a single transaction on this setup, so a failure rolls everything back; the files are also safe to
re-run if it ever stops half-way. The triggers briefly lock `students` and `scrape_jobs` against writes while they
are created (milliseconds); a write in that moment waits, it is not lost.

To prove it on your own database:

1. **Restore point.** In the Neon console, create a branch of your production branch before migrating. It is
   instant and a safe place to rehearse (point `DATABASE_URL` at the branch for a dry run first).
2. **Fingerprint before and after,** at a quiet time. The two results must match exactly:
   ```sql
   select 'students' as tbl, count(*), md5(string_agg(s::text, '' order by usn)) from students s
   union all
   select 'scrape_jobs', count(*), md5(string_agg(j::text, '' order by id)) from scrape_jobs j;
   ```
   (A student syncing between the two readings legitimately changes a row, so a differing hash with equal counts
   during live traffic is a normal write, not loss. Counts must never drop.)
3. **Check the stats** are right: `select * from app_stats_summary order by key;`, then compare `students_total`
   with `select count(*) from students`.

**Rolling back** (removes only the stats; no student or job data is involved):

```sql
drop view if exists app_stats_summary;
drop trigger if exists students_stats_insert on students;
drop trigger if exists students_stats_delete on students;
drop trigger if exists students_stats_year_change on students;
drop trigger if exists scrape_jobs_stats_delete on scrape_jobs;
drop function if exists students_stats_trigger(), scrape_jobs_purged_trigger(), refresh_app_stats(), app_stats_bump(text[], bigint[]);
drop table if exists app_stats;
-- so a later `npm run db:migrate` applies them again:
delete from drizzle.__drizzle_migrations where id in (select id from drizzle.__drizzle_migrations order by id desc limit 2);
```

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

## When the college portal is down

The dashboard never depends on the portal to open: it always serves what is saved in the database.
If a sync fails because the portal cannot be reached (network error, timeout, an HTTP error, or a
login page the client can no longer replay), the job is recorded as failed with
`result_summary.failureKind = "portal_unavailable"` and the student sees a banner, "The college portal
isn't responding right now. You're seeing your saved data…", instead of an error. Saved data is never
overwritten by a failed sync. The banner clears after the next successful sync.

A wrong PIN is recorded as `credentials_rejected` and anything else as `other`; neither shows the banner.
Brand-new students cannot sign in while the portal is down, because their details are checked against it
before anything is stored; they get "Could not reach the college portal right now".

## Monitoring

`GET /api/health` runs `select 1` against the database and answers `200 {"status":"ok"}`, or `503` if the
database is unreachable or takes longer than 5 seconds. It returns no student data and no error details,
and it never calls the college portal, so a portal outage does not look like an app outage.

Set up a free uptime monitor (for example UptimeRobot or Better Stack) yourself; it needs your account:

1. Create an HTTP(S) monitor for `https://<your-domain>/api/health`.
2. Use the **GET** method if the service offers a choice, and expect status `200`.
3. Add your email (or phone push) as the alert contact.
4. Choose the check interval carefully: Neon's free compute is billed by the time the database is awake
   and it sleeps after about 5 idle minutes, so a check every 5 minutes can keep it awake all month and
   use up the free allowance. As I understand the free limits (verify them on Neon's pricing page), an
   interval of 15–30 minutes is a safer balance between detecting outages and staying inside the quota.

## Rolling back a bad deploy

Every push to `main` is built and promoted to Production, so a bad merge reaches students immediately.
If the site is broken after a deploy:

1. **Fastest, in the Vercel dashboard:** open **Deployments**, find the last deployment that was
   **Ready** and worked, open its **⋯** menu and choose **Instant Rollback** (or **Promote to Production**).
   This takes effect in seconds without touching git. On the Hobby plan Vercel may only allow rolling back
   to the previous production deployment; if the option is missing, use step 2.
2. **Permanent fix in git:** create a branch from `main` (`git checkout -b fix/revert-<name>`), run
   `git revert -m 1 <merge-commit-sha>` for the bad merge, then merge that branch into `main` and push. Do
   this after step 1 as well, otherwise the next push to `main` would redeploy the bad code.
3. **Check it:** open `/api/health`, then log in and open the dashboard.

A code rollback does **not** undo database migrations. Migrations here are applied by hand with
`npm run db:migrate`; take a backup before running one, and prefer migrations that only add things.
Deploy code that needs a new column only after that migration has been applied.

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
10. Open `/api/health` in a browser: it shows `{"status":"ok"}` with status 200.
11. Simulate an outage on a local `npm run dev`: add `127.0.0.1 parents.msrit.edu` to your hosts file, press
    Update Dashboard, and the amber "portal isn't responding" banner appears while the data stays on screen.
    (Remove the hosts entry afterwards.) The failed job row has `result_summary.failureKind = "portal_unavailable"`.
