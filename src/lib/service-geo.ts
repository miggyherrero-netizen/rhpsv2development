/**
 * Geography helpers for the Waitlist: straight-line distances, "who is near the way to the destination",
 * and how a place is named in messages. Pure — no DB, no React. Distances are great-circle kilometres.
 */

export type LatLng = { lat: number; lng: number };

const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shortest distance from point `p` to the straight segment a→b, in km. Mindanao-scale trips (a few hundred km)
 * are handled in a local flat projection centred on the point, which is accurate to well under a kilometre there.
 */
export function distanceToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos(rad(p.lat)) * ((Math.PI / 180) * R_KM);
  const ky = (Math.PI / 180) * R_KM;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export type TripCandidate<T> = {
  item: T;
  point: LatLng | null;
  /** Distance to the home→destination line, km. */
  routeKm: number | null;
  /** Distance to the destination itself, km. */
  destKm: number | null;
  /** Which test it passed. */
  reason: "at_destination" | "near_destination" | "on_the_way" | "no_location";
};

/**
 * Waiting clients worth offering for a trip to `dest`: anyone within `radiusKm` of the straight line from the
 * home base to the destination, or within `radiusKm` of the destination. Clients with no known place are returned
 * last (reason "no_location") so they are never silently dropped. Nearest first.
 */
export function suggestForTrip<T>(input: {
  home: LatLng; dest: LatLng; radiusKm: number;
  /** `atHome`: lives in the home-base city — only offered when the trip is to that same city (the route starts there, so they are always "on the way"). */
  candidates: { item: T; point: LatLng | null; sameCity?: boolean; atHome?: boolean }[];
}): TripCandidate<T>[] {
  const out: TripCandidate<T>[] = [];
  for (const c of input.candidates) {
    if (!c.point) { out.push({ item: c.item, point: null, routeKm: null, destKm: null, reason: "no_location" }); continue; }
    if (c.atHome && !c.sameCity) continue;
    const routeKm = distanceToSegmentKm(c.point, input.home, input.dest);
    const destKm = haversineKm(c.point, input.dest);
    if (c.sameCity || destKm <= 1) out.push({ item: c.item, point: c.point, routeKm, destKm, reason: "at_destination" });
    else if (destKm <= input.radiusKm) out.push({ item: c.item, point: c.point, routeKm, destKm, reason: "near_destination" });
    else if (routeKm <= input.radiusKm) out.push({ item: c.item, point: c.point, routeKm, destKm, reason: "on_the_way" });
  }
  // Destination city first, then those near it (closest first), then those on the way (closest to the line first).
  const order = { at_destination: 0, near_destination: 1, on_the_way: 2, no_location: 3 } as const;
  const metric = (t: TripCandidate<T>) => (t.reason === "on_the_way" ? t.routeKm ?? 0 : t.destKm ?? 0);
  return out.sort((a, b) => order[a.reason] - order[b.reason] || metric(a) - metric(b));
}

/** "12 km" / "0.6 km" — whole km above 10, one decimal below. */
export const fmtKm = (km: number): string => (km >= 10 ? `${Math.round(km)} km` : `${(Math.round(km * 10) / 10).toString()} km`);

/* ------------------------------------------------------------------ names */

export const DAVAO_CITY_CODE = "112402000";

/** What {area} means in a message: the city, except Davao City where the barangay is what people recognise. */
export function areaName(city: { code: string; name: string } | null, barangay?: { name: string } | null): string {
  if (!city) return "";
  if (city.code === DAVAO_CITY_CODE && barangay?.name) return barangay.name;
  return city.name;
}

/** "Digos · Davao del Sur · XI" for typeahead rows. */
export function placeLabel(p: { city: string; province?: string | null; regionShort?: string | null }): string {
  return [p.city, p.province, p.regionShort ? `Region ${p.regionShort}` : null].filter(Boolean).join(" · ");
}

/** "Sta. Cruz", "Sto. Tomas", "Gen. Santos", "Pres. Roxas" are how people type them; the lists spell them out. */
const ABBREVIATIONS: [RegExp, string][] = [[/\bsta\b/g, "santa"], [/\bsto\b/g, "santo"], [/\bgen\b/g, "general"], [/\bpres\b/g, "president"], [/\bsen\b/g, "senator"]];

const norm = (s: string) => {
  let t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ");
  t = t.replace(/\bcity of\b|\bcity\b/g, " ");
  for (const [re, full] of ABBREVIATIONS) t = t.replace(re, full);
  return t.replace(/\s+/g, " ").trim();
};

/** Typeahead over cities/municipalities: every typed word must appear in the name, prefix matches first. */
export function searchPlaces<T extends { name: string; fullName?: string }>(places: T[], query: string, limit = 8): T[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored: { p: T; score: number }[] = [];
  for (const p of places) {
    const n = norm(p.fullName ?? p.name);
    if (!words.every((w) => n.includes(w))) continue;
    scored.push({ p, score: n.startsWith(words[0]!) ? 0 : n.split(" ").some((t) => t.startsWith(words[0]!)) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((s) => s.p);
}

/**
 * Best-effort city from free text (a website inquiry's address or message). Longest name first so "General Santos"
 * wins over "Santos"; returns null when nothing is recognised (the entry then lands in "Unsorted").
 */
export function findCityInText<T extends { name: string }>(text: string, cities: T[]): T | null {
  const raw = text.toLowerCase();
  const hay = ` ${norm(text)} `;
  if (hay.trim() === "") return null;
  const sorted = [...cities].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    const n = norm(c.name);
    if (n.length < 4) continue;
    // Short names (Mati, Tago, Lupon…) are also ordinary words: they only count after "taga / sa / in / from / city of",
    // before "City", or as a comma-separated address part ("Matti, Digos").
    const short = n.length < 6;
    if (!short ? hay.includes(` ${n} `) : new RegExp(` (taga|sa|in|at|from|ng|city of) ${n} `).test(hay) || (raw.includes(`${n} city`)) || new RegExp(`[,;]\\s*${n}\\b`).test(raw)) return c;
  }
  return null;
}
