# Scraping Architecture

This document explains how the app pulls student data from the college
parent portal (`https://parents.msrit.edu/newparents/`) and turns it into
the `students.details` JSON blob the dashboard reads.

The scraper logic was ported near-verbatim from the original MSR-Insight
Express backend (`backend/express/src/services/scraper/*.js`) into
TypeScript under `src/lib/scraper/`, but the *execution model* changed:
instead of scraping synchronously inside an HTTP request, it now runs as a
background job processed by a standalone worker process.

## Why a separate worker process

Puppeteer (a real headless Chromium) is too slow/heavy to run inside a
Next.js route handler on every login — a login request would block for the
whole scrape (page navigation, login, N attendance/CIE/exam/placement
fetches). Instead:

1. The Next.js API route just **enqueues a job** in a Postgres-backed queue
   table (`scrape_jobs`) and returns immediately.
2. A **separate long-running Node process** (`worker/scraper-worker.ts`,
   started via `npm run worker`) polls that table, claims jobs, and does the
   actual scraping with Puppeteer.
3. The frontend polls a status endpoint until the job finishes.

There's no Redis/RabbitMQ/BullMQ in this stack — the queue is just a
Postgres table with `status` (`pending` → `running` → `success`/`failed`),
polled every 3s, with `SELECT ... FOR UPDATE SKIP LOCKED` used to safely
claim a job even if multiple workers were ever run concurrently.

## End-to-end flow

```
Login form (student-login)
        │  POST /api/auth/login  { usn, dob, authType?, last4Digits? }
        ▼
src/app/api/auth/login/route.ts
        │
        ├─ instant login? (cached scrape + stored PIN + no forced resync)
        │     → sign session cookie, return { jobId: null }
        │
        └─ otherwise: enqueueScrapeJob() → scrape_jobs row (status=pending)
              → sign session cookie, return { jobId }
                        │
                        ▼
        Dashboard polls GET /api/scrape-jobs/[id] every ~2s
                        ▲
                        │ updates status/result
worker/scraper-worker.ts (separate `npm run worker` process)
        │  loop: claim next pending job (skip-locked) every 3s
        ▼
src/lib/scraper/scrapeAndSync.ts  scrapeAndSyncStudent()
        │
        ├─ parseDobParts()                  DOB string → { day, month, year }
        ├─ getCompleteStudentData()         puppeteerClient.ts (Puppeteer + axios)
        ├─ parseAndProcessData()            htmlParser.ts (cheerio)
        ├─ normalizeStudentRecord()         dataNormalizer.ts
        └─ UPDATE students SET details=..., encryptedPin=..., currentYear=...
```

## Module breakdown (`src/lib/scraper/`)

### `puppeteerClient.ts` — `getCompleteStudentData()`

Does all the actual browser/network work against the portal:

1. Launches (or reuses a shared, worker-provided) headless Chromium via
   Puppeteer. Images/stylesheets/fonts/media are blocked via
   `page.setRequestInterception` — only the HTML matters, so blocking these
   speeds up every navigation.
2. Navigates to the portal login page, fills in `#username` (the USN) and
   the DOB date-select dropdowns (`#dd`, `#mm`, `#yyyy`), and submits.
3. Detects whether the portal is asking for **secondary auth** (a 4-digit
   PIN tied to Father Mobile / Mother Mobile / ABC ID — `authType` selects
   which). If so, and a PIN (`last4Digits`) was supplied, it fills the
   digit inputs and submits again.
4. Confirms login succeeded by checking the resulting URL/HTML for
   dashboard markers (`LOGOUT` link, `dashboard`/`ksign` in the URL) while
   explicitly guarding against a false-positive: the portal's own
   login-error page still contains the literal string `"LOGOUT"` in its
   static layout, so an explicit error-text regex
   (`does not exist|invalid username|invalid password|...`) is checked
   first and always wins. A failed login throws, which the worker records
   as a `failed` job with the error message.
5. Once logged in, it reads the dashboard HTML and the session cookies,
   then closes the Puppeteer page/browser — **all remaining requests are
   plain HTTP** (via `axios`, replaying the session cookie), not more
   browser navigation.
6. Parses the dashboard HTML with `cheerio` (via `htmlParser.ts`'s
   `extractCourseRowsFromDashboard`) to find each enrolled course's
   attendance-detail and CIE-detail links.
