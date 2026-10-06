# How scraping works

Everything the dashboard shows comes from the college parent portal
(`https://parents.msrit.edu/newparents/`). A scrape logs in as the student with plain HTTP, fetches
the pages it needs, parses them, and writes the result onto the student's row. There is no browser
and no separate worker process: the scrape runs inside the Vercel function that queued it.

## Pipeline

```
route (login / update / report)
  └─ enqueueScrapeJob()            scrape_jobs row, PIN encrypted, one active job per USN
  └─ runJobAfterResponse()         after(): keeps the function alive past the response
       └─ claimAndRunJob()         claims the job, 45s deadline, records success / failure
            └─ scrapeAndSyncStudent()
                 ├─ getCompleteStudentData()   portalScraper.ts
                 │    ├─ loginToPortal()       portalHttpClient.ts   (2-step login over fetch)
                 │    └─ planFetchTargets()    which sub-pages this scope needs
                 │       + axios fan-out       6 at a time, retries on 429/5xx
                 ├─ parseCurrentSemester()     htmlParser.ts + dataNormalizer.ts  -> students.details
                 └─ parseExamHistory()         htmlParser.ts                       -> students.examHistory, cgpa
```

## Login (`portalHttpClient.ts`)

The portal is a Joomla app with a two-step form:

1. `GET /newparents/` and parse `#login-form`. It contains a per-session CSRF hidden input whose
   **name** is 32 hex characters (value `1`), so it is found by pattern, not hard-coded.
2. `POST index.php` with `username`, the `dd`/`mm`/`yyyy` selects, `passwd = yyyy-mm-dd`,
   `option=com_user`, `task=loginOtp` and the CSRF field. The page's own submit handler
   (`check1()`) is not defined and the invisible reCAPTCHA token is not verified server-side, so
   `captcha-response` is sent empty.
3. The response is the PIN form (`idType` 1/2/3 for father / mother / ABC ID, and `enteredid`).
   Its hidden fields are copied and `idType` + `enteredid` are set.
4. The redirect lands on the dashboard; the session cookie is kept for the sub-page requests.

Failures are typed: `PortalAuthError` (wrong USN, DOB or PIN; the message is safe to show students)
and `PortalLoginUnsupportedError` (login page markup changed). Every request has a timeout and the
whole login has a deadline.

## What each scope fetches (`planFetchTargets`)

| Scope | Pages | Writes |
|---|---|---|
| `current` | each course's attendance page and CIE page | `students.details` (and `name`, `current_year`) |
| `exam_history` | the exam-results page only | `students.exam_history`, `cgpa`, `exam_history_updated_at` |
| `full` | all of the above | both |

A sub-page that still fails after its retries fails the whole job. Parsing an empty page would
produce "0 classes attended / no marks" and overwrite good data, so the previous data is kept instead.

The portal's Placement section is never requested, parsed or stored.

## When scrapes run (`scrapePolicy.ts`)

- Login: `scopeForStaleness` compares `details.last_updated` (24h) and `examHistoryUpdatedAt` (7d).
  Both stale means one `full` job; nothing stale means no job. Login never waits for it.
- After a failed sync, login does not auto-sync again for 15 minutes.
- Manual buttons: "Update Dashboard" (`current`) and "Refresh results" (`exam_history`), each with a
  1-minute cooldown measured from its own last successful scrape.

## Job queue (`scrape_jobs`)

- A partial unique index allows one `pending`/`running` job per USN; enqueueing again returns the
  job already in flight.
- Before inserting, `enqueueScrapeJob` fails jobs older than 2 minutes that are still pending or
  running (the function was killed), so a dead job cannot block a student.
- `claimAndRunJob` claims with `UPDATE ... WHERE status = 'pending'`, so a duplicate invocation does
  nothing. `result_summary` records per-phase timings (`loginMs`, `pinMs`, `fetchMs`, `parseMs`,
  `dbMs`, `requestCount`, `bytesDownloaded`) and `method: "http"`.

## Parsing notes

- Course rows come from the dashboard table (`dash_od_row`); falls back to any table row with an
  attendance or CIE link.
- Attendance pages expose `[n]` counts in `cn-attend` / `cn-absent` / `cn-still` spans plus date tables.
- CIE pages embed a `var chartData = [...]` JSON array; it is extracted with bracket matching and
  trailing commas are stripped before `JSON.parse`.
- Subject `marks` = best of T1/T2 (or their average when both exist) + AQ1 + AQ2.
- `current_year` is `ceil(semester / 2)` from the class line (`SEM 06` is year 3).

## Testing

`npm test` never contacts the portal. The login client is tested against a fake portal (`fetch` is
injected), the parsers against HTML fixtures, and the queue, runner and migrations against an
in-memory Postgres (pglite) built from the real migration files.

To check the live portal after a change, run a throwaway script from the git-ignored `.scratch/`
folder with your own credentials; do not commit it and do not paste credentials into chat or logs.
