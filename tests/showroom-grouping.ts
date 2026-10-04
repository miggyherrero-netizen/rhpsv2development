/**
 * Showroom grouping / filtering / alt-text checks. Pure functions, no database.
 * Run with:  npx tsx tests/showroom-grouping.ts
 */
import { groupPianos, featuredGroups, matchesFilter, pianoAlt } from "../src/lib/showroom";
import type { PublicPiano } from "../src/server/data";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

let n = 0;
const piano = (o: Partial<PublicPiano>): PublicPiano => ({
  id: `p${++n}`, brand: "Yamaha", model: "U1", year: null, type: "Upright", condition: "Good",
  description: null, technicianNotes: null, dimensions: null, recommendedUse: null,
  priceCents: 11_000_000, status: "available", imageUrl: null, sortOrder: n, createdAt: new Date(0),
  ...o,
} as PublicPiano);

const list = [
  piano({}), piano({ year: 1990 }), piano({ status: "reserved" }), piano({}), piano({}),
  piano({ brand: "Kawai", model: "K-500", priceCents: 5_200_000 }),
  piano({ brand: "Boston", model: "GP-156", type: "Grand", priceCents: 89_000_000 }),
  piano({ brand: "Fazioli", model: "F156", type: "Grand", priceCents: null }),
  piano({ brand: "Steinway & Sons", model: "Model M", type: "Baby Grand", priceCents: 245_000_000 }),
];

console.log("grouping");
const groups = groupPianos(list);
check("9 pianos collapse to 5 model cards", groups.length, 5);
const u1 = groups.find((g) => g.lead.model === "U1")!;
check("U1 group holds 5 units", u1.units.length, 5);
check("U1 counts 4 available", u1.availableCount, 4);
check("U1 counts 1 reserved", u1.reservedCount, 1);
check("mixed years hide the year", u1.year, null);
check("same condition is kept", u1.condition, "Good");
check("different price is a different card", groupPianos([piano({ model: "X", priceCents: 1 }), piano({ model: "X", priceCents: 2 })]).length, 2);
check("different year alone does not split", groupPianos([piano({ model: "Y", year: 1980 }), piano({ model: "Y", year: 1999 })]).length, 1);

console.log("featured");
const reservedOnly = groupPianos([piano({ model: "R", status: "reserved" }), ...list]);
const feat = featuredGroups(reservedOnly, 3);
check("featured returns requested count", feat.length, 3);
check("available models come before reserved-only", feat.every((g) => g.availableCount > 0), true);

console.log("filters");
const ids = (f: Parameters<typeof matchesFilter>[1]) => groups.filter((g) => matchesFilter(g, f)).map((g) => g.lead.model).sort();
check("upright", ids("upright"), ["K-500", "U1"]);
check("grand includes baby grand", ids("grand"), ["F156", "GP-156", "Model M"]);
check("under 60k", ids("under60"), ["K-500"]);
check("60k–120k", ids("mid"), ["U1"]);
check("120k+", ids("over120"), ["GP-156", "Model M"]);
check("price-on-request only shows under All/type", ids("all").includes("F156") && !ids("under60").includes("F156") && !ids("over120").includes("F156"), true);

console.log("alt text");
check("alt uses stored fields only", pianoAlt({ brand: "Yamaha", model: "U1", year: 1985, type: "Upright", condition: "Reconditioned" }), "Yamaha U1 upright piano, 1985, reconditioned condition");
check("alt copes with missing year", pianoAlt({ brand: "Kawai", model: "K-500", year: null, type: "Upright", condition: "Like New" }), "Kawai K-500 upright piano, like new condition");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall showroom checks passed");
