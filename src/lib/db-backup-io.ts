/**
 * Database side of the backup tools (uses a `pg` client that the caller connects). Used by scripts/db-export.ts,
 * scripts/db-import.ts and tests/db-backup-db.ts. Export only ever runs SELECTs inside a READ ONLY transaction;
 * import only ever INSERTs/UPDATEs rows it loaded itself, in one transaction, and never deletes or truncates.
 */
import { randomBytes, randomInt } from "node:crypto";
import type { Client } from "pg";
import { hashPassword, hashPin } from "./security";
import {
  GENERATED_ON_IMPORT, LOGIN_GATE_PIN_KEY, ROW_FILTERS, UNUSABLE_PASSWORD_PREFIX, UNUSABLE_PIN_PREFIX, buildBackup, getRegistry,
  hashRows, insertBatchSql, makeTemporaryPassword, settingsDisposition, planLoad, qi,
  resetSequenceSql, selectRowsSql, sortRows, stripExcludedColumns, updateDeferredSql, type BackupFile, type TableInfo,
} from "./db-backup";

const BATCH = 500;
/** Anything with `query` (a pg Client or a pooled client). */
export type Queryable = Pick<Client, "query">;

/** Every schema table must exist in the database with exactly the schema's columns. Returns problems (empty = ok). */
export async function checkDatabaseMatchesSchema(client: Queryable, registry: TableInfo[] = getRegistry()): Promise<string[]> {
  const res = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const have = new Map<string, Set<string>>();
  for (const r of res.rows) {
    if (!have.has(r.table_name)) have.set(r.table_name, new Set());
    have.get(r.table_name)!.add(r.column_name);
  }
  const problems: string[] = [];
  for (const t of registry) {
    const cols = have.get(t.name);
    if (!cols) { problems.push(`table "${t.name}" is missing`); continue; }
    const want = new Set(t.columns.map((c) => c.name));
    const missing = [...want].filter((c) => !cols.has(c));
    const extra = [...cols].filter((c) => !want.has(c));
    if (missing.length) problems.push(`table "${t.name}" lacks column(s): ${missing.join(", ")}`);
    if (extra.length) problems.push(`table "${t.name}" has unexpected column(s): ${extra.join(", ")}`);
  }
  return problems;
}

async function readTable(client: Queryable, t: TableInfo): Promise<Record<string, unknown>[]> {
  const res = await client.query<{ j: string }>(selectRowsSql(t));
  return res.rows.map((r) => JSON.parse(r.j) as Record<string, unknown>);
}

