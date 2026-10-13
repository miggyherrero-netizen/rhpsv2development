/**
 * DB-backed scenario for "type a name, it becomes a new contact when you save". LOCAL POSTGRES ONLY. NOT part of `npm test`.
 *
 * Like tests/service-waitlist-convert-db.ts it never touches your working database: it creates a throw-away database
 * `herrero_newcust_test` on the same local server (schema copied with pg_dump -s from the base database), runs every
 * scenario there against the real server code (src/server/service-new-customer.ts), then drops it.
 * createJob / createInvoice need a signed-in request (cookies), so the scenarios hand `withNewCustomer` stand-ins that
 * write the same rows (and ones that fail). The Server Action wrappers are called WITHOUT a session to prove they stop at
 * requireUser() before writing anything.
 *
 * Run (local server on 5433, base database `herrero` must contain the schema):
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-new-customer-db.ts
 *
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_newcust_test";
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
  process.env.AUTH_SECRET ??= "newcustomertestsecret0123456789abcdef";
  const { db, pool } = await import("../src/db");
  const S = await import("../src/db/schema");
  const nc = await import("../src/server/service-new-customer");
  const core = await import("../src/server/service-waitlist-core");
  const { eq, sql, ilike } = await import("drizzle-orm");

  const customers = () => db.select().from(S.serviceCustomers);
  const countCustomers = async () => (await customers()).length;
  const byName = async (name: string) => (await customers()).filter((c) => c.name === name);
  const pianosOf = (id: string) => db.select().from(S.servicePianos).where(eq(S.servicePianos.customerId, id));
  const jobsOf = (id: string) => db.select().from(S.serviceJobs).where(eq(S.serviceJobs.customerId, id));
  const invoicesOf = (id: string) => db.select().from(S.serviceInvoices).where(eq(S.serviceInvoices.customerId, id));
  const entriesOf = (id: string) => db.select().from(S.serviceWaitlistEntries).where(eq(S.serviceWaitlistEntries.customerId, id));

  // Stand-ins for createJob / createInvoice (same rows, same result shape).
  const jobStep = (title = "Tuning") => async (ctx: { customerId: string; pianoId: string | null }) => {
    const [row] = await db.insert(S.serviceJobs).values({ customerId: ctx.customerId, pianoId: ctx.pianoId, title }).returning({ id: S.serviceJobs.id });
    await db.insert(S.serviceJobEvents).values({ jobId: row!.id, type: "created", message: "Job created", actorName: "Owner" });
    return { ok: true as const, data: { id: row!.id } };
  };
  const invoiceStep = async (ctx: { customerId: string }) => {
    const [row] = await db.insert(S.serviceInvoices).values({ customerId: ctx.customerId }).returning({ id: S.serviceInvoices.id });
    await db.insert(S.serviceInvoiceItems).values({ invoiceId: row!.id, description: "Tuning", qty: 1, unitPriceCents: 150000, position: 0 } as never);
    return { ok: true as const, data: { id: row!.id } };
  };

  try {
    const [region] = await db.insert(S.phRegions).values({ code: "R11", name: "Davao Region", shortName: "XI" }).returning();
    const [prov] = await db.insert(S.phProvinces).values({ code: "P1124", name: "Davao del Sur", regionCode: region!.code }).returning();
    await db.insert(S.phCities).values([{ code: "112403000", name: "Digos City", fullName: "Digos City", provinceCode: prov!.code, regionCode: region!.code, lat: 6.7, lng: 125.3 }] as never);
    const [jose] = await db.insert(S.serviceCustomers).values({ name: "José Peña", phone: "0917 000 0001" }).returning();
    await db.insert(S.serviceCustomers).values({ name: "Old Archived", archivedAt: new Date() });

    /* ---- 1. customer + piano + job together ---- */
    console.log("\n1. a typed name becomes a customer, with the job, in one go");
    const r1 = await nc.withNewCustomer({ name: "  maria   santos ", phone: " 0917 123 4567 " }, { brand: "Yamaha", model: "U1", type: "Upright" }, jobStep("Tuning — Yamaha U1"));
    check("succeeds with the new customer's id and display name", r1.ok && r1.customerName === "Maria Santos", r1);
    const maria = (await byName("Maria Santos"))[0];
    check("customer saved: title-cased, source referral, phone kept, no tags", !!maria && maria.source === "referral" && maria.phone === "0917 123 4567" && maria.tags.length === 0, maria);
    const mp = maria ? await pianosOf(maria.id) : [];
    check("piano saved for them (brand, model, type)", mp.length === 1 && mp[0]!.brand === "Yamaha" && mp[0]!.model === "U1" && mp[0]!.type === "Upright", mp);
    const mj = maria ? await jobsOf(maria.id) : [];
    check("job saved against that customer and that piano", mj.length === 1 && mj[0]!.pianoId === mp[0]?.id, mj);

    console.log("\n2. phone is optional; no piano typed -> an \"N/A\" piano is still created");
    const r2 = await nc.withNewCustomer({ name: "Lourdes Tan" }, { brand: "" }, jobStep("Visit"));
    const lou = (await byName("Lourdes Tan"))[0];
    const lp = lou ? await pianosOf(lou.id) : [];
    check("customer without phone gets an N/A piano (model empty) and the job is linked to it", r2.ok && !!lou && lou.phone === null && lp.length === 1 && lp[0]!.brand === "N/A" && lp[0]!.model === null
      && (await jobsOf(lou.id))[0]?.pianoId === lp[0]!.id, { r2, lp });

    /* ---- 3. failures leave nothing behind ---- */
    console.log("\n3. a refused job leaves no orphan customer, piano or job");
    const before = await countCustomers();
    const pianosBefore = (await db.select().from(S.servicePianos)).length;
    const jobsBefore = (await db.select().from(S.serviceJobs)).length;
    const r3 = await nc.withNewCustomer({ name: "Failing Person" }, { brand: "Kawai" }, async () => ({ ok: false as const, error: "Choose the customer's piano." }));
    check("error is passed on", !r3.ok && /piano/i.test(r3.error), r3);
    check("no customer, piano or job remains", (await countCustomers()) === before && (await db.select().from(S.servicePianos)).length === pianosBefore && (await db.select().from(S.serviceJobs)).length === jobsBefore);
    const r3c = await nc.withNewCustomer({ name: "Thrown Person" }, { brand: "Kawai" }, async () => { throw new Error("db exploded"); });
    check("a thrown error becomes a plain message and the customer + piano are removed", !r3c.ok && /Nothing was added/i.test(r3c.error) && (await countCustomers()) === before && (await db.select().from(S.servicePianos)).length === pianosBefore, r3c);
    const r3e = await nc.withNewCustomer({ name: "Retry Person" }, null, async () => ({ ok: false as const, error: "no" }));
    const r3f = await nc.withNewCustomer({ name: "Retry Person" }, null, jobStep());
    check("after a failed save the same name can be saved again", !r3e.ok && r3f.ok && (await byName("Retry Person")).length === 1, { r3e, r3f });

    console.log("\n4. cleanup only removes what this call made: anything else on the customer survives");
    const survivors: [string, (ctx: { customerId: string }) => Promise<void>][] = [
      ["a job", async (ctx) => { await jobStep("Someone else's job")(ctx as never); }],
      ["an invoice (with its line)", async (ctx) => { await invoiceStep(ctx); }],
      ["an invoice with a payment", async (ctx) => { const inv = await invoiceStep(ctx); await db.insert(S.servicePayments).values({ invoiceId: inv.data.id, amountCents: 1000 }); }],
      ["a waitlist entry", async (ctx) => { await core.insertEntry(db, { customerId: ctx.customerId, cityCode: null }); }],
      ["a reminder", async (ctx) => { await db.insert(S.serviceReminders).values({ customerId: ctx.customerId, note: "Call back", dueAt: new Date() } as never); }],
      ["an address", async (ctx) => { await db.insert(S.serviceLocations).values({ customerId: ctx.customerId, label: "Home", addressLine: "1 Acacia St" } as never); }],
      ["another piano", async (ctx) => { await db.insert(S.servicePianos).values({ customerId: ctx.customerId, brand: "Casio" } as never); }],
    ];
    for (const [what, make] of survivors) {
      const nm = `Keeps ${what.replace(/[^a-z]/gi, "")}`;
      const rr = await nc.withNewCustomer({ name: nm }, { brand: "Kawai" }, async (ctx) => { await make(ctx); return { ok: false as const, error: "late failure" }; });
      const kept = (await byName(nm))[0];
      check(`${what} added by someone else: the customer is kept, the error says so`, !rr.ok && /late failure/.test(rr.error) && /saved on its own/i.test(rr.error) && !!kept, rr);
      if (kept) {
        const n = (await jobsOf(kept.id)).length + (await invoicesOf(kept.id)).length + (await entriesOf(kept.id)).length + (await db.select().from(S.serviceReminders).where(eq(S.serviceReminders.customerId, kept.id))).length
          + (await db.select().from(S.serviceLocations).where(eq(S.serviceLocations.customerId, kept.id))).length + (await pianosOf(kept.id)).length;
        check(`   …and what was there is untouched (nothing deleted)`, n >= (what === "another piano" ? 2 : 1), n);
      }
    }
    const payCount = (await db.select().from(S.servicePayments)).length;
    check("a payment is never removed", payCount === 1, payCount);

    /* ---- 5. duplicates ---- */
    console.log("\n5. duplicate names");
    const beforeDup = await countCustomers();
    let ran = false;
    const rd = await nc.withNewCustomer({ name: "jose  PENA" }, { brand: "Yamaha" }, async () => { ran = true; return { ok: true as const }; });
    check("same name, other case/accents/spaces is refused with a clear message", !rd.ok && rd.error === "José Peña already exists. Pick them from the list.", rd);
    check("…it points at the saved customer", !rd.ok && rd.duplicateOf?.id === jose!.id, rd);
    check("…nothing was written and the save step never ran", !ran && (await countCustomers()) === beforeDup);
    const rp = await nc.withNewCustomer({ name: "María Santos" }, null, jobStep());
    check("an accent-different spelling of an existing customer is refused", !rp.ok && /already exists/.test(rp.error), rp);
    const rpun = await nc.withNewCustomer({ name: "Maria  Santos." }, null, jobStep());
    check("trailing punctuation does not slip past the check", !rpun.ok && /already exists/.test(rpun.error), rpun);
    const ra = await nc.withNewCustomer({ name: "jose pena", allowDuplicate: true }, null, jobStep());
    check("\"Create as new anyway\" (allowDuplicate) creates a second customer", ra.ok && (await customers()).filter((c) => c.name === "Jose Pena").length === 1 && (await countCustomers()) === beforeDup + 1, ra);
    const rarch = await nc.withNewCustomer({ name: "old archived" }, null, jobStep());
    check("an archived customer's name is free to use again (the list never shows them)", rarch.ok, rarch);
    const rnear = await nc.withNewCustomer({ name: "Santos Maria" }, null, jobStep());
    check("a reordered name is not blocked by the server (the form asks the owner first)", rnear.ok, rnear);

    console.log("\n6. invalid names write nothing");
    const beforeInvalid = await countCustomers();
    for (const bad of ["", "   ", "1234", "---", "a".repeat(161)]) {
      const rr = await nc.withNewCustomer({ name: bad }, null, jobStep());
      check(`"${bad.slice(0, 12)}${bad.length > 12 ? "…" : ""}" is refused`, !rr.ok && (await countCustomers()) === beforeInvalid, rr);
    }
    const rbp = await nc.withNewCustomer({ name: "No Brand" }, { brand: "  " }, jobStep());
    const nbp = (await byName("No Brand"))[0];
    check("a blank brand becomes the N/A placeholder", rbp.ok && !!nbp && (await pianosOf(nbp.id))[0]?.brand === "N/A", rbp);

    /* ---- 7. parallel submits ---- */
    console.log("\n7. two parallel submits of the same new name");
    const [pa, pb] = await Promise.all([
      nc.withNewCustomer({ name: "Parallel Person" }, { brand: "Yamaha" }, jobStep("A")),
      nc.withNewCustomer({ name: "parallel  person" }, { brand: "Yamaha" }, jobStep("B")),
    ]);
    const par = await byName("Parallel Person");
    check("exactly one succeeds, the other is told the name exists", [pa, pb].filter((r) => r.ok).length === 1 && [pa, pb].filter((r) => !r.ok && /already exists/.test(r.error)).length === 1, [pa, pb]);
    check("one customer and one job exist", par.length === 1 && (await jobsOf(par[0]!.id)).length === 1 && (await pianosOf(par[0]!.id)).length === 1);
    const many = await Promise.all(Array.from({ length: 6 }, (_, i) => nc.withNewCustomer({ name: "Burst Person" }, null, jobStep(`B${i}`))));
    check("six at once: still one customer", many.filter((r) => r.ok).length === 1 && (await byName("Burst Person")).length === 1, many.map((r) => r.ok));

    /* ---- 8. invoice flow ---- */
    console.log("\n8. invoice for a new customer");
    const ri = await nc.withNewCustomer({ name: "Invoice Person" }, null, invoiceStep);
    const ip = (await byName("Invoice Person"))[0];
    check("customer + invoice (with its line) saved together", ri.ok && !!ip && (await invoicesOf(ip.id)).length === 1);
    const rif = await nc.withNewCustomer({ name: "Invoice Refused" }, null, async () => ({ ok: false as const, error: "Add at least one line item." }));
    check("a refused invoice leaves no customer", !rif.ok && (await byName("Invoice Refused")).length === 0, rif);

    /* ---- 9. waitlist: one real transaction ---- */
    console.log("\n9. waitlist entry for a new customer (single transaction)");
    const rw = await nc.withNewCustomerTx({ name: "wait person", phone: "0999 111 2222" }, { brand: "" }, async (ctx, tx) => {
      const id = await core.insertEntry(tx, { customerId: ctx.customerId, pianoId: null, cityCode: "112403000", notes: "Sticky keys" });
      return { ok: true as const, data: { id } };
    });
    const wp = (await byName("Wait Person"))[0];
    const we = wp ? await entriesOf(wp.id) : [];
    check("customer and entry saved, entry waiting with a follow-up", rw.ok && we.length === 1 && we[0]!.status === "waiting" && we[0]!.pianoId === null, { rw, we });
    check("…and the new customer got an N/A piano", !!wp && (await pianosOf(wp.id)).length === 1 && (await pianosOf(wp.id))[0]!.brand === "N/A");
    const entriesBefore = (await db.select().from(S.serviceWaitlistEntries)).length;
    const custBefore = await countCustomers();
    const rwf = await nc.withNewCustomerTx({ name: "Wait Refused" }, null, async (ctx, tx) => {
      await core.insertEntry(tx, { customerId: ctx.customerId, cityCode: "112403000" });
      return { ok: false as const, error: "That city isn't in the list." };
    });
    check("a refused entry rolls the customer back (no orphan, no entry)", !rwf.ok && (await countCustomers()) === custBefore && (await db.select().from(S.serviceWaitlistEntries)).length === entriesBefore, rwf);
    const rwt = await nc.withNewCustomerTx({ name: "Wait Thrown" }, null, async (ctx, tx) => { await core.insertEntry(tx, { customerId: ctx.customerId, cityCode: "000000000" }); return { ok: true as const }; });
    check("a database error inside rolls everything back (bad city code -> FK)", !rwt.ok && /Nothing was added/.test(rwt.error) && (await byName("Wait Thrown")).length === 0, rwt);
    const rwd = await nc.withNewCustomerTx({ name: "wait   PERSON" }, null, async () => ({ ok: true as const }));
    check("duplicate name is refused in this flow too", !rwd.ok && /already exists/.test(rwd.error) && !!rwd.duplicateOf, rwd);
    const [wa, wb] = await Promise.all([
      nc.withNewCustomerTx({ name: "Twin Wait" }, null, async (ctx, tx) => ({ ok: true as const, data: { id: await core.insertEntry(tx, { customerId: ctx.customerId, cityCode: null }) } })),
      nc.withNewCustomerTx({ name: "twin wait" }, null, async (ctx, tx) => ({ ok: true as const, data: { id: await core.insertEntry(tx, { customerId: ctx.customerId, cityCode: null }) } })),
    ]);
    const tw = await byName("Twin Wait");
    check("two parallel waitlist saves: one customer, one entry", [wa, wb].filter((r) => r.ok).length === 1 && tw.length === 1 && (await entriesOf(tw[0]!.id)).length === 1, [wa, wb]);

    // requireUser() needs a request (cookies), so the Server Actions run here with it stubbed: signed out throws like the
    // real redirect, signed in returns a user. revalidatePath needs a request too.
    const req = (await import("node:module")).createRequire(__filename);
    const stub = (rel: string, exports: unknown) => { const f = req.resolve(rel); req.cache[f] = { id: f, filename: f, loaded: true, exports, children: [], paths: [] } as never; };
    let signedIn = false;
    const FAKE_USER = { id: "00000000-0000-4000-8000-0000000000aa", name: "Owner", email: "owner@test", role: "owner" };
    stub("../src/lib/auth", { requireUser: async () => { if (!signedIn) throw new Error("NEXT_REDIRECT"); return FAKE_USER; }, getUser: async () => (signedIn ? FAKE_USER : null) });
    stub("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined });
    /* ---- 10. the gate ---- */
    console.log("\n10. the Server Actions stop at requireUser() before writing");
    const total = await countCustomers();
    const actions = await import("../src/server/service-new-customer-actions");
    const wl = await import("../src/server/service-waitlist");
    const real = actions, wl2 = wl;
    const attempts: [string, () => Promise<unknown>][] = [
      ["createJobWithNewCustomer", () => actions.createJobWithNewCustomer({ name: "Gate Person" }, { brand: "Yamaha" }, { title: "x" } as never)],
      ["createInvoiceWithNewCustomer", () => actions.createInvoiceWithNewCustomer({ name: "Gate Person" }, { items: [{ description: "x" }] } as never)],
      ["addWaitlistEntryWithNewCustomer", () => wl.addWaitlistEntryWithNewCustomer({ name: "Gate Person" }, {})],
    ];
    for (const [name, call] of attempts) {
      let outcome: "threw" | "returned" = "returned";
      try { await call(); } catch { outcome = "threw"; }
      check(`${name} without a session does not run (and writes nothing)`, outcome === "threw" && (await countCustomers()) === total && (await byName("Gate Person")).length === 0);
    }

    console.log("\n11. the wrappers check the gate first (source order)");
    const fs = await import("node:fs");
    for (const [file, fn] of [["src/server/service-new-customer-actions.ts", "createJobWithNewCustomer"], ["src/server/service-new-customer-actions.ts", "createInvoiceWithNewCustomer"], ["src/server/service-waitlist.ts", "addWaitlistEntryWithNewCustomer"]]) {
      const src = fs.readFileSync(file, "utf8");
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      check(`${fn}: requireUser() runs before anything is written`, body.indexOf("await requireUser()") > 0 && body.indexOf("await requireUser()") < body.indexOf("withNewCustomer"), file);
    }

    /* ---- 12. the REAL createJob / wrappers, with requireUser and revalidatePath stubbed ---- */
    console.log("\n12. real createJob through createJobWithNewCustomer (requireUser stubbed)");
    signedIn = true;
    const jobFields = (o: Record<string, unknown> = {}) => ({ title: "Standard tuning", serviceType: "tuning", priority: "normal", ...o });

    const [otherCust] = await db.insert(S.serviceCustomers).values({ name: "Other Owner" }).returning();
    const [otherLoc] = await db.insert(S.serviceLocations).values({ customerId: otherCust!.id, label: "Home", addressLine: "9 Elm" } as never).returning();
    const ok1 = await real.createJobWithNewCustomer({ name: "real job person", phone: "0917 777 8888" }, { brand: "Yamaha", model: "U1", type: "Upright" }, jobFields({ locationId: otherLoc!.id }) as never);
    const rjp = (await byName("Real Job Person"))[0];
    const rjJobs = rjp ? await jobsOf(rjp.id) : [];
    check("success: customer, piano and job saved with the real createJob", ok1.ok && !!rjp && (await pianosOf(rjp.id)).length === 1 && rjJobs.length === 1 && rjJobs[0]!.pianoId === (await pianosOf(rjp.id))[0]!.id, ok1);
    check("the job has its 'created' event (same transaction)", rjJobs.length === 1 && (await db.select().from(S.serviceJobEvents).where(eq(S.serviceJobEvents.jobId, rjJobs[0]!.id))).length === 1);
    check("a location id sent by the browser is ignored (new customers have none)", rjJobs[0]?.locationId === null, rjJobs[0]?.locationId);

    const c0 = await countCustomers(), p0 = (await db.select().from(S.servicePianos)).length, j0 = (await db.select().from(S.serviceJobs)).length;
    const refused = await real.createJobWithNewCustomer({ name: "Refused Sale Person" }, null, jobFields({ jobType: "sale", salePianoId: "99999999-0000-4000-8000-000000000001" }) as never);
    check("a job the server refuses (unknown showroom piano) leaves no customer or job", !refused.ok && /no longer in the showroom/.test(refused.error) && (await countCustomers()) === c0 && (await db.select().from(S.serviceJobs)).length === j0, refused);

    await db.execute(sql`create function fail_event() returns trigger language plpgsql as $$ begin raise exception 'event insert failed'; end $$`);
    await db.execute(sql`create trigger fail_event_t before insert on service_job_events for each row execute function fail_event()`);
    const thrown = await real.createJobWithNewCustomer({ name: "Thrown Real Person" }, { brand: "Kawai" }, jobFields() as never);
    await db.execute(sql`drop trigger fail_event_t on service_job_events`);
    check("createJob throws AFTER its job insert (event insert fails): plain message, no job, no customer, no piano",
      !thrown.ok && /Nothing was added/.test(thrown.error) && (await countCustomers()) === c0 && (await db.select().from(S.servicePianos)).length === p0 && (await db.select().from(S.serviceJobs)).length === j0, thrown);
    check("…and the other customer's data was not touched", (await jobsOf(otherCust!.id)).length === 0 && (await db.select().from(S.serviceLocations).where(eq(S.serviceLocations.customerId, otherCust!.id))).length === 1);

    const needPiano = await real.createJobWithNewCustomer({ name: "No Piano Person" }, null, jobFields() as never);
    const npp = (await byName("No Piano Person"))[0];
    check("a home visit for a new customer with no piano typed gets an N/A piano linked to the job", needPiano.ok && !!npp && (await pianosOf(npp.id))[0]?.brand === "N/A" && (await jobsOf(npp.id))[0]?.pianoId === (await pianosOf(npp.id))[0]?.id, needPiano);
    const batch = await real.createJobWithNewCustomer({ name: "Trip to Digos" }, null, jobFields() as never);
    const bp = (await byName("Trip to Digos"))[0];
    check("a trip / batch name gets no piano; the job has none", batch.ok && !!bp && (await pianosOf(bp.id)).length === 0 && (await jobsOf(bp.id)).length === 1 && (await jobsOf(bp.id))[0]!.pianoId === null, batch);

    for (const bad of [123, null, {}, ["x"]]) {
      let r: { ok: boolean } | "threw" = "threw";
      try { r = await real.createJobWithNewCustomer({ name: bad } as never, { brand: "Y" }, jobFields() as never); } catch { /* stays "threw" */ }
      let r2: { ok: boolean } | "threw" = "threw";
      try { r2 = await real.createInvoiceWithNewCustomer({ name: bad } as never, { items: [{ description: "x" }] } as never); } catch { /* stays "threw" */ }
      let r3: { ok: boolean } | "threw" = "threw";
      try { r3 = await wl2.addWaitlistEntryWithNewCustomer({ name: bad } as never, {}); } catch { /* stays "threw" */ }
      check(`a non-string name (${JSON.stringify(bad)}) is refused by all three wrappers, no TypeError`, [r, r2, r3].every((x) => x !== "threw" && x.ok === false));
    }
    let r4: unknown = null; try { await real.createJobWithNewCustomer(null as never, null, null as never); r4 = "returned"; } catch { r4 = "threw"; }
    check("a null customer payload is refused", r4 === "returned");

    console.log("\n13. real createInvoice through createInvoiceWithNewCustomer");
    const [owner] = await db.insert(S.users).values({ email: "o@test", passwordHash: "x", name: "Owner" }).returning();
    FAKE_USER.id = owner!.id;
    const inv = await real.createInvoiceWithNewCustomer({ name: "real invoice person" }, { items: [{ description: "Tuning", qty: 1, unitPrice: 2500, taxable: true }], dueDate: null, notes: "" } as never);
    const rip = (await byName("Real Invoice Person"))[0];
    check("customer + invoice saved with the real createInvoice", inv.ok && !!rip && (await invoicesOf(rip.id)).length === 1 && (await invoicesOf(rip.id))[0]!.totalCents > 0, inv);
    const invBad = await real.createInvoiceWithNewCustomer({ name: "empty invoice person" }, { items: [], dueDate: null, notes: "" } as never);
    check("an invoice with no lines is refused and leaves no customer", !invBad.ok && (await byName("Empty Invoice Person")).length === 0, invBad);
    signedIn = false;
    let gate = "returned"; try { await real.createInvoiceWithNewCustomer({ name: "Signed Out" }, { items: [{ description: "x" }] } as never); } catch { gate = "threw"; }
    check("signed out: the wrapper stops at requireUser", gate === "threw" && (await byName("Signed Out")).length === 0);
    signedIn = true;

    const { rows } = await pool.query(`select count(*)::int as n from service_customers where lower(name) = 'maria santos'`);
    check("the only 'Maria Santos' is the one created in step 1", rows[0].n === 1);
    void ilike;
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
