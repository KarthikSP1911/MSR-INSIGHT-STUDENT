# Database backup and restore

The app's data lives in one Neon Postgres database (`students`, `scrape_jobs`). This is how it is backed up
and how to get it back. Two other things keep the app usable during an outage but are **not backups**:

- the copy of each student's profile saved in their browser (a per-device cache, see the README), and
- Neon's own point-in-time restore window (check the current length for your plan in the Neon console).

## What the backup is

`.github/workflows/db-backup.yml` runs every night (02:17 UTC) and on demand. It runs `pg_dump`, checks the
archive is readable, encrypts it with AES-256 (`gpg --symmetric`) and uploads it as the `db-backup` workflow
artifact, kept for 14 days.

The dump contains date of birth, marks and the **encrypted** portal PINs. It is encrypted even though the
repository should be private, because anyone who can read the repository's artifacts can download it.

## One-time setup (needs your GitHub and Neon accounts)

1. Make sure the repository is **private**.
2. In Neon, copy the **direct** connection string (the host *without* `-pooler`). `pg_dump` does not work
   reliably through the pooler. Use a read-only role if you create one.
3. Repository → Settings → Secrets and variables → Actions → add:
   - `BACKUP_DATABASE_URL`: the direct connection string.
   - `BACKUP_PASSPHRASE`: a long random passphrase (`openssl rand -base64 32`).
4. In the workflow file, set `PG_MAJOR` to the Postgres version shown in the Neon console. `pg_dump` must be at
   least as new as the server.
5. Actions → *Database backup* → **Run workflow**. Open the run, confirm it is green and that a `db-backup`
   artifact exists. Do the restore drill below once, so you know it works before you need it.

GitHub pauses scheduled workflows after about 60 days without repository activity, so check the Actions tab now
and then.

## Keep these outside the repository

A restore is impossible without them. Store them in a password manager:

- `BACKUP_PASSPHRASE`
- **`ENCRYPTION_SECRET`**: the dump holds `encrypted_pin` values that only decrypt with the same secret. If it
  is lost, every student must enter their PIN again.
- `JWT_SECRET` (changing it just signs everyone out).

## Restore

1. Download the newest `db-backup` artifact (Actions → run → Artifacts, or `gh run download`) and unzip it.
2. Decrypt:
   ```bash
   gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
     --output restore.dump --decrypt db-YYYYMMDDTHHMMSSZ.dump.gpg
   ```
3. Create an empty target: a new Neon branch or database (or a local Postgres for a drill). Use a direct
   connection string.
4. Load it:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$TARGET_DATABASE_URL" restore.dump
   ```
5. Point the app at it: set `DATABASE_URL` in the Vercel project to the new string and redeploy. Keep
   `ENCRYPTION_SECRET` unchanged.
6. Check `/api/health` returns `200`, then sign in and open the dashboard. The dump includes Drizzle's
   migration history, so do not re-run `npm run db:migrate` unless a migration is genuinely pending.

## Restore drill (do this once)

Restore into a scratch Neon branch or a throwaway local database, then compare row counts with production:

```sql
select count(*) from students;
select count(*) from scrape_jobs;
```

Delete the scratch target afterwards. The decrypted `restore.dump` contains personal data: delete it too.

## Limits

- A backup is at most a day old, and only the last 14 are kept. Students who synced after the last dump re-sync
  on their next sign-in.
- The dump uses a few seconds of database compute each night, which counts toward Neon's free allowance.
