/**
 * DB-backed scenario for the Maintenance Phase 1 read (getMaintenanceOverview) and the manual SQL file 12.
 * LOCAL POSTGRES ONLY. NOT part of `npm test`. Throw-away database `herrero_maint_test` (schema copied with pg_dump -s from the
 * base database, then drizzle/manual/12_maintenance_notifications.sql is run TWICE on it), then dropped.
 *
 * Run: DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-maintenance-db.ts
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_maint_test";
const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
const scratchUrl = new URL(base); scratchUrl.pathname = `/${SCRATCH}`;
const baseDb = u.pathname.slice(1);
if (baseDb === SCRATCH) { console.error("Point DATABASE_URL at the base database, not the scratch one."); process.exit(2); }

let failures = 0, passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passes++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const admin = new Client({ connectionString: adminUrl.toString() });
  admin.on("error", () => {});
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await admin.query(`CREATE DATABASE ${SCRATCH}`);
  await admin.end();
  const dump = execFileSync("pg_dump", ["-s", "-h", u.hostname, "-p", u.port || "5432", "-U", u.username || "postgres", baseDb], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("psql", ["-q", "-h", u.hostname, "-p", u.port || "5432", "-U", u.username || "postgres", "-d", SCRATCH, "-v", "ON_ERROR_STOP=0"], { input: dump, stdio: ["pipe", "ignore", "ignore"] });

  process.env.DATABASE_URL = scratchUrl.toString();
  process.env.DATABASE_SSL = "false";
  process.env.AUTH_SECRET ??= "maintenancetestsecret0123456789abcdef";
  // The base database may predate the maintenance tables: run the real manual file, twice (it must be idempotent).
  const sqlFile = readFileSync("drizzle/manual/12_maintenance_notifications.sql", "utf8");
  for (let run = 1; run <= 2; run++) {
    const out = spawnSync("psql", ["-q", "-h", u.hostname, "-p", u.port || "5432", "-U", u.username || "postgres", "-d", SCRATCH, "-v", "ON_ERROR_STOP=1"], { input: sqlFile, encoding: "utf8" });
    check(`manual SQL 12, run ${run}: exit 0`, out.status === 0, out.stderr);
  }
  process.env.DATABASE_URL = scratchUrl.toString();
  process.env.DATABASE_SSL = "false";
  const { db, pool } = await import("../src/db");
  const S = await import("../src/db/schema");
  const { getMaintenanceOverview, isUndefinedTable } = await import("../src/server/maintenance-data");
  const { eq, sql } = await import("drizzle-orm");

  try {
    const now = new Date();
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    const mkCust = async (name: string, o: Record<string, unknown> = {}) => (await db.insert(S.serviceCustomers).values({ name, phone: "0917 111 2222", email: `${name.split(" ")[0]!.toLowerCase()}@example.com`, ...o } as never).returning())[0]!;
    const mkPiano = async (customerId: string, brand: string, model: string | null, due: Date | null) =>
      (await db.insert(S.servicePianos).values({ customerId, brand, model, nextServiceDueAt: due } as never).returning())[0]!;
    const mkEntry = async (customerId: string, pianoId: string, o: Record<string, unknown> = {}) =>
      (await db.insert(S.serviceWaitlistEntries).values({ customerId, pianoId, source: "recall", status: "waiting", requestedAt: now, nextFollowUpAt: now, ...o } as never).returning())[0]!;

    const past = await mkCust("Past Person"); const pPast = await mkPiano(past.id, "Yamaha", "U1", day(-12)); await mkEntry(past.id, pPast.id);
    const soon = await mkCust("Soon Person"); const pSoon = await mkPiano(soon.id, "Kawai", "K-300", day(10)); await mkEntry(soon.id, pSoon.id, { status: "messaged" });
    const far = await mkCust("Far Person"); await mkPiano(far.id, "Baldwin", "X", day(45));
    const arch = await mkCust("Archived Person", { archivedAt: new Date() }); const pArch = await mkPiano(arch.id, "Steinway", "M", day(-3)); await mkEntry(arch.id, pArch.id);
    const booked = await mkCust("Booked Person"); const pBook = await mkPiano(booked.id, "Roland", "FP", day(5));
    const [job] = await db.insert(S.serviceJobs).values({ customerId: booked.id, pianoId: pBook.id, title: "Booked tuning" } as never).returning();
    await mkEntry(booked.id, pBook.id, { status: "scheduled", jobId: job!.id });
    const noinfo = await mkCust("Noinfo Person"); const pNo = await mkPiano(noinfo.id, "N/A", null, day(2)); await mkEntry(noinfo.id, pNo.id);
    const noentry = await mkCust("Noentry Person"); await mkPiano(noentry.id, "Petrof", "P", day(3));
    const consent = await mkCust("Consent Person"); const pCon = await mkPiano(consent.id, "Bechstein", "B", day(8)); await mkEntry(consent.id, pCon.id);
    await db.insert(S.serviceNotificationPreferences).values({ customerId: consent.id, emailConsent: true, smsConsent: false });
    const opted = await mkCust("Opted Person"); const pOpt = await mkPiano(opted.id, "Schimmel", "S", day(9)); await mkEntry(opted.id, pOpt.id);
    await db.insert(S.serviceNotificationPreferences).values({ customerId: opted.id, emailConsent: true, smsConsent: true, optedOutAt: new Date() });

    const counts = async () => (await db.execute(sql`select (select count(*) from service_notification_preferences) p, (select count(*) from service_waitlist_entries) w, (select count(*) from service_pianos) pi`)).rows[0] as Record<string, string>;
    const before = await counts();
    const ov = await getMaintenanceOverview(now);
    const by = (name: string) => ov.rows.find((r) => r.customerName === name);

    console.log("1. which pianos are listed");
    check("same pianos as getRecalls minus the archived customer; the 45-day one is left out", !by("Far Person") && !by("Archived Person") && ["Past Person", "Soon Person", "Booked Person", "Noinfo Person", "Noentry Person", "Consent Person", "Opted Person"].every((n) => !!by(n)), ov.rows.map((r) => r.customerName));
    check("sorted by due date, past first", ov.rows.every((r, i) => i === 0 || ov.rows[i - 1]!.dueAt.getTime() <= r.dueAt.getTime()));
    check("counts: 1 date passed, 6 upcoming", ov.datePassed === 1 && ov.upcoming === 6 && ov.rows.length === 7, [ov.datePassed, ov.upcoming]);
    check("past piano: timing past, 3 stages, d30 + d7 + due all passed or today", by("Past Person")!.timing === "past" && by("Past Person")!.stages.length === 3 && by("Past Person")!.stages.every((s) => s.timing !== "ahead"));
    check("soon piano: timing ahead, due stage ahead", by("Soon Person")!.timing === "ahead" && by("Soon Person")!.stages[2]!.timing === "ahead");

    console.log("\n2. piano label never says N/A");
    check("N/A piano: 'Piano (info needed)' + flag", by("Noinfo Person")!.pianoLabel === "Piano (info needed)" && by("Noinfo Person")!.pianoInfoMissing && !ov.rows.some((r) => /N\/A/.test(r.pianoLabel)), by("Noinfo Person")!.pianoLabel);
    check("real piano: label, no flag", by("Past Person")!.pianoLabel === "Yamaha U1" && !by("Past Person")!.pianoInfoMissing);

    console.log("\n3. channels and consent");
    const pr = by("Past Person")!;
    check("no consent row: manual ready, e-mail / SMS 'No consent recorded'", pr.consent === "none" && pr.channels.manual.ready && pr.channels.email.reason === "No consent recorded" && pr.channels.sms.reason === "No consent recorded", pr.channels);
    const cr = by("Consent Person")!;
    check("e-mail consent + address: e-mail ready, SMS not", cr.consent === "recorded" && cr.channels.email.ready && !cr.channels.sms.ready, cr.channels);
    const or = by("Opted Person")!;
    check("opted out: nothing ready, even manual", or.consent === "opted-out" && !or.channels.manual.ready && !or.channels.email.ready && or.channels.manual.reason === "Opted out", or.channels);
    const br = by("Booked Person")!;
    check("booked (scheduled with a job): nothing ready, 'Already booked'", br.booked && !br.channels.manual.ready && br.channels.manual.reason === "Already booked", br.channels);
    const nr = by("Noentry Person")!;
    check("no recall entry on the waitlist: 'No open recall', entryId null", nr.entryId === null && nr.channels.manual.reason === "No open recall");
    check("electronicReady counts only the consent piano", ov.electronicReady === 1, ov.electronicReady);

    console.log("\n4. read-only");
    const after = await counts();
    check("no table changed (nothing written)", JSON.stringify(before) === JSON.stringify(after), { before, after });

    check("archived customer dropped before the limit: not truncated", ov.truncated === false);

    console.log("\n5. consent table: only a MISSING table is tolerated");
    await db.execute(sql`alter table service_notification_preferences rename column email_consent to email_consent_x`);
    const origErr0 = console.error; console.error = () => {};
    const other = await getMaintenanceOverview(now).then(() => "returned", () => "threw");
    console.error = origErr0;
    check("a different database error (undefined column 42703) is rethrown, not hidden", other === "threw", other);
    await db.execute(sql`alter table service_notification_preferences rename column email_consent_x to email_consent`);
    await db.execute(sql`drop table service_notification_preferences`);
    const origErr = console.error; console.error = () => {};
    const ov2 = await getMaintenanceOverview(now);
    console.error = origErr;
    check("preferencesAvailable false, everyone 'No consent recorded', same rows (table missing = 42P01)", !ov2.preferencesAvailable && ov2.rows.length === 7 && ov2.rows.every((r) => r.consent === "none") && ov2.electronicReady === 0);

    check("isUndefinedTable: 42P01 on the error or on its cause only", [isUndefinedTable({ code: "42P01" }), isUndefinedTable({ cause: { code: "42P01" } }), isUndefinedTable({ code: "42703" }), isUndefinedTable({ cause: { code: "42703" } }), isUndefinedTable(new Error("x")), isUndefinedTable(null)].join() === "true,true,false,false,false,false");

    console.log("\n6. empty");
    await db.execute(sql`delete from service_waitlist_entries`); await db.execute(sql`delete from service_jobs`); await db.delete(S.servicePianos);
    const ov3 = await getMaintenanceOverview(now);
    check("no pianos: empty overview", ov3.rows.length === 0 && ov3.datePassed === 0 && ov3.upcoming === 0);
    void eq;
  } finally {
    await pool.end();
    const a2 = new Client({ connectionString: adminUrl.toString() });
    a2.on("error", () => {});
    await a2.connect();
    await a2.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await a2.end();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
