/**
 * Complete-database export / import: pure, testable core. No database access and no file access in here
 * (the thin command-line scripts scripts/db-export.ts and scripts/db-import.ts do the I/O).
 *
 * Design (see docs/BACKUP.md):
 *  - the table list is discovered from the Drizzle schema (src/db/schema.ts + src/db/gos-schema.ts), so a new table is
 *    exported automatically; a table can only be left out through the explicit EXCLUDED_TABLES list below (with a reason).
 *  - BUSINESS DATA ONLY: login sessions, password hashes, PIN hashes, login-gate PIN and share-link token hashes are never
 *    exported (EXCLUDED_TABLES / EXCLUDED_COLUMNS / settings row filter).
 *  - rows are read as PostgreSQL JSON (`to_jsonb`) and loaded with `jsonb_populate_recordset`, so every type round-trips
 *    exactly as the database itself prints it (see TYPE_MAPPING).
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as appSchema from "../db/schema";
import * as gosSchema from "../db/gos-schema";

export const BACKUP_FORMAT = 1;

/* ------------------------------------------------------------------------------------------------
 * Type mapping (documented in docs/BACKUP.md). Column SQL type -> JSON representation in the backup file.
 * A column whose type is not listed makes the registry throw, so a new kind of column is a conscious decision.
 * ---------------------------------------------------------------------------------------------- */
export const TYPE_MAPPING: Record<string, string> = {
  uuid: "string (lower-case canonical form)",
  text: "string",
  integer: "JSON number (int4; money is integer centavos, never a float)",
  smallint: "JSON number",
  serial: "JSON number (int4); the sequence is reset after import",
  boolean: "true / false",
  "double precision": "JSON number (PostgreSQL prints the shortest text that round-trips exactly)",
  timestamp: "string 'YYYY-MM-DDTHH:MM:SS[.ffffff]' (no zone; microseconds kept)",
  "timestamp with time zone": "string ISO-8601 in UTC, e.g. '2026-10-15T01:02:03.123456+00:00' (microseconds kept)",
  date: "string 'YYYY-MM-DD'",
  jsonb: "the JSON value itself (object / array / string / number / boolean / null)",
  enum: "string (the enum label)",
  null: "JSON null (a SQL NULL; an empty string stays an empty string)",
};

const SIMPLE_TYPES = new Set([
  "uuid", "text", "integer", "smallint", "serial", "boolean", "double precision", "timestamp",
  "timestamp with time zone", "date", "jsonb",
]);

/* ------------------------------------------------------------------------------------------------
 * What is NOT exported, and why.
 * ---------------------------------------------------------------------------------------------- */
export const EXCLUDED_TABLES: Record<string, string> = {
  sessions: "Login sessions: the token column IS the session secret. Everybody simply logs in again after a restore.",
  service_document_shares:
    "Bearer links for shared invoice/receipt documents: only token hashes are stored. Links are credentials, so they are not copied; create new share links after a restore.",
  gos_login_attempts: "Transient login-lockout counters (keyed by email); not business data.",
};

/** Columns that are removed from the exported rows (table -> column -> reason). Re-created at import time. */
export const EXCLUDED_COLUMNS: Record<string, Record<string, string>> = {
  users: { password_hash: "Password hash: a secret. Import gives every user an unusable hash; owners get a one-time temporary password." },
  workers: { pin_hash: "Technician kiosk PIN hash: a secret (4-digit PINs are trivially brute-forced from a hash). Workers must have their PIN re-set." },
};

/**
 * Column names that look like secrets but are deliberately kept ("table.column" -> reason). Used by the registry test:
 * any column named like a secret in an exported table must be either excluded above or listed here with a reason.
 */
export const ALLOWED_SENSITIVE_COLUMN_NAMES: Record<string, string> = {
  "service_jobs.private_notes": "Free-text staff notes about a job, not a credential. Business data, kept.",
};
export const SENSITIVE_COLUMN_RE = /(hash|secret|token|passw|pin_|_pin|^pin$|api_?key|credential|private)/i;

