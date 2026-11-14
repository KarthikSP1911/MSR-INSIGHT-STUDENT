# Deploying MSR Insight Student Dashboard to Vercel

## Overview

The entire app — UI, API routes, and the portal scraper — deploys as a single Next.js project to
Vercel's free (Hobby) tier. No second host (Render, Fly, Railway, etc.) is needed. The scraper logs in to
the college portal in a remote Chromium on Browserless.io, using a token each student supplies for
themselves (so there is no browser to host and no shared Browserless bill), then fetches the pages with
plain HTTP, which fits inside a serverless function.

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
                  parents.msrit.edu (login via Browserless, then plain HTTPS requests)
```

Routes that scrape export `maxDuration = 60` and run the job inside Next's `after()`, which keeps
the invocation alive after the response is sent. Each job also has its own 45-second deadline, so it
fails cleanly with a message instead of being killed by the platform.

## Part 1 — Database

Apply the migrations to your Neon database **before** deploying the new code:

```bash
npm run db:migrate   # DATABASE_URL pointed at your Neon project
```

These migrations change existing data:

| Migration | What it does |
|---|---|
| `0008_drop_browserless_columns.sql` | Drops `students.encrypted_browserless_token`, `students.browserless_token_valid`, `scrape_jobs.encrypted_browserless_token`. **Irreversible**: saved Browserless tokens are deleted (they are no longer used). |
| `0014_restore_browserless_columns.sql` | Adds `students.encrypted_browserless_token`, `students.browserless_token_valid` and `scrape_jobs.encrypted_browserless_token` back. The columns start empty (0008 deleted the old tokens), so every existing student is asked for a Browserless token at their next sign-in, and manual refreshes send them to the login page until they enter one. |
| `0009_split_exam_history.sql` | Adds `students.exam_history`, `students.cgpa`, `students.exam_history_updated_at`, copies each student's existing exam history and CGPA out of `details` into them, and renames the job scope `recurring` to `current`. |

The previous deployment reads the dropped columns, so it will error between migrating and the new
deploy going live; do the two back to back. Take a Neon branch/backup first if you want a rollback
point.

`npm run db:migrate` applies **every migration that is still pending**, not only the newest. Check what your
database has already had before you run it (the repo has 13 migrations, `0000` to `0012`):

```sql
select id, created_at from drizzle.__drizzle_migrations order by id;   -- one row per migration applied
```

If that shows fewer than 13 rows, the missing ones run too, in order. (Production already has `0000` to `0011`,
so a plain `npm run db:migrate` now applies only `0012` below.)

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

That rollback assumes `0010`/`0011` are the newest migrations. If `0012` and `0013` have also been applied, use
`limit 4` and also `drop function if exists year_from_usn(text, timestamptz), refresh_student_years(timestamptz);`
(the years they set stay as they are).

### The student year (`0012`, `0013`)

A student's `current_year` is worked out from the batch in their USN (`1MS23IS051` is the 2023 batch), not read
from the portal's page, whose layout change on 2026-10-07 had reset the year to 0 on every sync. The academic year
starts on **1 August**; year = academic year − batch + 1, and lateral-entry serials (`4xx`) are + 2.

- **Years 1 to 4** are the programme. **Year 5 means senior**: a student still on the rolls after the 4 years. In
  2026-27 that is every batch below 23 (`1MS22…` and earlier, 18 to 22 in your data); a batch not yet started
  counts as year 1.
- **It rolls forward every year by itself.** On 1 August 2027 batch 23 becomes seniors and the cutoff moves up
  to "below 24", and so on. A student's sync updates their own year, and a yearly scheduled job updates everyone
  else (see below).

`src/lib/academicYear.ts` is the rule; its SQL twin `year_from_usn()` is tested to agree with it. `0012` set the
year for students already stored (held to 1–4); `0013` added the senior year and re-applied the rule. Both write
**only the `current_year` column**: not `updated_at`, nor any other column, and they only touch rows whose year
actually differs. Neither can be edited after it has been applied, so later rule changes get a new migration.

**Deploy the code before (or with) these migrations.** The deployed app still derives the year from the page, so it
would write 0 back on each student's next sync until the new code is live.

To move everyone to the right year by hand at any time:

```sql
select refresh_student_years();   -- returns how many students changed; safe to repeat
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
   | `CRON_SECRET` | A third long random secret. Protects the yearly student-year job (below); the job refuses to run without it. |

   There is nothing Browserless-related to configure on Vercel: each student pastes their own Browserless.io
   token on the login form.

3. Trigger the deploy (push to the connected branch, or "Deploy" in the dashboard).

4. Verify: build succeeds, `/student-login` loads at the `*.vercel.app` URL.

`vercel.json` holds one setting, the yearly job described next.

### The yearly student-year job

`vercel.json` runs `GET /api/cron/refresh-student-years` at 02:00 UTC on **1 to 7 August** every year, right after
the academic year starts. It runs `refresh_student_years()` (see [The student year](#the-student-year-0012-0013)),
which moves every student to the year their USN's batch implies, seniors (year 5) included, and so keeps the
per-year counts in `app_stats` right with nobody running anything. Students who sign in are updated by their own
sync anyway; this covers the rest.

- Vercel sends `Authorization: Bearer $CRON_SECRET` itself once `CRON_SECRET` is set, so **set that variable**.
  Without it the route answers 503 and does nothing, and with a wrong value it answers 401, so it can never be run
  by the public.
- It is scheduled for seven days, not one, on purpose: it only changes students whose year differs, so repeating it
  is harmless, and a run that fails (say the database is down that day) is retried the next day.
- Hobby plans allow cron jobs once a day at most, which fits. It wakes the database for a moment on those seven days
  only.
- Check it in the Vercel dashboard (Project → Cron Jobs), or run it by hand (replace the values):
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron/refresh-student-years` returns
  `{"success":true,"changed":<how many students moved>}`.

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

## Pausing the site

`SITE_SHUTDOWN` is the kill switch, and it defaults to **on**: the code is paused unless the variable is exactly
`false`. While paused, the login page shows a "Temporarily paused" overlay, `/api/*` answers `503`, `/student/*`
redirects to login, and nothing in the app contacts `parents.msrit.edu`. `/api/health`, the yearly cron (database
only) and logout keep working. Because the default is paused, deploying this code is enough; no Vercel variable
is needed.

To resume once you have permission: add `SITE_SHUTDOWN=false` to the Production environment in Vercel and
redeploy (environment changes only apply to new deployments). To pause again, remove the variable or set it to
anything else, and redeploy.

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

## When the database is down

Neon's free tier suspends compute when the monthly allowance is used up, and a cold start can be slow. The app
degrades instead of breaking:

- A signed-in student sees the profile copy saved in their browser, with a banner, and the page returns to live
  data by itself once the database answers (it rechecks every minute).
- Sign-in still works if the student types their PIN: the portal proves the details and supplies the data, and
  nothing is written. Students who signed in this way are asked to sign in once more when the database returns, so
  their row is created.
- Manual refresh needs the database (it holds the saved PIN), so it sends the student to the sign-in form.

Check **Neon console → Usage** now and then. The free compute allowance is consumed by time awake, not by query
count, so the biggest levers are the uptime-monitor interval below and not polling `/api/health` often. Upgrading
the Neon plan is the real fix if the allowance keeps running out.

Backups: see [docs/BACKUP.md](docs/BACKUP.md). Add the `BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE` repository
secrets, run the workflow once and rehearse a restore.

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
