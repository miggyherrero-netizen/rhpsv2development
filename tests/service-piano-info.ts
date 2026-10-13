/** Piano placeholder helper + the payment -> service date rule. No database. Run: npx tsx tests/service-piano-info.ts */
import { PIANO_PLACEHOLDER, isPianoInfoMissing, pianoLabel, realBrand, waitlistPianoText } from "../src/lib/service-piano-info";
import { isNewerServiceDate, jobIsFinished, pickServedAt } from "../src/lib/service-sale";
import { waitlistToJobInitial } from "../src/lib/service-waitlist-convert";
import { DEFAULT_TEMPLATES, fillTemplate } from "../src/lib/service-waitlist";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  \u2717 ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  \u2713 ${name}`);
}
const d = (s: string) => new Date(s);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

console.log("placeholder");
check("placeholder is N/A", PIANO_PLACEHOLDER, "N/A");
check("N/A brand with no model needs info", isPianoInfoMissing({ brand: "N/A", model: null }), true);
check("case-insensitive, padded placeholder", [isPianoInfoMissing({ brand: " n/a ", model: "U1" }), isPianoInfoMissing({ brand: "Yamaha", model: "N/A" })], [true, true]);
check("empty / null brand or model needs info", [isPianoInfoMissing({ brand: "", model: "U1" }), isPianoInfoMissing({ brand: "Yamaha", model: "  " }), isPianoInfoMissing({ brand: "Yamaha" })], [true, true, true]);
check("real brand and model do not", isPianoInfoMissing({ brand: "Yamaha", model: "U1" }), false);
check("a brand like 'Nakamura' is not mistaken for the placeholder", isPianoInfoMissing({ brand: "Nakamura", model: "NA-1" }), false);
check("realBrand hides the placeholder", [realBrand("N/A"), realBrand("Kawai")], ["", "Kawai"]);
check("labels", [pianoLabel({ brand: "N/A", model: null }), pianoLabel({ brand: "Yamaha", model: "N/A" }), pianoLabel({ brand: "Yamaha", model: "U1" })], ["Piano (info needed)", "Yamaha", "Yamaha U1"]);

console.log("\nmessages never print the placeholder");
// Same rule as loadItems: a label only when the brand is real; the message call sites fall back to "piano".
const waitlistLabelFor = (p: { brand: string; model: string | null }) => (realBrand(p.brand) ? pianoLabel(p) : null);
const filled = fillTemplate(DEFAULT_TEMPLATES.find((t) => t.key === "recall")!.body, { first_name: "Maria", area: "Digos", piano: waitlistLabelFor({ brand: "N/A", model: null }) ?? "piano" });
check("recall message with an N/A piano says 'piano'", [/imong piano\?/.test(filled.text) || /imong piano\./.test(filled.text), /N\/A|info needed/i.test(filled.text)], [true, false]);
check("waitlist row text", [waitlistPianoText({ pianoLabel: null, pianoInfoMissing: true }), waitlistPianoText({ pianoLabel: null, pianoInfoMissing: false }), waitlistPianoText({ pianoLabel: "Yamaha U1", pianoInfoMissing: false })], ["Piano (info needed)", "No piano chosen", "Yamaha U1"]);

check("convert title never carries the placeholder", [
  waitlistToJobInitial({ pianoId: "P", serviceType: "tuning", notes: null, estValueCents: 0, status: "waiting", jobId: null, cityCode: null, barangayCode: null } as never, { id: "C" }, [], [{ id: "P", label: "Piano (info needed)", titleName: "" }]).title,
  waitlistToJobInitial({ pianoId: "P", serviceType: "tuning", notes: null, estValueCents: 0, status: "waiting", jobId: null, cityCode: null, barangayCode: null } as never, { id: "C" }, [], [{ id: "P", label: "Yamaha U1", titleName: "Yamaha U1" }]).title,
], ["Tuning", "Tuning — Yamaha U1"]);

console.log("\nservice date picked from a payment");
const pay = d("2026-10-10T04:00:00Z"), now = d("2026-10-13T00:00:00Z");
const pick = (o: Partial<Parameters<typeof pickServedAt>[0]>) => pickServedAt({ completedAt: null, scheduledStart: null, paidAt: pay, firstPayment: true, now, ...o });
check("completedAt wins", iso(pick({ completedAt: d("2026-10-01"), scheduledStart: d("2026-09-30") })), "2026-10-01");
check("no completedAt: the visit date", iso(pick({ scheduledStart: d("2026-10-05") })), "2026-10-05");
check("no dates: payment date, first payment only", [iso(pick({})), pick({ firstPayment: false })], ["2026-10-10", null]);
check("never later than now", [iso(pick({ completedAt: d("2026-12-01") })), iso(pick({ scheduledStart: d("2026-11-01") })), iso(pick({ paidAt: d("2026-11-01") }))], ["2026-10-13", "2026-10-13", "2026-10-13"]);
check("never moves backwards", [isNewerServiceDate(d("2026-10-01"), d("2026-09-01")), isNewerServiceDate(d("2026-10-01"), d("2026-10-01")), isNewerServiceDate(d("2026-10-01"), d("2026-10-02")), isNewerServiceDate(null, d("2020-01-01"))], [false, false, true, true]);
check("only a finished job is stamped", [
  jobIsFinished({ completedAt: d("2026-10-01"), status: "invoiced" }), jobIsFinished({ completedAt: null, status: "completed" }),
  jobIsFinished({ completedAt: null, status: "scheduled" }), jobIsFinished({ completedAt: d("2026-10-01"), status: "cancelled" }),
  jobIsFinished({ completedAt: d("2026-10-01"), status: "completed", cancelledAt: d("2026-10-02") }),
], [true, true, false, false, false]);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall passed");