/**
 * `settings` is a key/value table that also holds the login-gate PIN hash. Only these keys are exported (allow-list);
 * a secret-looking key/value is skipped; any OTHER key makes the export fail until it is consciously added here.
 */
export const SETTINGS_ALLOWED_KEYS = ["staleUpdateDays", "publicWebsiteContent", "publicHeroImage"] as const;
export const SECRET_SETTING_KEY_RE = /(pin|hash|secret|token|passw|passwd|api[-_]?key|credential|private|salt|session)/i;
const LOOKS_LIKE_HASH_VALUE_RE = /^([0-9a-f]{64}|[0-9a-f]{16,64}:[0-9a-f]{64,256})$/i;
export const LOGIN_GATE_PIN_KEY = "loginGatePinHash";

export function isSecretSettingRow(row: { key?: unknown; value?: unknown }): boolean {
  const key = typeof row.key === "string" ? row.key : "";
  const value = typeof row.value === "string" ? row.value : "";
  return SECRET_SETTING_KEY_RE.test(key) || LOOKS_LIKE_HASH_VALUE_RE.test(value);
}

export type SettingsDisposition = "keep" | "skip-secret" | "unknown";
export function settingsDisposition(row: { key?: unknown; value?: unknown }): SettingsDisposition {
  if (isSecretSettingRow(row)) return "skip-secret";
  return (SETTINGS_ALLOWED_KEYS as readonly string[]).includes(String(row.key)) ? "keep" : "unknown";
}

/** Row-level filters (applied to rows read from the database, and re-checked on import). true = keep the row. */
export const ROW_FILTERS: Record<string, (row: Record<string, unknown>) => boolean> = {
  settings: (row) => settingsDisposition(row) === "keep",
};

/* ------------------------------------------------------------------------------------------------
 * Registry: every table of the Drizzle schema.
 * ---------------------------------------------------------------------------------------------- */
export type ColumnInfo = { name: string; sqlType: string; notNull: boolean; hasDefault: boolean; isSerial: boolean };
export type FkInfo = { columns: string[]; foreignTable: string; foreignColumns: string[]; nullable: boolean };
export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  /** Columns that are written to the file (all columns minus EXCLUDED_COLUMNS). */
  exportedColumns: string[];
  excludedColumns: string[];
  primaryKey: string[];
  foreignKeys: FkInfo[];
  excluded: boolean;
  excludedReason?: string;
};

/** Throws for any column type the backup cannot round-trip exactly. Enums are detected by Drizzle's `enumValues`, not by name. */
export function assertSupportedColumnType(table: string, column: string, sqlType: string, enumValues: unknown): void {
  if (SIMPLE_TYPES.has(sqlType)) return;
  if (Array.isArray(enumValues) && enumValues.length > 0) return; // a pgEnum column
  throw new Error(
    `Column ${table}.${column} has type "${sqlType}", which the backup does not know how to round-trip exactly (bigint, bigserial, numeric, real, bytea, time, interval, ... are not supported). ` +
      `Add it to TYPE_MAPPING/SIMPLE_TYPES in src/lib/db-backup.ts (and test it) before using it.`,
  );
}

