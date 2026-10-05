/** Today command center helpers. No database. Run: npx tsx tests/service-today.ts */
import { manilaWeekBounds, isStaleQuote, daysSince, reminderText, groupByManilaDay, isAllClear, addManilaDays, DAY_MS } from "../src/lib/service-today";
import { startOfManilaDayUTC } from "../src/lib/dates";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const iso = (d: Date) => d.toISOString();

console.log("Manila week");
// Wed 2026-10-07 14:00 Manila = 06:00Z
const wed = new Date("2026-10-07T06:00:00Z");
check("week starts Monday 00:00 Manila", iso(manilaWeekBounds(wed).from), "2026-10-04T16:00:00.000Z");
check("week ends next Monday 00:00 Manila", iso(manilaWeekBounds(wed).to), "2026-10-11T16:00:00.000Z");
// Sunday 2026-10-11 23:30 Manila = 15:30Z still belongs to the week that started Mon Oct 5
check("Sunday night still in the same week", iso(manilaWeekBounds(new Date("2026-10-11T15:30:00Z")).from), "2026-10-04T16:00:00.000Z");
// Monday 00:10 Manila = Sunday 16:10Z starts a new week
check("Monday 00:10 Manila starts a new week", iso(manilaWeekBounds(new Date("2026-10-11T16:10:00Z")).from), "2026-10-11T16:00:00.000Z");
check("a Manila day is exactly 24h", addManilaDays(startOfManilaDayUTC(wed), 1).getTime() - startOfManilaDayUTC(wed).getTime(), DAY_MS);

console.log("\nstale quotes");
const now = new Date("2026-10-07T06:00:00Z");
check("sent 4 days ago -> stale", isStaleQuote(new Date("2026-10-03T06:00:00Z"), now), true);
check("sent 2 days ago -> not yet", isStaleQuote(new Date("2026-10-05T06:00:00Z"), now), false);
check("exactly 3 days is not over 3 days", isStaleQuote(new Date("2026-10-04T06:00:00Z"), now), false);
check("never sent -> not a follow-up", isStaleQuote(null, now), false);
check("days since", daysSince(new Date("2026-10-03T00:00:00Z"), now), 4);

console.log("\nreminder text");
const base = { customerName: "lourdes tan", code: "INV-2026-0007", balanceCents: 1_250_000, businessName: "Herrero Pianos" };
const overdue = reminderText({ ...base, dueDate: new Date("2026-09-30T00:00:00Z"), daysOverdue: 7 });
check("overdue wording + amount + code", [overdue.includes("Hi lourdes!"), overdue.includes("₱12,500"), overdue.includes("INV-2026-0007"), overdue.includes("was due on Sep 30")], [true, true, true, true]);
const upcoming = reminderText({ ...base, balanceCents: 123_456, dueDate: new Date("2026-10-20T00:00:00Z"), daysOverdue: 0 });
check("not overdue is softer and keeps centavos", [upcoming.includes("is due on Oct 20"), upcoming.includes("₱1,234.56"), upcoming.includes("was due")], [true, true, false]);
check("titles and organisations keep the full name", [
  reminderText({ ...base, customerName: "Sta. Cecilia Chapel", dueDate: null, daysOverdue: 1 }).startsWith("Hi Sta. Cecilia Chapel!"),
  reminderText({ ...base, customerName: "Fr. Santos", dueDate: null, daysOverdue: 1 }).startsWith("Hi Fr. Santos!"),
], [true, true]);
check("signed with the business", upcoming.endsWith("— Herrero Pianos"), true);

console.log("\nnext 7 days grouping");
const d0 = startOfManilaDayUTC(now);
const jobs = [
  { id: "c", at: new Date(d0.getTime() + 2 * DAY_MS + 3600_000) },
  { id: "a", at: new Date(d0.getTime() + 1 * DAY_MS + 1000) },
  { id: "b", at: new Date(d0.getTime() + 1 * DAY_MS + 7200_000) },
];
const groups = groupByManilaDay(jobs, (j) => j.at, d0);
check("grouped by day in order, empty days skipped", groups.map((g) => g.items.map((i) => i.id)), [["a", "b"], ["c"]]);

console.log("\nall clear");
check("clear only when every section is empty", [isAllClear({ now: 0, money: 0, next7: 0, followUps: 0 }), isAllClear({ now: 0, money: 0, next7: 2, followUps: 0 })], [true, false]);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall today checks passed");
