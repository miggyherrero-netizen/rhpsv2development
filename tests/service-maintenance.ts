/** Maintenance policy (pure, Manila days). No database. Run: npx tsx tests/service-maintenance.ts */
import { canPrepareReminder, daysToMaintenance, dayOffset, manilaDayStart, maintenanceTiming, channelStatus, plannedStages, shouldQueueStage } from "../src/lib/maintenance-policy";
import { startOfManilaDayUTC } from "../src/lib/dates";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const d = (s: string) => new Date(s);
const iso = (x: Date) => x.toISOString();

const due = d("2027-04-14T01:00:00.000Z"); // 09:00 Manila on Apr 14
const stages = plannedStages(due);
console.log("stages");
check("three stages in order", stages.map((x) => x.stage), ["d30", "d7", "due"]);
check("d30 is Mar 15 00:00 Manila", iso(stages[0]!.scheduledAt), "2027-03-14T16:00:00.000Z");
check("d7 is Apr 7 00:00 Manila, due is Apr 14 00:00 Manila", [iso(stages[1]!.scheduledAt), iso(stages[2]!.scheduledAt)], ["2027-04-06T16:00:00.000Z", "2027-04-13T16:00:00.000Z"]);
check("daysToMaintenance from the d30 start is 30", daysToMaintenance(due, stages[0]!.scheduledAt), 30);
check("dayOffset matches the stage", iso(dayOffset(due, -7)), iso(stages[1]!.scheduledAt));
check("leap day: Feb 28 -> Mar 1 2028 is 2 days", daysToMaintenance(d("2028-03-01T01:00:00Z"), d("2028-02-28T01:00:00Z")), 2);

console.log("\nManila day boundary (UTC+8, no daylight saving)");
check("15:59:59Z is still Oct 8 Manila, 16:00:00Z is Oct 9", [iso(manilaDayStart(d("2026-10-08T15:59:59Z"))), iso(manilaDayStart(d("2026-10-08T16:00:00Z")))], ["2026-10-07T16:00:00.000Z", "2026-10-08T16:00:00.000Z"]);
check("same as the shared startOfManilaDayUTC", [d("2026-10-08T15:59:59Z"), d("2026-10-08T16:00:00Z"), d("2027-01-01T00:00:00Z")].map((x) => iso(manilaDayStart(x)) === iso(startOfManilaDayUTC(x))), [true, true, true]);
check("late evening Manila and early morning Manila are the same day for 'due' days", daysToMaintenance(d("2026-10-08T15:30:00Z"), d("2026-10-08T00:10:00Z")), 0);
check("23:59 Manila vs 00:01 next day: 1 day apart", daysToMaintenance(d("2026-10-08T16:01:00Z"), d("2026-10-08T15:59:00Z")), 1);
check("timing: past / today / ahead", [maintenanceTiming(d("2026-10-07T15:59:00Z"), d("2026-10-08T04:00:00Z")), maintenanceTiming(d("2026-10-08T15:59:00Z"), d("2026-10-08T04:00:00Z")), maintenanceTiming(d("2026-10-08T16:00:00Z"), d("2026-10-08T04:00:00Z"))], ["past", "today", "ahead"]);
check("an invalid date throws", (() => { try { manilaDayStart(new Date("nope")); return "no throw"; } catch { return "threw"; } })(), "threw");
check("a non-integer offset throws", (() => { try { dayOffset(due, 1.5); return "no throw"; } catch { return "threw"; } })(), "threw");

console.log("\nqueue timing (no catch-up sends)");
check("d7 is queued exactly on its day", shouldQueueStage(due, "d7", stages[1]!.scheduledAt), true);
check("d7 is queued any time that Manila day", shouldQueueStage(due, "d7", d("2027-04-07T10:00:00Z")), true);
check("not the day before, not the day after (no backdated catch-up)", [shouldQueueStage(due, "d7", d("2027-04-06T15:59:00Z")), shouldQueueStage(due, "d7", d("2027-04-07T16:00:00Z"))], [false, false]);
check("d7 is not queued on the due day", shouldQueueStage(due, "d7", due), false);
check("due stage is queued on the due day", shouldQueueStage(due, "due", due), true);

console.log("\neligibility");
const eligible = {
  customerArchived: false, recallActive: true, alreadyBooked: false, currentDueAt: due, cycleDueAt: due, optedOut: false,
  emailConsent: false, smsConsent: false, email: "test@example.com", phone: "09123456789",
};
check("manual review is allowed with no consent on file", canPrepareReminder(eligible, "manual"), true);
check("email / sms need consent", [canPrepareReminder(eligible, "email"), canPrepareReminder(eligible, "sms")], [false, false]);
check("consent + address allows email, consent + phone allows sms", [canPrepareReminder({ ...eligible, emailConsent: true }, "email"), canPrepareReminder({ ...eligible, smsConsent: true }, "sms")], [true, true]);
check("consent but no address / phone: not allowed", [canPrepareReminder({ ...eligible, emailConsent: true, email: "  " }, "email"), canPrepareReminder({ ...eligible, smsConsent: true, phone: null }, "sms")], [false, false]);
check("opted out: nothing, not even manual (even with consent)", ["manual", "email", "sms"].map((c) => canPrepareReminder({ ...eligible, optedOut: true, emailConsent: true, smsConsent: true }, c as never)), [false, false, false]);
check("archived customer: nothing", ["manual", "email"].map((c) => canPrepareReminder({ ...eligible, customerArchived: true, emailConsent: true }, c as never)), [false, false]);
check("already booked: nothing", canPrepareReminder({ ...eligible, alreadyBooked: true }, "manual"), false);
check("recall no longer active: nothing", canPrepareReminder({ ...eligible, recallActive: false }, "manual"), false);
check("due date moved to another day since the cycle started: nothing", canPrepareReminder({ ...eligible, cycleDueAt: dayOffset(due, 1) }, "manual"), false);
check("due date moved within the same Manila day is still the same cycle", canPrepareReminder({ ...eligible, currentDueAt: d("2027-04-14T10:00:00Z") }, "manual"), true);
check("no current due date: nothing", canPrepareReminder({ ...eligible, currentDueAt: null }, "manual"), false);

console.log("\nchannel explanation never disagrees with the rule");
let mismatch = 0;
for (const archived of [false, true]) for (const opted of [false, true]) for (const booked of [false, true]) for (const active of [false, true]) for (const ec of [false, true]) for (const sc of [false, true]) for (const em of [null, "a@b.c"]) for (const dueMoved of [false, true]) for (const ch of ["manual", "email", "sms"] as const) {
  const i = { ...eligible, customerArchived: archived, optedOut: opted, alreadyBooked: booked, recallActive: active, emailConsent: ec, smsConsent: sc, email: em, phone: em ? "0917" : null, cycleDueAt: dueMoved ? dayOffset(due, 2) : due };
  const st = channelStatus(i, ch);
  if (st.ready !== canPrepareReminder(i, ch) || st.ready !== (st.reason === null)) mismatch++;
}
check("ready === canPrepareReminder and a reason exists exactly when not ready (512 combos x 3 channels)", mismatch, 0);
check("absent consent reads 'No consent recorded'", [channelStatus(eligible, "email").reason, channelStatus(eligible, "sms").reason, channelStatus(eligible, "manual").reason], ["No consent recorded", "No consent recorded", null]);
check("consent but empty address says so", channelStatus({ ...eligible, emailConsent: true, email: "" }, "email").reason, "No email on file");

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nAll maintenance policy checks passed.");
