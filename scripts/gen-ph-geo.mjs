#!/usr/bin/env node
/**
 * One-time generator for the Mindanao geography data (regions, provinces, cities/municipalities with lat/lng,
 * and every barangay of Davao City). Sources: PSGC (psgc.gitlab.io) for the names and codes, Wikidata (P988 PSGC code,
 * P625 coordinates) for lat/lng, and OpenStreetMap Nominatim only for the few places Wikidata doesn't cover.
 *
 *   node scripts/gen-ph-geo.mjs
 *
 * Writes src/data/ph-mindanao.json. Run it again any time; the committed JSON is what the app and the SQL seed use.
 */
import fs from "node:fs";

const UA = "herrero-pianos-geo-seed/1.0 (miggyherrero@gmail.com)";
const REGIONS = { "090000000": "IX", "100000000": "X", "110000000": "XI", "120000000": "XII", "160000000": "XIII", "150000000": "BARMM" };
const DAVAO_CITY = "112402000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, headers = {}) => {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
    if (res.ok) return res.json();
    await sleep(1500 * (i + 1));
  }
  throw new Error(`GET failed: ${url}`);
};

const title = (s) => s.replace(/\s+/g, " ").trim().replace(/\b([a-z])\./g, (_, c) => `${c.toUpperCase()}.`).replace(/\bDel\b/g, "del").replace(/\bDe\b/g, "de").replace(/\bNg\b/g, "ng").replace(/\bSa\b/g, "sa");
const clean = (s) => title(s.replace(/^City of /i, "").replace(/ City$/i, ""));

const regionsAll = await get("https://psgc.gitlab.io/api/regions/");
const regions = regionsAll.filter((r) => REGIONS[r.code]).map((r) => ({ code: r.code, name: r.name, short: REGIONS[r.code] }));

const provinces = [];
const cities = [];
for (const r of regions) {
  const provs = await get(`https://psgc.gitlab.io/api/regions/${r.code}/provinces/`);
  const cms = await get(`https://psgc.gitlab.io/api/regions/${r.code}/cities-municipalities/`);
  for (const p of provs) provinces.push({ code: p.code, name: title(p.name), regionCode: r.code });
  const provCodes = new Set(provs.map((p) => p.code));
  for (const c of cms) {
    // Highly urbanised cities come back without a province: the first four digits point to their parent province.
    const guess = `${c.code.slice(0, 4)}00000`;
    const provinceCode = c.provinceCode && provCodes.has(c.provinceCode) ? c.provinceCode : provCodes.has(guess) ? guess : null;
    cities.push({
      code: c.code, name: clean(c.name), fullName: title(c.name), kind: c.isCity ? "city" : "municipality",
      provinceCode, regionCode: r.code, lat: null, lng: null,
    });
  }
  console.log(r.short, provs.length, "provinces", cms.length, "cities/municipalities");
}

/* ---- coordinates from Wikidata (matched on the first six digits of the PSGC code) ---- */
const sparql = `SELECT ?psgc ?coord WHERE { ?item wdt:P988 ?psgc . ?item wdt:P625 ?coord . FILTER(REGEX(?psgc, "^(09|10|11|12|15|16|19)[0-9]{4}")) }`;
const wd = await get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, { Accept: "application/sparql-results+json" });
const byPrefix = new Map();
for (const b of wd.results.bindings) {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
  if (!m) continue;
  const key = b.psgc.value.slice(0, 6);
  if (!byPrefix.has(key)) byPrefix.set(key, { lng: +m[1], lat: +m[2] });
}
let matched = 0;
for (const c of cities) {
  const hit = byPrefix.get(c.code.slice(0, 6));
  if (hit) { c.lat = +hit.lat.toFixed(5); c.lng = +hit.lng.toFixed(5); matched++; }
}
console.log("Wikidata coordinates:", matched, "of", cities.length);

/* ---- Nominatim for the rest (1 request / second, as its usage policy asks) ---- */
const provName = new Map(provinces.map((p) => [p.code, p.name]));
for (const c of cities.filter((x) => x.lat === null)) {
  const q = [c.name, provName.get(c.provinceCode ?? ""), "Philippines"].filter(Boolean).join(", ");
  try {
    const res = await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(q)}`);
    if (res[0]) { c.lat = +(+res[0].lat).toFixed(5); c.lng = +(+res[0].lon).toFixed(5); }
  } catch { /* leave null: the city still works everywhere except distance suggestions */ }
  await sleep(1100);
}
// Hand-checked fixes for places Nominatim could not match by their PSGC name (looked up under their OSM names).
const OVERRIDES = { "097211000": [8.52045, 123.23123], "126512000": [6.45964, 124.32211], "153622000": [7.85313, 124.33944], "153627000": [7.89988, 124.33395] };
for (const c of cities) if (c.lat === null && OVERRIDES[c.code]) [c.lat, c.lng] = OVERRIDES[c.code];
const missing = cities.filter((c) => c.lat === null);
console.log("Still without coordinates:", missing.length, missing.slice(0, 10).map((c) => c.name));

/* ---- Davao City barangays ---- */
const brgys = (await get(`https://psgc.gitlab.io/api/cities-municipalities/${DAVAO_CITY}/barangays/`)).map((b) => ({ code: b.code, name: title(b.name), cityCode: DAVAO_CITY }));
console.log("Davao City barangays:", brgys.length);

fs.writeFileSync("src/data/ph-mindanao.json", JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), regions, provinces, cities, barangays: brgys }, null, 0));
console.log("wrote src/data/ph-mindanao.json");
