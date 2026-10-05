#!/usr/bin/env node
/**
 * Turns src/data/ph-mindanao.json into drizzle/manual/06_ph_geo_seed.sql (idempotent upserts, parents before children).
 *   node scripts/gen-ph-geo-sql.mjs
 */
import fs from "node:fs";

const d = JSON.parse(fs.readFileSync("src/data/ph-mindanao.json", "utf8"));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const num = (n) => (n === null || n === undefined ? "NULL" : String(n));
const rows = (list, fn) => list.map((x) => `  (${fn(x)})`).join(",\n");

const out = [];
out.push(`-- Home Service · Waitlist by Area — Mindanao geography seed (generated ${d.generatedAt} from PSGC; coordinates from Wikidata / OpenStreetMap)`);
out.push(`-- ${d.regions.length} regions, ${d.provinces.length} provinces, ${d.cities.length} cities & municipalities, ${d.barangays.length} Davao City barangays.`);
out.push(`-- Idempotent: safe to run again (rows are updated in place). Run AFTER 05_waitlist_schema.sql.`);
out.push(`BEGIN;`);
out.push(`INSERT INTO ph_regions (code, name, short_name) VALUES\n${rows(d.regions, (r) => `${q(r.code)}, ${q(r.name)}, ${q(r.short)}`)}\nON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name;`);
out.push(`INSERT INTO ph_provinces (code, name, region_code) VALUES\n${rows(d.provinces, (p) => `${q(p.code)}, ${q(p.name)}, ${q(p.regionCode)}`)}\nON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, region_code = EXCLUDED.region_code;`);
out.push(`INSERT INTO ph_cities (code, name, full_name, kind, province_code, region_code, lat, lng) VALUES\n${rows(d.cities, (c) => `${q(c.code)}, ${q(c.name)}, ${q(c.fullName)}, ${q(c.kind)}, ${c.provinceCode ? q(c.provinceCode) : "NULL"}, ${q(c.regionCode)}, ${num(c.lat)}, ${num(c.lng)}`)}\nON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, full_name = EXCLUDED.full_name, kind = EXCLUDED.kind, province_code = EXCLUDED.province_code, region_code = EXCLUDED.region_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng;`);
out.push(`INSERT INTO ph_barangays (code, name, city_code) VALUES\n${rows(d.barangays, (b) => `${q(b.code)}, ${q(b.name)}, ${q(b.cityCode)}`)}\nON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, city_code = EXCLUDED.city_code;`);
out.push(`COMMIT;`);
fs.writeFileSync("drizzle/manual/06_ph_geo_seed.sql", out.join("\n\n") + "\n");
console.log("wrote drizzle/manual/06_ph_geo_seed.sql", out.join("").length, "bytes");
