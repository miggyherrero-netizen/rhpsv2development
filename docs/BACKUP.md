# Complete-database backup and restore (command line)

Two scripts copy the **business data** of the whole database into one file and load it into a fresh database:

| Command | What it does |
|---|---|
| `npm run db:export` | Reads the database (read-only) and writes `backups/herrero-backup-YYYYMMDD-HHMMSS.json.gz` |
| `npm run db:import -- <file>` | Dry run: checks the file and the target, writes nothing |
| `npm run db:import -- <file> --apply` | Loads the file into an **empty** database, all-or-nothing |

There is no screen, route or server action for this. It runs only when somebody types the command, against the database in
`DATABASE_URL` (environment or `.env`). It never runs by itself and never against production unless the owner deliberately
points `DATABASE_URL` at it. No `pg_dump` is needed. Works the same on Windows, macOS and Linux (Node 22+).

This **complements** a raw `pg_dump` backup, it does not replace it (see the end).

## 0. Handling the file (read this first)

The backup is **plain gzip JSON. gzip is compression, NOT encryption**: anyone who gets the file can read it. The sha256 checksums
detect damage and careless edits; they are **not a signature** and do not stop a determined attacker.

What personal and sensitive data is inside:

- customers: names, phones, e-mails, home addresses, `service_locations.access_notes` (gate codes, "key under the mat"), piano details;
- invoices, payments and their `reference` fields (GCash/bank references), expenses, payroll hourly rates and time entries;
- owner and staff e-mail addresses;
- `projects.portal_uuid`: the secret address of every client's private restoration journal (anyone holding it can open that page);
- free-text notes, the website text and the hero image saved in settings.

Rules: keep the file on **encrypted storage** (BitLocker/FileVault/LUKS or an encrypted container), never in chat, e-mail or a shared
drive, delete copies you no longer need. On Windows the file permission bits (0600/0700) are ignored: use a private folder on a
BitLocker/EFS-protected disk.

`portal_uuid`, access notes and payment references are an **accepted risk**: they are exported so a restore is complete (restored
portal links keep working). If you do not want old portal links to survive a restore, import with `--regenerate-portal-links`.

**If the file may have leaked:** (1) give every project a new portal link (`--regenerate-portal-links` on a restore, or ask for a
reset), (2) re-set all worker PINs, (3) change the owner password (`npm run gos:create-owner`), (4) rotate `AUTH_SECRET`
(everybody is logged out), (5) change the login-gate PIN, (6) warn affected customers if contact data was exposed.

## 1. Export

macOS / Linux:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DBNAME'   # or keep it in .env
npm run db:export
```

Windows PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/DBNAME'   # or keep it in .env
npm run db:export
```

- The script prints only the host and database name (never the URL or password), then one line per table with its row count.
- The file goes to `./backups/` (created if missing, ignored by git). Other folders: `--dir <folder outside the project>` or
  `--out <file>`. Inside the project folder only `./backups` is allowed; any other project path (src, docs, the project root...)
  is refused, for `--dir` and `--out` alike, unless you add `--force-inside-project`. The folder is created with mode 0700 and the
  file with 0600 (POSIX; ignored on Windows). An existing file is never overwritten.
- `settings` is exported through an **allow-list** (`staleUpdateDays`, `publicWebsiteContent`, `publicHeroImage`). Secret-looking rows
  are skipped and their key names are printed. Any other key makes the export **fail** with its name, so nothing unknown is copied
  silently; if it is a plain business setting, add it to `SETTINGS_ALLOWED_KEYS` in `src/lib/db-backup.ts`.
