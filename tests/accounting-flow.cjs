/* Integration checks for the Owner Accounting engine against an isolated PostgreSQL
   schema; no application rows are modified.
   Run:  TEST_DB_HOST=127.0.0.1 DB_PORT=54329 DB_USER=postgres DB_PASSWORD=postgres \
         DB_NAME=app_db node tests/accounting-flow.cjs
   Covers: core initialization, owner money, the posting bridge (idempotency, hash
   changes, unmapped methods, pre-books, period locks), project billing, piano sales
   (incl. legacy carrying cost + forfeited deposits), reconciliation, and the read
   layer (overview / reports / receivables) against an independently maintained mirror. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
require("dotenv").config({ quiet: true });

const namespace = `accflow_test_${randomUUID().replaceAll("-", "")}`;
const config = {
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  host: process.env.TEST_DB_HOST || "localhost", port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres", password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "nextjs_db",
};
const setup = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${namespace}` });
const db = drizzle(pool);
const context = new AsyncLocalStorage();
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} }; cache.set(filename, mod);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (name === "@/db") return { db, pool };
    if (name === "next/headers") return { cookies: async () => ({
      get: (key) => context.getStore()?.get(key) ? { value: context.getStore().get(key) } : undefined,
      set: (key, value) => context.getStore().set(key, value), delete: (key) => context.getStore().delete(key),
    }) };
    if (name === "next/cache") return { revalidatePath: () => {} };
    if (name === "next/navigation") return { redirect: () => { throw new Error("AUTH_REDIRECT"); } };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(localRequire, mod, mod.exports);
  return mod.exports;
}

/* ---------- helpers ---------- */
let checks = 0;
function check(name, actual, expected) {
  checks++;
  assert.deepStrictEqual(actual, expected, `✗ ${name}`);
  console.log(`  ✓ ${name}`);
}
const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];

/** Debit-natured balance including the account's opening baseline (the app's `balanceOf`). */
const accounts = new Map(); // id → { system_key, type, name }
async function loadAccounts() {
  accounts.clear();
  for (const r of (await q("SELECT id, system_key, type, name, opening_balance_cents FROM acc_accounts")).rows) {
    accounts.set(r.id, r);
  }
}
const acc = (key) => { for (const [id, a] of accounts) if (a.system_key === key) return id; throw new Error(`no account ${key}`); };
async function bal(accountId) {
  const r = await one(
    "SELECT coalesce(sum(debit_cents),0)::bigint AS d, coalesce(sum(credit_cents),0)::bigint AS c FROM acc_journal_lines WHERE account_id = $1",
    [accountId],
  );
  const a = accounts.get(accountId);
  const debitNatured = a.type === "asset" || a.type === "expense";
  const raw = debitNatured ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d);
  return raw + (debitNatured ? a.opening_balance_cents : a.opening_balance_cents);
}
const manilaNow = () => new Date(Date.now() + 8 * 3600 * 1000);
/** parseLocal() expects Manila wall-clock strings — format an instant accordingly. */
const manilaLocal = (d) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16);
const monthKey = (d) => d.toISOString().slice(0, 7);

/* ---------- mirror ledger (independent expectation of every balance) ---------- */
const M = {
  cash: 0, bank: 0, gcash: 0, maya: 0, unmapped: 0, ar: 0, on_hand: 0,
  vat: 0, loan: 0, ap: 0, deposits: 0, capital: 0, opening: 0, draws: 0, personal: 0,
  service_revenue: 0, project_revenue: 0, piano_revenue: 0, other_income: 0,
  fuel: 0, utilities: 0, wages: 0, interest: 0, materials: 0, cogs: 0,
};
async function checkMirror(label) {
  await loadAccounts();
  const map = {
    cash: "wallet_cash", bank: "wallet_bank", gcash: "wallet_gcash", maya: "wallet_maya",
    unmapped: "unmapped", ar: "ar", on_hand: "pianos_on_hand",
    vat: "vat_payable", loan: null, ap: "ap", deposits: "deposits_held",
    capital: "capital", opening: "opening_equity", draws: "owner_draws", personal: "personal",
    service_revenue: "service_revenue", project_revenue: "project_revenue",
    piano_revenue: "piano_revenue", other_income: "other_income",
    fuel: "exp_fuel", utilities: "exp_rent", wages: "wages", interest: "exp_interest",
    materials: "exp_materials", cogs: "piano_cogs",
  };
  for (const [k, key] of Object.entries(map)) {
    if (k === "loan") continue; // loan account created at runtime; checked separately
    check(`${label}: ${k} = ${M[k]}`, await bal(acc(key)), M[k]);
  }
}

