/** Jobs list grouping helpers. No database. Run: npx tsx tests/service-jobs-list.ts */
import { groupJobs, relativeDayLabel, quickFilterCounts } from "../src/lib/service-jobs-list";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// Thu 2026-10-08 10:00 Manila = 02:00Z
const now = new Date("2026-10-08T02:00:00Z");
const J = (id: string, status: string, start: string | null, createdAt = "2026-01-01T00:00:00Z") => ({ id, status, scheduledStart: start ? new Date(start) : null, createdAt: new Date(createdAt) });

const jobs = [
  J("earlier-new", "completed", "2026-10-02T02:00:00Z"),
  J("up-late", "scheduled", "2026-10-20T02:00:00Z"),
  J("today-pm", "scheduled", "2026-10-08T08:00:00Z"),
  J("lead", "lead", null, "2026-09-01T00:00:00Z"),
  J("closing-old", "scheduled", "2026-09-20T02:00:00Z"),
  J("up-soon", "quoted", "2026-10-09T02:00:00Z"),
  J("today-am", "in_progress", "2026-10-08T00:30:00Z"),
  J("closing-new", "in_progress", "2026-10-05T02:00:00Z"),
  J("earlier-old", "completed", "2026-08-15T02:00:00Z"),
  J("quote-null", "quoted", null, "2026-09-15T00:00:00Z"),
];

console.log("grouping order");
const g = groupJobs(jobs, now);
check("group order", g.map((x) => x.kind), ["closing", "today", "upcoming", "unscheduled", "earlier"]);
check("labels", g.map((x) => x.label), ["Needs closing", "Today", "Upcoming", "Unscheduled", "Earlier"]);
check("closing oldest first", g[0].items.map((i) => i.id), ["closing-old", "closing-new"]);
check("today by time", g[1].items.map((i) => i.id), ["today-am", "today-pm"]);
check("upcoming soonest first", g[2].items.map((i) => i.id), ["up-soon", "up-late"]);
check("unscheduled newest created first", g[3].items.map((i) => i.id), ["quote-null", "lead"]);
check("earlier newest first", g[4].items.map((i) => i.id), ["earlier-new", "earlier-old"]);
check("counts", g.map((x) => x.count), [2, 2, 2, 2, 2]);
check("empty groups omitted", groupJobs([J("a", "lead", null)], now).map((x) => x.kind), ["unscheduled"]);

console.log("\nManila boundary");
// 2026-10-07T16:30Z = Oct 8 00:30 Manila => Today on Oct 8
check("00:30 Manila is today", groupJobs([J("a", "scheduled", "2026-10-07T16:30:00Z")], now)[0].kind, "today");
// 2026-10-07T15:59Z = Oct 7 23:59 Manila => needs closing (still open, yesterday)
check("23:59 Manila previous day needs closing", groupJobs([J("a", "scheduled", "2026-10-07T15:59:00Z")], now)[0].kind, "closing");
check("completed yesterday is earlier", groupJobs([J("a", "completed", "2026-10-07T15:59:00Z")], now)[0].kind, "earlier");
// 2026-10-08T16:00Z = Oct 9 00:00 Manila => upcoming
check("next midnight Manila is upcoming", groupJobs([J("a", "scheduled", "2026-10-08T16:00:00Z")], now)[0].kind, "upcoming");

console.log("\nearlier split by month");
const many = Array.from({ length: 12 }, (_, i) => J(`e${i}`, "completed", i < 6 ? `2026-09-${10 + i}T02:00:00Z` : `2025-12-${10 + i}T02:00:00Z`));
const m = groupJobs(many, now);
check("month headings (year only when not current)", m.map((x) => x.label), ["Earlier · September", "Earlier · December 2025"]);
check("month counts", m.map((x) => x.count), [6, 6]);

console.log("\nrelative date labels");
check("today", relativeDayLabel("2026-10-08T05:00:00Z", now), "Today");
check("tomorrow", relativeDayLabel("2026-10-09T05:00:00Z", now), "Tomorrow");
check("yesterday", relativeDayLabel("2026-10-07T05:00:00Z", now), "Yesterday");
check("other day this year, no year", relativeDayLabel("2026-09-28T05:00:00Z", now), "Mon, Sep 28");
check("other year shows year", relativeDayLabel("2025-09-28T05:00:00Z", now), "Sun, Sep 28, 2025");
check("Manila midnight is next day", relativeDayLabel("2026-10-07T16:30:00Z", now), "Today");

console.log("\nquick counts");
check("counts ignore nothing but status", quickFilterCounts(jobs), { open: 8, scheduled: 3, completed: 2, all: 10 });

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall jobs-list checks passed");