7. Builds a list of URLs to fetch: each course's attendance page, each
   course's CIE page, the exam-history page, and four placement pages
   (eligibility, status, results, profile).
8. Fetches all of them concurrently, capped at 6 in flight
   (`mapWithConcurrency`, `concurrency.ts`) with a small random delay
   (100–500ms) per request to avoid hammering the portal, and tolerates
   individual fetch failures (returns `""` HTML rather than throwing).
9. Returns a `ScrapedData` object: raw HTML strings keyed by course code
   (`attendance`, `cie`) plus `dashboard`, `exams`, and the four
   `placement*` fields.

### `htmlParser.ts` — `parseAndProcessData()`

Pure HTML parsing (cheerio), no network calls. Converts the raw
`ScrapedData` HTML blobs into an intermediate `RawScrapedRecord`:

- `extractCourseRowsFromDashboard()` — finds course rows in the dashboard
  table, extracting course code/name and the attendance/CIE links. Falls
  back through three selector strategies (specific `dash_od_row` table →
  any table row with an attendance/CIE link → any row that looks like a
  course-code row) to tolerate portal markup drift.
- Per-course attendance parsing — reads present/absent/remaining counts
  from `[N]`-bracketed spans (with text-regex fallbacks), plus lists of
  present/absent dates from two date tables.
- Per-course CIE parsing — reads the CIE eligibility flag from a table
  column, and extracts test scores from an inline `var chartData = [...]`
  JS array embedded in the page (`extractChartDataJsonArray()` does a
  balanced-bracket scan since the JSON isn't always strictly valid — it
  strips trailing commas before `JSON.parse`).
- Exam history parsing — CGPA from the first paragraph containing a
  decimal number, and one entry per `table.res-table` (one per semester),
  reading SGPA/credits from the caption and per-course grade rows from
  `tbody`.
- Placement parsing — `parsePlacementEvents()` (list-based events, falling
  back to generic tables) for eligibility/status/results, and
  `parsePlacementProfile()` (label/value pairs from several possible DOM
  shapes: dedicated profile rows, 2-column tables, form groups, bare
  inputs) for the profile page. Keys containing `token`/`submit` are
  filtered out defensively.

### `dataNormalizer.ts` — `normalizeStudentRecord()`

Converts the intermediate record into the final `StudentDetails` shape
persisted to `students.details`:

- Computes attendance percentage per subject (`present / (present+absent)`,
  rounded).
- Standardizes assessment names into `T1`/`T2`/`T3`/`T4`/`AQ1`/`AQ2`/`AQ3`/
  `FINAL CIE` via regex (`standardizeAssessmentType`), discarding anything
  that doesn't match and anything non-numeric (`-`, empty, etc. via
  `isValidNumeric`).
- Computes each subject's `marks` total as
  `round((T1+T2)/2) [or max(T1,T2) if only one is present] + AQ1 + AQ2`.
- Derives `current_year` from the class-details string's semester number
  (`SEM 0N` → `year = ceil(N/2)`, standard B.E. programme mapping).
- Passes `exam_history` and `placement` through largely as-is.

### `concurrency.ts` — `mapWithConcurrency()`

Generic bounded-parallelism helper (worker-pool pattern): runs an async
function over a list of items with at most `limit` in flight at once. Used
solely to cap the portal HTTP fan-out at 6 concurrent requests.

### `scrapeAndSync.ts` — `scrapeAndSyncStudent()`

The orchestration entry point called by the worker:

1. `parseDobParts()` — parses `DD-MM-YYYY`, `YYYY-MM-DD`, or any
   `Date`-parseable string into the `{ day, month, year }` parts the portal
   form needs (throws on unparseable input).
2. Calls `getCompleteStudentData()` then `parseAndProcessData()` (which
   internally calls `normalizeStudentRecord()`).
3. Persists the result: `UPDATE students SET name, dob, authType,
   encryptedPin, currentYear, details, updatedAt WHERE usn = ...` — note
   the PIN that was actually used for this successful scrape is
   **re-encrypted and stored**, so a future login can go through the
   "instant login" path without asking for the PIN again.

## The job queue (`scrape_jobs` table + worker)

