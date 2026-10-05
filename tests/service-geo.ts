/** Distances, trip suggestions, place search. No database. Run: npx tsx tests/service-geo.ts */
import { haversineKm, distanceToSegmentKm, suggestForTrip, fmtKm, areaName, placeLabel, searchPlaces, findCityInText, DAVAO_CITY_CODE } from "../src/lib/service-geo";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const near = (n: number, target: number, tol: number) => Math.abs(n - target) <= tol;

const davao = { lat: 7.0731, lng: 125.6128 };
const digos = { lat: 6.7496, lng: 125.3572 };
const gensan = { lat: 6.1164, lng: 125.1716 };
const tagum = { lat: 7.4478, lng: 125.8078 };
const toril = { lat: 7.0, lng: 125.5 };

console.log("distances");
check("Davao → Digos is about 45 km", near(haversineKm(davao, digos), 45, 4), true);
check("Davao → General Santos is about 117 km in a straight line", near(haversineKm(davao, gensan), 117, 6), true);
check("same point is 0", haversineKm(davao, davao), 0);
check("a point on the line is ~0 km from the route", near(distanceToSegmentKm({ lat: (davao.lat + gensan.lat) / 2, lng: (davao.lng + gensan.lng) / 2 }, davao, gensan), 0, 0.5), true);
check("beyond the destination the distance is to the end point, not the infinite line", near(distanceToSegmentKm({ lat: 5.5, lng: 124.9 }, davao, gensan), haversineKm({ lat: 5.5, lng: 124.9 }, gensan), 3), true);
check("a degenerate (zero-length) segment works", near(distanceToSegmentKm(digos, davao, davao), haversineKm(digos, davao), 3), true);
check("Tagum (north) is far from the Davao → Gensan line", distanceToSegmentKm(tagum, davao, gensan) > 40, true);
check("formatting", [fmtKm(0.64), fmtKm(12.4), fmtKm(45)], ["0.6 km", "12 km", "45 km"]);

console.log("\ntrip suggestions (Davao → General Santos, 40 km)");
const cand = (id: string, point: { lat: number; lng: number } | null, sameCity = false) => ({ item: id, point, sameCity });
const s = suggestForTrip({
  home: davao, dest: gensan, radiusKm: 40,
  candidates: [cand("gensan-client", { lat: 6.12, lng: 125.18 }, true), cand("digos", digos), cand("tagum", tagum), cand("toril", toril), cand("nowhere", null), cand("polomolok", { lat: 6.22, lng: 125.07 })],
});
check("on-the-way and near-destination clients are offered", s.map((x) => x.item), ["gensan-client", "polomolok", "toril", "digos", "nowhere"]);
check("Tagum (north, 50+ km off) is not", s.some((x) => x.item === "tagum"), false);
check("reasons", s.map((x) => x.reason), ["at_destination", "near_destination", "on_the_way", "on_the_way", "no_location"]);
check("a client with no known place is kept, last, never dropped", s.at(-1)!.item, "nowhere");
check("every offered client has its distances", s.filter((x) => x.point).every((x) => x.routeKm !== null && x.destKm !== null), true);
check("a wider radius brings Tagum (about 45 km from the line) in", suggestForTrip({ home: davao, dest: gensan, radiusKm: 60, candidates: [cand("tagum", tagum)] }).length, 1);
check("a tiny radius leaves only the destination city", suggestForTrip({ home: davao, dest: gensan, radiusKm: 2, candidates: [cand("a", { lat: 6.12, lng: 125.18 }, true), cand("digos", digos)] }).map((x) => x.item), ["a"]);

console.log("\nhome-city clients");
const homeTrip = suggestForTrip({
  home: davao, dest: digos, radiusKm: 20,
  candidates: [{ item: "davao-client", point: { lat: 7.07, lng: 125.61 }, atHome: true }, { item: "digos-client", point: digos, sameCity: true }, { item: "home-to-home", point: { lat: 7.07, lng: 125.61 }, atHome: true, sameCity: true }],
});
check("clients in the home city aren't offered for a trip elsewhere", homeTrip.map((x) => x.item), ["digos-client", "home-to-home"]);

console.log("\nnames and search");
check("{area} is the barangay inside Davao City", areaName({ code: DAVAO_CITY_CODE, name: "Davao" }, { name: "Toril" }), "Toril");
check("…and the city everywhere else", areaName({ code: "112401000", name: "Digos" }, { name: "Zone 1" }), "Digos");
check("…the city when Davao City has no barangay", areaName({ code: DAVAO_CITY_CODE, name: "Davao" }, null), "Davao");
check("label", placeLabel({ city: "Digos", province: "Davao del Sur", regionShort: "XI" }), "Digos · Davao del Sur · Region XI");
const places = [{ name: "Digos", fullName: "City of Digos" }, { name: "General Santos", fullName: "City of General Santos" }, { name: "Santo Tomas", fullName: "Santo Tomas" }, { name: "Davao", fullName: "City of Davao" }];
check("typeahead finds by any word", searchPlaces(places, "santos").map((p) => p.name), ["General Santos"]);
check("prefix matches rank first", searchPlaces(places, "sant").map((p) => p.name), ["Santo Tomas", "General Santos"]);
check("accents and case don't matter", searchPlaces(places, "DÍGOS").map((p) => p.name), ["Digos"]);
check("empty query -> nothing", searchPlaces(places, " "), []);
check("Sta. / Sto. / Gen. abbreviations find the spelled-out names", [
  searchPlaces([{ name: "Santa Cruz" }, { name: "Santo Tomas" }], "sta. cruz").map((p) => p.name),
  searchPlaces([{ name: "Santa Cruz" }, { name: "Santo Tomas" }], "sto tomas").map((p) => p.name),
  searchPlaces(places, "gen santos").map((p) => p.name),
], [["Santa Cruz"], ["Santo Tomas"], ["General Santos"]]);
check("city found in an address", findCityInText("Blk 4 Lot 2, Matti, Digos City, Davao del Sur", places)?.name, "Digos");
check("longest name wins (General Santos before Santos)", findCityInText("we are in general santos", [...places, { name: "Santos" }])?.name, "General Santos");
check("a short city name only counts after taga / sa / in", [findCityInText("Mati ra ko, dili ko ganahan", [{ name: "Mati" }])?.name ?? null, findCityInText("taga Mati ko", [{ name: "Mati" }])?.name ?? null], [null, "Mati"]);
check("nothing recognised -> null (Unsorted)", findCityInText("somewhere far away", places), null);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall geo checks passed");