function buildRegistry(): TableInfo[] {
  const out: TableInfo[] = [];
  const seen = new Set<string>();
  for (const mod of [appSchema, gosSchema] as Record<string, unknown>[]) {
    for (const value of Object.values(mod)) {
      if (!is(value, PgTable)) continue;
      const cfg = getTableConfig(value);
      if (seen.has(cfg.name)) continue;
      seen.add(cfg.name);
      if (cfg.schema && cfg.schema !== "public") throw new Error(`Table ${cfg.schema}.${cfg.name}: only the public schema is supported.`);
      const pkCols = new Set<string>(cfg.columns.filter((c) => c.primary).map((c) => c.name));
      for (const pk of cfg.primaryKeys) for (const c of pk.columns) pkCols.add(c.name);
      const columns: ColumnInfo[] = cfg.columns.map((c) => {
        const sqlType = c.getSQLType();
        assertSupportedColumnType(cfg.name, c.name, sqlType, (c as { enumValues?: unknown }).enumValues);
        return { name: c.name, sqlType, notNull: c.notNull, hasDefault: c.hasDefault, isSerial: sqlType === "serial" };
      });
      const colByName = new Map(columns.map((c) => [c.name, c]));
      const excludedCols = Object.keys(EXCLUDED_COLUMNS[cfg.name] ?? {});
      for (const ec of excludedCols) if (!colByName.has(ec)) throw new Error(`EXCLUDED_COLUMNS lists ${cfg.name}.${ec}, which is not in the schema.`);
      const foreignKeys: FkInfo[] = cfg.foreignKeys.map((fk) => {
        const ref = fk.reference();
        const cols = ref.columns.map((c) => c.name);
        return {
          columns: cols,
          foreignTable: getTableConfig(ref.foreignTable).name,
          foreignColumns: ref.foreignColumns.map((c) => c.name),
          nullable: cols.every((n) => !colByName.get(n)!.notNull),
        };
      });
      const reason = EXCLUDED_TABLES[cfg.name];
      out.push({
        name: cfg.name,
        columns,
        exportedColumns: columns.map((c) => c.name).filter((n) => !excludedCols.includes(n)).sort(),
        excludedColumns: excludedCols,
        primaryKey: [...pkCols],
        foreignKeys,
        excluded: reason !== undefined,
        excludedReason: reason,
      });
    }
  }
  for (const name of Object.keys(EXCLUDED_TABLES)) if (!seen.has(name)) throw new Error(`EXCLUDED_TABLES lists "${name}", which is not in the schema.`);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let registryCache: TableInfo[] | null = null;
/** All schema tables (exported and excluded), sorted by name. */
export function getRegistry(): TableInfo[] {
  return (registryCache ??= buildRegistry());
}
/** Tables that go into the file, sorted by name. */
export function getExportedTables(): TableInfo[] {
  return getRegistry().filter((t) => !t.excluded);
}

/* ------------------------------------------------------------------------------------------------
 * Fingerprint of the app schema (tables + columns + types + nullability). Export and import must agree.
 * ---------------------------------------------------------------------------------------------- */
export function computeSchemaFingerprint(registry: TableInfo[] = getRegistry()): string {
  const lines: string[] = [];
  for (const t of [...registry].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const c of [...t.columns].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`${t.name}.${c.name}:${c.sqlType}:${c.notNull ? "nn" : "n"}`);
    }
  }
  return sha256(lines.join("\n"));
}

/* ------------------------------------------------------------------------------------------------
 * Insert order (topological sort over foreign keys).
 * ---------------------------------------------------------------------------------------------- */
export type DeferredColumn = { table: string; columns: string[]; foreignTable: string };
export type LoadPlan = { order: string[]; deferred: DeferredColumn[] };

type GraphTable = Pick<TableInfo, "name" | "foreignKeys">;

/**
 * Parents before children. Self-references and foreign-key cycles are handled explicitly: a nullable foreign key that
 * cannot be satisfied by ordering is "deferred" (inserted as NULL, then filled by an UPDATE once all rows exist).
 * Foreign keys to tables outside `tables` are ignored (the caller asserts none exist for exported tables).
 */
