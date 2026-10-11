/** Waitlist -> job mapping and the Jobs page link. No database. Run: npx tsx tests/service-waitlist-convert.ts */
import {
  canConvertEntry, parseJobsPageParams, pickLocationId, pickPianoId, resolveJobsPrefill, waitlistToJobInitial, wantsJobsPrefill, type ConvertEntry,
} from "../src/lib/service-waitlist-convert";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const C = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entry = (o: Partial<ConvertEntry> = {}): ConvertEntry => ({
  customerId: C, pianoId: null, serviceType: "tuning", cityCode: null, barangayCode: null, estValueCents: 0, notes: null, ...o,
});
const locs = [
  { id: "L-davao", cityCode: "112402000", barangayCode: "B1" },
  { id: "L-digos", cityCode: "112403000", barangayCode: null },
  { id: "L-davao2", cityCode: "112402000", barangayCode: "B2" },
];

console.log("which entries can be converted");
check("waiting", canConvertEntry({ status: "waiting", jobId: null }), true);
check("messaged / confirmed / not now", ["messaged", "confirmed", "not_now"].map((status) => canConvertEntry({ status, jobId: null })), [true, true, true]);
check("scheduled and done are not offered", ["scheduled", "done"].map((status) => canConvertEntry({ status, jobId: null })), [false, false]);
check("an entry already linked to a job is not offered", canConvertEntry({ status: "waiting", jobId: "J" }), false);

console.log("\npiano: the entry's, else the only one, else blank");
check("entry's own piano wins", pickPianoId(P1, [{ id: P2, label: "x" }]), P1);
check("one piano on file -> that one", pickPianoId(null, [{ id: P2, label: "Kawai" }]), P2);
check("two pianos -> blank (the form asks)", pickPianoId(null, [{ id: P1, label: "a" }, { id: P2, label: "b" }]), null);
check("no pianos -> blank", pickPianoId(null, []), null);

console.log("\nlocation: matches the entry's area, else the first");
check("same city and barangay", pickLocationId({ cityCode: "112402000", barangayCode: "B2" }, locs), "L-davao2");
check("same city, barangay not matched -> first in that city", pickLocationId({ cityCode: "112402000", barangayCode: "B9" }, locs), "L-davao");
check("other city", pickLocationId({ cityCode: "112403000", barangayCode: null }, locs), "L-digos");
check("no location in that city -> the first one", pickLocationId({ cityCode: "999", barangayCode: null }, locs), "L-davao");
check("entry has no area -> the first one", pickLocationId({ cityCode: null, barangayCode: null }, locs), "L-davao");
check("customer has no locations -> none", pickLocationId({ cityCode: "112402000", barangayCode: null }, []), null);

console.log("\nthe job the form starts with");
check("piano from the customer's only piano, title like the trip flow", waitlistToJobInitial(entry({ serviceType: "repair", notes: "Sticky keys" }), { id: C }, locs, [{ id: P1, label: "Yamaha U1" }]), {
  customerId: C, locationId: "L-davao", pianoId: P1, title: "Repair — Yamaha U1", serviceType: "repair", privateNotes: "Sticky keys",
});
check("no piano -> title is just the service, piano blank", waitlistToJobInitial(entry(), { id: C }, [], []), {
  customerId: C, locationId: null, pianoId: null, title: "Tuning", serviceType: "tuning", privateNotes: "",
});
check("entry's piano is used even when it is one of several", waitlistToJobInitial(entry({ pianoId: P2 }), { id: C }, locs, [{ id: P1, label: "A" }, { id: P2, label: "Kawai K-300" }]).title, "Tuning — Kawai K-300");
check("estimated value is added as its own line after the notes (private notes)", waitlistToJobInitial(entry({ notes: "Prefers Saturdays", estValueCents: 250_000 }), { id: C }, [], []).privateNotes, "Prefers Saturdays\nEstimated value ₱2,500");
check("estimated value alone", waitlistToJobInitial(entry({ estValueCents: 150_000 }), { id: C }, [], []).privateNotes, "Estimated value ₱1,500");
check("no value -> no value line", waitlistToJobInitial(entry({ notes: "Gate code 1234", estValueCents: 0 }), { id: C }, [], []).privateNotes, "Gate code 1234");
check("whitespace-only notes are dropped", waitlistToJobInitial(entry({ notes: "   " }), { id: C }, [], []).privateNotes, "");
check("unknown service type falls back to a plain title", waitlistToJobInitial(entry({ serviceType: "mystery" }), { id: C }, [], []).title, "Visit");
check("nothing else is forced (no time, technician, price)", Object.keys(waitlistToJobInitial(entry(), { id: C }, [], [])).sort(), ["customerId", "locationId", "pianoId", "privateNotes", "serviceType", "title"]);
check("client-visible notes are never prefilled from the entry", "notes" in waitlistToJobInitial(entry({ notes: "secret", estValueCents: 100 }), { id: C }, [], []), false);

console.log("\nJobs page link: ?new=1&customer=..&piano=..");
check("everything valid", parseJobsPageParams({ new: "1", customer: C, piano: P1, filter: "open" }), { open: true, customerId: C, pianoId: P1, filter: "open" });
check("no new=1 -> form stays closed", parseJobsPageParams({ customer: C }).open, false);
check("new=true is not accepted", parseJobsPageParams({ new: "true" }).open, false);
check("junk ids are dropped", parseJobsPageParams({ new: "1", customer: "abc'; drop table", piano: "123" }), { open: true, customerId: null, pianoId: null, filter: undefined });
check("repeated params take the first", parseJobsPageParams({ new: ["1", "0"], customer: [C, C2] }), { open: true, customerId: C, pianoId: null, filter: undefined });
check("uppercase ids are normalised", parseJobsPageParams({ customer: C.toUpperCase() }).customerId, C);

check("prefill only counts with new=1", [wantsJobsPrefill({ open: false, customerId: C, pianoId: null }), wantsJobsPrefill({ open: true, customerId: C, pianoId: null }), wantsJobsPrefill({ open: true, customerId: null, pianoId: null })], [false, true, false]);
const known = (ids: string[], owner: string | null) => ({ customerIds: new Set(ids), pianoOwnerId: owner });
check("customer + their piano", resolveJobsPrefill({ customerId: C, pianoId: P1 }, known([C, C2], C)), { customerId: C, pianoId: P1 });
check("unknown customer is ignored", resolveJobsPrefill({ customerId: C2, pianoId: null }, known([C], null)), null);
check("piano of someone else is ignored, customer kept", resolveJobsPrefill({ customerId: C, pianoId: P1 }, known([C, C2], C2)), { customerId: C, pianoId: null });
check("piano that does not exist is ignored, customer kept", resolveJobsPrefill({ customerId: C, pianoId: P1 }, known([C], null)), { customerId: C, pianoId: null });
check("a piano alone brings its owner", resolveJobsPrefill({ customerId: null, pianoId: P1 }, known([C], C)), { customerId: C, pianoId: P1 });
check("a piano alone whose owner is archived/unknown -> nothing", resolveJobsPrefill({ customerId: null, pianoId: P1 }, known([C2], C)), null);
check("nothing given -> nothing", resolveJobsPrefill({ customerId: null, pianoId: null }, known([C], null)), null);

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall passed");
