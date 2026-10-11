/**
 * DB-backed scenario for "Convert to job" and "Quick inquiry". LOCAL POSTGRES ONLY. NOT part of `npm test`.
 *
 * Like tests/service-finance-edit-db.ts it never touches your working database: it creates a throw-away database
 * `herrero_convert_test` on the same local server (schema copied with pg_dump -s from the base database), runs every
 * scenario there against the real server code (src/server/service-waitlist-core.ts), then drops it.
 * createJob itself needs a signed-in request (cookies), so the scenarios hand the convert flow a stand-in that inserts
 * a real service_jobs row the same way (and one that fails, to prove the rollback).
 *
 * Run (local server on 5433, base database `herrero` must contain the schema):
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-waitlist-convert-db.ts
 *
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_convert_test";
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
  const { db, pool } = await import("../src/db");
  const S = await import("../src/db/schema");
  const core = await import("../src/server/service-waitlist-core");
  const { validateQuickInquiry } = await import("../src/lib/service-inquiry");
  const { eq, sql } = await import("drizzle-orm");

  try {
    // Reference data: two cities (the quick inquiry checks the area exists).
    const [region] = await db.insert(S.phRegions).values({ code: "R11", name: "Davao Region", shortName: "XI" }).returning();
    const [prov] = await db.insert(S.phProvinces).values({ code: "P1124", name: "Davao del Sur", regionCode: region!.code }).returning();
    const cityRow = (code: string, name: string) => ({ code, name, fullName: name, provinceCode: prov!.code, regionCode: region!.code, lat: 6.7, lng: 125.3 });
    await db.insert(S.phCities).values([cityRow("112403000", "Digos City"), cityRow("112402000", "Davao City")] as never);

    const [cust] = await db.insert(S.serviceCustomers).values({ name: "Test Customer", phone: "0917 123 4567" }).returning();
    const [other] = await db.insert(S.serviceCustomers).values({ name: "Someone Else", phone: "0999 000 1111", notes: "PRIVATE" }).returning();
    const [piano] = await db.insert(S.servicePianos).values({ customerId: cust!.id, brand: "Yamaha", model: "U1", type: "Upright" } as never).returning();

    const entryFor = (customerId: string, o: Partial<typeof S.serviceWaitlistEntries.$inferInsert> = {}) =>
      core.insertEntry(db, { customerId, pianoId: piano!.id, cityCode: "112403000", notes: "Sticky keys", ...(o as object) });
    const getEntry = async (id: string) => (await db.select().from(S.serviceWaitlistEntries).where(eq(S.serviceWaitlistEntries.id, id)))[0]!;
    const jobsOf = (customerId: string) => db.select().from(S.serviceJobs).where(eq(S.serviceJobs.customerId, customerId));

    // Stand-in for createJob (which needs a request): same insert, same Result shape.
    let created = 0;
    const fakeCreateJob = async (input: { customerId: string; title: string; pianoId?: string | null; status?: string | null; scheduledStart?: string | null; jobType?: string | null }) => {
      const [row] = await db.insert(S.serviceJobs).values({
        customerId: input.customerId, title: input.title, pianoId: input.pianoId ?? null, status: (input.status ?? "lead") as never,
        scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
      }).returning({ id: S.serviceJobs.id });
      created++;
      return { ok: true as const, data: { id: row!.id } };
    };
    const failingCreateJob = async () => ({ ok: false as const, error: "Choose the customer's piano." });
    const throwingCreateJob = async (): Promise<never> => { throw new Error("db exploded"); };
    const values = (customerId: string, o: Record<string, unknown> = {}) => ({ customerId, title: "Tuning — Yamaha U1", pianoId: piano!.id, scheduledStart: "2026-10-20T09:00:00+08:00", ...o });

    /* ---- 1. convert ---- */
    console.log("\n1. convert creates exactly one job and links the entry");
    const e1 = await entryFor(cust!.id);
    const r1 = await core.convertEntryToJob(e1, values(cust!.id) as never, fakeCreateJob as never);
    let en = await getEntry(e1);
    check("convert succeeds and returns the job id", r1.ok && !!r1.data.jobId, r1);
    check("exactly one job exists for the customer", (await jobsOf(cust!.id)).length === 1);
    check("the entry is scheduled and linked to that job", en.status === "scheduled" && en.jobId === (r1.ok ? r1.data.jobId : null), en);
    check("the job is a scheduled visit (it has a start time)", (await jobsOf(cust!.id))[0]!.status === "scheduled");

    console.log("\n2. converting again does not book twice");
    const before = created;
    const r2 = await core.convertEntryToJob(e1, values(cust!.id) as never, fakeCreateJob as never);
    check("second convert is rejected with a clear message", !r2.ok && /already booked/i.test(r2.error), r2);
    check("no second job was created", created === before && (await jobsOf(cust!.id)).length === 1);
    const e1b = await entryFor(cust!.id, { notes: "double click" });
    const [ra, rb] = await Promise.all([
      core.convertEntryToJob(e1b, values(cust!.id) as never, fakeCreateJob as never),
      core.convertEntryToJob(e1b, values(cust!.id) as never, fakeCreateJob as never),
    ]);
    check("two simultaneous clicks: exactly one wins", [ra, rb].filter((r) => r.ok).length === 1, [ra, rb]);
    check("…and only one job came out of them", (await jobsOf(cust!.id)).length === 2);
    const eDone = await entryFor(cust!.id, { status: "done" });
    const rd = await core.convertEntryToJob(eDone, values(cust!.id) as never, fakeCreateJob as never);
    check("a done entry is rejected", !rd.ok && /already done/i.test(rd.error), rd);

    console.log("\n3. a failing createJob rolls the entry back");
    const e3 = await entryFor(cust!.id, { status: "confirmed" });
    const jobsBefore = (await jobsOf(cust!.id)).length;
    const r3 = await core.convertEntryToJob(e3, values(cust!.id) as never, failingCreateJob as never);
    en = await getEntry(e3);
    check("the error from createJob is passed on", !r3.ok && /piano/i.test(r3.error), r3);
    check("entry is back to confirmed, unlinked", en.status === "confirmed" && en.jobId === null, en);
    check("no job was added", (await jobsOf(cust!.id)).length === jobsBefore);
    const r3b = await core.convertEntryToJob(e3, values(cust!.id) as never, throwingCreateJob as never);
    en = await getEntry(e3);
    check("a thrown error also rolls back", !r3b.ok && en.status === "confirmed" && en.jobId === null, { r3b, en });
    const r3c = await core.convertEntryToJob(e3, values(cust!.id) as never, fakeCreateJob as never);
    check("and the entry can still be converted afterwards", r3c.ok, r3c);

    console.log("\n4. a cancelled job releases the entry");
    en = await getEntry(e3);
    await core.releaseEntriesForJob(en.jobId!, "cancelled");
    en = await getEntry(e3);
    check("entry is waiting again, job link cleared, fresh follow-up in the future", en.status === "waiting" && en.jobId === null && en.nextFollowUpAt.getTime() > Date.now(), en);
    const r4 = await core.convertEntryToJob(e3, values(cust!.id) as never, fakeCreateJob as never);
    check("a released entry can be converted again", r4.ok, r4);

    console.log("\n5. guards");
    const e5 = await entryFor(cust!.id);
    const wrong = await core.convertEntryToJob(e5, values(other!.id) as never, fakeCreateJob as never);
    check("a job for a different customer is rejected and the entry is untouched", !wrong.ok && (await getEntry(e5)).status === "waiting", wrong);
    const missing = await core.convertEntryToJob("00000000-0000-4000-8000-000000000000", values(cust!.id) as never, fakeCreateJob as never);
    check("unknown entry is rejected", !missing.ok && /not found/i.test(missing.error), missing);
    const noTime = await entryFor(cust!.id);
    const rt = await core.convertEntryToJob(noTime, values(cust!.id, { scheduledStart: null }) as never, fakeCreateJob as never);
    check("without a start time the job is a lead (parked in Unscheduled) and the entry is still linked", rt.ok && (await getEntry(noTime)).jobId === (rt.ok ? rt.data.jobId : null)
      && (await db.select().from(S.serviceJobs).where(eq(S.serviceJobs.id, rt.ok ? rt.data.jobId : "")))[0]?.status === "lead");

    /* ---- quick inquiry ---- */
    const quick = (o: Record<string, unknown>) => {
      const v = validateQuickInquiry({ name: "Ana Reyes", phone: "0917 123 4567", cityCode: "112403000", request: "Tuning, upright", ...o });
      if (!v.ok) throw new Error(v.error);
      return core.createQuickInquiryEntry(v.value);
    };

    console.log("\n6. quick inquiry matches an existing customer by phone digits");
    const customersBefore = (await db.select().from(S.serviceCustomers)).length;
    const q1 = await quick({ phone: "+0917-123-4567", name: "Different Spelling" });
    check("matched the existing customer (other formatting, other name)", q1.ok && q1.data.customerId === cust!.id && !q1.data.customerWasNew, q1);
    check("no customer was created", (await db.select().from(S.serviceCustomers)).length === customersBefore);
    check("the matched customer's saved name is untouched", (await db.select().from(S.serviceCustomers).where(eq(S.serviceCustomers.id, cust!.id)))[0]!.name === "Test Customer");
    check("only the name comes back, nothing else about the customer", q1.ok && Object.keys(q1.data).sort().join() === "customerId,customerName,customerWasNew,duplicate,entryId,nextFollowUpAt", q1.ok && Object.keys(q1.data));
    check("a different customer's data is not in the result", !JSON.stringify(q1).includes("PRIVATE") && !JSON.stringify(q1).includes("0999"));

    console.log("\n7. quick inquiry creates a new customer otherwise, with the follow-up default");
    const t0 = Date.now();
    const q2 = await quick({ name: "Ana Reyes", phone: "0922 555 7788", pianoModel: "Kawai K-300", estValue: "3,000", source: "facebook", notes: "Weekends only" });
    check("new customer created", q2.ok && q2.data.customerWasNew && q2.data.customerName === "Ana Reyes", q2);
    if (q2.ok) {
      const ent = await getEntry(q2.data.entryId);
      const days = (ent.nextFollowUpAt.getTime() - t0) / 86_400_000;
      check("entry follow-up is about 3 days out", days > 2.99 && days < 3.01, days);
      check("entry is waiting, in Digos, source facebook, value 3000.00", ent.status === "waiting" && ent.cityCode === "112403000" && ent.source === "facebook" && ent.estValueCents === 300_000, ent);
      check("notes hold the request, piano model and extra notes", ent.notes === "Tuning, upright\nPiano: Kawai K-300\nWeekends only", ent.notes);
      check("no piano record was created for the model text", (await db.select().from(S.servicePianos).where(eq(S.servicePianos.customerId, q2.data.customerId))).length === 0);
      const nc = (await db.select().from(S.serviceCustomers).where(eq(S.serviceCustomers.id, q2.data.customerId)))[0]!;
      check("the new customer has the phone and the same source (facebook)", nc.phone === "0922 555 7788" && nc.source === "facebook", nc);
    }
    const q3 = await quick({ phone: "0922 555 7788" });
    check("the same person again is matched, not duplicated", q3.ok && !q3.data.customerWasNew && q2.ok && q3.data.customerId === q2.data.customerId, q3);

    console.log("\n8. double tap, bad input");
    const q4a = await quick({ phone: "0933 111 2222", name: "Tap Twice", request: "Repair" });
    const q4b = await quick({ phone: "0933 111 2222", name: "Tap Twice", request: "Repair" });
    check("the same inquiry twice in a row returns the first entry, flagged duplicate", q4a.ok && q4b.ok && q4b.data.entryId === q4a.data.entryId && q4b.data.duplicate, { q4a, q4b });
    check("only one entry exists for it", q4a.ok && (await db.select().from(S.serviceWaitlistEntries).where(eq(S.serviceWaitlistEntries.customerId, q4a.data.customerId))).length === 1);
    const bad = validateQuickInquiry({ name: "", phone: "", cityCode: "", request: "" });
    check("missing name, phone, area and request are all rejected before anything is written", !bad.ok && Object.keys(bad.errors).length === 4);
    const badCity = await quick({ cityCode: "000000000", phone: "0944 000 1111" });
    check("an area that isn't in the list is rejected", !badCity.ok && /area/i.test(badCity.error), badCity);
    check("…and no customer was made for it", (await db.select().from(S.serviceCustomers).where(sql`phone = '0944 000 1111'`)).length === 0);

    /* ---- review fixes ---- */
    const [trip] = await db.insert(S.serviceTrips).values({ name: "Digos trip" }).returning();
    console.log("\n9. a trip 'Confirm + time' cannot slip in between convert's claim and link");
    const e9 = await entryFor(cust!.id, { notes: "race" });
    let tripClaimDuring: boolean | null = null;
    const racingCreateJob = async (input: Parameters<typeof fakeCreateJob>[0]) => {
      tripClaimDuring = await core.claimEntryForTrip(e9, trip!.id, piano!.id).catch((e) => { console.error(e); return false; });
      return fakeCreateJob(input);
    };
    const jobsBefore9 = (await jobsOf(cust!.id)).length;
    const r9 = await core.convertEntryToJob(e9, values(cust!.id) as never, racingCreateJob as never);
    check("the trip claim is refused while the convert claim is fresh", tripClaimDuring === false, tripClaimDuring);
    check("convert still completes with exactly one job", r9.ok && (await jobsOf(cust!.id)).length === jobsBefore9 + 1 && (await getEntry(e9)).jobId === (r9.ok ? r9.data.jobId : null));
    const e9b = await entryFor(cust!.id, { notes: "stale" });
    await db.update(S.serviceWaitlistEntries).set({ status: "scheduled", updatedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(S.serviceWaitlistEntries.id, e9b));
    check("a stale 'scheduled' entry with no job is still claimable by a trip", (await core.claimEntryForTrip(e9b, trip!.id, piano!.id)) === true);
    const e9c = await entryFor(cust!.id, { notes: "other flow links first" });
    const [otherJob] = await db.insert(S.serviceJobs).values({ customerId: cust!.id, title: "Elsewhere" }).returning();
    const linkedElsewhere = async (input: Parameters<typeof fakeCreateJob>[0]) => {
      await db.update(S.serviceWaitlistEntries).set({ jobId: otherJob!.id }).where(eq(S.serviceWaitlistEntries.id, e9c));
      return fakeCreateJob(input);
    };
    const r9c = await core.convertEntryToJob(e9c, values(cust!.id) as never, linkedElsewhere as never);
    check("if the entry got a job meanwhile, convert does not overwrite it and says the job wasn't linked", !r9c.ok && /not linked/.test(r9c.error) && (await getEntry(e9c)).jobId === otherJob!.id, r9c);

    console.log("\n10. link failure after createJob");
    const e10 = await entryFor(cust!.id, { status: "confirmed", notes: "link fails" });
    let tries = 0;
    const alwaysThrows = async () => { tries++; throw new Error("link boom"); };
    const r10 = await core.convertEntryToJob(e10, values(cust!.id) as never, fakeCreateJob as never, alwaysThrows as never);
    en = await getEntry(e10);
    check("retried once, then a clear message naming the job", !r10.ok && tries === 2 && /Job #\d+ was created but not linked/.test(r10.error), { r10, tries });
    check("entry reverted to confirmed, no dead end", en.status === "confirmed" && en.jobId === null, en);
    const e10b = await entryFor(cust!.id, { notes: "link flaky" });
    let n = 0;
    const flaky = async (id: string, jobId: string, pid: string | null) => {
      if (n++ === 0) throw new Error("blip");
      await db.update(S.serviceWaitlistEntries).set({ jobId, status: "scheduled" }).where(eq(S.serviceWaitlistEntries.id, id)); return true;
    };
    const r10b = await core.convertEntryToJob(e10b, values(cust!.id) as never, fakeCreateJob as never, flaky as never);
    check("a single link failure is retried and succeeds", r10b.ok && (await getEntry(e10b)).jobId === (r10b.ok ? r10b.data.jobId : null), r10b);

    console.log("\n11. input guards");
    const e11 = await entryFor(cust!.id, { notes: "guards" });
    const [otherLoc] = await db.insert(S.serviceLocations).values({ customerId: other!.id, addressLine: "Not yours" }).returning();
    const rl = await core.convertEntryToJob(e11, values(cust!.id, { locationId: otherLoc!.id }) as never, fakeCreateJob as never);
    check("another customer's address is rejected, entry untouched", !rl.ok && /different customer/.test(rl.error) && (await getEntry(e11)).status === "waiting", rl);
    const rg = await core.convertEntryToJob(e11, values(cust!.id, { locationId: "not-a-uuid" }) as never, fakeCreateJob as never);
    check("a malformed address id is rejected", !rg.ok);
    const rn = await core.convertEntryToJob(e11, null as never, fakeCreateJob as never);
    check("missing values are rejected cleanly", !rn.ok && /missing/i.test(rn.error));
    const [ownLoc] = await db.insert(S.serviceLocations).values({ customerId: cust!.id, addressLine: "Mine" }).returning();
    check("the customer's own address is accepted", (await core.convertEntryToJob(e11, values(cust!.id, { locationId: ownLoc!.id }) as never, fakeCreateJob as never)).ok);

    console.log("\n12. two parallel quick inquiries with the same new phone");
    const pc = (await db.select().from(S.serviceCustomers)).length;
    const [qa, qb] = await Promise.all([quick({ name: "Parallel One", phone: "0966 123 0001", request: "Tuning A" }), quick({ name: "Parallel One", phone: "+63 966 123 0001", request: "Tuning B" })]);
    check("both succeed", qa.ok && qb.ok, [qa, qb]);
    check("only ONE customer was created", (await db.select().from(S.serviceCustomers)).length === pc + 1);
    check("both entries belong to that customer", qa.ok && qb.ok && qa.data.customerId === qb.data.customerId && [qa, qb].filter((q) => q.ok && q.data.customerWasNew).length === 1);

    console.log("\n13. +63 and 0 formats are the same person");
    const m1 = await quick({ phone: "+63 917 123 4567" });
    check("0917… stored, +63 917… typed -> matched", m1.ok && m1.data.customerId === cust!.id && !m1.data.customerWasNew, m1);
    const m2 = await quick({ phone: "63917-123-4567", request: "Another thing" });
    check("63917… typed -> matched", m2.ok && m2.data.customerId === cust!.id, m2);
    const m3 = await quick({ phone: "0966-123-0001", request: "Later" });
    check("+63 966… stored (new customer above), 0966… typed -> matched", m3.ok && qa.ok && m3.data.customerId === qa.data.customerId, m3);
    check("a one-digit-repeated phone is rejected", !validateQuickInquiry({ name: "x", phone: "0000000", cityCode: "1", request: "y" }).ok);
    const before13 = (await db.select().from(S.serviceCustomers)).length;
    await core.createWaitlistFromInquiry({ name: "Web Person", phone: "+639171234567", message: "tuning please" });
    check("website inquiry path uses the same matcher (no new customer)", (await db.select().from(S.serviceCustomers)).length === before13);
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
