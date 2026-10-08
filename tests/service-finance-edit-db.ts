/**
 * DB-backed scenario for the phase 3 finance edit rules. LOCAL POSTGRES ONLY. NOT part of `npm test`.
 *
 * It never touches your working database: it creates a throw-away database `herrero_edit_test` on the same
 * local server (schema copied with pg_dump -s from the base database), runs every scenario there against the
 * real invoice ops (src/server/service-invoice-ops.ts), then drops it.
 *
 * Run (local server on 5433, base database `herrero` must contain the schema and service_finance_history):
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-finance-edit-db.ts
 *
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_edit_test";
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
  const ops = await import("../src/server/service-invoice-ops");
  const { eq, sql } = await import("drizzle-orm");

  try {
    const [owner] = await db.insert(S.users).values({ email: "o@test", passwordHash: "x", name: "Test Owner", role: "owner" }).returning();
    const [tech] = await db.insert(S.users).values({ email: "t@test", passwordHash: "x", name: "Crew", role: "tech" }).returning();
    const [cust] = await db.insert(S.serviceCustomers).values({ name: "Test Customer" }).returning();
    const OWNER = { id: owner!.id, name: owner!.name, role: "owner" };
    const CREW = { id: tech!.id, name: tech!.name, role: "tech" };

    const mkInvoice = async (withJob: boolean) => {
      let jobId: string | null = null;
      if (withJob) {
        const [job] = await db.insert(S.serviceJobs).values({ customerId: cust!.id, title: "Tuning", status: "invoiced" }).returning();
        jobId = job!.id;
      }
      const [inv] = await db.insert(S.serviceInvoices).values({ customerId: cust!.id, jobId, taxRateBps: 1200, status: "draft" }).returning();
      const r = await ops.addInvoiceItemsOp(OWNER, inv!.id, [
        { description: "Tuning", qty: 1, unitPrice: 1000, taxable: true },
        { description: "Travel", qty: 1, unitPrice: 500, taxable: false },
      ]);
      if (!r.ok) throw new Error(`setup failed: ${r.error}`);
      return { id: inv!.id, jobId };
    };
    const inv = async (id: string) => (await db.select().from(S.serviceInvoices).where(eq(S.serviceInvoices.id, id)))[0]!;
    const pays = (id: string) => db.select().from(S.servicePayments).where(eq(S.servicePayments.invoiceId, id));
    const hist = (id: string) => db.select().from(S.serviceFinanceHistory).where(eq(S.serviceFinanceHistory.invoiceId, id));
    const jobStatus = async (id: string | null) => id ? (await db.select().from(S.serviceJobs).where(eq(S.serviceJobs.id, id)))[0]!.status : null;
    const sum = (rows: { amountCents: number }[]) => rows.reduce((a, p) => a + p.amountCents, 0);

    /* ---- 1. invoice with two payments ---- */
    console.log("\n1. real invoice with two payments");
    const A = await mkInvoice(true);
    let i = await inv(A.id);
    check("unpaid draft: subtotal 1,500.00, VAT 120.00, total 1,620.00 (unpaid edit needed no reason)", [i.subtotalCents, i.taxCents, i.totalCents].join() === "150000,12000,162000", i);
    check("unpaid line edit still needs no reason", (await ops.updateInvoiceOp(OWNER, A.id, { notes: "hello" })).ok);
    const r1 = await ops.recordPaymentOp(OWNER, { invoiceId: A.id, amount: 1000, method: "cash", receivedAt: "2026-09-05T10:00", markSent: true });
    const r2 = await ops.recordPaymentOp(OWNER, { invoiceId: A.id, amount: 620, method: "gcash", reference: "GC-1", receivedAt: "2026-09-20T10:00" });
    i = await inv(A.id);
    let P = await pays(A.id);
    check("two payments recorded", r1.ok && r2.ok && P.length === 2);
    check("invoice is paid, amountPaid == SUM(payments)", i.status === "paid" && i.amountPaidCents === sum(P) && i.amountPaidCents === 162000, i);
    check("paidAt = latest payment date (2026-09-20 Manila), not the edit time", i.paidAt?.toISOString() === "2026-09-20T02:00:00.000Z", i.paidAt);
    check("linked job moved invoiced -> paid", (await jobStatus(A.jobId)) === "paid");
    const over = await ops.recordPaymentOp(OWNER, { invoiceId: A.id, amount: 0.01 });
    check("overpayment by 1 centavo is rejected with a how-to message", !over.ok && /more than the balance/.test((over as { error: string }).error), over);
    check("nothing was written by the rejected payment", (await pays(A.id)).length === 2);

    /* ---- 2. edit payment amount ---- */
    console.log("\n2. edit payment amount");
    const pGc = P.find((p) => p.method === "gcash")!, pCash = P.find((p) => p.method === "cash")!;
    const noReason = await ops.editPaymentOp(OWNER, pGc.id, { amount: 500 } as never);
    check("missing reason rejected", !noReason.ok && /reason/i.test((noReason as { error: string }).error), noReason);
    const shortReason = await ops.editPaymentOp(OWNER, pGc.id, { amount: 500, reason: "ab" });
    check("too-short reason rejected", !shortReason.ok);
    check("payment untouched after the rejections", (await pays(A.id)).find((p) => p.id === pGc.id)!.amountCents === 62000);
    const crewEdit = await ops.editPaymentOp(CREW, pGc.id, { amount: 500, reason: "crew try" });
    check("non-owner is denied", !crewEdit.ok && /owner/i.test((crewEdit as { error: string }).error), crewEdit);
    const up = await ops.editPaymentOp(OWNER, pGc.id, { amount: 620.01, reason: "typo test" });
    check("raising a payment above the total is rejected", !up.ok && /more than the invoice total/.test((up as { error: string }).error), up);
    const h0 = (await hist(A.id)).length;
    const ed = await ops.editPaymentOp(OWNER, pGc.id, { amount: 500, receivedAt: "2026-10-02T09:00", method: "bank_transfer", reference: "BT-9", reason: "Customer's bank fee was deducted" });
    P = await pays(A.id); i = await inv(A.id);
    check("valid edit succeeds on the SAME row (still exactly 2 payment rows)", ed.ok && P.length === 2 && P.some((p) => p.id === pGc.id && p.amountCents === 50000), ed);
    check("invoice recomputed: partial, balance 120.00, amountPaid == SUM(payments)", i.status === "partial" && i.amountPaidCents === 150000 && i.amountPaidCents === sum(P) && i.paidAt === null, i);
    check("job moved paid -> invoiced", (await jobStatus(A.jobId)) === "invoiced");
    const hRows = (await hist(A.id)).slice(h0 === 0 ? 0 : 0).filter((h) => h.reason);
    const payRow = hRows.find((h) => h.entityType === "payment" && h.action === "update");
    check("history row has the reason, from/to in centavos and ISO dates", !!payRow && payRow.reason === "Customer's bank fee was deducted" && (payRow.changes as Record<string, { from: unknown; to: unknown }>).amountCents?.from === 62000 && (payRow.changes as Record<string, { from: unknown; to: unknown }>).amountCents?.to === 50000 && typeof (payRow.changes as Record<string, { from: unknown }>).receivedAt?.from === "string", payRow);
    check("status change row also carries the reason", hRows.some((h) => h.action === "status" && h.reason));
    const same = await ops.editPaymentOp(OWNER, pGc.id, { amount: 500, reason: "no change" });
    check("saving with no change is refused and writes nothing", !same.ok && (await hist(A.id)).length === h0 + hRows.length);

    /* ---- 3. line edits after payment ---- */
    console.log("\n3. invoice edits after payment need a reason");
    const items = await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.invoiceId, A.id));
    const tuning = items.find((x) => x.description === "Tuning")!;
    const lineNo = await ops.updateInvoiceItemOp(OWNER, tuning.id, { unitPrice: 1100 });
    check("line edit without a reason is rejected", !lineNo.ok && /reason/i.test((lineNo as { error: string }).error), lineNo);
    check("line unchanged", (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.id, tuning.id)))[0]!.unitPriceCents === 100000);
    const lineCrew = await ops.updateInvoiceItemOp(CREW, tuning.id, { unitPrice: 1100 }, "crew try");
    check("non-owner line edit denied", !lineCrew.ok);
    const lineOk = await ops.updateInvoiceItemOp(OWNER, tuning.id, { unitPrice: 1100 }, "Price corrected per quote");
    i = await inv(A.id);
    check("line edit with a reason works; total 1,732.00 (1,600 + 12% of 1,100), still partial", lineOk.ok && i.totalCents === 173200 && i.status === "partial", i);
    const lowering = await ops.updateInvoiceItemOp(OWNER, tuning.id, { unitPrice: 100 }, "too low test");
    check("a line edit that drops the total below what was paid is rejected", !lowering.ok && /more than the invoice total/.test((lowering as { error: string }).error), lowering);
    check("...and the line is unchanged (rolled back)", (await inv(A.id)).totalCents === 173200);
    const delAll = await ops.deleteInvoiceItemOp(OWNER, tuning.id, "remove test");
    check("deleting a line that would drop the total below paid is rejected", !delAll.ok);
    const discBig = await ops.updateInvoiceOp(OWNER, A.id, { discount: 99999 }, "discount test");
    check("discount above subtotal rejected", !discBig.ok && /discount/i.test((discBig as { error: string }).error), discBig);
    const discNo = await ops.updateInvoiceOp(OWNER, A.id, { discount: 100 });
    check("discount change without reason rejected", !discNo.ok);
    const discOk = await ops.updateInvoiceOp(OWNER, A.id, { discount: 100, dueDate: "2026-11-01T00:00" }, "Goodwill discount");
    i = await inv(A.id);
    check("discount with reason works; total recomputed by code", discOk.ok && i.discountCents === 10000 && i.totalCents === 173200 - 10000 - 1200, i);
    const addNo = await ops.addInvoiceItemsOp(OWNER, A.id, [{ description: "Extra", unitPrice: 50 }]);
    check("adding a line without a reason is rejected", !addNo.ok);
    const addOk = await ops.addInvoiceItemsOp(OWNER, A.id, [{ description: "Extra", unitPrice: 50 }], "Forgot this part");
    check("adding a line with a reason works", addOk.ok);
    const firstPay = (await pays(A.id)).reduce((a, p) => (p.createdAt < a ? p.createdAt : a), new Date("2999-01-01"));
    const lineHist = (await hist(A.id)).filter((h) => h.entityType === "invoice_item" && h.createdAt > firstPay);
    check("every line history row written after the first payment carries a reason", lineHist.length >= 2 && lineHist.every((h) => !!h.reason), lineHist.map((h) => h.reason));

    /* ---- 4. concurrency ---- */
    console.log("\n4. concurrent edits of one invoice");
    const C = await mkInvoice(false);
    await ops.recordPaymentOp(OWNER, { invoiceId: C.id, amount: 600, method: "cash", markSent: true });
    await ops.recordPaymentOp(OWNER, { invoiceId: C.id, amount: 400, method: "cash" });
    const [c1, c2] = await pays(C.id);
    const par = await Promise.all([
      ops.editPaymentOp(OWNER, c1!.id, { amount: 550, reason: "parallel edit one" }),
      ops.editPaymentOp(OWNER, c2!.id, { amount: 350, reason: "parallel edit two" }),
    ]);
    const Cp = await pays(C.id); const Ci = await inv(C.id);
    check("both parallel payment edits succeeded", par.every((r) => r.ok), par);
    check("no lost update: amountPaid == SUM(payments) == 900.00", Ci.amountPaidCents === sum(Cp) && Ci.amountPaidCents === 90000, { Ci: Ci.amountPaidCents, sum: sum(Cp) });
    check("each edit left a history row", (await hist(C.id)).filter((h) => h.entityType === "payment" && h.action === "update").length === 2);
    // Race: 8 payments of 100.00 into a balance of 720.00 (total 1,620.00 - 900.00) -> exactly 7 fit (the lock serialises them).
    const race = await Promise.all(Array.from({ length: 8 }, () => ops.recordPaymentOp(OWNER, { invoiceId: C.id, amount: 100, method: "gcash" })));
    const Cr = await pays(C.id); const Cri = await inv(C.id);
    check("race of 8 payments: exactly 7 accepted, 1 rejected, never overpaid", race.filter((r) => r.ok).length === 7 && Cri.amountPaidCents <= Cri.totalCents && Cri.amountPaidCents === sum(Cr), { ok: race.filter((r) => r.ok).length, paid: Cri.amountPaidCents, total: Cri.totalCents });
    check("race result: partial at 1,600.00 of 1,620.00 (the 8th 100.00 would have overpaid)", Cri.status === "partial" && Cri.amountPaidCents === 160000, Cri);
    const finish = await ops.recordPaymentOp(OWNER, { invoiceId: C.id, amount: 20 });
    check("paying exactly the last 20.00 makes it paid", finish.ok && (await inv(C.id)).status === "paid" && (await inv(C.id)).amountPaidCents === 162000);
    const mix = await Promise.all([
      ops.editPaymentOp(OWNER, c1!.id, { amount: 560, reason: "mix one" }),
      ops.updateInvoiceItemOp(OWNER, (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.invoiceId, C.id)))[0]!.id, { qty: 1 }, "mix two"),
      ops.deletePaymentOp(OWNER, c2!.id, "mix three"),
    ]);
    const Cm = await pays(C.id); const Cmi = await inv(C.id);
    check("mixed parallel edits: invoice still consistent (amountPaid == SUM(payments), never above total)", mix.every((r) => r.ok || /reason|more than|not found/i.test((r as { error: string }).error)) && Cmi.amountPaidCents === sum(Cm) && Cmi.amountPaidCents <= Cmi.totalCents, { mix, paid: Cmi.amountPaidCents, sum: sum(Cm), total: Cmi.totalCents });

    /* ---- 5. history failure rolls back ---- */
    console.log("\n5. history failure rolls the edit back (scratch database only)");
    const D = await mkInvoice(false);
    await ops.recordPaymentOp(OWNER, { invoiceId: D.id, amount: 1000, method: "cash", markSent: true });
    const dp = (await pays(D.id))[0]!;
    await pool.query("ALTER TABLE service_finance_history RENAME TO service_finance_history_off");
    const noHist = await ops.editPaymentOp(OWNER, dp.id, { amount: 900, reason: "table missing test" });
    const afterNoHist = (await pays(D.id))[0]!;
    check("edit fails with a clear message", !noHist.ok && /history/i.test((noHist as { error: string }).error), noHist);
    check("payment amount rolled back to 1,000.00", afterNoHist.amountCents === 100000);
    check("invoice totals rolled back (still partial, paid 1,000.00)", (await inv(D.id)).amountPaidCents === 100000 && (await inv(D.id)).status === "partial");
    const itD = (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.invoiceId, D.id)))[0]!;
    const lineNoHist = await ops.updateInvoiceItemOp(OWNER, itD.id, { unitPrice: 2000 }, "table missing line");
    check("line edit on a paid invoice also fails and rolls back", !lineNoHist.ok && (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.id, itD.id)))[0]!.unitPriceCents === itD.unitPriceCents);
    const E = await mkInvoice(false);
    const freeEdit = await ops.updateInvoiceOp(OWNER, E.id, { notes: "unpaid edits stay best-effort" });
    check("unpaid invoice edits still work with the table missing (old behaviour)", freeEdit.ok);
    await pool.query("ALTER TABLE service_finance_history_off RENAME TO service_finance_history");
    const back = await ops.editPaymentOp(OWNER, dp.id, { amount: 900, reason: "table back test" });
    check("after the table is back the same edit succeeds", back.ok && (await pays(D.id))[0]!.amountCents === 90000, back);

    /* ---- 6. void ---- */
    console.log("\n6. void invoices");
    const dpay = (await pays(D.id))[0]!;
    const voidNo = await ops.setInvoiceStatusOp(OWNER, D.id, "void");
    check("voiding an invoice with payments needs a reason", !voidNo.ok);
    const voidCrew = await ops.setInvoiceStatusOp(CREW, D.id, "void", "crew try");
    check("...and the owner", !voidCrew.ok);
    const voidOk = await ops.setInvoiceStatusOp(OWNER, D.id, "void", "Customer cancelled the booking");
    check("void with reason works", voidOk.ok && (await inv(D.id)).status === "void");
    const vEdits = await Promise.all([
      ops.editPaymentOp(OWNER, dpay.id, { amount: 800, reason: "void edit test" }),
      ops.updateInvoiceOp(OWNER, D.id, { notes: "x" }, "void edit test"),
      ops.addInvoiceItemsOp(OWNER, D.id, [{ description: "x", unitPrice: 1 }], "void edit test"),
      ops.updateInvoiceItemOp(OWNER, itD.id, { qty: 2 }, "void edit test"),
      ops.deleteInvoiceItemOp(OWNER, itD.id, "void edit test"),
      ops.recordPaymentOp(OWNER, { invoiceId: D.id, amount: 1 }),
      ops.deletePaymentOp(OWNER, dpay.id, "void edit test"),
    ]);
    check("every edit on a void invoice is rejected", vEdits.every((r) => !r.ok && /void/i.test((r as { error: string }).error)), vEdits);
    const reopenNo = await ops.setInvoiceStatusOp(OWNER, D.id, "draft");
    check("reopening needs a reason too", !reopenNo.ok && (await inv(D.id)).status === "void");
    const reopen = await ops.setInvoiceStatusOp(OWNER, D.id, "draft", "Booking is back on");
    check("reopen with reason: payments keep it partial, amountPaid == SUM(payments)", reopen.ok && (await inv(D.id)).status === "partial" && (await inv(D.id)).amountPaidCents === sum(await pays(D.id)));

    /* ---- 7. delete invoice / payment ---- */
    console.log("\n7. delete");
    const delPaid = await ops.deleteInvoiceOp(OWNER, A.id, `INV-${A.id}`);
    const codeOf = async (id: string) => { const x = await inv(id); const st = await db.select().from(S.serviceSettings).where(eq(S.serviceSettings.ownerId, OWNER.id)); return `${st[0]!.invoicePrefix}-${x.issueDate.getUTCFullYear()}-${String(x.invoiceNumber).padStart(4, "0")}`; };
    const delPaid2 = await ops.deleteInvoiceOp(OWNER, A.id, await codeOf(A.id));
    check("deleteInvoice with payments rejected even with the right code (\"Void it instead\")", !delPaid2.ok && /Void it instead/.test((delPaid2 as { error: string }).error), delPaid2);
    check("(wrong code is rejected too)", !delPaid.ok);
    check("invoice and payments still exist", (await pays(A.id)).length === 2 && !!(await inv(A.id)));
    const delFree = await ops.deleteInvoiceOp(OWNER, E.id, await codeOf(E.id));
    check("an unpaid invoice can still be deleted", delFree.ok && (await db.select().from(S.serviceInvoices).where(eq(S.serviceInvoices.id, E.id))).length === 0, delFree);
    const target = (await pays(A.id))[0]!;
    const dpNo = await ops.deletePaymentOp(OWNER, target.id);
    check("deleting a payment without a reason is rejected", !dpNo.ok && (await pays(A.id)).length === 2);
    const dpOk = await ops.deletePaymentOp(OWNER, target.id, "Entered on the wrong invoice");
    const delRow = (await hist(A.id)).find((h) => h.entityType === "payment" && h.action === "delete");
    const dc = delRow?.changes as Record<string, { from: unknown; to: unknown }> | null;
    check("deletePayment with a reason works", dpOk.ok && (await pays(A.id)).length === 1);
    check("its history row keeps full amount / method / date and the reason", !!delRow && dc?.amountCents?.from === target.amountCents && dc?.method?.from === target.method && typeof dc?.receivedAt?.from === "string" && delRow.reason === "Entered on the wrong invoice", delRow);

    /* ---- 7b. review fixes ---- */
    console.log("\n7b. review fixes");
    const G = await mkInvoice(true);
    await ops.recordPaymentOp(OWNER, { invoiceId: G.id, amount: 1620, markSent: true });
    check("job is paid after a full payment", (await jobStatus(G.jobId)) === "paid");
    await db.update(S.serviceJobs).set({ status: "cancelled" }).where(eq(S.serviceJobs.id, G.jobId!));
    const gItems = await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.invoiceId, G.id));
    const gUp = await ops.updateInvoiceItemOp(OWNER, gItems[0]!.id, { description: "Tuning (renamed)" }, "rename only");
    const gDown = await ops.editPaymentOp(OWNER, (await pays(G.id))[0]!.id, { amount: 1000, reason: "partial refund" });
    check("a cancelled job is never changed by recalculation (paid and un-paid transitions)", gUp.ok && gDown.ok && (await jobStatus(G.jobId)) === "cancelled");
    const empty = await ops.updateInvoiceItemOp(OWNER, gItems[0]!.id, {});
    check("empty patch to updateInvoiceItem is a clean ok (no database error)", empty.ok, empty);
    const emptyPay = await ops.editPaymentOp(OWNER, (await pays(G.id))[0]!.id, { reason: "nothing at all" });
    check("empty editPayment is a clean 'Nothing was changed'", !emptyPay.ok && /Nothing was changed/.test((emptyPay as { error: string }).error), emptyPay);
    const bigQty = await ops.updateInvoiceItemOp(OWNER, gItems[0]!.id, { qty: 50_000 }, "qty test");
    check("qty above 9,999 is clamped, not stored raw", (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.id, gItems[0]!.id)))[0]!.qty <= 9_999 || !bigQty.ok);
    const bigPrice = await ops.updateInvoiceItemOp(OWNER, gItems[0]!.id, { unitPrice: 30_000_000 }, "price test");
    check("unit price above the limit is rejected with a clear message", !bigPrice.ok && /Amount too large/.test((bigPrice as { error: string }).error), bigPrice);
    const bigAdd = await ops.addInvoiceItemsOp(OWNER, G.id, [{ description: "x", unitPrice: 30_000_000 }], "price test");
    check("adding a line above the limit is rejected", !bigAdd.ok && /Amount too large/.test((bigAdd as { error: string }).error));
    const H = await mkInvoice(false);
    const twoBig = await ops.addInvoiceItemsOp(OWNER, H.id, [{ description: "a", qty: 1, unitPrice: 19_000_000 }, { description: "b", qty: 1, unitPrice: 19_000_000 }, { description: "c", qty: 1, unitPrice: 19_000_000 }]);
    check("a total that overflows the database column returns a clean message (22003), no crash", !twoBig.ok && /Amount too large/.test((twoBig as { error: string }).error), twoBig);
    check("...and the invoice was rolled back to its 2 original lines", (await db.select().from(S.serviceInvoiceItems).where(eq(S.serviceInvoiceItems.invoiceId, H.id))).length === 2);
    const taxUp = await ops.updateInvoiceOp(OWNER, H.id, { taxRateBps: 999_999 });
    check("tax rate is clamped to 100% (10000 bps)", taxUp.ok && (await inv(H.id)).taxRateBps === 10_000, await inv(H.id));
    // tax-rate edit on a paid invoice that would overpay
    const K = await mkInvoice(false);
    await ops.recordPaymentOp(OWNER, { invoiceId: K.id, amount: 1620, markSent: true });
    const taxDown = await ops.updateInvoiceOp(OWNER, K.id, { taxRateBps: 0 }, "tax test");
    check("lowering the tax rate on a fully paid invoice (would overpay) is rejected and rolled back", !taxDown.ok && /more than the invoice total/.test((taxDown as { error: string }).error) && (await inv(K.id)).taxRateBps === 1200, taxDown);
    // stale status
    await db.update(S.serviceInvoices).set({ status: "sent" }).where(eq(S.serviceInvoices.id, K.id));
    const stale = await ops.updateInvoiceOp(OWNER, K.id, { notes: "stale status" });
    check("stale status 'sent' with payments still needs a reason", !stale.ok && /reason/i.test((stale as { error: string }).error), stale);
    // status allow-list
    const L = await mkInvoice(false);
    await ops.setInvoiceStatusOp(OWNER, L.id, "sent");
    const sentBefore = (await inv(L.id)).sentAt;
    const unknown = await ops.setInvoiceStatusOp(OWNER, L.id, "banana");
    check("unknown status is rejected and does not clear sentAt", !unknown.ok && (await inv(L.id)).sentAt?.getTime() === sentBefore?.getTime());
    await ops.setInvoiceStatusOp(OWNER, L.id, "void");
    const sentOnVoid = await ops.setInvoiceStatusOp(OWNER, L.id, "sent");
    check("'sent' on a void invoice is rejected (reopen first)", !sentOnVoid.ok && /reopen/i.test((sentOnVoid as { error: string }).error) && (await inv(L.id)).status === "void", sentOnVoid);
    // editPayment / deletePayment always need a reason
    const M = await mkInvoice(false);
    await ops.recordPaymentOp(OWNER, { invoiceId: M.id, amount: 100, markSent: true });
    const mp = (await pays(M.id))[0]!;
    check("editPayment with blank-looking reason rejected", !(await ops.editPaymentOp(OWNER, mp.id, { amount: 90, reason: "\u200B\u200B..." })).ok);
    check("deletePayment with symbols-only reason rejected", !(await ops.deletePaymentOp(OWNER, mp.id, "...")).ok && (await pays(M.id)).length === 1);

    /* ---- 8. global invariant ---- */
    console.log("\n8. books balance across everything this script touched");
    const bad = await pool.query(`
      SELECT i.id FROM service_invoices i
      LEFT JOIN (SELECT invoice_id, sum(amount_cents)::int s FROM service_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.amount_paid_cents <> coalesce(p.s, 0) OR i.amount_paid_cents > greatest(i.total_cents, 0)`);
    check("every invoice: amount_paid == SUM(payments) and never above total", bad.rowCount === 0, bad.rows);
    void sql;
  } finally {
    await pool.end();
    const a2 = new Client({ connectionString: adminUrl.toString() });
    a2.on("error", () => {});
    await a2.connect();
    await a2.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await a2.end();
  }
}

main().then(() => {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
