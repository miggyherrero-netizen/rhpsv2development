/** Complete-database backup: pure core (registry, exclusions, ordering, hashing, file round trip, host safety). No database. Run: npx tsx tests/db-backup.ts */
import { gzipSync } from "node:zlib";
import {
  ALLOWED_SENSITIVE_COLUMN_NAMES, BackupFileError, EXCLUDED_COLUMNS, EXCLUDED_TABLES, GENERATED_ON_IMPORT, SENSITIVE_COLUMN_RE,
  assertExactJson, assessImportTarget, backupFileName, buildBackup, canonicalJson, computeSchemaFingerprint, decodeAndValidateBackup,
  effectiveHosts, encodeBackup, fkIntoExcludedTables, getExportedTables, getRegistry, hashRows, insertBatchSql, isInsideProjectButNotBackups,
  isSecretSettingRow, makeTemporaryPassword, settingsDisposition, assertSupportedColumnType, hostParamProblem, SETTINGS_ALLOWED_KEYS, MAX_BACKUP_FILE_BYTES, planLoad, selectRowsSql, sha256, sslFor, validatePlan, type BackupFile,
} from "../src/lib/db-backup";
import { verifyPassword, verifyPin } from "../src/lib/security";
import { UNUSABLE_PASSWORD_PREFIX, UNUSABLE_PIN_PREFIX } from "../src/lib/db-backup";
import * as appSchema from "../src/db/schema";
import * as gosSchema from "../src/db/gos-schema";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig, bigint, numeric, real, bigserial, pgTable, pgEnum } from "drizzle-orm/pg-core";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
function throws(fn: () => unknown): string | null { try { fn(); return null; } catch (e) { return (e as Error).message; } }

const registry = getRegistry();
const exported = getExportedTables();

console.log("registry");
const schemaTables = [appSchema, gosSchema].flatMap((m) => Object.values(m as Record<string, unknown>).filter((v) => is(v, PgTable)).map((v) => getTableConfig(v as PgTable).name));
check("registry has every pgTable of both schema files", [...new Set(schemaTables)].sort(), registry.map((t) => t.name).sort());
check("every table is exported or listed in EXCLUDED_TABLES", registry.every((t) => t.excluded === (t.name in EXCLUDED_TABLES)), true);
check("every EXCLUDED_TABLES entry has a reason", Object.values(EXCLUDED_TABLES).every((r) => r.length > 20), true);
check("sessions is excluded", registry.find((t) => t.name === "sessions")!.excluded, true);
check("users.password_hash and workers.pin_hash are excluded columns", [EXCLUDED_COLUMNS.users!.password_hash !== undefined, EXCLUDED_COLUMNS.workers!.pin_hash !== undefined], [true, true]);
check("exported column lists never contain an excluded column", exported.every((t) => t.exportedColumns.every((c) => !(c in (EXCLUDED_COLUMNS[t.name] ?? {})))), true);
const suspicious = exported.flatMap((t) => t.exportedColumns.filter((c) => SENSITIVE_COLUMN_RE.test(c) && !(`${t.name}.${c}` in ALLOWED_SENSITIVE_COLUMN_NAMES)).map((c) => `${t.name}.${c}`));
check("no exported table has a secret-looking column that is not excluded or explicitly allowed", suspicious, []);
check("every excluded NOT NULL column has an import-time generator", Object.entries(EXCLUDED_COLUMNS).flatMap(([t, cols]) => Object.keys(cols).filter((c) => registry.find((r) => r.name === t)!.columns.find((x) => x.name === c)!.notNull && GENERATED_ON_IMPORT[t]?.column !== c)), []);
check("no exported table references an excluded table (FK integrity)", fkIntoExcludedTables(), []);
check("fingerprint is stable and 64 hex", [computeSchemaFingerprint() === computeSchemaFingerprint(), /^[0-9a-f]{64}$/.test(computeSchemaFingerprint())], [true, true]);
const mutated = registry.map((t) => (t.name === "users" ? { ...t, columns: [...t.columns, { name: "extra", sqlType: "text", notNull: false, hasDefault: false, isSerial: false }] } : t));
check("fingerprint changes when a column is added", computeSchemaFingerprint(mutated) === computeSchemaFingerprint(), false);
check("select SQL removes excluded columns inside the database", [selectRowsSql(registry.find((t) => t.name === "users")!).includes("'password_hash'"), selectRowsSql(registry.find((t) => t.name === "workers")!).includes("'pin_hash'")], [true, true]);
check("serial columns are detected (job/invoice numbers)", registry.flatMap((t) => t.columns.filter((c) => c.isSerial).map((c) => `${t.name}.${c.name}`)).sort(), ["owner_preferences.id", "service_invoices.invoice_number", "service_jobs.job_number", "service_settings.id"]);

