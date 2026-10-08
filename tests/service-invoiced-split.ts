/** "Invoiced this month" split (service vs piano sales, like-for-like days). No database. Run: npx tsx tests/service-invoiced-split.ts */
import { deltaOf, invoicedByKind, isInvoiceKind, likeForLikeRange, periodDelta } from "../src/lib/service-dashboard";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const iso = (d: Date) => d.toISOString();
// Manila local time -> instant
const manila = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h) - 8 * 3_600_000);

console.log("like-for-like range");
const r = likeForLikeRange(manila(2026, 10, 8, 15));
check("current from", iso(r.current.from), "2026-09-30T16:00:00.000Z");
check("current to = start of Oct 9 Manila", iso(r.current.to), "2026-10-08T16:00:00.000Z");
check("previous Sep 1-8", [iso(r.previous.from), iso(r.previous.to)], ["2026-08-31T16:00:00.000Z", "2026-09-08T16:00:00.000Z"]);
check("labels", [r.label, r.previousLabel], ["Oct 1–8", "Sep 1–8"]);
const m31 = likeForLikeRange(manila(2027, 3, 31));
check("Mar 31 2027 -> Feb 1-28", [m31.label, m31.previousLabel, iso(m31.previous.to)], ["Mar 1–31", "Feb 1–28", "2027-02-28T16:00:00.000Z"]);
check("Mar 31 2028 -> Feb 1-29 (leap)", likeForLikeRange(manila(2028, 3, 31)).previousLabel, "Feb 1–29");
const j31 = likeForLikeRange(manila(2027, 1, 31));
check("Jan 31 -> Dec 1-31", [j31.previousLabel, iso(j31.previous.from), iso(j31.previous.to)], ["Dec 1–31", "2026-11-30T16:00:00.000Z", "2026-12-31T16:00:00.000Z"]);
check("Manila day used near midnight (UTC still Oct 7)", likeForLikeRange(new Date("2026-10-07T16:30:00Z")).label, "Oct 1–8");
check("first of month", likeForLikeRange(manila(2026, 10, 1)).label, "Oct 1");

console.log("\nperiodDelta");
check("new", periodDelta(4550000, 0, "Sep 1–8"), { direction: "new", pct: null, text: "New" });
check("both zero is flat", periodDelta(0, 0, "Sep 1–8"), { direction: "flat", pct: 0, text: "Same as Sep 1–8" });
check("up", periodDelta(112, 100, "Sep 1–8"), { direction: "up", pct: 12, text: "Up 12% vs Sep 1–8" });
check("down", periodDelta(92, 100, "Sep 1–8"), { direction: "down", pct: 8, text: "Down 8% vs Sep 1–8" });
check("equal is flat", periodDelta(100, 100, "Sep 1–8").direction, "flat");
check("current 0, previous > 0 is down 100", periodDelta(0, 500, "Sep 1–8"), { direction: "down", pct: 100, text: "Down 100% vs Sep 1–8" });
check("no label stands alone", periodDelta(150, 100).text, "Up 50%");

console.log("\nkind validator");
check("accepts", [isInvoiceKind("service"), isInvoiceKind("sale")], [true, true]);
check("rejects others", ["Sale", "", "piano", "sales", null, undefined, 1].map(isInvoiceKind), [false, false, false, false, false, false, false]);

console.log("\ninvoiced by kind");
type Row = { totalCents: number; issueDate: string; sentAt: string | null; voidedAt: string | null; amountPaidCents: number; dueDate: null; status: string; kind: string };
const inv = (day: string, pesos: number, kind = "service", extra: Partial<Row> = {}): Row => {
  const at = new Date(`${day}T12:00:00+08:00`).toISOString();
  return { totalCents: pesos * 100, issueDate: at, sentAt: at, voidedAt: null, amountPaidCents: 0, dueDate: null, status: "sent", kind, ...extra };
};
const voided = (day: string, pesos: number, kind = "service") => inv(day, pesos, kind, { voidedAt: new Date(`${day}T13:00:00+08:00`).toISOString(), status: "void" });
const draft = (day: string, pesos: number) => inv(day, pesos, "service", { sentAt: null, status: "draft" });
const rows: Row[] = [
  inv("2026-09-26", 209000, "sale"), inv("2026-09-27", 240000, "sale"), inv("2026-09-27", 14000), inv("2026-09-28", 3500),
  inv("2026-10-05", 3500), inv("2026-10-05", 4000), inv("2026-10-05", 4000),
  inv("2026-10-06", 3000), inv("2026-10-06", 7000), inv("2026-10-06", 4500),
  inv("2026-10-07", 16500), inv("2026-10-08", 3000),
  voided("2026-09-26", 40000), voided("2026-09-28", 15000), voided("2026-09-30", 25000), voided("2026-10-08", 3000),
  draft("2026-10-04", 9999), draft("2026-09-04", 8888),
];
const oct = invoicedByKind(rows, manila(2026, 10, 8, 15));
check("Oct 8: service 45,500", oct.service.currentCents, 4_550_000);
check("Oct 8: service vs Sep 1-8 is New", oct.service.delta, { direction: "new", pct: null, text: "New" });
check("Oct 8: sales 0 and flat", [oct.sales.currentCents, oct.sales.delta.direction], [0, "flat"]);
check("Oct 8: total + labels", [oct.totalCents, oct.previousTotalCents, oct.rangeLabel, oct.previousLabel], [4_550_000, 0, "Oct 1–8", "Sep 1–8"]);
const sep = invoicedByKind(rows, manila(2026, 9, 30, 10));
check("Sep 30: service 17,500", sep.service.currentCents, 1_750_000);
check("Sep 30: sales 449,000", sep.sales.currentCents, 44_900_000);
check("Sep 30: previous (Aug 1-30) is zero", [sep.service.previousCents, sep.sales.previousCents, sep.previousLabel], [0, 0, "Aug 1–30"]);
const mid = invoicedByKind([inv("2026-10-07", 100, "service", { issueDate: "2026-10-07T16:30:00Z" })], manila(2026, 10, 8, 15));
check("issued 2026-10-07T16:30Z is Oct 8 in Manila", mid.service.currentCents, 10_000);
const outside = invoicedByKind([inv("2026-10-09", 100)], manila(2026, 10, 8, 15));
check("later days not counted yet", outside.totalCents, 0);
const cmp = invoicedByKind([inv("2026-09-03", 1000, "sale"), inv("2026-09-20", 5000, "sale"), inv("2026-10-02", 1500, "sale")], manila(2026, 10, 8));
check("only same-day span is compared (Sep 20 ignored)", [cmp.sales.previousCents, cmp.sales.delta.text], [100_000, "Up 50% vs Sep 1–8"]);

console.log("\ndeltaOf unchanged");
check("none", deltaOf(100, 0), { direction: "none", pct: null, text: "Nothing to compare with last month" });
check("up", deltaOf(150, 100), { direction: "up", pct: 50, text: "Up 50% on last month" });
check("down", deltaOf(50, 100, "Sep"), { direction: "down", pct: 50, text: "Down 50% on Sep" });
check("flat", deltaOf(100, 100), { direction: "flat", pct: 0, text: "Same as last month" });

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall passed");
