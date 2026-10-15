/**
 * Export the whole BUSINESS database to one gzip-compressed JSON file. READ ONLY: SELECTs inside one READ ONLY,
 * REPEATABLE READ transaction. Secrets (password/PIN hashes, sessions, share-link hashes, login-gate PIN) are left out.
 *
 *   npm run db:export                       # -> ./backups/herrero-backup-YYYYMMDD-HHMMSS.json.gz
 *   npm run db:export -- --dir D:\Backups   # another folder
 *   npm run db:export -- --out D:\Private\my-backup.json.gz
 *
 * Inside the project folder only ./backups is allowed (override: --force-inside-project).
 *
 * Reads DATABASE_URL (env or .env) only. Details: docs/BACKUP.md
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  backupFileName, databaseNameOf, effectiveHosts, encodeBackup, getExportedTables, isInsideProjectButNotBackups, sslFor,
} from "../src/lib/db-backup";
import { exportDatabase } from "../src/lib/db-backup-io";

function fail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let dir: string | undefined;
  let out: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dir" || a === "--out") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) fail(`${a} needs a value.`);
      if (a === "--dir") dir = v; else out = v;
    } else if (a === "--force-inside-project") force = true;
    else if (a.startsWith("--dir=")) dir = a.slice(6);
    else if (a.startsWith("--out=")) out = a.slice(6);
    else fail(`Unknown argument "${a}". Allowed: --dir <folder>, --out <file>, --force-inside-project. The database comes from DATABASE_URL only.`);
  }
  return { dir, out, force };
}

async function main() {
  const { dir, out, force } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set (set it in the environment or in .env).");

  const root = process.cwd();
  const when = new Date();
  let target: string;
  if (out) target = path.resolve(root, out);
  else target = path.join(path.resolve(root, dir ?? "backups"), backupFileName(when));
  const rel = path.relative(root, path.dirname(target));
  if (!force && isInsideProjectButNotBackups(rel)) {
    fail(`Refusing to write into the project folder "${rel || "."}". Use ./backups (default) or a folder outside the project. (Override on purpose: --force-inside-project.)`);
  }

  // Only host and database name are ever printed - never the URL, user or password.
  console.log(`Source database: ${effectiveHosts(databaseUrl, process.env).join(",")} / ${databaseNameOf(databaseUrl)}`);
  console.log("Mode: READ ONLY (SELECT inside a READ ONLY, REPEATABLE READ transaction).");

  const client = new Client({ connectionString: databaseUrl, ssl: sslFor(databaseUrl, process.env) });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (e) {
    fail(`Could not connect to the database (${(e as { code?: string }).code ?? "connection error"}).`);
  }
  let backup;
  try {
    backup = await exportDatabase(client, when);
  } catch (e) {
    await client.end().catch(() => undefined);
    fail((e as Error).message);
  }
  await client.end();

  const bytes = encodeBackup(backup);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 }); // never overwrite an existing file
  } catch (e) {
    fail(`Could not write ${target}: ${(e as NodeJS.ErrnoException).code === "EEXIST" ? "the file already exists" : (e as Error).message}`);
  }

  console.log("\nTable                                   rows  sha256 (first 12)");
  let total = 0;
  for (const t of getExportedTables()) {
    const m = backup.manifest.tables[t.name]!;
    total += m.rows;
    console.log(`${t.name.padEnd(36)} ${String(m.rows).padStart(7)}  ${m.sha256.slice(0, 12)}`);
  }
  console.log(`\n${getExportedTables().length} tables, ${total} rows.`);
  console.log(`Left out on purpose: tables ${backup.manifest.excluded!.tables.join(", ")}; columns ${backup.manifest.excluded!.columns.join(", ")}; ${backup.manifest.excluded!.settingsRowsSkipped} secret-looking settings row(s)${backup.manifest.excluded!.settingsKeysSkipped?.length ? ` (keys: ${backup.manifest.excluded!.settingsKeysSkipped.join(", ")})` : ""}.`);
  console.log(`\nWrote ${target} (${(bytes.length / 1024).toFixed(1)} KB)`);
  console.log("\nWARNING: this file contains your customers' personal data (names, phones, addresses, invoices).");
  console.log("It is NOT encrypted (gzip only). Windows ignores the file permission bits: use a private folder on an encrypted disk (BitLocker/EFS).");
  console.log("Treat it like a password: keep it off shared drives and chats, store it encrypted, delete copies you do not need.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
