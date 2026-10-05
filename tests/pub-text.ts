/** Title Case helper for the public site. No database. Run: npx tsx tests/pub-text.ts */
import { titleCase } from "../src/lib/pub-text";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

console.log("title case");
check("basic labels", [titleCase("book an assessment"), titleCase("see the showroom"), titleCase("message us")], ["Book an Assessment", "See the Showroom", "Message Us"]);
check("small words stay small, except first and last", [titleCase("instruments ready for a home"), titleCase("the work speaks first"), titleCase("what we check during an assessment"), titleCase("back to home")], ["Instruments Ready for a Home", "The Work Speaks First", "What We Check During an Assessment", "Back to Home"]);
check("already-capitalised input is unchanged", titleCase("Baby Grand · Fully Restored · For Serious Study"), "Baby Grand · Fully Restored · For Serious Study");
check("each segment after a middle dot starts with a capital", titleCase("grand · excellent · for performance"), "Grand · Excellent · For Performance");
check("a word after a dash starts with a capital", titleCase("family client — 1911 steinway o restoration"), "Family Client — 1911 Steinway O Restoration");
check("hyphenated words capitalise each part", titleCase("davao-based piano sales & service"), "Davao-Based Piano Sales & Service");
check("numbers and mixed-case tokens are kept", [titleCase("a=442 concert pitch standard"), titleCase("pianos tuned & serviced"), titleCase("under ₱60k"), titleCase("SMS and WiFi")], ["A=442 Concert Pitch Standard", "Pianos Tuned & Serviced", "Under ₱60k", "SMS and WiFi"]);
check("empty / null", [titleCase(""), titleCase(null), titleCase(undefined)], ["", "", ""]);
check("extra spaces survive", titleCase("grand   piano"), "Grand   Piano");
check("for + use (the card's 'for serious study')", titleCase("for serious study"), "For Serious Study");

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall title-case checks passed");