Schema (`src/lib/db/schema.ts`):

- `usn`, `dob`, `authType`, `encryptedPin` — snapshot of what to scrape
  with (the PIN is encrypted before insert, in `enqueueScrapeJob()`
  (`src/lib/scrapeJobs.ts`) — never stored in plaintext, even transiently).
- `trigger` — one of `login`, `manual_update`, `requires_secondary_auth_retry`.
- `status` — `pending` → `running` → `success` | `failed`.
- `error`, `resultSummary` (`{ subjectsCount, examHistoryCount }`),
  `createdAt`/`startedAt`/`finishedAt`.
- Indexes on `(status, createdAt)` (for the polling claim query) and
  `(usn, status)` (for per-student lookups).

`worker/scraper-worker.ts`:

- Runs as its own process (`npm run worker`, `tsx watch`), separate from
  `next dev`/`next start`.
- Keeps a single Chromium instance alive across jobs (`getOrLaunchBrowser`)
  — only a `page.newPage()`/`page.close()` per job, not a full browser
  launch — since browser boot is by far the most expensive part of a
  scrape. Relaunches automatically if the browser disconnects.
- Loop: `claimNextJob()` (a transaction using
  `SELECT ... FOR UPDATE SKIP LOCKED` to atomically grab the oldest
  pending job and flip it to `running`) → `processJob()` → sleep 3s if
  nothing was pending.
- `processJob()` decrypts the job's PIN, calls `scrapeAndSyncStudent()`,
  and writes back `success`/`failed` with the result summary or error
  message. Graceful shutdown on `SIGINT`/`SIGTERM`.

## API surface

- **`POST /api/auth/login`** (`src/app/api/auth/login/route.ts`) — USN +
  DOB (+ optional `authType`/`last4Digits` secondary auth,
  `forceResync`). Three outcomes:
  - **Instant login**: cached scrape exists, PIN is stored, and no forced
    resync/new PIN was given → signs the session cookie immediately,
    `jobId: null`.
  - **Needs secondary auth**: no PIN available (first login, or DOB
    changed and no PIN given) → returns `requiresSecondaryAuth: true`
    without enqueuing anything.
  - **Enqueue**: otherwise creates/updates the `students` row and calls
    `enqueueScrapeJob()`, signs the session cookie right away (so the user
    is "logged in" while the sync runs in the background), and returns the
    `jobId`.
  - A DOB mismatch is only treated as an auth failure once the existing
    row has confirmed scraped data (`hasScrapedData`) — an existing row
    with no scraped data is just an unverified placeholder from a prior
    failed first attempt, so it's allowed to be overwritten by a corrected
    retry.
- **`GET /api/scrape-jobs/[id]`** (`src/app/api/scrape-jobs/[id]/route.ts`)
  — polled by the dashboard (`page.tsx`, `setSyncJobId` /
  `syncJobId`) roughly every 2s until the job reaches `success`/`failed`;
  returns `status`, `error`, `resultSummary`. Scoped to the authenticated
  session's USN (403/404 otherwise).

## Security/robustness notes

- PIN is **never** persisted in plaintext — encrypted (`encryptText`/
  `decryptText`, `src/lib/auth/crypto.ts`) both in `students.encryptedPin`
  and in the transient `scrape_jobs.encryptedPin` snapshot.
- `axios` is configured with `rejectUnauthorized: false` on its HTTPS
  agent — TLS verification is disabled for the portal's HTTP client calls
  (only for the post-Puppeteer-login HTTP fetches, not the Puppeteer
  navigation itself).
- Fetch failures for individual sub-pages (attendance/CIE/exam/placement)
  are swallowed and return empty HTML rather than failing the whole job —
  downstream parsing treats missing HTML as "no data" rather than
  crashing.
- Login failure detection explicitly special-cases the portal's
  error-page false positive (see `puppeteerClient.ts` notes above) so a
  wrong USN/DOB/PIN reliably throws instead of silently succeeding with an
  empty record.

## Running it locally

```
npm run dev      # Next.js app
npm run worker   # separate terminal — the scraper worker (tsx watch)
```

Both need the same `DATABASE_URL` (via `src/lib/db/client.ts` /
`src/lib/db/workerClient.ts`) since the queue is just a shared Postgres
table.
