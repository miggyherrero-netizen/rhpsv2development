/** "Last service" for a customer. No database. Run: npx tsx tests/service-last-service.ts */
import { jobServedAt, lastServiceDate } from "../src/lib/service-last-service";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const d = (s: string) => new Date(s);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

console.log("one job");
check("completed job uses completedAt", iso(jobServedAt({ status: "completed", completedAt: d("2026-03-01") })), "2026-03-01");
check("billed job with no completedAt falls back to started, then scheduled", [
  iso(jobServedAt({ status: "invoiced", startedAt: d("2026-02-10"), scheduledStart: d("2026-02-09") })),
  iso(jobServedAt({ status: "paid", scheduledStart: d("2026-02-09") })),
  iso(jobServedAt({ status: "paid", invoicedAt: d("2026-02-12") })),
], ["2026-02-10", "2026-02-09", "2026-02-12"]);
check("open / cancelled jobs are not a service", [jobServedAt({ status: "scheduled", scheduledStart: d("2026-06-01") }), jobServedAt({ status: "cancelled", completedAt: d("2026-01-01") })], [null, null]);
check("a piano sale is not a service", jobServedAt({ status: "completed", jobType: "sale", completedAt: d("2026-03-01") }), null);
check("completed with no usable date -> null (never a bogus date)", jobServedAt({ status: "completed" }), null);
check("works with ISO strings (data passed to client components)", iso(jobServedAt({ status: "completed", completedAt: "2026-04-05T02:00:00.000Z" })), "2026-04-05");

console.log("\nper customer");
check("newest of jobs and pianos wins", iso(lastServiceDate(
  [{ status: "completed", completedAt: d("2026-03-01") }, { status: "invoiced", completedAt: d("2026-01-01") }],
  [{ lastServiceAt: d("2026-05-01") }, { lastServiceAt: null }],
)), "2026-05-01");
check("piano date alone is enough (work done before the app)", iso(lastServiceDate([], [{ lastServiceAt: d("2025-11-20") }])), "2025-11-20");
check("the screenshot case: one billed job, no completedAt", iso(lastServiceDate([{ status: "invoiced", scheduledStart: d("2026-02-09") }], [{ lastServiceAt: null }])), "2026-02-09");
check("nothing served yet -> null (shows —)", lastServiceDate([{ status: "lead" }], [{ lastServiceAt: null }]), null);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
