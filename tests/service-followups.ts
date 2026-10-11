/** The one follow-up queue: merge, group, dedupe, combined counts. No database. Run: npx tsx tests/service-followups.ts */
import { parseDayInput } from "../src/lib/service-reminders";
import {
  dueFollowUpCount, entryInQueue, entryOwnsRecall, softCount, type RecallEntry, filterFollowUps, followUpCounts, groupFollowUps, mergeFollowUps, untrackedRecalls, FOLLOW_UP_HORIZON_DAYS,
} from "../src/lib/service-followups";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// 2026-10-08 12:00 Manila
const now = new Date("2026-10-08T04:00:00Z");
const D = (s: string) => parseDayInput(s)!;
const rem = (id: string, day: string) => ({ id, dueAt: D(day), createdAt: new Date("2026-10-01T00:00:00Z") });
const ent = (id: string, status: string, at: string) => ({ id, status, nextFollowUpAt: new Date(at) });
const keys = (l: { key: string }[]) => l.map((i) => i.key);

console.log("merge: each kind alone, then both");
check("reminders only", keys(mergeFollowUps([rem("a", "2026-10-08")], [], now)), ["reminder:a"]);
check("waitlist only", keys(mergeFollowUps([], [ent("w", "waiting", "2026-10-08T01:00:00Z")], now)), ["waitlist:w"]);
const both = mergeFollowUps(
  [rem("r-today", "2026-10-08"), rem("r-over", "2026-10-05"), rem("r-up", "2026-10-12")],
  [ent("w-over", "messaged", "2026-10-06T03:00:00Z"), ent("w-today", "waiting", "2026-10-08T09:00:00Z"), ent("w-up", "waiting", "2026-10-10T03:00:00Z")],
  now,
);
check("both: one list in due-day order, reminders first on the same day", keys(both),
  ["reminder:r-over", "waitlist:w-over", "reminder:r-today", "waitlist:w-today", "waitlist:w-up", "reminder:r-up"]);
check("the same id twice is one row", keys(mergeFollowUps([rem("a", "2026-10-08"), rem("a", "2026-10-08")], [ent("w", "waiting", "2026-10-08T01:00:00Z"), ent("w", "waiting", "2026-10-08T01:00:00Z")], now)), ["reminder:a", "waitlist:w"]);
check("a reminder and an entry with the same id are different rows", keys(mergeFollowUps([rem("x", "2026-10-08")], [ent("x", "waiting", "2026-10-08T01:00:00Z")], now)), ["reminder:x", "waitlist:x"]);

console.log("\nManila day boundary");
// 2026-10-07T16:30Z = 00:30 on Oct 8 in Manila -> today; 2026-10-07T15:59Z = 23:59 on Oct 7 -> overdue
const edge = mergeFollowUps([], [ent("late", "waiting", "2026-10-07T16:30:00Z"), ent("before", "waiting", "2026-10-07T15:59:00Z"), ent("endOfDay", "waiting", "2026-10-08T15:59:00Z"), ent("tomorrow", "waiting", "2026-10-08T16:00:00Z")], now);
check("day starts and ends on Manila midnight", edge.map((i) => [i.key, i.dueAt.toISOString()]), [
  ["waitlist:before", "2026-10-06T16:00:00.000Z"], ["waitlist:late", "2026-10-07T16:00:00.000Z"], ["waitlist:endOfDay", "2026-10-07T16:00:00.000Z"], ["waitlist:tomorrow", "2026-10-08T16:00:00.000Z"],
]);
const g = groupFollowUps(edge, now);
check("waitlist entries are never overdue: past and today both land in waitlistNow (07T16:30Z is Oct 8 Manila)", [keys(g.overdue), keys(g.today), keys(g.waitlistNow), keys(g.upcoming)], [[], [], ["waitlist:before", "waitlist:late", "waitlist:endOfDay"], ["waitlist:tomorrow"]]);

console.log("\ngrouping");
const gb = groupFollowUps(both, now);
check("overdue/today are reminders only; waitlist due goes to waitlistNow; upcoming mixes both", [keys(gb.overdue), keys(gb.today), keys(gb.waitlistNow), keys(gb.upcoming)], [
  ["reminder:r-over"], ["reminder:r-today"], ["waitlist:w-over", "waitlist:w-today"], ["waitlist:w-up", "reminder:r-up"],
]);
check("no waitlist row in overdue or today", [...gb.overdue, ...gb.today].every((i) => i.kind === "reminder"), true);

console.log("\nwhich entries are in the queue");
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
check("waiting + messaged are in", [entryInQueue(ent("a", "waiting", at(0)), now), entryInQueue(ent("b", "messaged", at(-2)), now)], [true, true]);
check("done / scheduled / confirmed are never in", ["done", "scheduled", "confirmed"].map((s) => entryInQueue(ent("x", s, at(-1)), now)), [false, false, false]);
check("not_now is out while paused, in once its pause is over", [entryInQueue(ent("n", "not_now", at(20)), now), entryInQueue(ent("n", "not_now", at(0)), now), entryInQueue(ent("n", "not_now", at(-1)), now)], [false, true, true]);
check("beyond the horizon is out", [entryInQueue(ent("f", "waiting", at(FOLLOW_UP_HORIZON_DAYS)), now), entryInQueue(ent("f", "waiting", at(FOLLOW_UP_HORIZON_DAYS + 2)), now)], [true, false]);
check("excluded entries never reach the list", keys(mergeFollowUps([], [ent("d", "done", at(-1)), ent("s", "scheduled", at(-1)), ent("c", "confirmed", at(-1)), ent("n", "not_now", at(10))], now)), []);