export function planLoad(tables: GraphTable[]): LoadPlan {
  const names = new Set(tables.map((t) => t.name));
  const deferred: DeferredColumn[] = [];
  const deferredKeys = new Set<string>();
  const edgeKey = (t: string, fk: FkInfo) => `${t}|${fk.columns.join(",")}|${fk.foreignTable}`;

  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.foreignTable === t.name && names.has(t.name)) {
        if (!fk.nullable) throw new Error(`${t.name} has a NOT NULL self-reference (${fk.columns.join(",")}); it cannot be loaded.`);
        deferred.push({ table: t.name, columns: fk.columns, foreignTable: t.name });
        deferredKeys.add(edgeKey(t.name, fk));
      }
    }
  }

  const attempt = (): string[] | null => {
    const indeg = new Map<string, number>();
    const children = new Map<string, Set<string>>();
    for (const t of tables) { indeg.set(t.name, 0); children.set(t.name, new Set()); }
    for (const t of tables) {
      const parents = new Set<string>();
      for (const fk of t.foreignKeys) {
        if (deferredKeys.has(edgeKey(t.name, fk)) || !names.has(fk.foreignTable) || fk.foreignTable === t.name) continue;
        parents.add(fk.foreignTable);
      }
      for (const p of parents) { children.get(p)!.add(t.name); indeg.set(t.name, indeg.get(t.name)! + 1); }
    }
    const ready = [...indeg].filter(([, d]) => d === 0).map(([n]) => n).sort();
    const order: string[] = [];
    while (ready.length) {
      const n = ready.shift()!;
      order.push(n);
      for (const c of [...children.get(n)!].sort()) {
        indeg.set(c, indeg.get(c)! - 1);
        if (indeg.get(c) === 0) { ready.push(c); ready.sort(); }
      }
    }
    return order.length === tables.length ? order : null;
  };

  let order = attempt();
  // Cycle between tables: defer nullable FKs (deterministically, one at a time) until the graph is acyclic.
  const candidates = tables
    .flatMap((t) => t.foreignKeys.filter((fk) => fk.nullable && fk.foreignTable !== t.name && names.has(fk.foreignTable)).map((fk) => ({ t, fk })))
    .sort((a, b) => edgeKey(a.t.name, a.fk).localeCompare(edgeKey(b.t.name, b.fk)));
  for (const { t, fk } of candidates) {
    if (order) break;
    deferredKeys.add(edgeKey(t.name, fk));
    deferred.push({ table: t.name, columns: fk.columns, foreignTable: fk.foreignTable });
    order = attempt();
  }
  if (!order) throw new Error("Foreign keys form a cycle that cannot be broken with nullable columns.");
  return { order, deferred };
}

/** Check a plan: every non-deferred FK points to a table inserted earlier (or the same table via a deferred self-FK). */
export function validatePlan(tables: GraphTable[], plan: LoadPlan): string[] {
  const pos = new Map(plan.order.map((n, i) => [n, i]));
  const problems: string[] = [];
  const isDeferred = (t: string, fk: FkInfo) => plan.deferred.some((d) => d.table === t && d.columns.join(",") === fk.columns.join(",") && d.foreignTable === fk.foreignTable);
  for (const t of tables) {
    if (!pos.has(t.name)) { problems.push(`${t.name} missing from order`); continue; }
    for (const fk of t.foreignKeys) {
      if (isDeferred(t.name, fk)) continue;
      const p = pos.get(fk.foreignTable);
      if (p === undefined) problems.push(`${t.name} -> ${fk.foreignTable}: parent not in the load`);
      else if (p >= pos.get(t.name)!) problems.push(`${t.name} is inserted before its parent ${fk.foreignTable}`);
    }
  }
  return problems;
}

/** Exported tables must not point at excluded tables (that would break FK integrity on import). */
export function fkIntoExcludedTables(registry: TableInfo[] = getRegistry()): string[] {
  const excluded = new Set(registry.filter((t) => t.excluded).map((t) => t.name));
  return registry
    .filter((t) => !t.excluded)
    .flatMap((t) => t.foreignKeys.filter((fk) => excluded.has(fk.foreignTable)).map((fk) => `${t.name} -> ${fk.foreignTable}`));
}

/* ------------------------------------------------------------------------------------------------
 * Serialization, hashing
 * ---------------------------------------------------------------------------------------------- */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with object keys sorted recursively: the same data always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Refuses values JSON cannot carry exactly: integers beyond 2^53 (JavaScript would silently round them),
 * non-finite numbers, and anything that is not plain JSON data (Date, bigint, Buffer, undefined...).
 * Rows from `to_jsonb` are already plain JSON, so this is a safety net, not a conversion.
 */
