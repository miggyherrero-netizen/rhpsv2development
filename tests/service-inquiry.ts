/** Quick inquiry checks (pure). Run: npx tsx tests/service-inquiry.ts */
import { INQUIRY_LIMITS, composeInquiryNotes, customerSourceFor, digitsOnly, phoneMatchKey, validateQuickInquiry } from "../src/lib/service-inquiry";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const base = { name: "Maria Santos", phone: "0917 123 4567", cityCode: "112403000", request: "Tuning for an upright" };
const err = (o: Record<string, unknown>) => { const r = validateQuickInquiry({ ...base, ...o }); return r.ok ? null : r.errors; };

console.log("required fields");
check("a complete inquiry is accepted", validateQuickInquiry(base).ok, true);
check("missing name", err({ name: "" })?.name, "Enter the customer's name.");
check("blank name (spaces)", err({ name: "   " })?.name, "Enter the customer's name.");
check("missing phone", err({ phone: "" })?.phone, "Enter a phone number.");
check("missing area", err({ cityCode: "" })?.cityCode, "Pick the area.");
check("area not a string", err({ cityCode: null })?.cityCode, "Pick the area.");
check("missing request", err({ request: "  " })?.request, "Write what they asked for.");
check("everything missing -> four messages at once, no silent defaults", Object.keys(err({ name: "", phone: "", cityCode: "", request: "" }) ?? {}).sort(), ["cityCode", "name", "phone", "request"]);
check("the first message is the one the server returns", (() => { const r = validateQuickInquiry({ ...base, name: "", phone: "" }); return r.ok ? null : r.error; })(), "Enter the customer's name.");
check("non-object values do not crash", validateQuickInquiry({ name: 5, phone: {}, cityCode: [], request: false }).ok, false);

console.log("\ntrimming and phone digits");
const ok = (o: Record<string, unknown>) => { const r = validateQuickInquiry({ ...base, ...o }); if (!r.ok) throw new Error(r.error); return r.value; };
check("name and request are trimmed and inner spaces collapsed", [ok({ name: "  Maria   Santos ", request: "  Tuning   please " }).name, ok({ request: "  Tuning   please " }).request], ["Maria Santos", "Tuning please"]);
check("digits are taken from any format", ["0917 123 4567", "0917-123-4567", "(0917) 123.4567", "09171234567"].map((phone) => ok({ phone }).phoneDigits), ["09171234567", "09171234567", "09171234567", "09171234567"]);
check("+63 form keeps its own digits (country code)", ok({ phone: "+63 917 123 4567" }).phoneDigits, "639171234567");
check("stored phone is the trimmed text, not the digits", ok({ phone: "  0917 123 4567 " }).phone, "0917 123 4567");
check("too short", err({ phone: "12345" })?.phone, "That number is too short. Use at least 7 digits.");
check("too long", err({ phone: "12345678901234567" })?.phone, "That number is too long. Use at most 15 digits.");
check("letters are rejected", err({ phone: "call me" })?.phone, "Use digits only, like 0917 123 4567.");
check("digitsOnly", digitsOnly("+63 (917) 123-4567"), "639171234567");

console.log("\nphone matching key (Philippine formats)");
check("0917…, +63 917… and 63917… share a key", ["0917 123 4567", "+63 917 123 4567", "63917-123-4567", "9171234567"].map((p) => phoneMatchKey(digitsOnly(p))), ["9171234567", "9171234567", "9171234567", "9171234567"]);
check("a landline keeps its own digits", phoneMatchKey("0822214477"), "0822214477");
check("short numbers are left alone", phoneMatchKey("123456"), "123456");
check("a different number does not collide", phoneMatchKey("09171234568") !== phoneMatchKey("09171234567"), true);
check("validator carries the key", ok({ phone: "+63 917 123 4567" }).phoneKey, "9171234567");
check("one repeated digit is rejected", ["0000000", "11111111111"].map((phone) => err({ phone })?.phone), ["That doesn't look like a real number.", "That doesn't look like a real number."]);

console.log("\nlength caps");
check("an emoji at the cut is not split", (() => { const r = ok({ request: "a".repeat(239) + "😀😀" }).request; return [Array.from(r).length, r.endsWith("😀"), /[\ud800-\udbff]$/.test(r)]; })(), [240, true, false]);
check("name capped", ok({ name: "x".repeat(500) }).name.length, INQUIRY_LIMITS.name);
check("request capped", ok({ request: "y".repeat(2000) }).request.length, INQUIRY_LIMITS.request);
check("piano model capped", ok({ pianoModel: "z".repeat(500) }).pianoModel?.length, INQUIRY_LIMITS.pianoModel);
check("notes capped", ok({ notes: "n".repeat(5000) }).notes?.length, INQUIRY_LIMITS.notes);
check("the composed note always fits the 1,000-character field", composeInquiryNotes(ok({ request: "y".repeat(2000), pianoModel: "z".repeat(500), notes: "n".repeat(5000) })).length <= 1000, true);

console.log("\noptional fields");
const min = ok({});
check("left out -> empty, value 0, source phone", [min.pianoModel, min.notes, min.estValueCents, min.source, min.barangayCode], [null, null, 0, "phone", null]);
check("estimated value: 2,500 -> 250000 centavos", ok({ estValue: "2,500" }).estValueCents, 250_000);
check("estimated value with peso sign and decimals", ok({ estValue: "₱1,250.50" }).estValueCents, 125_050);
check("estimated value as a number", ok({ estValue: 3000 }).estValueCents, 300_000);
check("estimated value unreadable", err({ estValue: "a lot" })?.estValue, "Use a number like 2,500.");
check("estimated value negative", err({ estValue: "-5" })?.estValue, "Use a number like 2,500.");
check("estimated value absurd", err({ estValue: "99999999999" })?.estValue, "That value is too high.");
check("source: a known one is kept", ok({ source: "facebook" }).source, "facebook");
check("source: an unknown one is rejected, not guessed", err({ source: "carrier pigeon" })?.source, "Pick where it came from.");
check("barangay is passed through when given", ok({ barangayCode: " 112402001 " }).barangayCode, "112402001");

console.log("\nnotes written to the entry");
check("request only", composeInquiryNotes(ok({})), "Tuning for an upright");
check("request, then piano model, then extra notes", composeInquiryNotes(ok({ pianoModel: "Yamaha U1", notes: "Prefers Saturdays" })), "Tuning for an upright\nPiano: Yamaha U1\nPrefers Saturdays");
check("customer source follows the entry source", (["website", "facebook", "walk_in", "phone", "recall"] as const).map(customerSourceFor), ["website", "facebook", "walk_in", "other", "other"]);

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall passed");
