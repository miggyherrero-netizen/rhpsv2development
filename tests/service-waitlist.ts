/** Waitlist rules: follow-up dates, not-now rule, template filling, grouping, metrics. No database. Run: npx tsx tests/service-waitlist.ts */
import {
  afterMessaged, shouldGoNotNow, parkAsNotNow, isFollowUpDue, defaultNextFollowUp, daysWaiting, isLongWait, isUpcoming, recallEntryFor,
  fillTemplate, firstName, smsHref, messengerHref, DEFAULT_TEMPLATES, PLACEHOLDERS, groupWaitlist, avgDaysWaiting, messagedToConfirmedRate, jobsPerTrip, DAY_MS, type WaitRow,
} from "../src/lib/service-waitlist";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const d = (iso: string) => new Date(iso);
const now = d("2026-10-07T06:00:00Z"); // Wed 14:00 Manila

console.log("follow-up dates");
check("new entries default to a follow-up in 3 days", defaultNextFollowUp(now).toISOString(), "2026-10-10T06:00:00.000Z");
check("Messaged ✓ sets status, counts it, stamps now, next in 3 days", (() => { const r = afterMessaged({ status: "waiting", followUpCount: 0 }, now); return [r.status, r.followUpCount, r.lastContactedAt?.toISOString(), r.nextFollowUpAt.toISOString()]; })(), ["messaged", 1, "2026-10-07T06:00:00.000Z", "2026-10-10T06:00:00.000Z"]);
check("every Messaged ✓ adds one", afterMessaged({ status: "messaged", followUpCount: 2 }, now).followUpCount, 3);
check("coming back from 'not now' starts a fresh cycle", afterMessaged({ status: "not_now", followUpCount: 3 }, now).followUpCount, 1);

console.log("\ntwo follow-ups, then not now");
const msg = (count: number, next: string) => ({ status: "messaged", followUpCount: count, nextFollowUpAt: d(next) });
check("first message + 1 follow-up: keep going", shouldGoNotNow(msg(2, "2026-10-06T00:00:00Z"), now), false);
check("first message + 2 follow-ups, follow-up date passed, no yes -> not now", shouldGoNotNow(msg(3, "2026-10-06T00:00:00Z"), now), true);
check("…but not before that last follow-up date arrives", shouldGoNotNow(msg(3, "2026-10-09T00:00:00Z"), now), false);
check("a confirmed client is never parked", shouldGoNotNow({ status: "confirmed", followUpCount: 5, nextFollowUpAt: d("2026-10-01T00:00:00Z") }, now), false);
check("parking sets not-now and the next follow-up 30 days out", (() => { const p = parkAsNotNow(now); return [p.status, p.nextFollowUpAt.toISOString()]; })(), ["not_now", "2026-11-06T06:00:00.000Z"]);

console.log("\nwhat is due today (Manila)");
check("due earlier today", isFollowUpDue({ status: "waiting", nextFollowUpAt: d("2026-10-07T01:00:00Z") }, now), true);
check("due tonight, still today in Manila (11pm)", isFollowUpDue({ status: "messaged", nextFollowUpAt: d("2026-10-07T15:00:00Z") }, now), true);
check("due tomorrow Manila (00:30 Oct 8) is not today", isFollowUpDue({ status: "messaged", nextFollowUpAt: d("2026-10-07T16:30:00Z") }, now), false);
check("overdue by days still shows", isFollowUpDue({ status: "waiting", nextFollowUpAt: d("2026-09-20T00:00:00Z") }, now), true);
check("scheduled / done / confirmed don't need a nudge", ["scheduled", "done", "confirmed"].map((status) => isFollowUpDue({ status, nextFollowUpAt: d("2026-09-20T00:00:00Z") }, now)), [false, false, false]);
check("a parked client comes back when the 30 days are up", isFollowUpDue({ status: "not_now", nextFollowUpAt: d("2026-10-07T00:00:00Z") }, now), true);

console.log("\ndays waiting");
check("whole days", daysWaiting(d("2026-10-01T06:00:00Z"), now), 6);
check("red after 14 days, not at 14", [isLongWait(d("2026-09-23T06:00:00Z"), now), isLongWait(d("2026-09-22T05:00:00Z"), now)], [false, true]);
check("a future recall is upcoming, 0 days", [isUpcoming(d("2026-12-01T00:00:00Z"), now), daysWaiting(d("2026-12-01T00:00:00Z"), now)], [true, 0]);

console.log("\nrecall entries");
check("tuning done Mar 10 + 6 months: waiting, due Sep 10, first nudge the same day", (() => { const r = recallEntryFor({ completedAt: d("2026-03-10T00:00:00Z") }, 6)!; return [r.requestedAt.toISOString().slice(0, 10), r.nextFollowUpAt.toISOString().slice(0, 10), r.status, r.source]; })(), ["2026-09-10", "2026-09-10", "waiting", "recall"]);

