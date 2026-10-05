/** Status = time: derive travel / on-site entries from job status events. No database. Run: npx tsx tests/service-time-events.ts */
import { deriveSegments, planTimeSync, segmentMinutes, timeSourceLabel, type StatusEvent, type ExistingTimeLog } from "../src/lib/service-time-events";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);
const ev = (id: string, status: string | null, hhmm: string): StatusEvent => ({ id, status, at: t(hhmm) });
const brief = (s: ReturnType<typeof deriveSegments>) => s.map((x) => [x.kind, x.startedAt.toISOString().slice(11, 16), x.endedAt ? x.endedAt.toISOString().slice(11, 16) : null, segmentMinutes(x)]);

console.log("derive segments");
check("travel → arrived → complete gives a travel and an on-site entry",
  brief(deriveSegments([ev("1", "scheduled", "07:00"), ev("2", "en_route", "08:00"), ev("3", "in_progress", "08:40"), ev("4", "completed", "10:10")])),
  [["travel", "08:00", "08:40", 40], ["work", "08:40", "10:10", 90]]);
check("a job still on site has a running entry", brief(deriveSegments([ev("2", "en_route", "08:00"), ev("3", "in_progress", "08:40")])), [["travel", "08:00", "08:40", 40], ["work", "08:40", null, null]]);
check("hold ends the clock; resuming and arriving again starts a new on-site entry",
  brief(deriveSegments([ev("a", "in_progress", "09:00"), ev("b", "on_hold", "10:00"), ev("c", "scheduled", "13:00"), ev("d", "in_progress", "14:00"), ev("e", "completed", "15:30")])),
  [["work", "09:00", "10:00", 60], ["work", "14:00", "15:30", 90]]);
check("a double tap on the same status doesn't restart the clock", brief(deriveSegments([ev("a", "in_progress", "09:00"), ev("b", "in_progress", "09:01"), ev("c", "completed", "10:00")])), [["work", "09:00", "10:00", 60]]);
check("notes and other non-status events are ignored", brief(deriveSegments([ev("n", null, "08:30"), ev("a", "in_progress", "09:00"), ev("n2", null, "09:30"), ev("c", "completed", "10:00")])), [["work", "09:00", "10:00", 60]]);
check("events are read in time order even if stored out of order", brief(deriveSegments([ev("c", "completed", "10:00"), ev("a", "in_progress", "09:00")])), [["work", "09:00", "10:00", 60]]);
check("cancelling mid-travel closes the travel entry", brief(deriveSegments([ev("a", "en_route", "08:00"), ev("b", "cancelled", "08:20")])), [["travel", "08:00", "08:20", 20]]);
check("no status events -> no entries", deriveSegments([ev("n", null, "08:00")]), []);
check("each segment remembers the events that bound it", (() => { const s = deriveSegments([ev("a", "en_route", "08:00"), ev("b", "in_progress", "08:30")]); return [s[0]!.startEventId, s[0]!.endEventId, s[1]!.endEventId]; })(), ["a", "b", null]);

console.log("\nsync plan");
const segs = deriveSegments([ev("a", "en_route", "08:00"), ev("b", "in_progress", "08:40"), ev("c", "completed", "10:00")]);
check("first sync inserts both entries", planTimeSync(segs, []).inserts.map((s) => s.kind), ["travel", "work"]);
const stored = (over: Partial<ExistingTimeLog> & { startEventId: string | null }): ExistingTimeLog => ({ id: over.startEventId ?? "x", source: "event", startedAt: t("08:00"), endedAt: null, kind: "travel", ...over });
check("an entry that already matches is left alone", planTimeSync(segs.slice(0, 1), [stored({ startEventId: "a", endedAt: t("08:40") })]).updates, []);
check("an open entry is closed when the next status arrives", planTimeSync(segs.slice(0, 1), [stored({ startEventId: "a", endedAt: null })]).updates.map((u) => [u.id, u.minutes]), [["a", 40]]);
check("an entry the owner edited by hand is never overwritten", planTimeSync(segs.slice(0, 1), [stored({ startEventId: "a", source: "manual", endedAt: t("08:50") })]), { inserts: [], updates: [] });
check("manual entries with no event link don't block new derived ones", planTimeSync(segs, [stored({ startEventId: null, source: "manual", endedAt: t("09:00") })]).inserts.length, 2);
check("syncing twice changes nothing the second time", (() => {
  const first = planTimeSync(segs, []);
  const existing = first.inserts.map((s) => stored({ startEventId: s.startEventId, startedAt: s.startedAt, endedAt: s.endedAt, kind: s.kind }));
  const again = planTimeSync(segs, existing);
  return [again.inserts.length, again.updates.length];
})(), [0, 0]);

console.log("\nsource labels");
check("labels", [
  timeSourceLabel({ source: "event", startEventId: "a" }), timeSourceLabel({ source: "manual", startEventId: "a" }),
  timeSourceLabel({ source: "manual", startEventId: null }), timeSourceLabel({ source: "timer", startEventId: null }),
], ["From status", "Edited", "Manual", "Timer"]);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall status-time checks passed");
