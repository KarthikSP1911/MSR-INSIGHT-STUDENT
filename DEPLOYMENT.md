# Deploying MSR Insight Student Dashboard to Vercel

## Overview

The entire app — UI, API routes, and the portal scrape runner — deploys as a single
Next.js project to Vercel's free (Hobby) tier. No second host (Render, Fly, Railway, etc.)
is needed. Since the scraper connects to a **per-student Browserless.io remote browser**
over a WebSocket instead of launching a local Chromium process, the whole scrape fits
comfortably inside Vercel's serverless function execution window.

## Architecture recap

```
Browser → Vercel (Next.js)
                ├─ /api/auth/login         ← validates token, enqueues job
                ├─ /api/report/update      ← enqueues job
                ├─ /api/scrape-jobs/run    ← claims job, connects to Browserless, scrapes
                └─ /api/scrape-jobs/[id]   ← polled by useScrapeJobPolling
                                   ↕
                         Neon Postgres (scrape_jobs + students)
                                   ↕
              Browserless.io (per-student remote Chromium)
```

## Part 1 — Vercel: deploy the Next.js app

1. **Vercel dashboard**: vercel.com → Add New → Project → import the GitHub repo.
   Framework preset auto-detects as Next.js; root directory = repo root.

2. **Environment variables** (Project Settings → Environment Variables, apply to
   Production + Preview):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon Postgres connection string (pooled variant). |
   | `JWT_SECRET` | Long random secret — `openssl rand -base64 32`. |
   | `ENCRYPTION_SECRET` | Different long random secret — `openssl rand -base64 32`. |

   > **That's it.** No `PUPPETEER_SKIP_DOWNLOAD`, no `PUPPETEER_EXECUTABLE_PATH`, no
   > `BROWSERLESS_TOKEN` global env var — tokens are per-student and stored encrypted in
   > Postgres, not in env.

3. Trigger the deploy (push to the connected branch, or "Deploy" in the dashboard).

4. Verify: build succeeds, `/student-login` loads at the `*.vercel.app` URL.

No `vercel.json` is required.

## Part 2 — Database

The existing Neon database and connection string are reused. Confirm migrations are current:

```bash
npm run db:migrate   # DATABASE_URL pointed at your Neon project
```

The latest migration (`drizzle/0006_same_shocker.sql`) adds:
- `students.encrypted_browserless_token` (text, nullable)
- `students.browserless_token_valid` (boolean, default true)
- `scrape_jobs.encrypted_browserless_token` (text, nullable)

## Part 3 — Per-student Browserless.io tokens

Students provide their own [Browserless.io](https://www.browserless.io) API token at
first login. Browserless offers a **free tier** sufficient for one student's scrape volume.

**Where to get a token:**
1. Sign up at [browserless.io](https://www.browserless.io).
2. Go to Account → API Key.
3. Copy the token and paste it into the login form's "Browserless API Token" field.

**Security:** the token is validated synchronously on submission (5-second test-connect to
`wss://chrome.browserless.io`), then encrypted with AES-256-GCM (same scheme as the portal
PIN) before being stored on `students.encrypted_browserless_token` and snapshotted into the
`scrape_jobs` row. It is never returned by any API response, never logged, and never included
in error messages.

**Token expiry:** if Browserless rejects a token during a scrape, `browserlessTokenValid` is
flipped `false` on the student row and the job is marked `failed` with error
`browserless_token_invalid`. The next login re-prompts specifically for a new token (PIN is
not required again if still valid).

## Part 4 — Scrape route timeout

`POST /api/scrape-jobs/run` has `export const maxDuration = 60` (Vercel Hobby limit).

| Scope | Typical time | Notes |
|---|---|---|
| `recurring` (login) | 15–30s | Skips exam-history page; merges from prior scrape |
| `full` (manual sync) | 20–40s | Fetches all pages including exam history |

If a scrape exceeds 60s, Vercel terminates the function and the job row stays in `running`
until the client's `MAX_POLL_MS` (6 min) backstop fires, surfacing a timeout to the student.
The student can retry via "Sync now" once the 5-minute cooldown expires.

## Verification checklist

1. Vercel app loads; `/student-login` renders.
2. First-time login shows secondary auth section with Verification Option, Last 4 Digits,
   and Browserless API Token fields.
3. Submit with an invalid Browserless token → inline error under the token field, form stays
   open, no session minted.
4. Submit with a valid token + correct PIN → session minted, redirected to dashboard with
   `syncJobId` param.
5. Dashboard's `useScrapeJobPolling` transitions: pending → running → success.
6. Drizzle Studio (`npm run db:studio`) confirms:
   - `scrape_jobs` row reached `success`.
   - `students` row has `encrypted_browserless_token` set, `browserless_token_valid = true`.
7. "Sync now" button works after 5-minute cooldown.
8. Simulate a bad token: manually set `browserless_token_valid = false` in the DB, then
   log in again — secondary auth section should reopen showing only the token field.