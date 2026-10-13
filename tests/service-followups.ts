/** The recall dedupe between Today's recalls and the waitlist (entryOwnsRecall). Reminders are separate. No database. Run: npx tsx tests/service-followups.ts */
import { entryOwnsRecall, softCount, type RecallEntry, untrackedRecalls } from "../src/lib/service-followups";
import { isFollowUpDue } from "../src/lib/service-waitlist";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// 2026-10-08 12:00 Manila
const now = new Date("2026-10-08T04:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

console.log("a recall is hidden from Today's recalls only when its entry is due now (on the follow-up panel) or booked");
const rc = [{ pianoId: "p1" }, { pianoId: "p2" }];
const E = (o: Partial<RecallEntry>): RecallEntry => ({ status: "waiting", nextFollowUpAt: new Date(at(0)), serviceType: "tuning", pianoId: "p1", jobId: null, ...o });
const left = (e: RecallEntry[]) => untrackedRecalls(rc, e, now).map((r) => r.pianoId);
check("waiting entry due today suppresses (it is on the Follow up today panel)", left([E({})]), ["p2"]);
check("messaged entry overdue suppresses", left([E({ status: "messaged", nextFollowUpAt: new Date(at(-2)) })]), ["p2"]);
check("waiting entry 3 days out does NOT suppress: the recall stays on Today", left([E({ nextFollowUpAt: new Date(at(3)) })]), ["p1", "p2"]);
check("waiting entry 20 days out does NOT suppress", left([E({ nextFollowUpAt: new Date(at(20)) })]), ["p1", "p2"]);
check("confirmed entry keeps the recall visible", left([E({ status: "confirmed" })]), ["p1", "p2"]);
check("paused not_now keeps it visible", left([E({ status: "not_now", nextFollowUpAt: new Date(at(20)) })]), ["p1", "p2"]);
check("not_now whose pause is over (due) suppresses", left([E({ status: "not_now", nextFollowUpAt: new Date(at(-1)) })]), ["p2"]);
check("scheduled WITH a job suppresses (even days out)", left([E({ status: "scheduled", jobId: "j1", nextFollowUpAt: new Date(at(9)) })]), ["p2"]);
check("scheduled with no job keeps it visible", left([E({ status: "scheduled" })]), ["p1", "p2"]);
check("done entry keeps it visible", left([E({ status: "done" })]), ["p1", "p2"]);
check("a different service type does not suppress", left([E({ serviceType: "repair" })]), ["p1", "p2"]);
check("an entry without a piano does not suppress", left([E({ pianoId: null })]), ["p1", "p2"]);
check("no entries: every recall stays", left([]), ["p1", "p2"]);

// For every case: the recall is on Today's recall list OR the entry is on Today's follow-up panel (isFollowUpDue) OR a job is booked.
const statuses = ["waiting", "messaged", "confirmed", "scheduled", "not_now", "done"];
const offsets = [-5, 0, 1, 3, 20, 31, 45];
let neither = 0, divergent = 0;
for (const status of statuses) for (const d of offsets) for (const jobId of [null, "j"]) {
  const e = E({ status, nextFollowUpAt: new Date(at(d)), jobId });
  const owns = entryOwnsRecall(e, now);
  const listed = left([e]).includes("p1");
  const onPanel = isFollowUpDue(e, now);
  const booked = status === "scheduled" && !!jobId;
  if (!listed && !(onPanel || booked)) neither++;
  if (owns !== (onPanel || booked)) divergent++;
}
check("a recall is never in neither place", neither, 0);
check("entryOwnsRecall = due on the panel or booked, nothing else", divergent, 0);

async function main() {
  console.log("\nbadge fails soft");
  const logged: unknown[][] = [];
  check("a throwing count returns 0 and logs", [await softCount(async () => { throw new Error("db down"); }, (...a) => logged.push(a)), logged.length], [0, 1]);
  check("a working count passes through", await softCount(async () => 7, () => {}), 7);
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log("\nAll recall dedupe checks passed.");
}
void main();
