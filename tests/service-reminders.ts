/** Client follow-up reminders: dates, snooze, labels. No database. Run: npx tsx tests/service-reminders.ts */
import { presetDate, parseDayInput, toDayInput, isTodayOrLater, daysUntil, reminderState, isDueNow, snoozedTo, reminderLabel, sortByDue, cleanNote, NOTE_MAX, groupReminders } from "../src/lib/service-reminders";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
// 2026-10-05 17:30 UTC = 2026-10-06 01:30 Manila  (a "late night" case: Manila is already tomorrow)
const lateNight = new Date("2026-10-05T17:30:00Z");
const noon = new Date("2026-10-05T04:00:00Z"); // 12:00 Manila, Oct 5
const D = (s: string) => parseDayInput(s)!;

console.log("quick dates (Manila days)");
check("tomorrow at noon = Oct 6", toDayInput(presetDate("tomorrow", noon)), "2026-10-06");
check("next week = +7 days", toDayInput(presetDate("week", noon)), "2026-10-12");
check("late night uses the Manila date, not the server's (Oct 6 here -> tomorrow is Oct 7)", toDayInput(presetDate("tomorrow", lateNight)), "2026-10-07");
check("a preset is always midnight Manila", presetDate("3days", noon).toISOString(), "2026-10-07T16:00:00.000Z");

console.log("\ntyped dates");
check("valid date -> Manila midnight", D("2026-10-18").toISOString(), "2026-10-17T16:00:00.000Z");
check("round trip", toDayInput(D("2026-12-31")), "2026-12-31");
check("impossible / empty dates are rejected", [parseDayInput("2026-02-31"), parseDayInput(""), parseDayInput("10/18/2026"), parseDayInput(null)], [null, null, null, null]);
check("past days are refused, today is fine", [isTodayOrLater(D("2026-10-04"), noon), isTodayOrLater(D("2026-10-05"), noon), isTodayOrLater(D("2026-10-06"), noon)], [false, true, true]);

console.log("\nstate + label");
check("overdue / today / upcoming", [reminderState(D("2026-10-02"), noon), reminderState(D("2026-10-05"), noon), reminderState(D("2026-10-09"), noon)], ["overdue", "today", "upcoming"]);
check("days until", [daysUntil(D("2026-10-02"), noon), daysUntil(D("2026-10-05"), noon), daysUntil(D("2026-10-09"), noon)], [-3, 0, 4]);
check("due now = today or earlier", [isDueNow(D("2026-10-05"), noon), isDueNow(D("2026-10-06"), noon), isDueNow(D("2026-09-01"), noon)], [true, false, true]);
check("labels", [reminderLabel(D("2026-10-02"), noon), reminderLabel(D("2026-10-05"), noon), reminderLabel(D("2026-10-06"), noon), reminderLabel(D("2026-10-20"), noon)], ["3d overdue", "Today", "Tomorrow", null]);
check("a reminder due this Manila day is 'today' even late at night UTC", reminderState(D("2026-10-06"), lateNight), "today");

console.log("\nsnooze");
check("snooze counts from today, never from the old due date", toDayInput(snoozedTo(3, noon)), "2026-10-08");
check("snooze is at least 1 day", toDayInput(snoozedTo(0, noon)), "2026-10-06");

console.log("\nsorting + note");
const a = { id: "a", dueAt: D("2026-10-09") }, b = { id: "b", dueAt: D("2026-10-01") }, c = { id: "c", dueAt: D("2026-10-05") };
check("most overdue first", sortByDue([a, b, c]).map((x) => x.id), ["b", "c", "a"]);
check("note is trimmed, blank -> null, capped", [cleanNote("  call  "), cleanNote("   "), cleanNote(undefined), cleanNote("x".repeat(500))?.length], ["call", null, null, NOTE_MAX]);

console.log("\ngroups");
const g = groupReminders([a, b, c, { id: "d", dueAt: D("2026-10-06") }], noon);
check("overdue / today / upcoming, each in due order", [g.overdue.map((x) => x.id), g.today.map((x) => x.id), g.upcoming.map((x) => x.id)], [["b"], ["c"], ["d", "a"]]);
check("nothing -> three empty groups", groupReminders([], noon), { overdue: [], today: [], upcoming: [] });

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall reminder checks passed");