console.log("\ntemplates");
const full = { first_name: "Maria", area: "Digos", date: "Saturday, Oct 18", time: "9:00 AM", piano: "Yamaha U1", location: "12 Acacia St", price: "₱2,500", tech_name: "Ariel" };
check("fills every placeholder", fillTemplate("Hi {first_name}! {piano} sa {area}, {date} {time}, {location}, {price}, {tech_name}.", full), { text: "Hi Maria! Yamaha U1 sa Digos, Saturday, Oct 18 9:00 AM, 12 Acacia St, ₱2,500, Ariel.", missing: [] });
check("the same placeholder twice", fillTemplate("{area} … {area}", { area: "Toril" }).text, "Toril … Toril");
check("a missing value is reported and the sentence is tidied", fillTemplate("Hi {first_name}, naa mi sa {area} sa {date}.", { first_name: "Ana", date: "Sat" }), { text: "Hi Ana, naa mi sa sa Sat.", missing: ["area"] });
check("a missing value at the end leaves no dangling comma", fillTemplate("Moabot si {tech_name}, {time}.", { tech_name: "Ariel" }).text, "Moabot si Ariel.");
check("emoticons and a deliberate ' ?' are never rewritten", fillTemplate("Salamat :) ok ;) tinuod ?", {}).text, "Salamat :) ok ;) tinuod ?");
check("a recall message with no {date} reads cleanly", fillTemplate(DEFAULT_TEMPLATES.find((t) => t.key === "recall")!.body, { first_name: "Ana", piano: "Yamaha U1", area: "Digos" }).text.includes("karong ."), false);
check("unknown placeholders are left alone, not blanked", fillTemplate("Hi {nickname} {first_name}", { first_name: "Ana" }).text, "Hi {nickname} Ana");
check("each seeded template only uses known placeholders", DEFAULT_TEMPLATES.every((t) => [...t.body.matchAll(/\{([a-z_]+)\}/g)].every((m) => (PLACEHOLDERS as readonly string[]).includes(m[1]!))), true);
check("four seeded templates", DEFAULT_TEMPLATES.map((t) => t.key), ["area_trip", "follow_up", "confirm_day_before", "recall"]);
check("every seeded template fills cleanly with full details", DEFAULT_TEMPLATES.map((t) => fillTemplate(t.body, full).missing.length), [0, 0, 0, 0]);
check("first name", [firstName("Maria Santos"), firstName("Fr. Santos"), firstName("")], ["Maria", "Fr. Santos", ""]);
check("sms link carries the body (iOS + Android form)", smsHref("0917 123 4567", "Hi Ana!"), "sms:09171234567?&body=Hi%20Ana!");
check("no usable number -> no sms link", smsHref("n/a", "x"), null);
check("messenger link only with a handle", [messengerHref("maria.santos"), messengerHref(null)], ["https://m.me/maria.santos", null]);

console.log("\ngrouping Region → Province → City");
const row = (id: string, city: string | null, prov: string | null, reg: string | null, daysAgo: number, value = 100): WaitRow => ({
  id, cityCode: city, cityName: city, provinceCode: prov, provinceName: prov, regionCode: reg, regionShort: reg, requestedAt: new Date(now.getTime() - daysAgo * DAY_MS), estValueCents: value,
});
const rows = [row("1", "Digos", "DelSur", "XI", 5), row("2", "Digos", "DelSur", "XI", 20), row("3", "Toril", "DelSur", "XI", 2), row("4", "Tagum", "DelNorte", "XI", 30), row("5", "Gensan", "SouthCot", "XII", 1), row("6", null, null, null, 50)];
const g = groupWaitlist(rows, now);
check("regions: bigger first, Unsorted last", g.map((r) => [r.name, r.count]), [["Region XI", 4], ["Region XII", 1], ["Unsorted", 1]]);
check("provinces ordered by count", g[0]!.provinces.map((p) => [p.name, p.count]), [["DelSur", 3], ["DelNorte", 1]]);
check("cities: count then oldest", g[0]!.provinces[0]!.cities.map((c) => [c.name, c.count, c.oldestDays]), [["Digos", 2, 20], ["Toril", 1, 2]]);
check("entries oldest first", g[0]!.provinces[0]!.cities[0]!.entries.map((e) => e.id), ["2", "1"]);
check("ties on count go to the longer wait", groupWaitlist([row("a", "A", "P", "XI", 3), row("b", "B", "P", "XI", 9)], now)[0]!.provinces[0]!.cities.map((c) => c.name), ["B", "A"]);
check("est. value adds up", g[0]!.estValueCents, 400);
check("no place at all -> Unsorted", g.at(-1)!.provinces[0]!.cities[0]!.name, "Unsorted");

console.log("\nmetrics");
check("average days waiting only counts open, due entries", avgDaysWaiting([
  { status: "waiting", requestedAt: d("2026-10-01T06:00:00Z") }, { status: "messaged", requestedAt: d("2026-09-27T06:00:00Z") },
  { status: "done", requestedAt: d("2026-01-01T00:00:00Z") }, { status: "waiting", requestedAt: d("2026-12-01T00:00:00Z") },
], now), 8);
check("no one waiting -> no average", avgDaysWaiting([], now), null);
check("messaged → confirmed over the last 30 days", messagedToConfirmedRate([
  { status: "confirmed", lastContactedAt: d("2026-10-01T00:00:00Z") }, { status: "scheduled", lastContactedAt: d("2026-09-20T00:00:00Z") },
  { status: "messaged", lastContactedAt: d("2026-10-05T00:00:00Z") }, { status: "not_now", lastContactedAt: d("2026-09-15T00:00:00Z") },
  { status: "confirmed", lastContactedAt: d("2026-07-01T00:00:00Z") }, { status: "waiting", lastContactedAt: null },
], now), { messaged: 4, confirmed: 2, ratePct: 50 });
check("nobody messaged -> no rate", messagedToConfirmedRate([{ status: "waiting", lastContactedAt: null }], now).ratePct, null);
check("jobs per trip ignores empty trips", jobsPerTrip([{ jobCount: 4 }, { jobCount: 2 }, { jobCount: 0 }]), 3);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall waitlist checks passed");