console.log("\nload order");
const plan = planLoad(exported);
check("order covers every exported table once", [...plan.order].sort(), exported.map((t) => t.name).sort());
check("every foreign key points to an earlier table (or is a deferred self-reference)", validatePlan(exported, plan), []);
check("service_catalog.package_id self-reference is deferred", plan.deferred.map((d) => `${d.table}.${d.columns.join(",")}`), ["service_catalog.package_id"]);
check("users before sessions-like children, customers before jobs, jobs before invoices", [plan.order.indexOf("users") < plan.order.indexOf("service_settings"), plan.order.indexOf("service_customers") < plan.order.indexOf("service_jobs"), plan.order.indexOf("service_jobs") < plan.order.indexOf("service_invoices"), plan.order.indexOf("service_invoices") < plan.order.indexOf("service_payments")], [true, true, true, true]);
const fk = (cols: string[], parent: string, nullable: boolean) => ({ columns: cols, foreignTable: parent, foreignColumns: ["id"], nullable });
const cyc = planLoad([{ name: "a", foreignKeys: [fk(["b_id"], "b", true)] }, { name: "b", foreignKeys: [fk(["a_id"], "a", false)] }]);
check("a two-table cycle is broken at the nullable FK", [cyc.order, cyc.deferred.map((d) => `${d.table}.${d.columns}`)], [["a", "b"], ["a.b_id"]]);
check("a cycle of NOT NULL keys is refused", throws(() => planLoad([{ name: "a", foreignKeys: [fk(["b_id"], "b", false)] }, { name: "b", foreignKeys: [fk(["a_id"], "a", false)] }])) !== null, true);
check("a NOT NULL self-reference is refused", throws(() => planLoad([{ name: "a", foreignKeys: [fk(["p"], "a", false)] }])) !== null, true);
check("deferred columns are inserted as NULL", insertBatchSql(registry.find((t) => t.name === "service_catalog")!, [], ["package_id"]).includes('NULL AS "package_id"'), true);

