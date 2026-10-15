/**
 * End-to-end check of `npm run db:export` / `npm run db:import` against THROW-AWAY LOCAL databases. NOT part of `npm test`.
 *
 * Creates two uniquely named databases on the server DATABASE_URL points to (A = seeded demo data, B = empty schema),
 * runs the real scripts as child processes, and compares A and B. Databases are left behind (never dropped).
 *
 * Run: DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres DATABASE_SSL=false npx tsx tests/db-backup-db.ts
 * Refuses to run unless the host is 127.0.0.1 / localhost / ::1.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Client } from "pg";
import { verifyPassword, verifyPin } from "../src/lib/security";
import { assessImportTarget, getExportedTables, getRegistry, hashRows, sortRows, stripExcludedColumns, selectRowsSql, ROW_FILTERS } from "../src/lib/db-backup";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to a LOCAL server (e.g. postgresql://postgres@127.0.0.1:5433/postgres)."); process.exit(2); }
const baseUrl = new URL(base);
const targetCheck = assessImportTarget(base, { allowRemote: false }, process.env); // host / hostaddr / PGHOST aware
if (!targetCheck.ok) { console.error(`Refusing to run: ${targetCheck.message} (local databases only)`); process.exit(2); }

const stamp = Date.now();
const NAME_A = `dbbk_a_${stamp}`, NAME_B = `dbbk_b_${stamp}`;
const urlFor = (name: string) => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };
const root = process.cwd();
const outDir = mkdtempSync(path.join(tmpdir(), "dbbk-"));

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}

function run(args: string[], dbUrl: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync("npx", args, { cwd: root, env: { ...process.env, DATABASE_URL: dbUrl, DATABASE_SSL: "false", ...extraEnv }, encoding: "utf8", shell: process.platform === "win32" });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}
/** The import script needs a terminal for --apply (the temp password is shown on screen only); give it a pseudo-terminal via `script`. */
function runApplyInTty(file: string, dbUrl: string) {
  const cmd = `npx tsx scripts/db-import.ts ${JSON.stringify(file)} --apply`;
  const res = spawnSync("script", ["-qec", cmd, "/dev/null"], { cwd: root, env: { ...process.env, DATABASE_URL: dbUrl, DATABASE_SSL: "false" }, encoding: "utf8" });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

async function readAll(url: string) {
  const c = new Client({ connectionString: url }); await c.connect();
  const out: Record<string, Record<string, unknown>[]> = {};
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await c.query("SET LOCAL TIME ZONE 'UTC'");
  for (const t of getRegistry()) {
    const r = await c.query<{ j: string }>(selectRowsSql(t));
    const rows = r.rows.map((x) => JSON.parse(x.j) as Record<string, unknown>);
    out[t.name] = t.excluded ? rows : sortRows((ROW_FILTERS[t.name] ? rows.filter(ROW_FILTERS[t.name]!) : rows).map((x) => stripExcludedColumns(t, x)));
  }
  await c.query("COMMIT");
  await c.end();
  return out;
}

async function main() {
  const adminUrl = urlFor("postgres");
  const admin = new Client({ connectionString: adminUrl }); admin.on("error", () => {}); await admin.connect();
  await admin.query(`CREATE DATABASE ${NAME_A}`);
  await admin.query(`CREATE DATABASE ${NAME_B}`);
  await admin.end();
  const A = urlFor(NAME_A), B = urlFor(NAME_B);
  console.log(`Scratch databases: ${NAME_A} (seeded), ${NAME_B} (empty)`);

  console.log("\nsetup");
  let r = run(["drizzle-kit", "push", "--force"], A); check("drizzle-kit push into A", r.code === 0, r.out.slice(-400));
  r = run(["tsx", "src/db/seed.ts"], A); check("seed A", r.code === 0, r.out.slice(-400));
  r = run(["drizzle-kit", "push", "--force"], B); check("drizzle-kit push into B (empty)", r.code === 0, r.out.slice(-400));

  // Add a few awkward rows the demo seed may not have: NULLs, empty strings, unicode, jsonb, microsecond timestamps.
  const a = new Client({ connectionString: A }); await a.connect();
  const seedHash = (await a.query<{ password_hash: string }>("SELECT password_hash FROM users LIMIT 1")).rows[0]!.password_hash;
  const pinHashes = (await a.query<{ pin_hash: string }>("SELECT pin_hash FROM workers")).rows.map((x) => x.pin_hash);
  await a.query("INSERT INTO sessions (token, user_id, expires_at) SELECT 'SESSION-SECRET-TOKEN-XYZ', id, now() + interval '1 day' FROM users LIMIT 1");
  await a.query("INSERT INTO settings (key, value) VALUES ('someApiToken', 'tok-should-not-leave'), ('publicWebsiteContent', 'Peña ☃ \"quoted\" \\\\ back')");
  await a.query("INSERT INTO gos_settings (id, data) VALUES (1, '{\"n\":[1,2,{\"x\":null}],\"s\":\"\",\"e\":[]}'::jsonb) ON CONFLICT (id) DO NOTHING");
  await a.query("INSERT INTO gos_login_attempts (email, failed_count) VALUES ('x@y.z', 3)");
  // Invoices, lines, payments (integer centavos), a doc share link, geography with doubles, and a package line (self-FK).
  await a.query(`INSERT INTO service_invoices (customer_id, job_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, amount_paid_cents, notes, due_date)
    SELECT c.id, (SELECT id FROM service_jobs WHERE customer_id = c.id LIMIT 1), 'partial', 123456789, 1, 2147483000, 2147483647, 1000050, 'Peña "n" ☃', now() FROM service_customers c LIMIT 2`);
  await a.query(`INSERT INTO service_invoice_items (invoice_id, description, details, qty, unit_price_cents) SELECT id, 'Tuning', NULL, 2, 300050 FROM service_invoices`);
  await a.query(`INSERT INTO service_payments (invoice_id, amount_cents, method, reference, note) SELECT id, 500025, 'gcash', '', NULL FROM service_invoices`);
  await a.query(`INSERT INTO service_payments (invoice_id, amount_cents) SELECT id, 500025 FROM service_invoices`);
  await a.query(`INSERT INTO service_document_shares (owner_id, invoice_id, kind, token_hash, expires_at) SELECT (SELECT id FROM users LIMIT 1), id, 'invoice', 'SHARE-TOKEN-HASH-QQQ', now() + interval '1 day' FROM service_invoices LIMIT 1`);
  await a.query(`INSERT INTO ph_regions VALUES ('R10', 'Northern Mindanao', 'X')`);
  await a.query(`INSERT INTO ph_cities (code, name, full_name, province_code, region_code, lat, lng) VALUES ('C1', 'Davao', 'Davao City', NULL, 'R10', 7.190708, 125.455341), ('C2', 'Nowhere', 'Nowhere', NULL, 'R10', NULL, NULL)`);
  await a.query(`INSERT INTO service_catalog (id, name, kind, unit_price_cents, package_id) VALUES
    ('00000000-0000-4000-8000-000000000001', 'Pkg low id', 'package', 100, NULL),
    ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Pkg high id', 'package', 200, NULL),
    ('00000000-0000-4000-8000-000000000002', 'Member of high', 'part', 0, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
    ('ffffffff-ffff-4fff-8fff-fffffffffffe', 'Member of low', 'part', 0, '00000000-0000-4000-8000-000000000001')`);
  const counts: Record<string, number> = {};
  for (const t of getRegistry()) counts[t.name] = Number((await a.query(`SELECT count(*) FROM "${t.name}"`)).rows[0].count);
  check("seed produced data (users, workers, jobs, invoices, payments)", ["users", "workers", "service_jobs", "service_invoices", "service_payments"].every((t) => counts[t]! > 0), counts);

  console.log("\nexport");
  await a.query("INSERT INTO settings (key, value) VALUES ('mysteryKey', 'x')");
  r = run(["tsx", "scripts/db-export.ts", "--out", path.join(outDir, "unknown-key.json.gz")], A);
  check("export FAILS on an unknown settings key and writes nothing", r.code !== 0 && /mysteryKey/.test(r.out) && !existsSync(path.join(outDir, "unknown-key.json.gz")), r.out.slice(-300));
  await a.query("DELETE FROM settings WHERE key = 'mysteryKey'");
  await a.end();
  r = run(["tsx", "scripts/db-export.ts", "--out", "stray-backup.json.gz"], A);
  check("export with --out inside the project folder is refused", r.code !== 0 && /Refusing/.test(r.out) && !existsSync("stray-backup.json.gz"), r.out.slice(-300));
  r = run(["tsx", "scripts/db-export.ts", "--out", path.join(outDir, "nope", "x.json.gz")], A);
  check("export with --out works", r.code === 0 && existsSync(path.join(outDir, "nope", "x.json.gz")), r.out.slice(-400));
  r = run(["tsx", "scripts/db-export.ts", "--dir", "src"], A);
  check("export into a source folder is refused", r.code !== 0 && /Refusing/.test(r.out), r.out.slice(-300));
  const before = existsSync("backups") ? readdirSync("backups").length : 0;
  r = run(["tsx", "scripts/db-export.ts", "--dir", outDir], A);
  const file = readdirSync(outDir).find((f) => /^herrero-backup-\d{8}-\d{6}\.json\.gz$/.test(f));
  check("export (default naming) writes herrero-backup-YYYYMMDD-HHMMSS.json.gz", r.code === 0 && !!file, r.out.slice(-400));
  check("export output prints host + db name, never user/password/URL", r.out.includes(NAME_A) && !r.out.includes("postgres://") && !r.out.includes("postgresql://"), r.out.slice(0, 300));
  check("export warns about personal data", /personal data/.test(r.out));
  check("export printed per-table row counts", /service_payments\s+\d+/.test(r.out));
  void before;
  const filePath = path.join(outDir, file!);
  const raw = gunzipSync(readFileSync(filePath)).toString("utf8");
  check("file has no password hash, pin hash, session token, secret setting", ![seedHash, ...pinHashes, "SESSION-SECRET-TOKEN-XYZ", "tok-should-not-leave", "SHARE-TOKEN-HASH-QQQ"].some((s) => raw.includes(s)));
  const parsed = JSON.parse(raw);
  check("login-gate row is not in data (its key NAME may appear in the manifest note)", !JSON.stringify(parsed.data).includes("loginGatePinHash") && parsed.manifest.excluded.settingsKeysSkipped.includes("loginGatePinHash"));
  check("data section has no 'sessions' / share / lockout tables and no secret columns", !["sessions", "service_document_shares", "gos_login_attempts"].some((t) => t in parsed.data) && !JSON.stringify(parsed.data).match(/password_hash|pin_hash|token_hash/));
  check("manifest rows match the live counts for exported tables", getExportedTables().every((t) => t.name === "settings" || parsed.manifest.tables[t.name].rows === counts[t.name]));
  check("settings: 2 secret rows (login-gate PIN, API token) skipped, normal kept", parsed.data.settings.length === counts.settings! - 2 && parsed.manifest.excluded.settingsRowsSkipped === 2, [parsed.data.settings.length, counts.settings]);
  const copyOfA = await readAll(A);

  console.log("\ndry run");
  const beforeB = await readAll(B);
  r = run(["tsx", "scripts/db-import.ts", filePath], B);
  const afterDry = await readAll(B);
  check("dry run succeeds and says nothing was written", r.code === 0 && /DRY RUN finished/.test(r.out), r.out.slice(-500));
  check("dry run changed nothing in B", getRegistry().every((t) => afterDry[t.name]!.length === 0 && beforeB[t.name]!.length === 0));

  console.log("\nrefusals before applying");
  const tamperedPath = path.join(outDir, "tampered.json.gz");
  const t1 = JSON.parse(raw); t1.data.service_payments[0].amount_cents = t1.data.service_payments[0].amount_cents + 1;
  writeFileSync(tamperedPath, gzipSync(JSON.stringify(t1)));
  r = run(["tsx", "scripts/db-import.ts", tamperedPath, "--apply"], B);
  check("tampered file (money value changed) refused", r.code !== 0 && /checksum|changed/.test(r.out), r.out.slice(-300));
  const garbage = path.join(outDir, "garbage.json.gz"); writeFileSync(garbage, "not a gzip");
  r = run(["tsx", "scripts/db-import.ts", garbage], B);
  check("non-gzip file refused", r.code !== 0 && /gzip/.test(r.out), r.out.slice(-200));
  r = run(["tsx", "scripts/db-import.ts", filePath, "--apply"], urlFor(NAME_B).replace("127.0.0.1", "db.example.com").replace("localhost", "db.example.com"));
  check("remote host refused (no flags)", r.code !== 0 && /non-local host/.test(r.out) && !/Plan/.test(r.out), r.out.slice(-300));
  r = run(["tsx", "scripts/db-import.ts", filePath, "--allow-remote", "--confirm-db-name=wrong"], urlFor(NAME_B).replace("127.0.0.1", "db.example.com"));
  check("remote host + wrong confirmation refused", r.code !== 0 && /confirmation does not match/.test(r.out), r.out.slice(-300));
  r = run(["tsx", "scripts/db-import.ts", filePath, "--database-url=postgres://x"], B);
  check("credentials as CLI argument refused", r.code !== 0 && /Unknown option/.test(r.out));
  r = run(["tsx", "scripts/db-import.ts", filePath], A);
  check("non-empty target (A) refused in dry run", r.code !== 0 && /NOT empty/.test(r.out), r.out.slice(-300));
  r = run(["tsx", "scripts/db-import.ts", filePath, "--apply"], B, {});
  check("--apply without a terminal refused (temp password would be logged)", r.code !== 0 && /interactive terminal/.test(r.out), r.out.slice(-300));
  const stillEmpty = await readAll(B);
  check("B still empty after all refusals", getRegistry().every((t) => stillEmpty[t.name]!.length === 0));

  console.log("\napply");
  const ap = runApplyInTty(filePath, B);
  check("apply succeeds", ap.code === 0 && /Import committed/.test(ap.out), ap.out.slice(-800));
  const gate = /NEW LOGIN-GATE PIN: (\d{4})/.exec(ap.out);
  check("a new random login-gate PIN was shown", !!gate, ap.out.slice(-300));
  const pw = /ONE-TIME[^\n]*\n\s*(\S+)\s+([A-Z2-9]{4}(?:-[A-Z2-9]{4}){3})/.exec(ap.out);
  check("a one-time temporary password was shown for the owner", !!pw, ap.out.slice(-500));

  const copyOfB = await readAll(B);
  console.log("\ncompare A and B");
  for (const t of getExportedTables()) {
    const ra = copyOfA[t.name]!, rb = copyOfB[t.name]!;
    check(`${t.name}: ${ra.length} rows, same count and content hash`, ra.length === rb.length && hashRows(ra) === hashRows(rb), { a: ra.length, b: rb.length });
  }
  const sess = copyOfB.sessions!.length, attempts = copyOfB.gos_login_attempts!.length, shares = copyOfB.service_document_shares!.length;
  check("sessions / lockout counters / share links were not imported", sess === 0 && attempts === 0 && shares === 0);

  const m = new Client({ connectionString: B }); await m.connect();
  const mb = new Client({ connectionString: A }); await mb.connect();
  const q = "SELECT id, invoice_number, subtotal_cents, discount_cents, tax_cents, total_cents, amount_paid_cents, status FROM service_invoices ORDER BY id";
  const money = async (c: Client) => JSON.stringify([(await c.query(q)).rows, (await c.query("SELECT id, amount_cents, received_at FROM service_payments ORDER BY id")).rows, (await c.query("SELECT id, unit_price_cents, qty FROM service_invoice_items ORDER BY id")).rows]);
  const [mA, mB] = [await money(mb), await money(m)];
  check("invoice / payment / line money columns identical", mA === mB && mA.length > 100);
  const seqs = await m.query("SELECT last_value, is_called FROM service_invoices_invoice_number_seq");
  const maxInv = (await m.query("SELECT max(invoice_number) AS n FROM service_invoices")).rows[0].n;
  const nextInv = (await m.query("SELECT nextval(pg_get_serial_sequence('service_invoices','invoice_number')) AS n")).rows[0].n;
  check("serial sequences were reset (next invoice number follows the highest)", Number(nextInv) === Number(maxInv) + 1, { maxInv, nextInv, seqs: seqs.rows });
  const users = (await m.query("SELECT email, password_hash, role FROM users ORDER BY email")).rows;
  const pws = pw ? pw[2]! : "";
  
  check("owner can log in with the temporary password; nobody with the old one", users.filter((u) => u.role === "owner").some((u) => verifyPassword(pws, u.password_hash)) && !users.some((u) => verifyPassword("owner1234", u.password_hash)));
  const gateRow = (await m.query("SELECT value FROM settings WHERE key = 'loginGatePinHash'")).rows;
  check("login-gate PIN hash was written for the shown PIN (not the 0000 default), and is not in the file", gateRow.length === 1 && !!gate && verifyPin(gate[1]!, gateRow[0].value) && !raw.includes(gateRow[0].value));
  const wk = (await m.query("SELECT pin_hash FROM workers")).rows;
  check("worker PINs are unusable until re-set", wk.length > 0 && wk.every((w) => !verifyPin("0000", w.pin_hash) && !verifyPin("1234", w.pin_hash)));
  check("temporary password is not in the exported file or in B's data", !raw.includes(pws) && !JSON.stringify(copyOfB).includes(pws));
  const leftovers = readdirSync(outDir).concat(existsSync("backups") ? readdirSync("backups") : []);
  check("temporary password is not in any file created by the test", !leftovers.some((f) => { try { return readFileSync(path.join(outDir, f)).toString("latin1").includes(pws); } catch { return false; } }));
  await m.end(); await mb.end();

  console.log("\nafter apply");
  r = run(["tsx", "scripts/db-import.ts", filePath], B);
  check("second import into B refused (non-empty)", r.code !== 0 && /NOT empty/.test(r.out), r.out.slice(-300));
  const ap2 = runApplyInTty(filePath, B);
  check("second --apply refused and changes nothing", ap2.code !== 0 && /NOT empty/.test(ap2.out));
  const again = await readAll(B);
  check("B unchanged by the refused re-import", getExportedTables().every((t) => hashRows(again[t.name]!) === hashRows(copyOfB[t.name]!)));

  console.log("\nportal links + unknown tables + dry-run info");
  const adm2 = new Client({ connectionString: urlFor("postgres") }); await adm2.connect();
  const NAME_E = `dbbk_e_${stamp}`; await adm2.query(`CREATE DATABASE ${NAME_E}`); await adm2.end();
  const E = urlFor(NAME_E);
  r = run(["drizzle-kit", "push", "--force"], E); check("push into E", r.code === 0, r.out.slice(-200));
  const e0 = new Client({ connectionString: E }); await e0.connect(); await e0.query("CREATE TABLE mystery_extra (id int)"); await e0.query("INSERT INTO mystery_extra VALUES (1)");
  r = run(["tsx", "scripts/db-import.ts", filePath], E);
  check("unknown table WITH rows in the target: warned and refused", r.code !== 0 && /mystery_extra \(HAS ROWS\)/.test(r.out), r.out.slice(-300));
  await e0.query("DELETE FROM mystery_extra");
  r = run(["tsx", "scripts/db-import.ts", filePath], E);
  check("unknown empty table: loud warning, dry run still works", r.code === 0 && /WARNING.*mystery_extra/.test(r.out), r.out.slice(-300));
  check("dry run lists owner emails and users per role", /Users by role: .*owner=1/.test(r.out) && /owner@herrero\.ph/.test(r.out), r.out.slice(-600));
  await e0.end();
  const oldPortal = (await readAll(A)).projects!.map((p) => p.portal_uuid as string).sort();
  const apE = (() => { const res = spawnSync("script", ["-qec", `npx tsx scripts/db-import.ts ${JSON.stringify(filePath)} --apply --regenerate-portal-links`, "/dev/null"], { cwd: root, env: { ...process.env, DATABASE_URL: E, DATABASE_SSL: "false" }, encoding: "utf8" }); return { code: res.status, out: `${res.stdout}\n${res.stderr}` }; })();
  check("apply with --regenerate-portal-links succeeds", apE.code === 0 && /Import committed/.test(apE.out), apE.out.slice(-500));
  const newPortal = (await readAll(E)).projects!.map((p) => p.portal_uuid as string).sort();
  check("every project got a NEW portal link, other data identical", newPortal.length === oldPortal.length && newPortal.every((u) => !oldPortal.includes(u)) && new Set(newPortal).size === newPortal.length);
  check("B (default import) kept the original portal links", JSON.stringify((await readAll(B)).projects!.map((p) => p.portal_uuid).sort()) === JSON.stringify(oldPortal));
  r = run(["tsx", "scripts/db-import.ts", filePath], urlFor(NAME_B) + "?host=/tmp&host=db.example.com");
  check("repeated ?host= pointing at a remote server refused", r.code !== 0 && /\?host=/.test(r.out) && !/Plan/.test(r.out), r.out.slice(-300));

  console.log("\nrollback");
  // A file that passes validation but cannot load (FK to a missing parent) must leave a fresh database untouched.
  const t2 = JSON.parse(raw); t2.data.service_payments[0].invoice_id = "00000000-0000-4000-8000-00000000dead";
  t2.manifest.tables.service_payments.sha256 = hashRows(t2.data.service_payments);
  const brokenPath = path.join(outDir, "broken-fk.json.gz"); writeFileSync(brokenPath, gzipSync(JSON.stringify(t2)));
  const adm = new Client({ connectionString: urlFor("postgres") }); await adm.connect();
  const NAME_C = `dbbk_c_${stamp}`; await adm.query(`CREATE DATABASE ${NAME_C}`); await adm.end();
  const C = urlFor(NAME_C);
  r = run(["drizzle-kit", "push", "--force"], C); check("push into C", r.code === 0, r.out.slice(-200));
  const ap3 = runApplyInTty(brokenPath, C);
  const afterC = await readAll(C);
  check("broken FK: import fails and rolls back everything", ap3.code !== 0 && getRegistry().every((t) => afterC[t.name]!.length === 0), ap3.out.slice(-300));
  // exported file with a NOT NULL violation would equally roll back; covered by the same transaction.

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll db-backup DB checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
