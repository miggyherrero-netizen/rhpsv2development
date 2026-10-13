/**
 * DB-backed scenario: new customers get an "N/A" piano, and a payment dates the piano's service. LOCAL POSTGRES ONLY.
 * NOT part of `npm test`. Creates a throw-away database `herrero_pianosvc_test` on the same local server (schema copied
 * with pg_dump -s from the base database), runs the scenarios against the real server code, then drops it.
 *
 * Run (local server on 5433, base database `herrero` must contain the schema):
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-piano-service-db.ts
 *
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_pianosvc_test";
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
  process.env.AUTH_SECRET ??= "pianoservicetestsecret0123456789abcdef";
  const { db, pool } = await import("../src/db");
  const S = await import("../src/db/schema");
  const ops = await import("../src/server/service-invoice-ops");
  const nc = await import("../src/server/service-new-customer");
  const { eq, sql } = await import("drizzle-orm");

  try {
    const [owner] = await db.insert(S.users).values({ email: "o@test", passwordHash: "x", name: "Test Owner", role: "owner" }).returning();
    const OWNER = { id: owner!.id, name: owner!.name, role: "owner" };
    const day = (s: string) => new Date(`${s}T02:00:00Z`);
    const dstr = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
    const piano = async (id: string) => (await db.select().from(S.servicePianos).where(eq(S.servicePianos.id, id)))[0]!;
    const recalls = (pianoId: string) => db.select().from(S.serviceWaitlistEntries).where(eq(S.serviceWaitlistEntries.pianoId, pianoId));
    const openRecalls = async (pianoId: string) => (await recalls(pianoId)).filter((e) => e.source === "recall" && ["waiting", "messaged", "not_now"].includes(e.status));
    const inv = async (id: string) => (await db.select().from(S.serviceInvoices).where(eq(S.serviceInvoices.id, id)))[0]!;
    const money = (i: Awaited<ReturnType<typeof inv>>) => [i.subtotalCents, i.taxCents, i.totalCents, i.amountPaidCents, i.status].join();

    const [cust] = await db.insert(S.serviceCustomers).values({ name: "Pay Customer" }).returning();
    const mkPiano = async (extra: Partial<typeof S.servicePianos.$inferInsert> = {}) =>
      (await db.insert(S.servicePianos).values({ customerId: cust!.id, brand: "Yamaha", model: "U1", ...extra }).returning())[0]!;
    const mkInvoice = async (job: Partial<typeof S.serviceJobs.$inferInsert> | null, pianoId: string | null) => {
      let jobId: string | null = null;
      if (job) jobId = (await db.insert(S.serviceJobs).values({ customerId: cust!.id, pianoId, title: "Visit", status: "invoiced", ...job }).returning())[0]!.id;
      const [i] = await db.insert(S.serviceInvoices).values({ customerId: cust!.id, jobId, status: "draft" }).returning();
      const r = await ops.addInvoiceItemsOp(OWNER, i!.id, [{ description: "Tuning", qty: 1, unitPrice: 2000, taxable: false }]);
      if (!r.ok) throw new Error(`setup failed: ${r.error}`);
      return { id: i!.id, jobId };
    };

    console.log("\n1. a new customer always gets a piano, and the job is linked to it");
    let jobId = "";
    const r1 = await nc.withNewCustomer({ name: "Brand New" }, { brand: "" }, async (ctx) => {
      const [j] = await db.insert(S.serviceJobs).values({ customerId: ctx.customerId, pianoId: ctx.pianoId, title: "Tuning" }).returning({ id: S.serviceJobs.id });
      jobId = j!.id;
      return { ok: true as const };
    });
    const [bn] = (await db.select().from(S.serviceCustomers).where(eq(S.serviceCustomers.name, "Brand New")));
    const bnp = bn ? await db.select().from(S.servicePianos).where(eq(S.servicePianos.customerId, bn.id)) : [];
    const bnj = (await db.select().from(S.serviceJobs).where(eq(S.serviceJobs.id, jobId)))[0];
    check("N/A piano, model empty, job.pianoId set", r1.ok && bnp.length === 1 && bnp[0]!.brand === "N/A" && bnp[0]!.model === null && bnj?.pianoId === bnp[0]!.id, { r1, bnp, bnj });
    const nb = await nc.withNewCustomer({ name: "Invoice Only" }, null, async () => ({ ok: true as const }));
    const nbc = (await db.select().from(S.serviceCustomers).where(eq(S.serviceCustomers.name, "Invoice Only")))[0];
    check("no piano passed (piano sale / trip name / invoice only): none created", nb.ok && !!nbc && (await db.select().from(S.servicePianos).where(eq(S.servicePianos.customerId, nbc.id))).length === 0);
    const r1b = await nc.withNewCustomer({ name: "Typed Brand" }, { brand: "Kawai", model: "K-300" }, async () => ({ ok: true as const }));
    const tb = (await db.select().from(S.serviceCustomers).where(eq(S.serviceCustomers.name, "Typed Brand")))[0];
    const tbp = tb ? await db.select().from(S.servicePianos).where(eq(S.servicePianos.customerId, tb.id)) : [];
    check("a typed brand and model are kept", r1b.ok && tbp.length === 1 && tbp[0]!.brand === "Kawai" && tbp[0]!.model === "K-300", tbp);

    console.log("\n2. payment on a completed tuning job dates the piano");
    const p2 = await mkPiano();
    const A = await mkInvoice({ serviceType: "tuning", completedAt: day("2026-09-01") }, p2.id);
    const pay1 = await ops.recordPaymentOp(OWNER, { invoiceId: A.id, amount: 800, method: "cash", receivedAt: "2026-10-05T10:00", markSent: true });
    let pp = await piano(p2.id);
    check("payment recorded", pay1.ok, pay1);
    check("lastServiceAt = job.completedAt, next due = +6 months", dstr(pp.lastServiceAt) === "2026-09-01" && dstr(pp.nextServiceDueAt) === "2027-03-01", pp);
    check("exactly one open recall on the waitlist, dated at next due", (await openRecalls(p2.id)).length === 1 && dstr((await openRecalls(p2.id))[0]!.requestedAt) === "2027-03-01");
    const beforeSecond = money(await inv(A.id));
    const pay2 = await ops.recordPaymentOp(OWNER, { invoiceId: A.id, amount: 1200, method: "gcash", receivedAt: "2026-10-20T10:00" });
    pp = await piano(p2.id);
    check("second payment ok, invoice paid", pay2.ok && (await inv(A.id)).status === "paid" && beforeSecond.split(",")[3] === "80000", { pay2, beforeSecond });
    check("second payment: piano dates unchanged, still one open recall", dstr(pp.lastServiceAt) === "2026-09-01" && dstr(pp.nextServiceDueAt) === "2027-03-01" && (await openRecalls(p2.id)).length === 1 && (await recalls(p2.id)).length === 1);

    console.log("\n3. never moves backwards");
    const p3 = await mkPiano({ lastServiceAt: day("2026-09-20"), nextServiceDueAt: day("2027-03-20") });
    const B = await mkInvoice({ serviceType: "tuning", completedAt: day("2026-08-01") }, p3.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: B.id, amount: 500, receivedAt: "2026-10-05T10:00", markSent: true });
    pp = await piano(p3.id);
    check("an older visit leaves the newer service date alone", dstr(pp.lastServiceAt) === "2026-09-20" && dstr(pp.nextServiceDueAt) === "2027-03-20" && (await recalls(p3.id)).length === 0, pp);

    console.log("\n4. only a finished job is stamped");
    const p4 = await mkPiano();
    const C = await mkInvoice({ serviceType: "tuning", status: "scheduled", scheduledStart: day("2026-10-20") }, p4.id);
    await db.insert(S.serviceWaitlistEntries).values({ customerId: cust!.id, pianoId: p4.id, jobId: C.jobId, status: "scheduled", nextFollowUpAt: day("2026-10-20") });
    await ops.recordPaymentOp(OWNER, { invoiceId: C.id, amount: 2000, receivedAt: "2026-10-05T10:00", markSent: true });
    pp = await piano(p4.id);
    check("prepaying a scheduled job in full: piano untouched, booking's waitlist entry stays scheduled, no recall",
      (await inv(C.id)).status === "paid" && pp.lastServiceAt === null && pp.nextServiceDueAt === null && (await recalls(p4.id)).length === 1 && (await recalls(p4.id))[0]!.status === "scheduled");
    const p4b = await mkPiano();
    const C2 = await mkInvoice({ serviceType: "tuning", status: "scheduled" }, p4b.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C2.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("deposit on an uncompleted job: untouched", (await piano(p4b.id)).lastServiceAt === null);
    const p4c = await mkPiano();
    const C3 = await mkInvoice({ serviceType: "tuning", status: "cancelled", completedAt: day("2026-10-01"), cancelledAt: day("2026-10-02") }, p4c.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C3.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("cancelled job: untouched", (await piano(p4c.id)).lastServiceAt === null);
    const p4d = await mkPiano();
    const C4 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: day("2026-10-01") }, p4d.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C4.id, amount: 100, receivedAt: "2026-12-25T10:00", markSent: true });
    check("deposit on a completed job with a future receivedAt: stamped with completedAt, not the future date", dstr((await piano(p4d.id)).lastServiceAt) === "2026-10-01");
    const p4e = await mkPiano();
    const C5 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: new Date(Date.now() + 5 * 86400000) }, p4e.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C5.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("a completion date in the future is clamped to now", (await piano(p4e.id)).lastServiceAt!.getTime() <= Date.now());
    const p4f = await mkPiano();
    const C6 = await mkInvoice({ serviceType: "tuning", status: "completed" }, p4f.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C6.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    await ops.recordPaymentOp(OWNER, { invoiceId: C6.id, amount: 100, receivedAt: "2026-10-12T10:00" });
    check("no dates at all: only the FIRST payment's date is used; a later payment doesn't move it", dstr((await piano(p4f.id)).lastServiceAt) === "2026-10-05");
    const p4g = await mkPiano();
    const C7 = await mkInvoice({ serviceType: "tuning", status: "completed" }, p4g.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: C7.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    const p4h = await mkPiano();
    const C8 = await mkInvoice({ serviceType: "tuning", status: "completed" }, p4h.id);
    await db.insert(S.servicePayments).values({ invoiceId: C8.id, amountCents: 100, receivedAt: day("2026-09-01") });
    await ops.recordPaymentOp(OWNER, { invoiceId: C8.id, amount: 100, receivedAt: "2026-10-12T10:00", markSent: true });
    check("not the first payment and no dates: no fallback", (await piano(p4h.id)).lastServiceAt === null);

    console.log("\n4b. old or superseded service: skipped");
    const p4i = await mkPiano();
    const D1 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: day("2026-03-01") }, p4i.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: D1.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("next due would already be in the past: untouched, no recall", (await piano(p4i.id)).lastServiceAt === null && (await recalls(p4i.id)).length === 0);
    const p4j = await mkPiano();
    await db.insert(S.serviceJobs).values({ customerId: cust!.id, pianoId: p4j.id, title: "Newer tuning", serviceType: "tuning", status: "completed", completedAt: day("2026-10-10") });
    const D2 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: day("2026-10-01") }, p4j.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: D2.id, amount: 100, receivedAt: "2026-10-12T10:00", markSent: true });
    check("a newer tuning job exists for the piano: untouched", (await piano(p4j.id)).lastServiceAt === null);
    const p4k = await mkPiano({ lastServiceAt: day("2026-10-01"), nextServiceDueAt: day("2027-04-01") });
    const D3 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: day("2026-09-01") }, p4k.id);
    const rec0 = await import("../src/server/service-recall");
    const moved = await rec0.rollPianoRecall(D3.jobId!);
    check("completing an older visit never moves last service backwards, recall untouched", !moved && dstr((await piano(p4k.id)).lastServiceAt) === "2026-10-01" && dstr((await piano(p4k.id)).nextServiceDueAt) === "2027-04-01" && (await recalls(p4k.id)).length === 0);
    const p4l = await mkPiano({ lastServiceAt: day("2026-10-01"), nextServiceDueAt: day("2027-04-01") });
    const D4 = await mkInvoice({ serviceType: "tuning", status: "completed", completedAt: day("2026-10-01") }, p4l.id);
    const eq1 = await rec0.rollPianoRecall(D4.jobId!);
    const eq2 = await rec0.rollPianoRecall(D4.jobId!);
    check("equal timestamps: dates stay the same, repeating is harmless, one open recall", eq1 && eq2 && dstr((await piano(p4l.id)).lastServiceAt) === "2026-10-01" && dstr((await piano(p4l.id)).nextServiceDueAt) === "2027-04-01" && (await openRecalls(p4l.id)).length === 1);

    console.log("\n5. repair job, no job, sale job: piano untouched");
    const p5 = await mkPiano();
    const D = await mkInvoice({ serviceType: "repair", completedAt: day("2026-09-01") }, p5.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: D.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    pp = await piano(p5.id);
    check("repair: no service date, no recall", pp.lastServiceAt === null && pp.nextServiceDueAt === null && (await recalls(p5.id)).length === 0, pp);
    const E = await mkInvoice(null, null);
    const pe = await ops.recordPaymentOp(OWNER, { invoiceId: E.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("an invoice with no job still takes payments", pe.ok);
    const p5b = await mkPiano();
    const F = await mkInvoice({ serviceType: "tuning", jobType: "sale", completedAt: day("2026-09-01") }, p5b.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: F.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("piano sale job: piano untouched", (await piano(p5b.id)).lastServiceAt === null);

    console.log("\n6. the piano step fails: the payment still succeeds, money identical");
    const p6 = await mkPiano();
    const G = await mkInvoice({ serviceType: "tuning", completedAt: day("2026-09-01") }, p6.id);
    const H = await mkInvoice(null, null);
    await db.execute(sql`create function fail_piano() returns trigger language plpgsql as $$ begin raise exception 'piano update blocked'; end $$`);
    await db.execute(sql`create trigger fail_piano_t before update on service_pianos for each row execute function fail_piano()`);
    const origErr = console.error; console.error = () => {};
    let pg: Awaited<ReturnType<typeof ops.recordPaymentOp>>;
    try {
      pg = await ops.recordPaymentOp(OWNER, { invoiceId: G.id, amount: 750, method: "cash", receivedAt: "2026-10-05T10:00", markSent: true });
    } finally { console.error = origErr; }
    await db.execute(sql`drop trigger fail_piano_t on service_pianos`);
    await ops.recordPaymentOp(OWNER, { invoiceId: H.id, amount: 750, method: "cash", receivedAt: "2026-10-05T10:00", markSent: true });
    const pgPays = await db.select().from(S.servicePayments).where(eq(S.servicePayments.invoiceId, G.id));
    check("payment ok even though the piano update threw", pg.ok && pgPays.length === 1 && pgPays[0]!.amountCents === 75000, pg);
    check("piano left untouched", (await piano(p6.id)).lastServiceAt === null);
    check("money fields identical to the same payment on a job-less invoice", money(await inv(G.id)) === money(await inv(H.id)), { g: money(await inv(G.id)), h: money(await inv(H.id)) });

    console.log("\n7. completing the job later stamps via the shared recall roll");
    const p7 = await mkPiano();
    const I = await mkInvoice({ serviceType: "tuning", status: "scheduled" }, p7.id);
    await ops.recordPaymentOp(OWNER, { invoiceId: I.id, amount: 100, receivedAt: "2026-10-05T10:00", markSent: true });
    check("deposit on the uncompleted job left the piano alone", (await piano(p7.id)).lastServiceAt === null);
    const rec = await import("../src/server/service-recall");
    await db.update(S.serviceJobs).set({ completedAt: day("2026-10-09") }).where(eq(S.serviceJobs.id, I.jobId!));
    await rec.rollPianoRecall(I.jobId!);
    pp = await piano(p7.id);
    check("completion stamps the completion day; exactly one open recall", dstr(pp.lastServiceAt) === "2026-10-09" && dstr(pp.nextServiceDueAt) === "2027-04-09" && (await openRecalls(p7.id)).length === 1, pp);
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