console.log("\ncounts and filters");
const c = followUpCounts(both, now);
check("filter counts", [c.all, c.reminder, c.waitlist], [6, 3, 3]);
check("group counts (due total unchanged: 4)", [c.overdue, c.today, c.waitlistNow, c.upcoming, c.due], [1, 1, 2, 2, 4]);
check("group counts add up to All", c.overdue + c.today + c.waitlistNow + c.upcoming, c.all);
check("groups and counts agree", [gb.overdue.length, gb.today.length, gb.waitlistNow.length, gb.upcoming.length], [c.overdue, c.today, c.waitlistNow, c.upcoming]);
check("filters split the list", [keys(filterFollowUps(both, "reminder")).length, keys(filterFollowUps(both, "waitlist")).length, filterFollowUps(both, "all").length], [3, 3, 6]);
check("filter counts add up to All", c.reminder + c.waitlist, c.all);
const remindersList = [rem("r-today", "2026-10-08"), rem("r-over", "2026-10-05"), rem("r-up", "2026-10-12")];
const entriesList = [ent("w-over", "messaged", "2026-10-06T03:00:00Z"), ent("w-today", "waiting", "2026-10-08T09:00:00Z"), ent("w-up", "waiting", "2026-10-10T03:00:00Z"), ent("w-done", "done", "2026-10-01T00:00:00Z")];
check("badge count = the queue's overdue + today", dueFollowUpCount(remindersList, entriesList, now), followUpCounts(mergeFollowUps(remindersList, entriesList, now), now).due);
check("badge count value", dueFollowUpCount(remindersList, entriesList, now), 4);
check("empty queue", followUpCounts([], now), { all: 0, reminder: 0, waitlist: 0, overdue: 0, today: 0, waitlistNow: 0, upcoming: 0, due: 0 });

console.log("\nrecalls are counted once (entry owns the recall only if the queue shows it, or it is scheduled with a job)");
const rc = [{ pianoId: "p1" }, { pianoId: "p2" }];
const E = (o: Partial<RecallEntry>): RecallEntry => ({ status: "waiting", nextFollowUpAt: new Date(at(0)), serviceType: "tuning", pianoId: "p1", jobId: null, ...o });
const left = (e: RecallEntry[]) => untrackedRecalls(rc, e, now).map((r) => r.pianoId);
check("waiting in-queue entry suppresses (counted once)", left([E({})]), ["p2"]);
check("messaged in-queue entry suppresses", left([E({ status: "messaged", nextFollowUpAt: new Date(at(-2)) })]), ["p2"]);
check("confirmed entry keeps the recall visible", left([E({ status: "confirmed" })]), ["p1", "p2"]);
check("waiting beyond the 30-day horizon keeps it visible", left([E({ nextFollowUpAt: new Date(at(FOLLOW_UP_HORIZON_DAYS + 3)) })]), ["p1", "p2"]);
check("paused not_now keeps it visible", left([E({ status: "not_now", nextFollowUpAt: new Date(at(20)) })]), ["p1", "p2"]);
check("not_now whose pause is over (in the queue) suppresses", left([E({ status: "not_now", nextFollowUpAt: new Date(at(-1)) })]), ["p2"]);
check("scheduled WITH a job suppresses", left([E({ status: "scheduled", jobId: "j1" })]), ["p2"]);
check("scheduled with no job keeps it visible", left([E({ status: "scheduled" })]), ["p1", "p2"]);
check("done entry keeps it visible", left([E({ status: "done" })]), ["p1", "p2"]);
check("a different service type does not suppress", left([E({ serviceType: "repair" })]), ["p1", "p2"]);
check("an entry without a piano does not suppress", left([E({ pianoId: null })]), ["p1", "p2"]);
check("no entries: every recall stays", left([]), ["p1", "p2"]);
const waitlistDue = dueFollowUpCount([], [{ id: "w", status: "waiting", nextFollowUpAt: new Date(at(0)) }], now);
check("recall with an in-queue entry: 1 follow-up + 1 other recall, not 2 + 2", waitlistDue + left([E({})]).length, 2);
// Never in neither place: for every case a recall is either in the queue or still in the recall list.
const statuses = ["waiting", "messaged", "confirmed", "scheduled", "not_now", "done"];
const offsets = [-5, 0, 3, 20, 31, 45];
let divergent = 0, neither = 0;
for (const status of statuses) for (const d of offsets) for (const jobId of [null, "j"]) {
  const e = E({ status, nextFollowUpAt: new Date(at(d)), jobId });
  const owns = entryOwnsRecall(e, now), inQ = entryInQueue(e, now);
  if (owns && !(inQ || (status === "scheduled" && jobId))) divergent++;
  if (inQ && !owns) divergent++;
  if (!owns && left([e]).length !== 2) neither++;
}
check("entryOwnsRecall never diverges from entryInQueue (+ scheduled-with-job)", divergent, 0);
check("whenever the entry does not own the recall, the recall stays listed", neither, 0);

async function main() {
  console.log("\nbadge fails soft");
  const logged: unknown[][] = [];
  check("a throwing count returns 0 and logs", [await softCount(async () => { throw new Error("db down"); }, (...a) => logged.push(a)), logged.length], [0, 1]);
  check("a working count passes through", await softCount(async () => 7, () => {}), 7);
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log("\nAll follow-up queue checks passed.");
}
void main();