console.log("\nserialization");
check("canonical JSON ignores key order", canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
check("row hash does not depend on row order", hashRows([{ id: 1 }, { id: 2 }]) === hashRows([{ id: 2 }, { id: 1 }]), true);
check("row hash changes with content", hashRows([{ id: 1 }]) === hashRows([{ id: 2 }]), false);
const edge = { id: "00000000-0000-4000-8000-000000000001", nothing: null, emptyArr: [], emptyStr: "", nested: { a: [1, 2, { b: null }], s: "x" }, ts: "2026-10-15T01:02:03.123456+00:00", naive: "2026-10-15T01:02:03.123456", maxInt4: 2147483647, negative: -2147483648, safeMax: Number.MAX_SAFE_INTEGER, frac: 0.1 + 0.2, money: 123456789, t: true, f: false, uni: "Peña \u{1F3B9} \u0000".replace("\u0000", "") };
check("edge values survive stringify + parse unchanged", JSON.parse(JSON.stringify(edge)), edge);
check("edge values pass the exactness check", throws(() => assertExactJson(edge)), null);
check("an integer beyond 2^53 is refused (would round silently)", throws(() => assertExactJson({ n: 2 ** 53 })) !== null, true);
check("a Date, a bigint and undefined are refused (the database must format them)", [throws(() => assertExactJson({ d: new Date() })) !== null, throws(() => assertExactJson({ b: BigInt(1) })) !== null, throws(() => assertExactJson({ u: undefined })) !== null], [true, true, true]);
check("NaN / Infinity are refused", [throws(() => assertExactJson({ n: NaN })) !== null, throws(() => assertExactJson({ n: Infinity })) !== null], [true, true]);
check("file name pattern", backupFileName(new Date("2026-10-05T03:04:05Z")), "herrero-backup-20261005-030405.json.gz");

console.log("\nsecrets");
const empty = (): Record<string, Record<string, unknown>[]> => Object.fromEntries(exported.map((t) => [t.name, []]));

const HASH = "a".repeat(32) + ":" + "b".repeat(128);
const pin = sha256("herrero-pin-v1:0000");
check("settings: login-gate PIN row is a secret (by key)", isSecretSettingRow({ key: "loginGatePinHash", value: "x" }), true);
check("settings: a hash-looking value is a secret even under an innocent key", [isSecretSettingRow({ key: "foo", value: pin }), isSecretSettingRow({ key: "foo", value: HASH })], [true, true]);
check("settings: normal rows are not secret", [isSecretSettingRow({ key: "staleUpdateDays", value: "10" }), isSecretSettingRow({ key: "publicWebsiteContent", value: '{"a":1}' })], [false, false]);
check("settings allow-list: known keys kept, secrets skipped, anything else 'unknown'", [...SETTINGS_ALLOWED_KEYS.map((k) => settingsDisposition({ key: k, value: "x" })), settingsDisposition({ key: "loginGatePinHash", value: "x" }), settingsDisposition({ key: "mysteryKey", value: "x" })], ["keep", "keep", "keep", "skip-secret", "unknown"]);
check("export FAILS on an unknown settings key (clear message)", (throws(() => buildBackup({ ...empty(), settings: [{ key: "mysteryKey", value: "1" }] })) ?? "").includes("SETTINGS_ALLOWED_KEYS"), true);
const data = empty();
data.users = [{ id: "u1", email: "o@x.ph", name: "Owner", role: "owner", created_at: "2026-01-01T00:00:00.000000", password_hash: HASH }];
data.workers = [{ id: "w1", name: "W", title: "T", avatar_url: null, hourly_rate_cents: 35000, pin_hash: pin, active: true, created_at: "2026-01-01T00:00:00.000000" }];
data.settings = [{ key: "loginGatePinHash", value: pin }, { key: "staleUpdateDays", value: "10" }];
const backup = buildBackup(data, { createdAt: new Date("2026-10-15T00:00:00Z") });
const text = JSON.stringify(backup.data);
check("serialized export has no password hash, no pin hash, no login-gate row, no session data", [text.includes(HASH), text.includes(pin), text.includes("loginGatePinHash"), text.includes("password_hash"), text.includes("pin_hash"), "sessions" in backup.data, JSON.stringify(backup).includes(HASH)], [false, false, false, false, false, false, false]);
check("secrets are only in the manifest's 'excluded' note by table/column NAME", backup.manifest.excluded!.columns.sort(), ["users.password_hash", "workers.pin_hash"]);
check("the non-secret settings row is kept", backup.data.settings, [{ key: "staleUpdateDays", value: "10" }]);
check("manifest lists each exported table with rows + sha256", Object.keys(backup.manifest.tables).sort(), exported.map((t) => t.name).sort());
check("manifest format/fingerprint", [backup.manifest.format, backup.manifest.appSchemaFingerprint], [1, computeSchemaFingerprint()]);
check("unusable password never verifies", verifyPassword("anything", UNUSABLE_PASSWORD_PREFIX + "00ff"), false);
check("unusable PIN never verifies", [verifyPin("0000", UNUSABLE_PIN_PREFIX + "00ff"), verifyPin("1234", UNUSABLE_PIN_PREFIX + "00ff")], [false, false]);
const tp = makeTemporaryPassword((n) => Buffer.alloc(n, 7));
check("temporary password format 4-4-4-4 from a safe alphabet", /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(tp), true);

console.log("\nfile round trip + tamper detection");
const bytes = encodeBackup(backup);
check("gzip magic bytes", [bytes[0], bytes[1]], [0x1f, 0x8b]);
const back = decodeAndValidateBackup(bytes);
check("round trip gives identical manifest + data", [back.manifest, back.data], [backup.manifest, backup.data]);
function expectRefused(name: string, make: (b: BackupFile) => Buffer | BackupFile) {
  const copy: BackupFile = JSON.parse(JSON.stringify(backup));
  const made = make(copy);
  const buf = Buffer.isBuffer(made) ? made : gzipSync(JSON.stringify(made));
  let msg = "";
  try { decodeAndValidateBackup(buf); } catch (e) { msg = e instanceof BackupFileError ? e.message : `WRONG ERROR ${(e as Error).message}`; }
  check(name, msg.length > 0 && !msg.startsWith("WRONG"), true);
}
expectRefused("not gzip", () => Buffer.from("hello"));
expectRefused("gzip but not JSON", () => gzipSync("not json"));
expectRefused("unknown format", (b) => { b.manifest.format = 2; return b; });
expectRefused("other schema fingerprint", (b) => { b.manifest.appSchemaFingerprint = "0".repeat(64); return b; });
expectRefused("a changed value (sha256 mismatch)", (b) => { b.data.users![0]!.name = "Hacker"; return b; });
expectRefused("a deleted row (count mismatch)", (b) => { b.data.users!.pop(); return b; });
expectRefused("an added row with recomputed sha but wrong manifest count", (b) => { b.data.workers!.push({ ...b.data.workers![0]! }); return b; });
expectRefused("a table removed from data", (b) => { delete b.data.projects; return b; });
expectRefused("an extra table smuggled into data", (b) => { b.data.sessions = []; return b; });
expectRefused("a password_hash injected with a recomputed checksum", (b) => {
  b.data.users![0]!.password_hash = HASH;
  b.manifest.tables.users = { rows: 1, sha256: hashRows(b.data.users!) };
  return b;
});
expectRefused("a login-gate settings row injected with a recomputed checksum", (b) => {
  b.data.settings!.push({ key: "loginGatePinHash", value: pin });
  b.manifest.tables.settings = { rows: 2, sha256: hashRows(b.data.settings!) };
  return b;
});

console.log("\nhost safety");
const dec = (url: string, o: { allowRemote?: boolean; confirmedName?: string | null } = {}, env = {}) => assessImportTarget(url, { allowRemote: o.allowRemote ?? false, confirmedName: o.confirmedName ?? null }, env);
check("localhost / 127.0.0.1 / ::1 are allowed", ["postgresql://u@localhost:5432/d", "postgresql://u@127.0.0.1:5433/d", "postgresql://u@[::1]:5432/d"].map((u) => dec(u).ok), [true, true, true]);
check("supabase host refused without flags", dec("postgresql://postgres.x:pw@aws-0-ap.pooler.supabase.com:6543/postgres").ok, false);
check("remote refused with --allow-remote alone? no: asks for the typed name", (() => { const r = dec("postgresql://u@db.example.com/prod", { allowRemote: true }); return r.ok && r.needsTypedName; })(), true);
check("remote with the wrong name refused", dec("postgresql://u@db.example.com/prod", { allowRemote: true, confirmedName: "other" }).ok, false);
check("remote with allow + right name accepted", dec("postgresql://u@db.example.com/prod", { allowRemote: true, confirmedName: "prod" }).ok, true);
check("confirm name without --allow-remote is still refused", dec("postgresql://u@db.example.com/prod", { confirmedName: "prod" }).ok, false);
check("lookalike hostnames are not local", [dec("postgresql://u@localhost.evil.com/d").ok, dec("postgresql://u@127.0.0.1.evil.com/d").ok, dec("postgresql://u@notlocalhost/d").ok], [false, false, false]);
check("?host= override to a remote server is caught", dec("postgresql://u@localhost/d?host=db.example.com").ok, false);
check("no host in URL falls back to PGHOST", [dec("postgresql:///d", {}, { PGHOST: "db.example.com" }).ok, dec("postgresql:///d", {}, {}).ok, effectiveHosts("postgresql:///d?host=/var/run/postgresql")], [false, true, ["/var/run/postgresql"]]);
check("refusal message never contains the password", JSON.stringify(dec("postgresql://u:SuperSecret@db.example.com/prod")).includes("SuperSecret"), false);
check("ssl rule matches src/db/index.ts", [sslFor("postgresql://u@localhost/d", {}), sslFor("postgresql://u@h.example.com/d", {}) !== false, sslFor("postgresql://u@h.example.com/d", { DATABASE_SSL: "false" })], [false, true, false]);


console.log("\nhost safety: repeated / comma / PGHOST bypasses");
check("repeated ?host= (pg uses the LAST one) is refused", dec("postgresql://u@localhost/d?host=/tmp&host=db.example.com").ok, false);
check("hostaddr to a remote IP is refused", dec("postgresql://u@localhost/d?hostaddr=203.0.113.9").ok, false);
check("comma host list with a remote entry is refused", dec("postgresql://u@localhost,db.example.com/d").ok === false || dec("postgresql://u@localhost/d?host=localhost,db.example.com").ok === false, true);
check("every value of every repeated param is collected", effectiveHosts("postgresql://u@localhost/d?host=/a,/b&host=/c&hostaddr=127.0.0.1"), ["localhost", "/a", "/b", "/c", "127.0.0.1"]);
check("?host=localhost (not a socket path) is refused as a param", dec("postgresql://u@localhost/d?host=localhost").ok, false);
check("unix-socket path param is accepted", dec("postgresql:///d?host=/var/run/postgresql").ok, true);
check("PGHOST that conflicts with a local URL is refused", [dec("postgresql://u@127.0.0.1/d", {}, { PGHOST: "db.example.com" }).ok, dec("postgresql://u@127.0.0.1/d", {}, { PGHOST: "localhost" }).ok], [false, true]);
check("hostParamProblem names the parameter", (hostParamProblem("postgresql://u@localhost/d?host=x.example.com") ?? "").includes("?host="), true);

console.log("\ncolumn type support");
const col = (c: { getSQLType(): string; enumValues?: unknown }) => throws(() => assertSupportedColumnType("t", "c", c.getSQLType(), (c as { enumValues?: unknown }).enumValues));
const tbl = pgTable("probe", { b: bigint("b", { mode: "number" }), n: numeric("n"), r: real("r"), bs: bigserial("bs", { mode: "number" }) });
const tc = getTableConfig(tbl).columns;
check("bigint / numeric / real / bigserial are refused with a clear message", tc.map((c) => (col(c) ?? "").includes("does not know how to round-trip")), [true, true, true, true]);
check("unknown types (bytea, time, interval) are refused", ["bytea", "time", "interval", "numeric(10,2)"].map((t) => throws(() => assertSupportedColumnType("t", "c", t, undefined)) !== null), [true, true, true, true]);
const probeEnum = pgEnum("probe_kind", ["a", "b"]);
check("a pgEnum column is accepted (detected by enumValues, not by name)", throws(() => assertSupportedColumnType("t", "c", "probe_kind", probeEnum.enumValues)), null);
check("a type that only LOOKS like an enum name is refused", throws(() => assertSupportedColumnType("t", "c", "some_unknown_type", undefined)) !== null, true);

console.log("\nsize limits");
check("a file that expands beyond the cap is refused with a plain error", (() => { try { decodeAndValidateBackup(gzipSync(Buffer.alloc(5000, 97)), undefined, 1000); return "no error"; } catch (e) { return e instanceof BackupFileError && /expands to more than/.test(e.message) ? "ok" : String(e); } })(), "ok");
check("input size cap is 200 MB", MAX_BACKUP_FILE_BYTES, 200 * 1024 * 1024);

console.log("\nexport folder safety");
check("backups folder and subfolders are fine", ["backups", "backups/2026", "backups\\x"].map(isInsideProjectButNotBackups), [false, false, false]);
check("project source folders and the project root are refused", ["src", "src/lib", "docs", "scripts", "public", ""].map(isInsideProjectButNotBackups), [true, true, true, true, true, true]);
check("folders outside the project are fine", ["../backups-elsewhere", "..", "C:\\Backups", "/mnt/usb"].map(isInsideProjectButNotBackups), [false, false, false, false]);
check("'..foo' is a folder INSIDE the project (not a parent)", isInsideProjectButNotBackups("..foo"), true);
check("'backupsX' is not the backups folder", isInsideProjectButNotBackups("backupsX"), true);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll db-backup checks passed");
