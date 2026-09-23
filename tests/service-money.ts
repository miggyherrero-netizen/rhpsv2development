/**
 * Pure-domain checks for the Home Service workspace — money arithmetic, invoice status
 * derivation, AR aging, job margins, and Manila wall-clock parsing.
 *
 * Run with:  npx tsx tests/service-money.ts
 * No database required.
 */

import {
  computeTotals, invoiceStatus, balanceCents, agingSummary, agingBucket, daysOverdue,
  jobMargin, parseLocal, moneyToCents, elapsedMinutes, fmtMinutes, jobCode, invoiceCode,
} from "../src/lib/service";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

console.log("computeTotals");
{
  const t = computeTotals(
    [
      { qty: 1, unitPriceCents: 250_000, taxable: true },
      { qty: 2, unitPriceCents: 50_000, taxable: false },
      { qty: 1, unitPriceCents: -25_000, taxable: true },
    ],
    { taxRateBps: 1200 },
  );
  check("subtotal adds discount lines as negative", t.subtotalCents, 325_000);
  check("taxable base excludes exempt lines", t.taxableCents, 225_000);
  check("12% VAT on taxable base", t.taxCents, 27_000);
  check("total = subtotal + tax", t.totalCents, 352_000);
}
{
  const t = computeTotals([{ qty: 1, unitPriceCents: 100_000, taxable: true }], {
    discountCents: 20_000,
    taxRateBps: 1_200,
  });
  check("discount reduces the taxable base", t.taxCents, 9_600);
  check("discount reduces the total", t.totalCents, 89_600);
}

console.log("invoice status");
{
  const base = {
    status: "draft",
    totalCents: 100_000,
    amountPaidCents: 0,
    dueDate: new Date("2026-09-30T00:00:00Z"),
    sentAt: null,
    voidedAt: null,
  };
  const now = new Date("2026-09-23T00:00:00Z");
  check("unpaid and unsent is draft", invoiceStatus(base, now), "draft");
  check("sent but unpaid", invoiceStatus({ ...base, sentAt: now }, now), "sent");
  check("part payment", invoiceStatus({ ...base, sentAt: now, amountPaidCents: 40_000 }, now), "partial");
  check("full payment settles", invoiceStatus({ ...base, amountPaidCents: 100_000 }, now), "paid");
  check(
    "past due date and unpaid is overdue",
    invoiceStatus({ ...base, sentAt: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2026-09-10T00:00:00Z") }, now),
    "overdue",
  );
  check(
    "void wins over paid",
    invoiceStatus({ ...base, amountPaidCents: 100_000, voidedAt: now }, now),
    "void",
  );
  check("balance never goes negative", balanceCents({ ...base, amountPaidCents: 150_000 }), 0);
  check("days overdue counts from the due date", daysOverdue({ ...base, dueDate: new Date("2026-09-20T00:00:00Z") }, now), 3);
}

console.log("AR aging");
{
  const now = new Date("2026-09-23T00:00:00Z");
  const inv = (due: string | null, amount = 100_000) => ({
    status: "sent", totalCents: amount, amountPaidCents: 0,
    dueDate: due ? new Date(due) : null, sentAt: null, voidedAt: null,
  });
  const summary = agingSummary(
    [
      inv("2026-10-10T00:00:00Z"), // not yet due
      inv("2026-09-15T00:00:00Z"), // 8 days
      inv("2026-08-30T00:00:00Z"), // 24 days
      inv("2026-08-01T00:00:00Z"), // 53 days
      inv("2026-06-01T00:00:00Z"), // 114 days
      { ...inv("2026-01-01T00:00:00Z"), voidedAt: now }, // voided — excluded
      { ...inv("2026-01-01T00:00:00Z"), amountPaidCents: 100_000 }, // settled — excluded
    ],
    now,
  );
  check("current bucket", summary.buckets[0].amountCents, 100_000);
  check("1–30 bucket holds two invoices", summary.buckets[1].amountCents, 200_000);
  check("31–60 bucket", summary.buckets[2].amountCents, 100_000);
  check("61–90 bucket empty", summary.buckets[3].amountCents, 0);
  check("90+ bucket", summary.buckets[4].amountCents, 100_000);
  check("total outstanding excludes void and paid", summary.totalOutstandingCents, 500_000);
  check("overdue excludes the current bucket", summary.overdueCents, 400_000);
  check("bucket selection — 53 days lands in 31–60", agingBucket(inv("2026-08-01T00:00:00Z"), now), "31_60");
  check("bucket selection — 75 days lands in 61–90", agingBucket(inv("2026-07-10T00:00:00Z"), now), "61_90");
}

console.log("job margin");
{
  const m = jobMargin({
    laborCostCents: 120_000,
    partsCostCents: 45_000,
    expenseCents: 20_000,
    invoicedCents: 350_000,
  });
  check("cost sums labor, parts, expenses", m.costCents, 185_000);
  check("profit", m.profitCents, 165_000);
  check("margin percent", m.marginPct, 47);
  check(
    "unbilled job has zero margin, not -100%",
    jobMargin({ laborCostCents: 10_000, partsCostCents: 0, expenseCents: 0, invoicedCents: 0 }).marginPct,
    0,
  );
}

console.log("parsing and formatting");
{
  // Container runs in UTC; the business timezone is Asia/Manila (UTC+8, no DST).
  const parsed = parseLocal("2026-09-23T09:30");
  check("datetime-local string becomes 01:30Z (= 09:30 Manila)", parsed?.toISOString(), "2026-09-23T01:30:00.000Z");
  check("peso string → centavos", moneyToCents("1,250.50"), 125_050);
  check("numeric input → centavos", moneyToCents(300), 30_000);
  check("garbage input → zero", moneyToCents("abc"), 0);
  check("elapsed minutes", elapsedMinutes(new Date("2026-09-23T01:00:00Z"), new Date("2026-09-23T03:15:00Z")), 135);
  check("running timer measured against now", elapsedMinutes(new Date(Date.now() - 90 * 60_000)), 90);
  check("minutes format", fmtMinutes(135), "2h 15m");
  check("zero minutes format", fmtMinutes(0), "0m");
  check("job code", jobCode("WO", 12, new Date("2026-09-23T00:00:00Z")), "WO-2026-0012");
  check("invoice code", invoiceCode("INV", 3, new Date("2026-01-05T00:00:00Z")), "INV-2026-0003");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll home-service domain checks passed ✔");
