/** Customers list row summary. No database. Run: npx tsx tests/service-customer-list.ts */
import { customerRowSummary, rowArea, nextDue, telHref, dueLabel, dueState, dueSortKey } from "../src/lib/service-customer-list";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const now = new Date("2026-10-05T00:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

console.log("area");
check("area wins over city", rowArea([{ area: "Buhangin", city: "Davao" }]), "Buhangin");
check("falls back to city, skipping blanks", rowArea([{ area: " ", city: null }, { area: null, city: "General Santos" }]), "General Santos");
check("no location -> null", rowArea([]), null);

console.log("\nnext due");
check("earliest due across pianos", nextDue([{ nextServiceDueAt: days(40) }, { nextServiceDueAt: days(-3) }, { nextServiceDueAt: null }])?.getTime(), days(-3).getTime());
check("no dates -> null", nextDue([{ nextServiceDueAt: null }, {}]), null);
check("ISO strings work (props from the server)", nextDue([{ nextServiceDueAt: days(5).toISOString() }])?.getTime(), days(5).getTime());

console.log("\nstate + label");
check("overdue", [dueState(-1), dueLabel({ daysUntilDue: -20, dueState: "overdue" })], ["overdue", "20d overdue"]);
check("due today is soon, says so", [dueState(0), dueLabel({ daysUntilDue: 0, dueState: "soon" })], ["soon", "Due today"]);
check("14 days is soon, 15 is later", [dueState(14), dueState(15)], ["soon", "later"]);
check("later shows no urgency text (the date is enough)", dueLabel({ daysUntilDue: 90, dueState: "later" }), "");
check("none", [dueState(null), dueLabel({ daysUntilDue: null, dueState: "none" })], ["none", "—"]);

console.log("\nsummary");
const s = customerRowSummary({ locations: [{ city: "Davao City" }], pianos: [{ nextServiceDueAt: days(-20) }] }, now);
check("summary combines area, days and state", [s.area, s.daysUntilDue, s.dueState], ["Davao City", -20, "overdue"]);
check("a customer with nothing set up", customerRowSummary({ locations: [], pianos: [] }, now), { area: null, nextDueAt: null, daysUntilDue: null, dueState: "none" });
check("due soonest sorts no-date customers last", [dueSortKey({ nextDueAt: null }) > dueSortKey({ nextDueAt: days(500) })], [true]);

console.log("\ntel link");
check("formats dialable numbers", [telHref("0922 875-1773"), telHref("+63 917 692 4983")], ["tel:09228751773", "tel:+639176924983"]);
check("junk / empty -> no link", [telHref(null), telHref(""), telHref("n/a"), telHref("12")], [null, null, null, null]);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall customer-list checks passed");
