/**
 * Integration check for POST /api/backup (the "Download a backup" button). LOCAL ONLY, NOT part of `npm test`.
 * Creates throw-away databases (A seeded, B empty) on the server DATABASE_URL points to, starts `next dev` on 127.0.0.1,
 * and calls the route over HTTP. Databases are left behind (never dropped).
 *
 * Run: DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres DATABASE_SSL=false npx tsx tests/backup-route-db.ts
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { Client, Pool } from "pg";
import { claimBackupAttempt, resetBackupAttempts, BACKUP_MAX_ATTEMPTS } from "../src/server/backup-lock";
import { assessImportTarget, decodeAndValidateBackup, getRegistry } from "../src/lib/db-backup";
import { exportDatabase, importDatabase } from "../src/lib/db-backup-io";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to a LOCAL server (e.g. postgresql://postgres@127.0.0.1:5433/postgres)."); process.exit(2); }
const guard = assessImportTarget(base, { allowRemote: false }, process.env);
if (!guard.ok) { console.error(`Refusing to run: ${guard.message} (local databases only)`); process.exit(2); }

const stamp = Date.now();
const NAME_A = `dbbk_route_a_${stamp}`, NAME_B = `dbbk_route_b_${stamp}`;
const urlFor = (n: string) => { const u = new URL(base); u.pathname = `/${n}`; return u.toString(); };
const PORT = 3100 + Math.floor(Math.random() * 400);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SECRET = "localvisualtestsecret0123456789abcdef";
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}
const sh = (args: string[], dbUrl: string) => spawnSync("npx", args, { env: { ...process.env, DATABASE_URL: dbUrl, DATABASE_SSL: "false", AUTH_SECRET: SECRET }, encoding: "utf8" });

type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function call(opts: { method?: string; cookie?: string; origin?: string | null; site?: string; type?: string | null; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = `hp_session=${opts.cookie}`;
    if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
    if (opts.site) headers["Sec-Fetch-Site"] = opts.site;
    if (opts.type !== null) headers["Content-Type"] = opts.type ?? "application/json";
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/backup", method: opts.method ?? "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(opts.body ?? "");
  });
}
const pw = (p: string) => JSON.stringify({ password: p });

async function main() {
  const adm = new Client({ connectionString: urlFor("postgres") }); await adm.connect();
  await adm.query(`CREATE DATABASE ${NAME_A}`); await adm.query(`CREATE DATABASE ${NAME_B}`); await adm.end();
  const A = urlFor(NAME_A), B = urlFor(NAME_B);
  console.log(`Scratch databases: ${NAME_A} (seeded), ${NAME_B} (empty)`);
  check("push + seed A", sh(["drizzle-kit", "push", "--force"], A).status === 0 && sh(["tsx", "src/db/seed.ts"], A).status === 0);
  check("push B", sh(["drizzle-kit", "push", "--force"], B).status === 0);

  const a = new Client({ connectionString: A }); await a.connect();
  const seedHash = (await a.query("SELECT password_hash FROM users WHERE role = 'owner' LIMIT 1")).rows[0].password_hash as string;
  const ownerId = (await a.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1")).rows[0].id as string;
  await a.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ('OWNER-SESSION-TOKEN-1', $1, now() + interval '1 day')", [ownerId]);
  const staff = (await a.query("INSERT INTO users (email, password_hash, name, role) VALUES ('staff@example.com', $1, 'Staff', 'staff') RETURNING id", [seedHash])).rows[0].id;
  await a.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ('STAFF-SESSION-TOKEN-1', $1, now() + interval '1 day')", [staff]);
  await a.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ('EXPIRED-SESSION-TOKEN', $1, now() - interval '1 day')", [ownerId]);
  await a.query(`INSERT INTO service_invoices (customer_id, status, subtotal_cents, total_cents, amount_paid_cents) SELECT id, 'sent', 123456789, 123456789, 0 FROM service_customers LIMIT 1`);
  await a.query(`INSERT INTO service_document_shares (owner_id, invoice_id, kind, token_hash, expires_at) SELECT $1, id, 'invoice', 'SHARE-TOKEN-HASH-QQQ', now() + interval '1 day' FROM service_invoices LIMIT 1`, [ownerId]);
  const owner2 = (await a.query("INSERT INTO users (email, password_hash, name, role) VALUES ('owner2@example.com', $1, 'Owner Two', 'owner') RETURNING id", [seedHash])).rows[0].id as string;
  await a.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ('OWNER2-SESSION-TOKEN', $1, now() + interval '1 day')", [owner2]);
  await a.end();

  const server: ChildProcess = spawn("npx", ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { env: { ...process.env, DATABASE_URL: A, DATABASE_SSL: "false", AUTH_SECRET: SECRET, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let serverLog = "";
  server.stdout?.on("data", (d) => { serverLog += d; });
  server.stderr?.on("data", (d) => { serverLog += d; });
  const stop = () => { try { process.kill(-server.pid!, "SIGKILL"); } catch { /* already gone */ } };
  process.on("exit", stop);
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { try { await call({ method: "GET" }); up = true; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
    check("dev server is up on 127.0.0.1", up);
    if (!up) throw new Error("server did not start");

    console.log("\nsecurity");
    let r = await call({ body: pw("atelier2026") });
    check("no session -> 401, no data, no download headers", r.status === 401 && !/gzip/.test(String(r.headers["content-type"])) && r.body.length < 200 && !r.body.toString().includes("@"), r.body.toString());
    r = await call({ cookie: "EXPIRED-SESSION-TOKEN", body: pw("atelier2026") });
    check("expired session -> 401", r.status === 401);
    r = await call({ cookie: "STAFF-SESSION-TOKEN-1", body: pw("atelier2026") });
    check("non-owner -> 403", r.status === 403, r.status);
    r = await call({ method: "GET", cookie: "OWNER-SESSION-TOKEN-1" });
    check("GET is not allowed (405)", r.status === 405, r.status);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", origin: "https://evil.example.net", body: pw("atelier2026") });
    check("foreign Origin -> 403", r.status === 403, r.status);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", origin: null, body: pw("atelier2026") });
    check("no Origin -> 403", r.status === 403, r.status);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", site: "cross-site", body: pw("atelier2026") });
    check("Sec-Fetch-Site: cross-site -> 403", r.status === 403, r.status);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", type: "text/plain", body: pw("atelier2026") });
    check("non-JSON content type -> 403", r.status === 403, r.status);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", body: pw("wrong-password") });
    check("wrong password -> 403 generic, no data", r.status === 403 && /Wrong password/.test(r.body.toString()) && !String(r.headers["content-type"]).includes("gzip"), r.body.toString());
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", body: "{not json" });
    check("garbage body -> 403, counted as a wrong try", r.status === 403, r.status);

    console.log("\ndownload");
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", site: "same-origin", body: pw("atelier2026") });
    check("correct password -> 200 gzip attachment", r.status === 200 && r.headers["content-type"] === "application/gzip" && /^attachment; filename="herrero-backup-\d{8}-\d{6}\.json\.gz"$/.test(String(r.headers["content-disposition"])), { s: r.status, h: r.headers });
    check("headers: no-store + nosniff, length matches", r.headers["cache-control"] === "no-store" && r.headers["x-content-type-options"] === "nosniff" && Number(r.headers["content-length"]) === r.body.length);
    check("gzip magic bytes", r.body[0] === 0x1f && r.body[1] === 0x8b);
    const raw = gunzipSync(r.body).toString("utf8");
    check("file has no password hash, session token or share-link hash", !raw.includes(seedHash) && !raw.includes("SESSION-TOKEN") && !raw.includes("SHARE-TOKEN") && !JSON.stringify(JSON.parse(raw).data).match(/password_hash|pin_hash|token_hash|loginGatePinHash/));
    const backup = decodeAndValidateBackup(r.body);
    check("bytes pass the importer's validation (format, fingerprint, checksums)", backup.manifest.format === 1);

    console.log("\nimport the downloaded file into an empty DB (existing import core)");
    const c = new Client({ connectionString: B }); await c.connect();
    const result = await importDatabase(c, backup);
    check("import into empty B succeeds and verifies", Object.keys(result.rowsByTable).length === getRegistry().filter((t) => !t.excluded).length);
    const again = await exportDatabase(c);
    await c.end();
    const differing = Object.entries(backup.manifest.tables).filter(([t, m]) => again.manifest.tables[t]?.rows !== m.rows || again.manifest.tables[t]?.sha256 !== m.sha256).map(([t]) => t);
    check("every table in B has the same row count and sha256 as the downloaded file", differing.length === 0, differing);

    console.log("\nrate limit");
    // attempts so far that reached the limiter: wrong, garbage, correct = 3 of 5
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", body: pw("nope-1") });
    const r2 = await call({ cookie: "OWNER-SESSION-TOKEN-1", body: pw("nope-2") });
    check("tries 4 and 5 are still answered (wrong password)", r.status === 403 && r2.status === 403, [r.status, r2.status]);
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", body: pw("atelier2026") });
    check("too many tries -> 429 with Retry-After, even with the right password", r.status === 429 && Number(r.headers["retry-after"]) > 0 && !String(r.headers["content-type"]).includes("gzip"), { s: r.status, h: r.headers["retry-after"] });
    r = await call({ cookie: "OWNER-SESSION-TOKEN-1", origin: "https://evil.example.net", body: pw("atelier2026") });
    check("a foreign origin is still refused (403) before the limiter", r.status === 403);

    console.log("\natomic lock + fail closed");
    const q = new Client({ connectionString: A }); await q.connect();
    const pool = new Pool({ connectionString: A, max: 12 });
    const claims = await Promise.all(Array.from({ length: 30 }, () => claimBackupAttempt(pool, "race-user")));
    const allowed = claims.filter((x) => x.allowed).length;
    check(`30 parallel guesses: exactly ${BACKUP_MAX_ATTEMPTS} get through, the rest are locked (never more than 5)`, allowed === BACKUP_MAX_ATTEMPTS && claims.filter((x) => !x.allowed).every((x) => x.retryAfterSec > 800 && x.retryAfterSec <= 900), { allowed });
    check("while locked, further attempts stay locked", !(await claimBackupAttempt(pool, "race-user")).allowed);
    await resetBackupAttempts(pool, "race-user");
    check("reset (after a correct password) clears the lock", (await claimBackupAttempt(pool, "race-user")).allowed);
    await q.query("UPDATE gos_login_attempts SET failed_count = 9, first_failed_at = now() - interval '20 minutes', locked_until = now() - interval '5 minutes' WHERE email = 'backup:race-user'");
    check("an expired lock/window starts counting again", (await claimBackupAttempt(pool, "race-user")).allowed);
    check("a missing table makes the helper throw (fail closed)", await (async () => {
      await q.query("ALTER TABLE gos_login_attempts RENAME TO gos_login_attempts_x");
      try { await claimBackupAttempt(pool, "x"); return false; } catch { return true; } finally { await q.query("ALTER TABLE gos_login_attempts_x RENAME TO gos_login_attempts"); }
    })());

    const O2 = { cookie: "OWNER2-SESSION-TOKEN" };
    await q.query("ALTER TABLE gos_login_attempts RENAME TO gos_login_attempts_x");
    r = await call({ ...O2, body: pw("atelier2026") });
    check("lock table missing -> 503 'temporarily unavailable', NO file even with the right password", r.status === 503 && /temporarily unavailable/.test(r.body.toString()) && !String(r.headers["content-type"]).includes("gzip"), { s: r.status, b: r.body.toString().slice(0, 120) });
    await q.query("ALTER TABLE gos_login_attempts_x RENAME TO gos_login_attempts");
    await q.query("INSERT INTO gos_login_attempts (email, failed_count, first_failed_at, locked_until) VALUES ($1, 6, now(), now() + interval '10 minutes')", [`backup:${owner2}`]);
    r = await call({ ...O2, body: pw("atelier2026") });
    check("locked user -> 429 + Retry-After, even with the right password", r.status === 429 && Number(r.headers["retry-after"]) > 0 && !String(r.headers["content-type"]).includes("gzip"), r.status);
    await q.query("UPDATE gos_login_attempts SET failed_count = 3, locked_until = NULL WHERE email = $1", [`backup:${owner2}`]);
    r = await call({ ...O2, body: pw("atelier2026") });
    const left = (await q.query("SELECT 1 FROM gos_login_attempts WHERE email = $1", [`backup:${owner2}`])).rowCount;
    check("correct password after 3 failures -> 200 and the failure counter is reset", r.status === 200 && left === 0, { s: r.status, left });
    await pool.end(); await q.end();

    console.log("\naudit log (server output)");
    const audits = serverLog.split("\n").filter((l) => l.includes('"audit":"backup_export"')).map((l) => JSON.parse(l.slice(l.indexOf("{"))));
    const outcomes = new Set(audits.map((x) => x.outcome));
    check("one structured line per outcome: ok, wrong_password, locked, rate_limited, unavailable, denied", ["ok", "wrong_password", "locked", "rate_limited", "unavailable", "denied"].every((o) => outcomes.has(o)), [...outcomes]);
    check("audit lines carry userId + ts + bytes only on ok", audits.every((x) => x.userId && x.ts) && audits.filter((x) => x.outcome === "ok").every((x) => x.bytes > 0));
    check("server output never contains the password, e-mail or session tokens", !/atelier2026|owner@herrero\.ph|owner2@example\.com|SESSION-TOKEN/.test(serverLog));
  } finally {
    stop();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll backup-route DB checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
