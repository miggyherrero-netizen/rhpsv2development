/** Finance history pure logic — no database. Run: npx tsx tests/service-finance-history.ts */
import { diffFields, dropSameDay, describeChange, pesoExact, formatValue } from "../src/lib/service-finance-history";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

console.log("diffFields");
const before = { discountCents: 50_000, notes: null as string | null, dueDate: new Date("2026-10-01T00:00:00Z"), qty: 2, taxable: true };
check("only changed fields are returned", diffFields(before, { ...before, discountCents: 0 }, ["discountCents", "notes", "qty"]), { discountCents: { from: 50_000, to: 0 } });
check("no change gives an empty object", diffFields(before, { ...before }, ["discountCents", "dueDate", "taxable"]), {});
check("null, undefined and empty text count as the same", diffFields(before, { ...before, notes: "" }, ["notes"]), {});
check("equal dates are not a change", diffFields(before, { ...before, dueDate: new Date("2026-10-01T00:00:00Z") }, ["dueDate"]), {});
check("dates become ISO strings", diffFields(before, { ...before, dueDate: new Date("2026-10-05T00:00:00Z") }, ["dueDate"]), { dueDate: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" } });
check("booleans and text", diffFields(before, { ...before, taxable: false, notes: "x" }, ["taxable", "notes"]), { taxable: { from: true, to: false }, notes: { from: null, to: "x" } });
check("a missing before gives from = null", diffFields(null, { qty: 3 }, ["qty"]), { qty: { from: null, to: 3 } });
check("zero is a real value, not empty", diffFields({ n: 0 }, { n: null }, ["n"]), { n: { from: 0, to: null } });

check("same Manila day with a different time is dropped, a new day is kept", dropSameDay({
  issueDate: { from: "2026-10-07T10:39:12.000Z", to: "2026-10-07T10:39:00.000Z" }, dueDate: { from: "2026-10-07T10:00:00.000Z", to: "2026-10-09T10:00:00.000Z" }, notes: { from: null, to: "x" },
}, ["issueDate", "dueDate"]), { dueDate: { from: "2026-10-07T10:00:00.000Z", to: "2026-10-09T10:00:00.000Z" }, notes: { from: null, to: "x" } });

console.log("\nformatting");
check("pesoExact", [pesoExact(0), pesoExact(50_000), pesoExact(123_456), pesoExact(-5), pesoExact(100_000_000)], ["P0.00", "P500.00", "P1,234.56", "-P0.05", "P1,000,000.00"]);
check("tax rate in bps shows a percent", formatValue("taxRateBps", 1200), "12%");
check("ISO instants show the Manila day", formatValue("spentAt", "2026-10-06T17:00:00.000Z"), "2026-10-07");
check("empty and booleans", [formatValue("notes", null), formatValue("taxable", true)], ["empty", "yes"]);

console.log("\ndescribeChange");
check("discount example", describeChange("invoice", "update", "INV-2026-0018", { discountCents: { from: 50_000, to: 0 } }), "Invoice INV-2026-0018 discount changed from P500.00 to P0.00");
check("status", describeChange("invoice", "status", "INV-2026-0018", { status: { from: "draft", to: "sent" } }), "Invoice INV-2026-0018 status changed from draft to sent");
check("payment create / delete", [describeChange("payment", "create", "P1,000.00 on INV-1"), describeChange("payment", "delete", "P1,000.00 on INV-1")], ["Payment P1,000.00 on INV-1 recorded", "Payment P1,000.00 on INV-1 deleted"]);
check("expense create", describeChange("expense", "create", "\"Strings\""), "Expense \"Strings\" created");
check("several fields are joined, long lists are cut", describeChange("expense", "update", "\"A\"", {
  amountCents: { from: 100, to: 200 }, vendor: { from: null, to: "Z" }, method: { from: "cash", to: "gcash" }, category: { from: "a", to: "b" }, note: { from: null, to: "n" },
}), "Expense \"A\" amount changed from P1.00 to P2.00; vendor changed from empty to Z; method changed from cash to gcash; and 2 more");
check("receipt replaced reads naturally", describeChange("expense", "update", "\"A\"", { receiptReplaced: { from: false, to: true } }), "Expense \"A\" receipt photo replaced");
check("update with nothing", describeChange("expense", "update", "\"A\"", {}), "Expense \"A\" saved with no changes");

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall finance history checks passed");
