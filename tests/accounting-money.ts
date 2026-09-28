/**
 * Pure-domain checks for the Owner Accounting engine — posting builders, balance
 * validation, VAT arithmetic, equity / safe-to-withdraw, reconciliation math, and
 * Manila month keys. Companion to tests/service-money.ts.
 *
 * Run with:  npx tsx tests/accounting-money.ts
 * No database required.
 */

import {
  billingLegs, completionLegs, equityStatement, isBalanced, lastMonthKeys, loanPaymentLegs,
  monthKeyManila, netFromInclusiveCents, reconMath, reversedLegs, safeToWithdraw,
  signedCents, accountBalanceCents, startOfManilaMonthUTC, twoLeg, vatExclusiveCents,
  vatInclusiveCents, jeCode, expenseAccountKey, SYSTEM_ACCOUNTS, DEFAULT_WALLETS,
  DEFAULT_EXPENSE_CATEGORIES, KIND_LABEL, KIND_STREAM, INCOME_KINDS,
} from "../src/lib/accounting";

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

console.log("VAT arithmetic");
{
  check("exclusive VAT: 12% on 6,850.00", vatExclusiveCents(685_000, 1200), 82_200);
  check("exclusive VAT: 0 bps", vatExclusiveCents(685_000, 0), 0);
  check("inclusive VAT: 12% inside 112,000.00 is 12,000.00", vatInclusiveCents(11_200_000, 1200), 1_200_000);
  check("inclusive VAT: 12% inside 100,000.00", vatInclusiveCents(10_000_000, 1200), 1_071_429);
  check("inclusive VAT rounds to centavo", vatInclusiveCents(999_999, 1200), 107_143);
  check("net from inclusive: 112,000 − VAT", netFromInclusiveCents(11_200_000, 1200), 10_000_000);
  check("net + vat = inclusive total", netFromInclusiveCents(999_999, 1200) + vatInclusiveCents(999_999, 1200), 999_999);
  check("inclusive VAT: 0 bps", vatInclusiveCents(500_000, 0), 0);
}

console.log("posting builders — balanced by construction");
{
  const two = twoLeg("A", "B", 50_000);
  check("twoLeg shape", two, [
    { accountId: "A", debitCents: 50_000, creditCents: 0, lineMemo: null },
    { accountId: "B", debitCents: 0, creditCents: 50_000, lineMemo: null },
  ]);
  check("twoLeg is balanced", isBalanced(two), true);

  const bill = billingLegs({ arId: "AR", revenueId: "REV", vatId: "VAT", totalCents: 112_000, revenueCents: 100_000, taxCents: 12_000 });
  check("billingLegs balanced (Dr AR = Cr revenue + Cr VAT)", isBalanced(bill), true);
  check("billingLegs debits AR the total", bill[0]!.debitCents, 112_000);

  const done = completionLegs({ depositsId: "DEP", arId: "AR", revenueId: "REV", vatId: "VAT", paidCents: 40_000, totalCents: 112_000, revenueCents: 100_000, taxCents: 12_000 });
  check("completionLegs balanced", isBalanced(done), true);
  check("completionLegs AR leg = total − paid", done[1]!.debitCents, 72_000);
  const overpaid = completionLegs({ depositsId: "DEP", arId: "AR", revenueId: "REV", vatId: "VAT", paidCents: 120_000, totalCents: 112_000, revenueCents: 100_000, taxCents: 12_000 });
  check("overpayment clamps AR at zero", overpaid[1]!.debitCents, 0);

  const loan = loanPaymentLegs({ loanId: "L", interestExpenseId: "I", walletId: "W", principalCents: 90_000, interestCents: 10_000 });
  check("loanPaymentLegs balanced (Dr loan + Dr interest = Cr wallet)", isBalanced(loan), true);

  check("reversedLegs swap sides", reversedLegs(two), [
    { accountId: "A", debitCents: 0, creditCents: 50_000, lineMemo: null },
    { accountId: "B", debitCents: 50_000, creditCents: 0, lineMemo: null },
  ]);
  check("a reversal of a balanced entry is balanced", isBalanced(reversedLegs(bill)), true);
}

console.log("balance validation rejects bad entries");
{
  check("single leg rejected", isBalanced([{
    accountId: "A", debitCents: 100, creditCents: 0,
  }]), false);
  check("unbalanced rejected", isBalanced([
    { accountId: "A", debitCents: 100, creditCents: 0 },
    { accountId: "B", debitCents: 0, creditCents: 90 },
  ]), false);
  check("both sides on one leg rejected", isBalanced([
    { accountId: "A", debitCents: 100, creditCents: 100 },
    { accountId: "B", debitCents: 0, creditCents: 0 },
  ]), false);
  check("zero-leg entry rejected", isBalanced([]), false);
  check("zero-amount balanced pair accepted (harmless)", isBalanced([
    { accountId: "A", debitCents: 0, creditCents: 0 },
    { accountId: "B", debitCents: 0, creditCents: 0 },
  ]), true);
}

console.log("account nature & balances");
{
  check("asset: debits increase", signedCents("asset", 500, 200), 300);
  check("expense: debits increase", signedCents("expense", 500, 200), 300);
  check("liability: credits increase", signedCents("liability", 500, 200), -300);
  check("equity: credits increase", signedCents("equity", 500, 900), 400);
  check("revenue: credits increase", signedCents("revenue", 0, 750), 750);
  check("wallet balance = opening + debits − credits", accountBalanceCents("asset", 10_000, 5_000, 3_000), 12_000);
  check("draws magnitude: debit−credit on equity", accountBalanceCents("equity", 0, 25_000, 5_000), -20_000);
}

