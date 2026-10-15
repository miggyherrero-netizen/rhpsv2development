/**
 * Import a backup made by `npm run db:export` into an EMPTY database. Never deletes or truncates anything.
 * Default is a DRY RUN (validates everything, writes nothing). Add --apply to load, all-or-nothing, in one transaction.
 *
 *   npx drizzle-kit push                         # 1. create the (empty) schema in the target database
 *   npm run db:import -- backups/FILE.json.gz            # 2. dry run
 *   npm run db:import -- backups/FILE.json.gz --apply    # 3. load
 *
 * Optional: --regenerate-portal-links gives every project a NEW private portal link (old links stop working).
 * Remote hosts are refused unless --allow-remote AND the database name is confirmed (typed, or --confirm-db-name=<name>).
 * The database comes from DATABASE_URL only (never from arguments). Details: docs/BACKUP.md
 */
import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { Client } from "pg";
import {
  BackupFileError, MAX_BACKUP_FILE_BYTES, assessImportTarget, decodeAndValidateBackup, getRegistry, sslFor,
} from "../src/lib/db-backup";
import { checkDatabaseMatchesSchema, importDatabase, nonEmptyTables, unregisteredTables } from "../src/lib/db-backup-io";

function fail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let file: string | undefined;
  let apply = false;
  let allowRemote = false;
  let regeneratePortalLinks = false;
  let confirmName: string | undefined;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--regenerate-portal-links") regeneratePortalLinks = true;
    else if (a === "--allow-remote") allowRemote = true;
    else if (a.startsWith("--confirm-db-name=")) confirmName = a.slice("--confirm-db-name=".length);
    else if (a.startsWith("--")) fail(`Unknown option "${a}". Allowed: --apply, --dry-run, --regenerate-portal-links, --allow-remote, --confirm-db-name=<name>. Credentials are never accepted as arguments (DATABASE_URL only).`);
    else if (/^[a-z]+:\/\//i.test(a) || a.includes("@")) fail("Do not pass connection strings or credentials as arguments. Use DATABASE_URL.");
    else if (file) fail("Only one backup file can be given.");
    else file = a;
  }
  if (!file) fail("Give the backup file: npm run db:import -- <file.json.gz> [--apply]");
  return { file, apply, allowRemote, confirmName, regeneratePortalLinks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set (set it in the environment or in .env).");

  // 1. Target safety BEFORE anything else (no connection yet).
  let decision = assessImportTarget(databaseUrl, { allowRemote: args.allowRemote, confirmedName: args.confirmName ?? null }, process.env);
  if (!decision.ok) fail(decision.message);
  if (decision.needsTypedName) {
    if (!process.stdin.isTTY) fail("A remote import needs the database name confirmed: pass --confirm-db-name=<name> or run in an interactive terminal.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`REMOTE database "${decision.database}" on ${decision.host}. Type the database name to continue: `)).trim();
    rl.close();
    decision = assessImportTarget(databaseUrl, { allowRemote: true, confirmedName: typed }, process.env);
    if (!decision.ok) fail(decision.message);
  }
  console.log(`Target database: ${decision.host} / ${decision.database}${decision.remote ? "  (REMOTE, confirmed)" : ""}`);
  console.log(args.apply ? "Mode: APPLY (one transaction, all-or-nothing)" : "Mode: DRY RUN (nothing is written)");

  // 2. Read + validate the file.
  const filePath = path.resolve(process.cwd(), args.file);
  let buf: Buffer;
  try {
    if (statSync(filePath).size > MAX_BACKUP_FILE_BYTES) fail(`The file is larger than ${MAX_BACKUP_FILE_BYTES / 1048576} MB; refusing to read it.`);
    buf = readFileSync(filePath);
  } catch { fail(`Cannot read ${filePath}.`); }
  let backup;
  try { backup = decodeAndValidateBackup(buf); } catch (e) {
    if (e instanceof BackupFileError) fail(`${e.message}\nNothing was imported.`);
    throw e;
  }
  console.log(`Backup file OK: format ${backup.manifest.format}, created ${backup.manifest.createdAt}, schema fingerprint matches, all table checksums verified.`);

  // 3. Target checks.
  if (args.apply && !process.stdout.isTTY) {
    fail("--apply must run in an interactive terminal: the one-time owner password is shown on screen only (never written to a file or log).");
  }
  const client = new Client({ connectionString: databaseUrl, ssl: sslFor(databaseUrl, process.env) });
  client.on("error", () => undefined);
  try { await client.connect(); } catch (e) { fail(`Could not connect to the database (${(e as { code?: string }).code ?? "connection error"}).`); }
  try {
    const problems = await checkDatabaseMatchesSchema(client);
    if (problems.length) fail(`The target database does not have this app's schema (${problems.slice(0, 5).join("; ")}). Create it first with: npx drizzle-kit push`);
    const unknownTables = await unregisteredTables(client);
    if (unknownTables.length) {
      console.warn(`\n!! WARNING: the target has table(s) this app version does not know: ${unknownTables.map((t) => `${t.name}${t.hasRows ? " (HAS ROWS)" : ""}`).join(", ")}. They are neither imported nor touched.`);
      if (unknownTables.some((t) => t.hasRows)) fail("An unknown table holds rows, so the target is not empty. Nothing was changed.");
    }
    const notEmpty = await nonEmptyTables(client);
    if (notEmpty.length) fail(`The target database is NOT empty (rows in: ${notEmpty.slice(0, 8).join(", ")}${notEmpty.length > 8 ? ", ..." : ""}). Imports only go into an empty database. Nothing was changed.`);

    console.log("\nPlan (insert order, parents first):");
    let total = 0;
    for (const t of getRegistry().filter((x) => !x.excluded)) total += backup.manifest.tables[t.name]!.rows;
    for (const [name, m] of Object.entries(backup.manifest.tables)) console.log(`  ${name.padEnd(36)} ${String(m.rows).padStart(7)} rows`);
    console.log(`  ${"TOTAL".padEnd(36)} ${String(total).padStart(7)} rows`);
    const byRole = new Map<string, number>();
    for (const u of backup.data.users!) byRole.set(String(u.role), (byRole.get(String(u.role)) ?? 0) + 1);
    const ownerEmails = backup.data.users!.filter((u) => u.role === "owner").map((u) => String(u.email));
    console.log(`\nUsers by role: ${[...byRole].map(([r, n]) => `${r}=${n}`).join(", ") || "none"}`);
    console.log(`Temporary password will be issued to ${ownerEmails.length} owner account(s): ${ownerEmails.join(", ") || "(none)"}`);
    console.log("All other users get an unusable password. Worker PINs must be set again (admin > Workers).");
    console.log("A NEW random login-gate PIN will be created and shown once after the import.");
    console.log(args.regeneratePortalLinks ? "Client portal links will be REGENERATED (old links stop working)." : "Client portal links keep their old addresses (use --regenerate-portal-links to replace them).");

    if (!args.apply) {
      console.log("\nDRY RUN finished. Nothing was written. Add --apply to load the data.");
      return;
    }
    const result = await importDatabase(client, backup, undefined, { regeneratePortalLinks: args.regeneratePortalLinks });
    console.log("\nImport committed. Verified per table (row count + sha256):");
    for (const [name, n] of Object.entries(result.rowsByTable)) console.log(`  ${name.padEnd(36)} ${String(n).padStart(7)} rows OK`);
    if (result.temporaryPasswords.length) {
      console.log("\n=== ONE-TIME TEMPORARY PASSWORD(S) - shown once, not saved anywhere ===");
      for (const p of result.temporaryPasswords) console.log(`  ${p.email}   ${p.password}`);
      console.log("Change it immediately; if you lose it, `npm run gos:create-owner` sets a new password.");
    } else {
      console.log("\nNo owner account was in the backup. Create one with: npm run gos:create-owner");
    }
    console.log(`\n=== NEW LOGIN-GATE PIN: ${result.gatePin} === (shown once, not saved; change it in admin settings)`);
    console.log("Now clear this terminal's scrollback, and never screen-share it.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