async function main() {
  await setup.query(`CREATE SCHEMA "${namespace}"`);
  try {
    const tables = [
      "users", "sessions", "workers", "projects", "tasks", "time_entries", "payments",
      "service_customers", "service_invoices", "service_payments", "service_expenses",
      "pianos", "acc_accounts", "acc_journal", "acc_journal_lines", "acc_reconciliations",
      "acc_period_locks", "acc_exceptions", "acc_settings", "audit_log",
      "project_items", "project_payments", "project_costs",
      "piano_sales", "piano_payments", "piano_cost_entries",
    ];
    for (const t of tables) await pool.query(`CREATE TABLE "${t}" (LIKE public."${t}" INCLUDING ALL)`);
    await pool.query("ALTER TABLE time_entries ADD FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL");

    const accounting = load("src/server/accounting.ts");
    const billing = load("src/server/accounting-billing.ts");
    const data = load("src/server/accounting-data.ts");
    const auth = load("src/lib/auth.ts");

    /* ---------- seed operational rows ---------- */
    const [owner, customer, worker, project, pianoA, pianoB] = Array.from({ length: 6 }, () => randomUUID());
    await pool.query("INSERT INTO users (id,email,password_hash,name,role) VALUES ($1,'acc-flow@example.invalid','unused','Flow Owner','owner')", [owner]);
    await pool.query("INSERT INTO service_customers (id,name) VALUES ($1,'Juan Dela Cruz')", [customer]);
    await pool.query("INSERT INTO workers (id,name,pin_hash) VALUES ($1,'Test A','unused')", [worker]);
    await pool.query("INSERT INTO projects (id,client_name,piano_brand,piano_model) VALUES ($1,'Dela Cruz Residence','Yamaha','U1')", [project]);
    await pool.query("INSERT INTO pianos (id,brand,model,cost_cents,status) VALUES ($1,'Yamaha','U3',35000000,'available')", [pianoA]);
    await pool.query("INSERT INTO pianos (id,brand,model,status) VALUES ($1,'Kawai','ND-21','available')", [pianoB]);
    const inv1 = (await one(
      "INSERT INTO service_invoices (customer_id,status,subtotal_cents,tax_cents,total_cents,amount_paid_cents,sent_at) VALUES ($1,'partial',1000000,120000,1120000,700000,now() - interval '2 hours') RETURNING id",
      [customer],
    )).id;
    const inv2 = (await one(
      "INSERT INTO service_invoices (customer_id,status,subtotal_cents,tax_cents,total_cents,amount_paid_cents,sent_at) VALUES ($1,'paid',500000,60000,560000,560000,now() - interval '80 days') RETURNING id",
      [customer],
    )).id;
    await q("INSERT INTO service_payments (invoice_id,amount_cents,method,received_at) VALUES ($1,500000,'gcash',now() - interval '1 hour'),($1,200000,'check',now() - interval '1 hour'),($2,560000,'cash',now())", [inv1, inv2]);
    await q("INSERT INTO service_expenses (category,description,amount_cents,method,spent_at) VALUES ('fuel','Diesel top-up',50000,'cash',now())");
    const te = (await one(
      "INSERT INTO time_entries (worker_id,clock_in,clock_out,rate_at_clock_in_cents,paid_cents,paid_at) VALUES ($1,now() - interval '3 hours',now() - interval '2 hours',35000,35000,now()) RETURNING id",
      [worker],
    )).id;
    await q("INSERT INTO payments (time_entry_id,amount_cents,paid_at) VALUES ($1,35000,now())", [te]);

    const ownerCookies = new Map();
    await context.run(ownerCookies, () => auth.createSession(owner));
    const as = (fn) => context.run(ownerCookies, fn);
    const user = await one("SELECT * FROM users WHERE id = $1", [owner]);

    /* ============================================================
     * 1. Initialization + first bridge run
     * ============================================================ */
    console.log("initialization & first sync");
    {
      const res = await as(() => accounting.syncNow());
      check("first sync posts 6 entries", res.data, { posted: 6, voided: 0, exceptions: 0 });
      await loadAccounts();
      check("system + wallet + expense accounts seeded", accounts.size, 31); // 16 system + 4 wallets + 11 expense categories
      check("all four default wallets exist", ["wallet_cash", "wallet_bank", "wallet_gcash", "wallet_maya"].every((k) => [...accounts.values()].some((a) => a.system_key === k)), true);
      const settings = await one("SELECT * FROM acc_settings");
      check("method map defaults cash→Cash wallet", settings.method_map.cash, acc("wallet_cash"));
      check("payroll wallet defaults to Cash", settings.payroll_account_id, acc("wallet_cash"));
      const nAccounts = accounts.size;
      await as(() => accounting.syncNow());
      check("core init is idempotent (no duplicate accounts)", accounts.size, nAccounts);

      // mirror the six posted entries
      M.ar += 1120000; M.service_revenue += 1000000; M.vat += 120000; // INV1 billing
      M.gcash += 500000; M.ar -= 500000; // P1 collection
      M.unmapped += 200000; M.ar -= 200000; // P2 unmapped method
      M.fuel += 50000; M.cash -= 50000; // fuel expense
      M.wages += 35000; M.cash -= 35000; // payroll
      M.cash += 560000; M.opening += 560000; // P3 on pre-books invoice → opening equity
      await checkMirror("sync 1");
      check("unmapped method raised an exception", (await one("SELECT count(*)::int AS n FROM acc_exceptions WHERE status='open'")).n, 1);

      // idempotency
      const again = await as(() => accounting.syncNow());
      check("second sync posts nothing", again.data, { posted: 0, voided: 0, exceptions: 0 });
      check("journal has exactly 6 entries", (await one("SELECT count(*)::int AS n FROM acc_journal")).n, 6);
    }

    /* ============================================================
     * 2. Owner money actions
     * ============================================================ */
    console.log("owner money");
    {
      check("contribution ok", (await as(() => accounting.recordOwnerContribution({ amount: 100000, walletId: acc("wallet_bank") }))).ok, true);
      M.bank += 10000000; M.capital += 10000000;
      const utilities = acc("exp_rent"); // “Rent & Utilities”
      check("business expense ok", (await as(() => accounting.recordBusinessExpense({ amount: 2500, categoryId: utilities, walletId: acc("wallet_bank"), description: "Meralco bill" }))).ok, true);
      M.utilities += 250000; M.bank -= 250000;
      check("other income ok", (await as(() => accounting.recordBusinessIncome({ amount: 15000, walletId: acc("wallet_gcash"), description: "Studio rental" }))).ok, true);
      M.gcash += 1500000; M.other_income += 1500000;
      check("draw is never blocked", (await as(() => accounting.recordOwnerDraw({ amount: 30000, walletId: acc("wallet_bank"), category: "Household" }))).ok, true);
      M.draws -= 3000000; M.bank -= 3000000; // equity-natured: draws carry a debit balance
      check("personal expense ok", (await as(() => accounting.recordPersonalExpense({ amount: 4000, walletId: acc("wallet_cash"), description: "Groceries" }))).ok, true);
      M.personal -= 400000; M.cash -= 400000;
      check("transfer ok", (await as(() => accounting.recordTransfer({ amount: 10000, fromWalletId: acc("wallet_bank"), toWalletId: acc("wallet_gcash") }))).ok, true);
      M.gcash += 1000000; M.bank -= 1000000;
      const loan = await as(() => accounting.createLoanAccount("SSS Calamity Loan"));
      check("loan account created", loan.ok, true);
      check("loan received ok", (await as(() => accounting.recordLoanReceived({ amount: 200000, loanAccountId: loan.data.id, walletId: acc("wallet_bank") }))).ok, true);
      M.bank += 20000000; M.loan += 20000000;
      check("loan payment ok", (await as(() => accounting.recordLoanPayment({ amount: 10000, interest: 800, loanAccountId: loan.data.id, walletId: acc("wallet_bank") }))).ok, true);
      M.loan -= 920000; M.interest += 80000; M.bank -= 1000000;
      check("tax payment ok", (await as(() => accounting.recordTaxPayment({ amount: 1200, walletId: acc("wallet_bank"), reference: "BIR 2550M" }))).ok, true);
      M.vat -= 120000; M.bank -= 120000;
      check("interest cannot exceed payment", (await as(() => accounting.recordLoanPayment({ amount: 500, interest: 600, loanAccountId: loan.data.id, walletId: acc("wallet_bank") }))).ok, false);

      // void the transfer — reversal pairs must net to zero
      const transfer = await one("SELECT id FROM acc_journal WHERE kind='transfer' AND voided_at IS NULL");
      check("void entry ok", (await as(() => accounting.voidEntry(transfer.id, "Wrong amount"))).ok, true);
      M.gcash -= 1000000; M.bank += 1000000;
      check("voided entry flagged + reversal posted", (await one(
        "SELECT (SELECT count(*)::int FROM acc_journal WHERE voided_at IS NOT NULL) AS v, (SELECT count(*)::int FROM acc_journal WHERE reversal_of_id IS NOT NULL) AS r",
      )), { v: 1, r: 1 });
      const reversal = await one("SELECT id FROM acc_journal WHERE reversal_of_id IS NOT NULL AND voided_at IS NULL");
      check("reversal entries cannot be voided", (await as(() => accounting.voidEntry(reversal.id, "nope"))).ok, false);
      check("already-voided entry cannot be voided again", (await as(() => accounting.voidEntry(transfer.id, "nope"))).ok, false);
      await checkMirror("owner money");
    }

    /* ============================================================
     * 3. Bridge: method-map remap, books-start change, invoice void
     * ============================================================ */
    console.log("bridge — remap / books start / void");
    {
      check("remap check→Bank", (await as(() => accounting.updateMethodMap({ check: acc("wallet_bank") }))).ok, true);
      const res = await as(() => accounting.syncNow());
      check("remap voids + reposts the payment", res.data, { posted: 1, voided: 1, exceptions: 0 });
      M.unmapped -= 200000; M.bank += 200000;
      await checkMirror("remap");
      check("unmapped account nets to zero", await bal(acc("unmapped")), 0);

      // push books start back 3 months → the pre-books invoice becomes postable
      const d = manilaNow();
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1));
      check("move books start", (await as(() => accounting.updateBooksStartDate(start.toISOString().slice(0, 10)))).ok, true);
      const res2 = await as(() => accounting.syncNow());
      check("books change posts invoice + reposts its payment", res2.data, { posted: 2, voided: 1, exceptions: 0 });
      M.ar += 560000; M.service_revenue += 500000; M.vat += 60000; // INV2 now billed
      M.ar -= 560000; // …and its payment now collects against AR instead of Opening Equity
      M.opening -= 560000; // prebooks entry voided
      await checkMirror("books start moved");
      check("revenue recognizes the now-postable invoice", await bal(acc("service_revenue")), M.service_revenue);

      // void the invoice → billing unposts, its payment goes back to opening equity
      await q("UPDATE service_invoices SET voided_at = now() WHERE id = $1", [inv2]);
      const res3 = await as(() => accounting.syncNow());
      check("voided invoice unposts billing + reverts payment to prebooks", res3.data, { posted: 1, voided: 2, exceptions: 0 });
      // billing reversal (−AR) is offset by the collection-reversal (+AR) → AR unchanged
      M.service_revenue -= 500000; M.vat -= 60000;
      M.opening += 560000;
      await checkMirror("invoice voided");
      check("revenue back to pre-void level", await bal(acc("service_revenue")), 1000000);
    }

    /* ============================================================
     * 4. Project billing
     * ============================================================ */
    console.log("project billing");
    {
      check("add quote items", (await as(() => billing.addProjectItem({ projectId: project, kind: "service", description: "Restoration labor", qty: 1, unitPrice: 80000 }))).ok
        && (await as(() => billing.addProjectItem({ projectId: project, kind: "part", description: "Renner hammers", qty: 1, unitPrice: 20000 }))).ok, true);
      check("quotedCents recalculated", (await one("SELECT quoted_cents FROM projects WHERE id=$1", [project])).quoted_cents, 10000000);
      check("progress deposit ok", (await as(() => billing.recordProjectPayment({ projectId: project, amount: 40000, kind: "deposit", walletId: acc("wallet_bank") }))).ok, true);
      M.bank += 4000000; M.deposits += 4000000;
      const cost = await as(() => billing.addProjectCost({ projectId: project, category: "materials", description: "Felt bulk order", amount: 8000 }));
      check("unpaid cost ok", cost.ok, true);
      M.materials += 800000; M.ap += 800000;
      const costId = (await one("SELECT id FROM project_costs WHERE description='Felt bulk order'")).id;
      check("settle cost ok", (await as(() => billing.payProjectCost(costId, acc("wallet_bank")))).ok, true);
      M.ap -= 800000; M.bank -= 800000;
      check("finalize billing", (await as(() => billing.finalizeProjectBilling({ projectId: project, taxRateBps: 1200 }))).ok, true);
      M.deposits -= 4000000; M.ar += 7200000; M.project_revenue += 10000000; M.vat += 1200000;
      const proj = await one("SELECT billed_cents, tax_rate_bps, billing_finalized_at IS NOT NULL AS fin FROM projects WHERE id=$1", [project]);
      check("billed snapshot stored", { b: proj.billed_cents, t: proj.tax_rate_bps, f: proj.fin }, { b: 10000000, t: 1200, f: true });
      check("quote edits blocked after finalize", (await as(() => billing.addProjectItem({ projectId: project, description: "Late line", unitPrice: 1 }))).ok, false);
      const finalPay = await as(() => billing.recordProjectPayment({ projectId: project, amount: 72000, kind: "final", walletId: acc("wallet_bank") }));
      check("post-finalize payment credits AR", finalPay.ok, true);
      M.bank += 7200000; M.ar -= 7200000;
      const payRow = await one("SELECT id FROM project_payments WHERE kind='final'");
      check("void final payment", (await as(() => billing.voidProjectPayment(payRow.id, "bounced cheque"))).ok, true);
      M.bank -= 7200000; M.ar += 7200000;
      await checkMirror("project billing");
    }

    /* ============================================================
     * 5. Piano sales
     * ============================================================ */
    console.log("piano sales");
    {
      await as(() => billing.reservePiano({ pianoId: pianoA, price: 500000, buyerName: "Maria Santos" }));
      const saleId = (await one("SELECT id FROM piano_sales WHERE piano_id=$1", [pianoA])).id;
      check("reserve ok", !!saleId, true);
      check("piano marked reserved", (await one("SELECT status FROM pianos WHERE id=$1", [pianoA])).status, "reserved");
      check("deposit ok", (await as(() => billing.recordPianoPayment({ saleId, amount: 50000, walletId: acc("wallet_gcash") }))).ok, true);
      M.gcash += 5000000; M.deposits += 5000000;
      check("prep cost ok", (await as(() => billing.addPianoCost({ pianoId: pianoA, kind: "prep", description: "Rebuild + polishing", amount: 20000, walletId: acc("wallet_bank") }))).ok, true);
      M.on_hand += 2000000; M.bank -= 2000000;
      check("complete sale", (await as(() => billing.completePianoSale({ saleId }))).ok, true);
      M.on_hand += 35000000; M.opening += 35000000; // legacy carrying cost via opening equity
      M.deposits -= 5000000; M.ar += 45000000; M.piano_revenue += 44642857; M.vat += 5357143;
      M.cogs += 37000000; M.on_hand -= 37000000;
      const row = await one("SELECT s.status, s.price_cents, s.cost_snapshot_cents, p.status AS piano_status FROM piano_sales s JOIN pianos p ON p.id = s.piano_id WHERE s.id=$1", [saleId]);
      check("sale completed + snapshots frozen + piano sold", row, { status: "completed", price_cents: 50000000, cost_snapshot_cents: 37000000, piano_status: "sold" });
      check("cost edits blocked after completion", (await as(() => billing.addPianoCost({ pianoId: pianoA, description: "too late", amount: 1 }))).ok, false);
      check("re-reserving a sold piano blocked", (await as(() => billing.reservePiano({ pianoId: pianoA, price: 1 }))).ok, false);
      check("balance payment credits AR", (await as(() => billing.recordPianoPayment({ saleId, amount: 450000, walletId: acc("wallet_bank") }))).ok, true);
      M.bank += 45000000; M.ar -= 45000000;

      // cancel flow: partial refund + forfeited deposit released to other income
      await as(() => billing.reservePiano({ pianoId: pianoB, price: 300000, buyerName: "Backup Buyer" }));
      const saleBId = (await one("SELECT id FROM piano_sales WHERE piano_id=$1", [pianoB])).id;
      check("reserve B ok", !!saleBId, true);
      check("deposit B ok", (await as(() => billing.recordPianoPayment({ saleId: saleBId, amount: 10000, walletId: acc("wallet_cash") }))).ok, true);
      M.cash += 1000000; M.deposits += 1000000;
      check("cancel with refund ok", (await as(() => billing.cancelPianoSale({ saleId: saleBId, refund: 6000, walletId: acc("wallet_cash"), reason: "Buyer backed out" }))).ok, true);
      M.deposits -= 600000; M.cash -= 600000; // refund leaves the wallet
      M.deposits -= 400000; M.other_income += 400000; // forfeited deposit is income, never an orphaned liability
      check("deposits held nets to zero after cancel", await bal(acc("deposits_held")), 0);
      check("piano B back to available", (await one("SELECT status FROM pianos WHERE id=$1", [pianoB])).status, "available");
      const reReserve = await as(() => billing.reservePiano({ pianoId: pianoB, price: 280000 }));
      check("cancelled sale row is reused", reReserve.ok, true);
      check("cancel again (no money held)", (await as(() => billing.cancelPianoSale({ saleId: saleBId, refund: 0, reason: "Changed mind" }))).ok, true);
      await checkMirror("piano sales");
    }

    /* ============================================================
     * 6. Reconciliation
     * ============================================================ */
    console.log("reconciliation");
    {
      const gcash = acc("wallet_gcash");
      const book = await bal(gcash); // 7,000,000
      const rec = await as(() => accounting.startReconciliation({ accountId: gcash, statementDate: manilaLocal(new Date(Date.now() + 60000)), statementEnding: book / 100 }));
      check("start recon ok", rec.ok, true);
      let detail = await as(() => data.getAccountDetail(gcash));
      check("recon opens with everything uncleared (statement − cleared)", detail.recon.differenceCents, book);
      for (const line of detail.recon.lines) {
        const r = await as(() => accounting.setLineCleared(line.lineId, true));
        if (!r.ok) throw new Error(`clear failed: ${r.error}`);
      }
      detail = await as(() => data.getAccountDetail(gcash));
      check("clearing all lines zeroes the difference", detail.recon.differenceCents, 0);
      check("complete recon ok", (await as(() => accounting.completeReconciliation(rec.data.id))).ok, true);
      check("recon history completed", (await one("SELECT status, difference_cents FROM acc_reconciliations WHERE id=$1", [rec.data.id])), { status: "completed", difference_cents: 0 });
      check("cleared lines recorded", (await one("SELECT count(*)::int AS n FROM acc_journal_lines WHERE reconciliation_id=$1", [rec.data.id])).n > 0, true);

      // close-with-difference path requires a note ≥ 10 chars
      const bank = acc("wallet_bank");
      const bankBook = await bal(bank);
      const rec2 = await as(() => accounting.startReconciliation({ accountId: bank, statementDate: manilaLocal(new Date(Date.now() + 60000)), statementEnding: (bankBook - 500) / 100 }));
      check("start bank recon ok", rec2.ok, true);
      const d2 = await as(() => data.getAccountDetail(bank));
      for (const line of d2.recon.lines) await as(() => accounting.setLineCleared(line.lineId, true));
      check("short note rejected", (await as(() => accounting.completeReconciliation(rec2.data.id, "short"))).ok, false);
      check("difference closes with a real note", (await as(() => accounting.completeReconciliation(rec2.data.id, "Bank fee not booked yet"))).ok, true);
      check("difference snapshotted", (await one("SELECT difference_cents FROM acc_reconciliations WHERE id=$1", [rec2.data.id])).difference_cents, -500);
      // a second open recon on the same wallet is blocked; cancelling frees it again
      const rec3 = await as(() => accounting.startReconciliation({ accountId: bank, statementDate: manilaLocal(new Date()), statementEnding: 0 }));
      check("fresh recon after completing the last", rec3.ok, true);
      check("a second open recon is blocked", (await as(() => accounting.startReconciliation({ accountId: bank, statementDate: manilaLocal(new Date()), statementEnding: 0 }))).ok, false);
      check("cancel recon ok", (await as(() => accounting.cancelReconciliation(rec3.data.id))).ok, true);
      check("recon can start again after cancel", (await as(() => accounting.startReconciliation({ accountId: bank, statementDate: manilaLocal(new Date()), statementEnding: 0 }))).ok, true);
      const rec4 = await one("SELECT id FROM acc_reconciliations WHERE status='open' AND account_id=$1", [bank]);
      await as(() => accounting.cancelReconciliation(rec4.id)); // leave no open recon behind
    }

    /* ============================================================
     * 7. Period locks
     * ============================================================ */
    console.log("period locks");
    {
      const d = manilaNow();
      const key = monthKey(d);
      const [y, m] = key.split("-").map(Number);
      // payment dated now, synced while the month is locked → exception, not a post
      await q("INSERT INTO service_payments (invoice_id,amount_cents,method,received_at) VALUES ($1,100000,'cash',now())", [inv1]);
      await q("UPDATE service_invoices SET amount_paid_cents = 800000 WHERE id = $1", [inv1]);
      const lock = await as(() => accounting.lockPeriod(y, m, "BIR filing"));
      check("lock ok", lock.ok, true);
      const drawBlocked = await as(() => accounting.recordOwnerDraw({ amount: 5000, walletId: acc("wallet_bank") }));
      check("writes inside a locked month are refused", drawBlocked.ok, false);
      check("…with a friendly message", /lock/i.test(drawBlocked.error ?? ""), true);
      const syncLocked = await as(() => accounting.syncNow());
      check("bridge files an exception instead of posting", syncLocked.data, { posted: 0, voided: 0, exceptions: 1 });
      check("exception row exists", (await one("SELECT count(*)::int AS n FROM acc_exceptions WHERE status='open'")).n, 2);
      const lockRow = await one("SELECT id FROM acc_period_locks");
      check("unlock ok", (await as(() => accounting.unlockPeriod(lockRow.id))).ok, true);
      const syncAfter = await as(() => accounting.syncNow());
      check("payment posts after unlock", syncAfter.data, { posted: 1, voided: 0, exceptions: 0 });
      M.cash += 100000; M.ar -= 100000;
      const draw = await as(() => accounting.recordOwnerDraw({ amount: 5000, walletId: acc("wallet_bank") }));
      check("draw works after unlock", draw.ok, true);
      M.draws -= 500000; M.bank -= 500000;
      await checkMirror("period locks");

      // backdated write into a different locked month
      const past = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 15));
      const pastLock = await as(() => accounting.lockPeriod(past.getUTCFullYear(), past.getUTCMonth() + 1));
      check("past month locked", pastLock.ok, true);
      check("backdated draw refused", (await as(() => accounting.recordOwnerDraw({ amount: 100, walletId: acc("wallet_bank"), date: past.toISOString().slice(0, 10) }))).ok, false);
      const pastRow = await one("SELECT id FROM acc_period_locks");
      await as(() => accounting.unlockPeriod(pastRow.id));
    }

    /* ============================================================
     * 8. Journal integrity invariants
     * ============================================================ */
    console.log("journal integrity");
    {
      check("every entry balances", (await one("SELECT count(*)::int AS n FROM (SELECT journal_id FROM acc_journal_lines GROUP BY journal_id HAVING sum(debit_cents) <> sum(credit_cents)) x")).n, 0);
      const orphans = await one("SELECT count(*)::int AS n FROM acc_journal j WHERE j.voided_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM acc_journal r WHERE r.reversal_of_id = j.id)");
      check("every voided entry has a reversal", orphans.n, 0);
      check("audit log written", (await one("SELECT count(*)::int AS n FROM audit_log")).n > 20, true);
    }

    /* ============================================================
     * 9. Read layer vs the mirror
     * ============================================================ */
    console.log("read layer");
    {
      const overview = await as(() => data.getOverview(user));
      const wallet = (name) => overview.wallets.find((w) => w.name === name);
      check("overview: Cash", wallet("Cash")?.balanceCents, M.cash);
      check("overview: Bank", wallet("Bank")?.balanceCents, M.bank);
      check("overview: GCash", wallet("GCash")?.balanceCents, M.gcash);
      check("overview: total cash", overview.totalCashCents, M.cash + M.bank + M.gcash);
      const retained = M.service_revenue + M.project_revenue + M.piano_revenue + M.other_income
        - (M.fuel + M.utilities + M.wages + M.interest + M.materials + M.cogs);
      check("overview: equity breakdown", {
        opening: overview.equity.openingCents, capital: overview.equity.capitalCents,
        retained: overview.equity.retainedProfitCents, draws: overview.equity.drawsCents,
        personal: overview.equity.personalCents, total: overview.equity.totalCents,
      }, {
        opening: M.opening, capital: M.capital, retained, draws: -M.draws,
        personal: -M.personal, total: M.opening + M.capital + retained + M.draws + M.personal,
      });
      const safeParts = overview.safeToWithdraw.parts.reduce((s, p) => s + p.cents, 0);
      check("safe-to-withdraw parts sum to the deduction", safeParts, -M.draws - M.personal + M.vat);
      check("safe-to-withdraw amount", overview.safeToWithdraw.amountCents, retained + M.draws + M.personal - M.vat);

      const reports = await as(() => data.getReports(user, 12));
      check("balance sheet balances", reports.balanceSheet.balanced, true);
      check("VAT payable", reports.vatPayableCents, M.vat);
      check("payroll register", reports.payrollRegister, [{ month: monthKey(d = manilaNow()), worker: "Test A", paidCents: 35000 }]);
      const projRow = reports.projectProfit.find((r) => r.projectId === project);
      check("project profitability", { c: projRow.contractCents, p: projRow.paidCents, rev: projRow.revenueCents, cost: projRow.costsCents, f: projRow.finalized },
        { c: 11200000, p: 4000000, rev: 10000000, cost: 800000, f: true });
      const saleRow = reports.salesRegister.find((r) => r.label.includes("U3"));
      check("sales register: frozen snapshot + margin", {
        price: saleRow.priceCents, tax: saleRow.taxCents, net: saleRow.netRevenueCents,
        cost: saleRow.costCents, paid: saleRow.paidCents, balance: saleRow.balanceCents,
      }, { price: 50000000, tax: 5357143, net: 44642857, cost: 37000000, paid: 50000000, balance: 0 });
      const pnlAcct = (name) => reports.pnlByAccount.find((a) => a.name === name)?.amountCents ?? 0;
      check("P&L by account: piano COGS", pnlAcct("Piano Cost of Sales"), 37000000);
      check("P&L by account: wages", pnlAcct("Payroll Wages"), 35000);

      const receivables = await as(() => data.getReceivables());
      const invRow = receivables.service.rows.find((r) => r.invoiceId === inv1);
      check("service receivable", { bal: invRow.balanceCents, paid: invRow.paidCents, name: invRow.customerName }, { bal: 320000, paid: 800000, name: "Juan Dela Cruz" });
      const projAr = receivables.projects.find((r) => r.projectId === project);
      check("project receivable", projAr.balanceCents, 7200000);
      const pb = await as(() => data.getProjectBilling(project));
      check("project billing bundle", {
        quote: pb.quotedCents, contract: pb.contractCents, paid: pb.paidCents, balance: pb.balanceCents,
        labor: pb.laborTotalCents, items: pb.items.length, costs: pb.costs.length,
        finalized: pb.billingFinalizedAt !== null, wallets: pb.wallets.length,
      }, {
        quote: 10000000, contract: 11200000, paid: 4000000, balance: 7200000,
        labor: 0, items: 2, costs: 1, finalized: true, wallets: 4,
      });
      check("deposits held cleared", receivables.depositsTotalCents, 0);

      const ownerMoney = await as(() => data.getOwnerMoney(user));
      check("owner history", ownerMoney.history.length >= 3, true);
      check("owner total cash", ownerMoney.totalCashCents, M.cash + M.bank + M.gcash);

      const feed = await as(() => data.getJournalPage({ q: "Meralco" }));
      check("journal search", feed.items.length, 1);
      check("journal entry carries legs", feed.items[0].legs.length, 2);
      const monthFeed = await as(() => data.getJournalPage({ monthKey: monthKey(manilaNow()) }));
      check("month filter returns the month's entries", monthFeed.items.every((i) => i.occurredAt.slice(0, 7) === monthKey(manilaNow())), true);
      const detail = await as(() => data.getAccountDetail(acc("wallet_bank")));
      check("account detail running balance", detail.lines[0].runningBalanceCents, detail.balanceCents);
    }

    /* ============================================================
     * 10. Settings / wallet / category CRUD + exception resolution
     * ============================================================ */
    console.log("settings & CRUD");
    {
      let settings = await as(() => data.getAccountingSettings(user.id));
      check("method map persisted", settings.settings.methodMap.check, acc("wallet_bank"));
      check("two open exceptions listed", settings.exceptions.filter((x) => x.status === "open").length, 2);
      for (const x of settings.exceptions) await as(() => accounting.resolveException(x.id));
      settings = await as(() => data.getAccountingSettings(user.id));
      check("all exceptions resolved", settings.exceptions.filter((x) => x.status === "open").length, 0);

      const bpi = await as(() => accounting.createWallet({ name: "BPI Checking", walletKind: "bank", openingBalance: 5000 }));
      check("wallet created with opening", bpi.ok, true);
      await loadAccounts(); // pick up the new wallet + the opening-equity offset
      check("new wallet balance = opening", await bal(bpi.data.id), 500000);
      check("opening mirrored into Opening Equity (books stay balanced)", await bal(acc("opening_equity")), M.opening + 500000);
      check("rename wallet", (await as(() => accounting.renameAccount(bpi.data.id, "BPI Savings"))).ok, true);
      check("deactivate blocked while mapped", (await as(() => accounting.updateWallet({ id: acc("wallet_bank"), active: false }))).ok, false);
      check("deactivate free wallet ok", (await as(() => accounting.updateWallet({ id: bpi.data.id, active: false }))).ok, true);
      check("reactivate ok", (await as(() => accounting.updateWallet({ id: bpi.data.id, active: true }))).ok, true);
      const cat = await as(() => accounting.createExpenseCategory("Franchise fees"));
      check("custom expense category", cat.ok, true);
      check("category usable", (await as(() => accounting.recordBusinessExpense({ amount: 100, categoryId: cat.data.id, walletId: acc("wallet_cash"), description: "City hall" }))).ok, true);
      M.cash -= 10000; // ₱100 expense — keeps the mirror honest for the final balance check

      const reports = await as(() => data.getReports(user, 12));
      check("balance sheet still balances after openings", reports.balanceSheet.balanced, true);
      const accountsPage = await as(() => data.getAccountsPage());
      check("accounts page lists the new wallet", accountsPage.accounts.some((a) => a.name === "BPI Savings"), true);
    }

    console.log(`\nAll ${checks} accounting flow checks passed.`);
  } finally {
    if (process.env.ACC_FLOW_KEEP === "1") {
      console.log(`(schema kept for inspection: ${namespace})`);
    } else {
      await setup.query(`DROP SCHEMA "${namespace}" CASCADE`);
    }
    await setup.end();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