console.log("equity statement & safe to withdraw");
{
  const eq = equityStatement({ openingCents: 100_000, capitalCents: 50_000, retainedProfitCents: 200_000, drawsCents: 80_000, personalCents: 20_000 });
  check("owner's equity = opening + capital + retained − draws − personal", eq.totalCents, 250_000);
  const safe = safeToWithdraw({
    retainedProfitCents: 200_000, drawsCents: 80_000, personalCents: 20_000,
    apCents: 10_000, vatPayableCents: 12_000, depositsHeldCents: 30_000, unpaidWagesCents: 8_000,
  });
  check("safe to withdraw subtracts every obligation", safe.amountCents, 40_000);
  check("deduction total", safe.deductionsCents, 160_000);
  check("can go negative (advisory only)", safeToWithdraw({
    retainedProfitCents: 10_000, drawsCents: 0, personalCents: 0, apCents: 0, vatPayableCents: 0,
    depositsHeldCents: 0, unpaidWagesCents: 25_000,
  }).amountCents, -15_000);
}

console.log("reconciliation math");
{
  // Cash wallet: opening 5,000. Cleared: +12,000 in (debit), −3,000 out (credit).
  const r = reconMath({
    type: "asset", openingCents: 500_000, statementEndingCents: 1_400_000,
    clearedDebitCents: 1_200_000, clearedCreditCents: 300_000,
    unclearedDebitCents: 200_000, unclearedCreditCents: 150_000,
  });
  check("cleared balance = opening + cleared debits − cleared credits", r.clearedBalanceCents, 1_400_000);
  check("difference = statement − cleared balance", r.differenceCents, 0);
  check("reconciled when difference is zero", r.reconciled, true);
  check("uncleared in = uncleared debits (asset)", r.unclearedInCents, 200_000);
  check("uncleared out = uncleared credits (asset)", r.unclearedOutCents, 150_000);

  const off = reconMath({
    type: "asset", openingCents: 500_000, statementEndingCents: 1_350_000,
    clearedDebitCents: 1_200_000, clearedCreditCents: 300_000,
    unclearedDebitCents: 0, unclearedCreditCents: 0,
  });
  check("bank fee shows as negative difference", off.differenceCents, -50_000);
  check("not reconciled with a difference", off.reconciled, false);

  const liab = reconMath({
    type: "liability", openingCents: 0, statementEndingCents: 0,
    clearedDebitCents: 100, clearedCreditCents: 300,
    unclearedDebitCents: 0, unclearedCreditCents: 0,
  });
  // Credit-natured: the balance is reported positive = amount owed (payments in reduce it).
  check("liability-natured math mirrors", liab.clearedBalanceCents, 200);
}

console.log("Manila month keys & codes");
{
  // Manila is UTC+8: Oct 1 00:30 Manila == Sep 30 16:30 UTC — the old to_char(UTC) bug.
  check("Manila 00:30 on the 1st belongs to that month", monthKeyManila(new Date("2026-09-30T16:30:00Z")), "2026-10");
  check("UTC midnight on the 1st is the same month", monthKeyManila(new Date("2026-10-01T00:00:00Z")), "2026-10");
  check("23:59 Manila on month end", monthKeyManila(new Date("2026-10-31T15:59:00Z")), "2026-10");
  check("Nov 1 00:00 Manila (+08)", monthKeyManila(new Date("2026-10-31T16:00:00Z")), "2026-11");
  check("month start instant is the 1st 00:00 Manila", startOfManilaMonthUTC(new Date("2026-09-28T02:00:00Z")).toISOString(), "2026-08-31T16:00:00.000Z");
  check("lastMonthKeys ends with current month", lastMonthKeys(new Date("2026-09-15T00:00:00Z"), 3), ["2026-07", "2026-08", "2026-09"]);
  // Year boundary + the setMonth overflow trap
  check("keys cross year boundaries correctly", lastMonthKeys(new Date("2026-02-10T00:00:00Z"), 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  check("13 months from January does not skip", lastMonthKeys(new Date("2026-01-10T00:00:00Z"), 13).slice(0, 3), ["2025-01", "2025-02", "2025-03"]);
  check("jeCode pads and uses the entry's own year", jeCode(7, new Date("2026-05-20T10:00:00Z")), "JE-2026-0007");
}

console.log("chart of accounts spec");
{
  const keys = SYSTEM_ACCOUNTS.map((a) => a.systemKey);
  check("every posting-rule system account exists", [
    "ar", "deposits_held", "owner_draws", "personal", "capital", "opening_equity",
    "vat_payable", "ap", "pianos_on_hand", "piano_cogs", "wages",
    "service_revenue", "project_revenue", "piano_revenue", "other_income", "unmapped",
  ].every((k) => keys.includes(k)), true);
  check("default wallets: no hardcoded bank names", DEFAULT_WALLETS.map((w) => w.name), ["Cash", "Bank", "GCash", "Maya"]);
  check("service expense categories map to acc accounts", expenseAccountKey("fuel"), "exp_fuel");
  check("unknown service category falls back to other", expenseAccountKey("nonsense"), "exp_other");
  check("interest category exists for loan payments", DEFAULT_EXPENSE_CATEGORIES.some((c) => c.expKey === "interest"), true);
}

console.log("kind metadata");
{
  check("draws stream to owner", KIND_STREAM.owner_draw, "owner");
  check("service billing streams to service", KIND_STREAM.service_billing, "service");
  check("every kind has a label", Object.keys(KIND_LABEL).length > 20, true);
  check("collections are income-direction kinds", INCOME_KINDS.has("service_collection"), true);
  check("draws are never income-direction", INCOME_KINDS.has("owner_draw"), false);
}

console.log(failures === 0 ? "\nAll accounting domain checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