- Connections to non-local hosts use TLS with `rejectUnauthorized: false` (same as the app's `src/db`): the connection is encrypted but
  the server certificate is not verified.
- It is read-only: every query is a `SELECT` inside one `READ ONLY`, `REPEATABLE READ` transaction, so the file is a consistent
  snapshot even while the app is in use.
- The database must have this version's schema (all tables and columns). If the live database is behind, the export stops with a
  message; run the pending `drizzle/manual/*.sql` first.

**The file contains customers' personal data** (names, phones, addresses, invoices, payments). Treat it like a password: do not
send it by chat or e-mail, do not put it on a shared drive, store it encrypted (for example in an encrypted disk or password
manager attachment), and delete copies you no longer need. Backup files are never committed (`/backups/` is in `.gitignore`).

## 2. Restore into a fresh local database

Example with a local Postgres on port 5432. Use a **new, empty** database.

macOS / Linux:

```bash
createdb -h 127.0.0.1 -U postgres herrero_restore
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/herrero_restore'
npx drizzle-kit push                                  # 1. creates the empty tables
npm run db:import -- backups/herrero-backup-20261015-093000.json.gz           # 2. dry run
npm run db:import -- backups/herrero-backup-20261015-093000.json.gz --apply   # 3. load
```

Windows PowerShell:

```powershell
createdb -h 127.0.0.1 -U postgres herrero_restore
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/herrero_restore'
npx drizzle-kit push
npm run db:import -- backups\herrero-backup-20261015-093000.json.gz
npm run db:import -- backups\herrero-backup-20261015-093000.json.gz --apply
```

Optional flag: `--regenerate-portal-links` (after `--apply`) gives every project a new portal address; old links stop working.

(No `createdb`? Create the database with any Postgres tool, for example `CREATE DATABASE herrero_restore;` in psql.)

What each step checks:

1. **Dry run (default)** reads the file: valid gzip, valid JSON, manifest format, the per-table row count and sha256, the
   **schema fingerprint** (must equal this code's schema, otherwise it refuses and tells you to use the matching app version),
   that the file contains no secret column. It then checks the target has the app's tables and is **empty** (every table has
   0 rows), warns loudly about tables in `public` that this app version does not know (refuses if such a table holds rows), prints
   the plan with the users per role and the owner e-mails that will get a temporary password, and writes nothing.
2. **`--apply`** repeats those checks, locks all tables (`SHARE ROW EXCLUSIVE`, so a running app cannot write meanwhile), then inserts everything in **one transaction** in foreign-key order (parents first;
   the one self-reference, `service_catalog.package_id`, is inserted as NULL and filled afterwards), resets the serial
   sequences (job numbers, invoice numbers), then reads the data back and compares row counts and sha256 with the manifest. Any
   problem rolls everything back; the database stays empty.
3. It never deletes or truncates anything and has no "overwrite" mode. A second import into the same database is refused
   (not empty). It does not run `drizzle/manual` SQL or change the schema; that is what `npx drizzle-kit push` is for.
4. `--apply` needs an interactive terminal (see "Getting back in"). That works in Windows terminals too, but not when the output is
   piped or redirected, or in CI: it refuses, because the secrets are shown on screen only.
5. A target reached through an SSH tunnel or port-forward **looks local** (`127.0.0.1`). The "empty target" rule is then the only
   guard, so check which database `DATABASE_URL` really points to before `--apply`.

**Remote targets are refused.** Only `localhost`, `127.0.0.1` and `::1` are accepted. Anything else needs both
`--allow-remote` and the database name confirmed (typed at the prompt, or `--confirm-db-name=<name>`). Credentials are never
accepted as arguments, only `DATABASE_URL`.

## 3. Getting back in after a restore

Passwords and PINs are secrets and are **not** in the file. After `--apply`:

| Item | What happens |
|---|---|
| Owner login | Every owner account gets a **one-time temporary password** shown once on the screen (e.g. `K8BV-GYKJ-5Y6C-AHCC`). It is never written to a file or log; `--apply` refuses to run when the output is redirected. Log in with it and **change the password immediately**. If you lose it, run `npm run gos:create-owner` (sets a new password for an e-mail). |
| Other users | Get an unusable password until the owner sets one. |
| Worker PINs (kiosk) | Unusable until re-set in the admin Workers page. |
| Login-gate PIN | The row is not exported. `--apply` writes a **new random 4-digit gate PIN** (hashed the way the app does) and shows it once after the commit, next to the temporary password. Change it in admin settings. |
| Sessions | Not exported: everybody logs in again. |
| Shared invoice/receipt links | Not exported (only token hashes exist; links are credentials). Create new share links. |

After seeing the temporary password and gate PIN, clear the terminal scrollback and never screen-share that window.

**After-restore checklist**

1. Log in with the temporary password, change the password now.
2. Write down the new gate PIN, change it in admin settings.
3. Re-set every worker PIN (admin > Workers).
4. Re-create invoice/receipt share links.
5. Make sure `AUTH_SECRET` is set in the environment: the development fallback in `src/lib/security.ts` is public.
6. Decide about portal links (`--regenerate-portal-links`) and open the site once to check it.

Why this design: it needs no new screen and no secret ever travels in the backup file, yet the owner always has a way in.

## 4. What is in the file, and what is left out

The table list is discovered from the Drizzle schema (`src/db/schema.ts` and `src/db/gos-schema.ts`), so new tables are exported
automatically. A table can only be left out through `EXCLUDED_TABLES` in `src/lib/db-backup.ts`; a unit test fails otherwise.

| Left out | Reason |
|---|---|
| table `sessions` | The token is the login secret. |
| table `service_document_shares` | Share links are bearer credentials (token hashes). |
| table `gos_login_attempts` | Temporary lockout counters, not business data. |
| column `users.password_hash` | Secret. Replaced at import (above). |
| column `workers.pin_hash` | Secret (a 4-digit PIN is easily recovered from a hash). Must be re-set. |
| `settings` rows whose key looks like a secret (`loginGatePinHash`, anything with pin/hash/secret/token/password/api key...) or whose value looks like a hash | Secrets. Key names (never values) are printed on export. |
| `settings` rows with any key not on the allow-list | Export fails instead (see section 1). |

Excluded columns are removed **inside the database** (`to_jsonb(row) - 'password_hash'`), so they never reach the script. The
registry test also fails if a new column with a secret-looking name appears in an exported table and is not excluded or
explicitly allowed.

Everything else is kept, including text that may be sensitive to customers, and each project's portal secret link id.

Deliberate consequences: rows that point at users (`service_settings.owner_id`, owner tasks, ...) stay valid because the user
rows are exported (without secrets).

## 5. File format (format 1)

A gzip-compressed JSON document:

```json
{ "manifest": { "format": 1, "createdAt": "...", "appSchemaFingerprint": "<sha256>",
                "tables": { "users": { "rows": 1, "sha256": "..." } }, "excluded": { ... } },
  "data": { "users": [ { "id": "...", "email": "..." } ] } }
```

- `appSchemaFingerprint` = sha256 of the sorted `table.column:type:nullability` list from the Drizzle schema.
- Per-table `sha256` = sha256 of the table's rows (each row as key-sorted JSON, rows sorted, joined by newlines).
- Rows are read as PostgreSQL JSON (`to_jsonb`) and loaded with `jsonb_populate_recordset`, so the database itself does all
  type conversion. Mapping:

| Column type | JSON |
|---|---|
| uuid, text, enum | string |
| integer, serial | number (money is integer centavos; no float conversion anywhere) |
| double precision | number (shortest exact text) |
| boolean | true / false |
| timestamp (no zone) | `"2026-10-15T01:02:03.123456"` (microseconds kept) |
| timestamptz | `"2026-10-15T01:02:03.123456+00:00"` (UTC) |
| jsonb | the JSON value itself |
| SQL NULL | `null` (an empty string stays `""`) |

A column of any other type (for example `bigint`, `numeric`, `bytea`) makes the tools stop with a message until it is handled
and tested, rather than risk a silent rounding. Integers above 2^53 are refused for the same reason.

## 6. Limits

- Size limits: the importer refuses a file above 200 MB and stops decompressing at 512 MB of JSON (plain error, no crash).
- The whole database is held in memory and written as one JSON file. Fine for this app (the demo data is ~20 KB compressed;
  photos are stored as URLs, but a hero image saved in `settings` is a data URL and is included). Several hundred MB would
  need a streaming version.
- The checksums detect damage and edits to the file. They are not a signature: someone who can edit the file and recompute the
  checksums can still change data (they cannot inject password hashes or non-allow-listed settings; those are rejected). Protect the file itself.
- The importer needs the schema from the same code version (fingerprint). Restore an old backup with the app version that made it.
- It does not copy extensions, roles, grants or the `drizzle/manual` history; it copies rows.

## 7. Raw `pg_dump` is still the full backup

Keep a normal Postgres dump as well. It includes everything (sessions, hashes, schema, indexes), and restores in one command.

```bash
pg_dump --format=custom --no-owner --file herrero-full.dump "$DATABASE_URL"        # macOS / Linux
pg_dump --format=custom --no-owner --file herrero-full.dump $env:DATABASE_URL     # PowerShell
pg_restore --no-owner --dbname "postgresql://postgres@127.0.0.1:5432/herrero_restore" herrero-full.dump
```

This export is the safer, secret-free copy for moving business data into a fresh install or checking it. The dump is the
disaster-recovery copy, and is even more sensitive (it contains the password hashes).

## 8. Tests

- `tests/db-backup.ts` (in `npm test`): registry covers every table, exclusions, load order, serialization, tamper detection, host safety.
- `tests/db-backup-db.ts` (not in `npm test`): throw-away **local** databases only. Seeds A, exports, imports into empty B, compares
  every table's row count and content hash, money columns, the gate PIN, portal-link regeneration, refusals (non-empty, tampered, remote, repeated `?host=`). Run:
  `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres DATABASE_SSL=false npx tsx tests/db-backup-db.ts`
  (uses `script` for a pseudo-terminal, so Linux/macOS util-linux/BSD only; scratch databases are left behind).