/** Read the whole database in one READ ONLY, REPEATABLE READ transaction. SELECT only. */
export async function exportDatabase(client: Queryable, createdAt = new Date(), opts: { timeoutMs?: number } = {}): Promise<BackupFile> {
  const registry = getRegistry();
  const problems = await checkDatabaseMatchesSchema(client, registry);
  if (problems.length) {
    throw new Error(`The database does not match this version of the app (${problems.slice(0, 5).join("; ")}). Nothing was exported. Bring the database schema up to date first.`);
  }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    if (opts.timeoutMs) {
      // Used by the web route only (the CLI has no limit): a stuck export must not hold a pooled connection for ever.
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(opts.timeoutMs)}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.floor(opts.timeoutMs)}`);
    }
    const data: Record<string, Record<string, unknown>[]> = {};
    let skippedKeys: string[] = [];
    for (const t of registry.filter((x) => !x.excluded)) {
      const rows = await readTable(client, t);
      if (t.name === "settings") skippedKeys = rows.filter((r) => settingsDisposition(r) === "skip-secret").map((r) => String(r.key)).sort();
      data[t.name] = rows;
    }
    await client.query("COMMIT");
    return buildBackup(data, { createdAt, settingsKeysSkipped: skippedKeys });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

/** Tables (all schema tables, excluded ones too) that already hold rows. */
export async function nonEmptyTables(client: Client, registry: TableInfo[] = getRegistry()): Promise<string[]> {
  const out: string[] = [];
  for (const t of registry) {
    const r = await client.query(`SELECT 1 FROM ${qi(t.name)} LIMIT 1`);
    if (r.rowCount) out.push(t.name);
  }
  return out;
}

/** Tables in schema `public` that this app version does not know (not in the registry), with whether they hold rows. */
export async function unregisteredTables(client: Client, registry: TableInfo[] = getRegistry()): Promise<{ name: string; hasRows: boolean }[]> {
  const known = new Set(registry.map((t) => t.name));
  const res = await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const out: { name: string; hasRows: boolean }[] = [];
  for (const r of res.rows.filter((x) => !known.has(x.table_name)).sort((a, b) => a.table_name.localeCompare(b.table_name))) {
    const c = await client.query(`SELECT 1 FROM ${qi(r.table_name)} LIMIT 1`);
    out.push({ name: r.table_name, hasRows: !!c.rowCount });
  }
  return out;
}

export type ImportOptions = { regeneratePortalLinks?: boolean };

export type ImportResult = {
  rowsByTable: Record<string, number>;
  /** One entry per owner user. Hand to the operator console ONLY; never write it to a file or log. */
  temporaryPasswords: { email: string; password: string }[];
  /** New random 4-digit login-gate PIN (its hash was written to settings). Operator console ONLY. */
  gatePin: string;
  portalLinksRegenerated: boolean;
};

/**
 * Load a validated backup into an EMPTY database in ONE transaction. Throws (after ROLLBACK) on any problem,
 * including a verification mismatch after loading. Never deletes anything.
 */
export async function importDatabase(client: Client, backup: BackupFile, registry: TableInfo[] = getRegistry(), opts: ImportOptions = {}): Promise<ImportResult> {
  const exported = registry.filter((t) => !t.excluded);
  const byName = new Map(exported.map((t) => [t.name, t]));
  const plan = planLoad(exported);
  const temporaryPasswords: ImportResult["temporaryPasswords"] = [];
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    // Block concurrent writers (the app) for the duration; reads stay possible. Taken BEFORE the emptiness check.
    await client.query(`LOCK TABLE ${registry.map((t) => qi(t.name)).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
    const unknownWithRows = (await unregisteredTables(client, registry)).filter((t) => t.hasRows).map((t) => t.name);
    if (unknownWithRows.length) throw new Error(`The target has table(s) this app version does not know and that hold rows (${unknownWithRows.join(", ")}). Imports only go into an empty database.`);
    const notEmpty = await nonEmptyTables(client, registry);
    if (notEmpty.length) throw new Error(`The target database is not empty (${notEmpty.slice(0, 6).join(", ")}${notEmpty.length > 6 ? ", ..." : ""}). Imports only go into an empty database.`);

    for (const name of plan.order) {
      const t = byName.get(name)!;
      const rows = backup.data[name]!;
      const gen = GENERATED_ON_IMPORT[name];
      const deferredCols = plan.deferred.filter((d) => d.table === name).flatMap((d) => d.columns);
      const sql = insertBatchSql(t, gen ? [gen.column] : [], deferredCols);
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map((row) => {
          if (!gen) return row;
          if (gen.kind === "pin") return { ...row, [gen.column]: `${UNUSABLE_PIN_PREFIX}${randomBytes(16).toString("hex")}` };
          if (row.role === "owner") {
            const password = makeTemporaryPassword(randomBytes);
            temporaryPasswords.push({ email: String(row.email), password });
            return { ...row, [gen.column]: hashPassword(password) };
          }
          return { ...row, [gen.column]: `${UNUSABLE_PASSWORD_PREFIX}${randomBytes(16).toString("hex")}` };
        });
        await client.query(sql, [JSON.stringify(batch)]);
      }
    }
    for (const d of plan.deferred) {
      const t = byName.get(d.table)!;
      const rows = backup.data[d.table]!;
      const sql = updateDeferredSql(t, d.columns);
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH).map((r) => {
          const o: Record<string, unknown> = {};
          for (const c of t.primaryKey) o[c] = r[c];
          for (const c of d.columns) o[c] = r[c];
          return o;
        });
        await client.query(sql, [JSON.stringify(slice)]);
      }
    }
    for (const t of exported) for (const c of t.columns.filter((x) => x.isSerial)) await client.query(resetSequenceSql(t, c.name));

    // The login-gate PIN hash is never exported: give the restored instance a fresh random gate PIN (shown once after COMMIT).
    const gatePin = String(randomInt(0, 10000)).padStart(4, "0");
    await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [LOGIN_GATE_PIN_KEY, hashPin(gatePin)]);
    if (opts.regeneratePortalLinks) await client.query(`UPDATE projects SET portal_uuid = gen_random_uuid()`);

    // Verify what is now in the database against the manifest (count + sha256), before committing.
    const rowsByTable: Record<string, number> = {};
    for (const t of exported) {
      const filter = ROW_FILTERS[t.name];
      const regen = opts.regeneratePortalLinks && t.name === "projects";
      const drop = (r: Record<string, unknown>) => { if (!regen) return r; const o = { ...r }; delete o.portal_uuid; return o; };
      const loaded = sortRows((await readTable(client, t)).filter((r) => (filter ? filter(r) : true)).map((r) => stripExcludedColumns(t, r)));
      const want = backup.manifest.tables[t.name]!;
      if (loaded.length !== want.rows) throw new Error(`Verification failed for ${t.name}: ${loaded.length} rows loaded, manifest says ${want.rows}.`);
      const wantHash = regen ? hashRows(backup.data[t.name]!.map(drop)) : want.sha256;
      if (hashRows(loaded.map(drop)) !== wantHash) throw new Error(`Verification failed for ${t.name}: content differs from the manifest after loading.`);
      rowsByTable[t.name] = loaded.length;
    }
    await client.query("COMMIT");
    return { rowsByTable, temporaryPasswords, gatePin, portalLinksRegenerated: !!opts.regeneratePortalLinks };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}