export function assertExactJson(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${path}: integer ${value} is beyond 2^53 and would lose precision in JSON`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => assertExactJson(v, `${path}[${i}]`)); return; }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value as object)) assertExactJson(v, `${path}.${k}`);
    return;
  }
  throw new Error(`${path}: ${typeof value} is not plain JSON data (Date/bigint/Buffer must be converted by the database, not in JavaScript)`);
}

/** Rows in a stable order (sorted by their canonical text) so that the hash does not depend on database ordering. */
export function sortRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({ r, k: canonicalJson(r) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.r);
}

export function hashRows(rows: Record<string, unknown>[]): string {
  return sha256(sortRows(rows).map(canonicalJson).join("\n"));
}

/** Apply exclusion rules to a row read from the database: drop excluded columns. */
export function stripExcludedColumns(table: Pick<TableInfo, "excludedColumns">, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const c of table.excludedColumns) delete out[c];
  return out;
}

/** Rows ready for the file: row filter + excluded columns removed + exactness check + stable order. */
export function prepareExportRows(table: TableInfo, dbRows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (table.name === "settings") {
    const unknown = dbRows.filter((r) => settingsDisposition(r) === "unknown").map((r) => String(r.key));
    if (unknown.length) {
      throw new Error(
        `The settings table has key(s) the backup does not know: ${unknown.join(", ")}. Nothing was exported. ` +
          `If they are plain business settings, add them to SETTINGS_ALLOWED_KEYS in src/lib/db-backup.ts; if they are secrets, they must not be exported.`,
      );
    }
  }
  const filter = ROW_FILTERS[table.name];
  const kept = (filter ? dbRows.filter(filter) : dbRows).map((r) => stripExcludedColumns(table, r));
  for (const r of kept) assertExactJson(r, table.name);
  return sortRows(kept);
}

/* ------------------------------------------------------------------------------------------------
 * Backup file
 * ---------------------------------------------------------------------------------------------- */
export type Manifest = {
  format: number;
  createdAt: string;
  appSchemaFingerprint: string;
  tables: Record<string, { rows: number; sha256: string }>;
  /** Informational only (never trusted on import): what was left out. */
  excluded?: { tables: string[]; columns: string[]; settingsRowsSkipped: number; settingsKeysSkipped?: string[] };
};
export type BackupFile = { manifest: Manifest; data: Record<string, Record<string, unknown>[]> };

export function buildBackup(
  dataByTable: Record<string, Record<string, unknown>[]>,
  opts: { createdAt?: Date; settingsKeysSkipped?: string[]; settingsRowsSkipped?: number; registry?: TableInfo[] } = {},
): BackupFile {
  const registry = opts.registry ?? getRegistry();
  const tables: Manifest["tables"] = {};
  const data: BackupFile["data"] = {};
  for (const t of registry.filter((x) => !x.excluded)) {
    const rows = dataByTable[t.name];
    if (!rows) throw new Error(`No rows supplied for table ${t.name}`);
    const prepared = prepareExportRows(t, rows);
    data[t.name] = prepared;
    tables[t.name] = { rows: prepared.length, sha256: hashRows(prepared) };
  }
  return {
    manifest: {
      format: BACKUP_FORMAT,
      createdAt: (opts.createdAt ?? new Date()).toISOString(),
      appSchemaFingerprint: computeSchemaFingerprint(registry),
      tables,
      excluded: {
        tables: registry.filter((t) => t.excluded).map((t) => t.name),
        columns: registry.flatMap((t) => t.excludedColumns.map((c) => `${t.name}.${c}`)),
        settingsRowsSkipped: opts.settingsKeysSkipped?.length ?? opts.settingsRowsSkipped ?? 0,
        settingsKeysSkipped: opts.settingsKeysSkipped ?? [],
      },
    },
    data,
  };
}

export const encodeBackup = (b: BackupFile): Buffer => gzipSync(Buffer.from(JSON.stringify(b), "utf8"), { level: 9 });

/** "herrero-backup-YYYYMMDD-HHMMSS.json.gz" (UTC). */
export function backupFileName(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `herrero-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json.gz`;
}

export class BackupFileError extends Error {}

/** Size limits: a compressed file above this is refused before reading; decompression stops at the second limit. */
export const MAX_BACKUP_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_BACKUP_JSON_BYTES = 512 * 1024 * 1024;

/** Decode + fully validate a backup file against the app's registry. Throws BackupFileError with a plain message. */
export function decodeAndValidateBackup(buf: Buffer, registry: TableInfo[] = getRegistry(), maxJsonBytes = MAX_BACKUP_JSON_BYTES): BackupFile {
  if (buf.length > MAX_BACKUP_FILE_BYTES) throw new BackupFileError(`The file is larger than ${MAX_BACKUP_FILE_BYTES / 1048576} MB; refusing to read it.`);
  let text: string;
  try { text = gunzipSync(buf, { maxOutputLength: maxJsonBytes }).toString("utf8"); } catch (e) {
    if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new BackupFileError(`The file expands to more than ${Math.round(maxJsonBytes / 1048576)} MB; refusing to read it.`);
    throw new BackupFileError("The file is not a valid gzip file (damaged or not a backup).");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new BackupFileError("The file content is not valid JSON."); }
  const file = parsed as Partial<BackupFile> | null;
  if (!file || typeof file !== "object" || !file.manifest || typeof file.manifest !== "object" || !file.data || typeof file.data !== "object") {
    throw new BackupFileError("The file has no manifest/data sections.");
  }
  const m = file.manifest as Manifest;
  if (m.format !== BACKUP_FORMAT) throw new BackupFileError(`Unsupported backup format ${String(m.format)} (this app reads format ${BACKUP_FORMAT}).`);
  const fingerprint = computeSchemaFingerprint(registry);
  if (m.appSchemaFingerprint !== fingerprint) {
    throw new BackupFileError(
      "The backup was made by a different version of the app schema (fingerprint mismatch). " +
        "Use the same app version that created the backup, or export again from a database that matches this code.",
    );
  }
  if (!m.tables || typeof m.tables !== "object") throw new BackupFileError("The manifest has no table list.");
  const exported = registry.filter((t) => !t.excluded);
  const expectedNames = exported.map((t) => t.name);
  const gotNames = Object.keys(m.tables).sort();
  if (gotNames.join(",") !== [...expectedNames].sort().join(",")) throw new BackupFileError("The manifest table list does not match this app's tables.");
  const dataNames = Object.keys(file.data).sort();
  if (dataNames.join(",") !== gotNames.join(",")) throw new BackupFileError("The data section does not match the manifest table list.");

  for (const t of exported) {
    const rows = (file.data as BackupFile["data"])[t.name];
    const entry = m.tables[t.name]!;
    if (!Array.isArray(rows)) throw new BackupFileError(`Table ${t.name}: rows are not a list.`);
    if (rows.length !== entry.rows) throw new BackupFileError(`Table ${t.name}: ${rows.length} rows in the file but the manifest says ${entry.rows}. The file was changed or is damaged.`);
    const want = [...t.exportedColumns].sort().join(",");
    for (const r of rows) {
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new BackupFileError(`Table ${t.name}: a row is not an object.`);
      const keys = Object.keys(r).sort().join(",");
      if (keys !== want) {
        const hasSecret = t.excludedColumns.some((c) => c in r);
        throw new BackupFileError(`Table ${t.name}: row columns do not match the schema${hasSecret ? " (a secret column is present, which a genuine backup never contains)" : ""}.`);
      }
    }
    const filter = ROW_FILTERS[t.name];
    if (filter && rows.some((r) => !filter(r))) throw new BackupFileError(`Table ${t.name}: contains a row that is not on the allow-list or looks like a secret; a genuine backup never contains it.`);
    try { rows.forEach((r) => assertExactJson(r, t.name)); } catch (e) { throw new BackupFileError((e as Error).message); }
    if (hashRows(rows) !== entry.sha256) throw new BackupFileError(`Table ${t.name}: checksum (sha256) mismatch. The file was changed or is damaged. Nothing was imported.`);
  }
  return file as BackupFile;
}

/* ------------------------------------------------------------------------------------------------
 * Target safety
 * ---------------------------------------------------------------------------------------------- */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * EVERY hostname pg could connect to for this URL: the URL host, every value of every repeated ?host= / ?hostaddr=
 * (comma lists too; pg uses the last one), and PGHOST when set. Brackets stripped, lower-cased.
 */
export function effectiveHosts(databaseUrl: string, env: Record<string, string | undefined> = {}): string[] {
  const u = new URL(databaseUrl);
  const hosts: string[] = [];
  const strip = (h: string) => h.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (u.hostname) hosts.push(strip(u.hostname));
  for (const key of ["host", "hostaddr"]) {
    for (const v of u.searchParams.getAll(key)) for (const h of v.split(",")) if (h.trim()) hosts.push(strip(h));
  }
  if (env.PGHOST) for (const h of env.PGHOST.split(",")) if (h.trim()) hosts.push(strip(h));
  if (hosts.length === 0) hosts.push("localhost");
  return hosts;
}

/** host/hostaddr query parameters are only accepted as unix-socket directories ("/..."); anything else is suspicious. */
export function hostParamProblem(databaseUrl: string): string | null {
  const u = new URL(databaseUrl);
  for (const key of ["host", "hostaddr"]) {
    for (const v of u.searchParams.getAll(key)) {
      for (const h of v.split(",")) if (!h.trim().startsWith("/")) return `The connection string carries a ?${key}= parameter ("${h.trim()}"); only the URL host is accepted for imports (a unix-socket path starting with / is the one exception).`;
    }
  }
  return null;
}

export function isLocalHost(h: string): boolean {
  return LOCAL_HOSTS.has(h) || h.startsWith("/"); // a unix-socket directory is local
}

export function databaseNameOf(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  return name || u.searchParams.get("dbname") || "(default)";
}

export type TargetDecision =
  | { ok: true; host: string; database: string; remote: boolean; needsTypedName: boolean }
  | { ok: false; message: string };

/**
 * Decide whether an import may go to this database. Local hosts: yes. Anything else: only with --allow-remote AND the
 * database name confirmed (typed or --confirm-db-name=<name>). Pure: the script supplies the confirmation text.
 */
export function assessImportTarget(
  databaseUrl: string,
  opts: { allowRemote: boolean; confirmedName?: string | null },
  env: Record<string, string | undefined> = {},
): TargetDecision {
  let hosts: string[];
  let database: string;
  try { hosts = effectiveHosts(databaseUrl, env); database = databaseNameOf(databaseUrl); } catch { return { ok: false, message: "DATABASE_URL is not a valid URL." }; }
  const paramProblem = hostParamProblem(databaseUrl);
  if (paramProblem) return { ok: false, message: paramProblem };
  const remoteHosts = hosts.filter((h) => !isLocalHost(h));
  const host = hosts.join(",");
  if (remoteHosts.length === 0) return { ok: true, host, database, remote: false, needsTypedName: false };
  if (!opts.allowRemote) {
    return { ok: false, message: `Refusing to import into the non-local host "${host}". Imports only go to localhost/127.0.0.1/::1 unless you pass --allow-remote and confirm the database name.` };
  }
  if (opts.confirmedName == null) return { ok: true, host, database, remote: true, needsTypedName: true };
  if (opts.confirmedName !== database) return { ok: false, message: `The confirmation does not match the database name "${database}". Nothing was done.` };
  return { ok: true, host, database, remote: true, needsTypedName: false };
}

/** SSL rule shared with src/db/index.ts: off for local hosts, on elsewhere, DATABASE_SSL=true|false overrides. */
export function sslFor(databaseUrl: string, env: Record<string, string | undefined>): false | { rejectUnauthorized: false } {
  const flag = env.DATABASE_SSL?.toLowerCase();
  if (flag === "true") return { rejectUnauthorized: false };
  if (flag === "false") return false;
  const host = new URL(databaseUrl).hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(host) ? false : { rejectUnauthorized: false };
}

/* ------------------------------------------------------------------------------------------------
 * Export-path safety
 * ---------------------------------------------------------------------------------------------- */
/**
 * Where may an export be written? Default folder = <root>/backups. Another folder INSIDE the project (source folders)
 * is refused unless the operator gave an explicit --out file path. Folders outside the project are fine.
 * `rel` = path.relative(projectRoot, target) computed by the caller.
 */
export function isInsideProjectButNotBackups(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  if (norm === "" ) return true; // the project root itself
  if (norm === ".." || norm.startsWith("../") || /^[A-Za-z]:/.test(norm) || norm.startsWith("/")) return false; // outside the project
  return !(norm === "backups" || norm.startsWith("backups/"));
}

/* ------------------------------------------------------------------------------------------------
 * Load SQL helpers (used by the import script, tested through the DB test)
 * ---------------------------------------------------------------------------------------------- */
export const qi = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** `SELECT to_jsonb(t) - excluded FROM table t` (secrets are removed inside the database). */
export function selectRowsSql(t: TableInfo): string {
  const minus = t.excludedColumns.length ? ` - ARRAY[${t.excludedColumns.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")}]::text[]` : "";
  return `SELECT (to_jsonb(x)${minus})::text AS j FROM ${qi(t.name)} x`;
}

/** Insert a batch given as one JSON array parameter ($1). Deferred columns are set to NULL here and filled later. */
export function insertBatchSql(t: TableInfo, extraColumns: string[], deferredColumns: string[]): string {
  const cols = [...t.exportedColumns, ...extraColumns];
  const list = cols.map(qi).join(", ");
  const select = cols.map((c) => (deferredColumns.includes(c) ? `NULL AS ${qi(c)}` : `r.${qi(c)}`)).join(", ");
  return `INSERT INTO ${qi(t.name)} (${list}) SELECT ${select} FROM jsonb_populate_recordset(NULL::${qi(t.name)}, $1::jsonb) r`;
}

/** Fill deferred columns from the same JSON batch, matched on the primary key. */
export function updateDeferredSql(t: TableInfo, columns: string[]): string {
  if (t.primaryKey.length === 0) throw new Error(`${t.name} has no primary key; cannot fill deferred columns.`);
  const set = columns.map((c) => `${qi(c)} = r.${qi(c)}`).join(", ");
  const where = t.primaryKey.map((c) => `t.${qi(c)} = r.${qi(c)}`).join(" AND ");
  return `UPDATE ${qi(t.name)} t SET ${set} FROM jsonb_populate_recordset(NULL::${qi(t.name)}, $1::jsonb) r WHERE ${where}`;
}

export function resetSequenceSql(t: TableInfo, column: string): string {
  return `SELECT setval(pg_get_serial_sequence('${qi(t.name)}', '${column}'), COALESCE((SELECT MAX(${qi(column)}) FROM ${qi(t.name)}), 1), (SELECT COUNT(*) > 0 FROM ${qi(t.name)}))`;
}

/* ------------------------------------------------------------------------------------------------
 * Values the importer generates for the columns that are never exported (NOT NULL secrets).
 * The result must never verify against any password/PIN: see verifyPassword / verifyPin in src/lib/security.ts
 * ("salt:hash" with a missing half, and a string that is not 64 hex characters).
 * ---------------------------------------------------------------------------------------------- */
export const UNUSABLE_PASSWORD_PREFIX = "!import-disabled!";
export const UNUSABLE_PIN_PREFIX = "import-disabled-";

/** Table -> excluded column that is NOT NULL and so must be filled with an unusable value on import. */
export const GENERATED_ON_IMPORT: Record<string, { column: string; kind: "password" | "pin" }> = {
  users: { column: "password_hash", kind: "password" },
  workers: { column: "pin_hash", kind: "pin" },
};

/** 16 characters (80 bits), no look-alike characters, grouped 4-4-4-4. Alphabet has exactly 32 symbols: no modulo bias. */
export function makeTemporaryPassword(randomBytes: (n: number) => Buffer): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += alphabet[bytes[i]! & 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}
