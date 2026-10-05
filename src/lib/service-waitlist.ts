/**
 * Waitlist by Area — the rules, as pure functions: follow-up dates, the "2 follow-ups then not now" rule,
 * message-template filling, grouping Region → Province → City, and the headline metrics. No DB, no React.
 */
import { startOfManilaDayUTC } from "@/lib/dates";
import { recallDueDate } from "@/lib/service-sale";

export const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ statuses */

export const WAIT_STATUSES = [
  { key: "waiting", label: "Waiting", tone: "slate" },
  { key: "messaged", label: "Messaged", tone: "azure" },
  { key: "confirmed", label: "Confirmed", tone: "success" },
  { key: "scheduled", label: "Scheduled", tone: "violet" },
  { key: "done", label: "Done", tone: "success" },
  { key: "not_now", label: "Not now", tone: "warn" },
] as const;
export type WaitStatus = (typeof WAIT_STATUSES)[number]["key"];
export const WAIT_STATUS_LABEL: Record<string, string> = Object.fromEntries(WAIT_STATUSES.map((s) => [s.key, s.label]));
export const WAIT_STATUS_TONE: Record<string, "slate" | "azure" | "success" | "violet" | "warn"> = Object.fromEntries(WAIT_STATUSES.map((s) => [s.key, s.tone]));

export const WAIT_SOURCES = [
  { key: "website", label: "Website" }, { key: "facebook", label: "Facebook" }, { key: "phone", label: "Phone" },
  { key: "recall", label: "Recall" }, { key: "walk_in", label: "Walk-in" },
] as const;
export type WaitSource = (typeof WAIT_SOURCES)[number]["key"];
export const WAIT_SOURCE_LABEL: Record<string, string> = Object.fromEntries(WAIT_SOURCES.map((s) => [s.key, s.label]));

/** Entries that are still being worked on (not finished and not parked). */
export const OPEN_WAIT_STATUSES: WaitStatus[] = ["waiting", "messaged", "confirmed", "scheduled"];
/** Statuses that count as "the client said yes". */
export const YES_STATUSES: WaitStatus[] = ["confirmed", "scheduled", "done"];

/* ------------------------------------------------------------------ follow-ups */

export const FOLLOW_UP_DAYS = 3;
export const NOT_NOW_DAYS = 30;
/** The first message plus two follow-ups; after that, no answer means "not now". */
export const MESSAGES_BEFORE_NOT_NOW = 3;
export const LONG_WAIT_DAYS = 14;

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);

/** Every entry must have a next follow-up; a new one defaults to 3 days from now. */
export const defaultNextFollowUp = (now: Date): Date => addDays(now, FOLLOW_UP_DAYS);

export type FollowUpState = {
  status: string;
  followUpCount: number;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date;
};

/**
 * "Messaged ✓": the client was just contacted. Status → messaged, one more message counted, next follow-up in 3 days.
 * An entry coming back from "not now" starts a fresh cycle (the 30-day wait already paid for the pause).
 */
export function afterMessaged(e: Pick<FollowUpState, "status" | "followUpCount">, now: Date): FollowUpState {
  return {
    status: "messaged",
    followUpCount: (e.status === "not_now" ? 0 : e.followUpCount) + 1,
    lastContactedAt: now,
    nextFollowUpAt: defaultNextFollowUp(now),
  };
}

/** Messaged three times (first message + 2 follow-ups), the next follow-up date has passed, still no yes. */
export function shouldGoNotNow(e: Pick<FollowUpState, "status" | "followUpCount" | "nextFollowUpAt">, now: Date): boolean {
  return e.status === "messaged" && e.followUpCount >= MESSAGES_BEFORE_NOT_NOW && e.nextFollowUpAt.getTime() <= now.getTime();
}

export const parkAsNotNow = (now: Date): { status: "not_now"; nextFollowUpAt: Date } => ({ status: "not_now", nextFollowUpAt: addDays(now, NOT_NOW_DAYS) });

/** Due on or before the end of today (Manila), and still worth chasing. */
export function isFollowUpDue(e: { status: string; nextFollowUpAt: Date }, now: Date): boolean {
  if (!["waiting", "messaged", "not_now"].includes(e.status)) return false;
  const endOfToday = startOfManilaDayUTC(now).getTime() + DAY_MS;
  return e.nextFollowUpAt.getTime() < endOfToday;
}

/** Whole days since the request (never negative; a future-dated recall hasn't started waiting yet). */
export const daysWaiting = (requestedAt: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - requestedAt.getTime()) / DAY_MS));
export const isLongWait = (requestedAt: Date, now: Date): boolean => daysWaiting(requestedAt, now) > LONG_WAIT_DAYS;
/** A recall entry dated in the future: on the list, but not waiting yet. */
export const isUpcoming = (requestedAt: Date, now: Date): boolean => requestedAt.getTime() > now.getTime();

/** The entry a completed tuning visit leaves behind: due one tuning interval later, first nudge on that day. */
export function recallEntryFor(job: { completedAt: Date }, intervalMonths: number): { requestedAt: Date; nextFollowUpAt: Date; status: "waiting"; source: "recall" } | null {
  const due = recallDueDate(job.completedAt, intervalMonths);
  return due ? { requestedAt: due, nextFollowUpAt: due, status: "waiting", source: "recall" } : null;
}

/* ------------------------------------------------------------------ templates */

export const PLACEHOLDERS = ["first_name", "area", "date", "time", "piano", "location", "price", "tech_name"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const firstName = (name: string): string => {
  const full = name.trim().replace(/\s+/g, " ");
  const first = full.split(" ")[0] ?? "";
  return first.includes(".") ? full : first || "";
};

/**
 * Fills {placeholders}. A placeholder with no value becomes empty (and is reported in `missing`, so the screen can
 * say what to fill in) — the sentence is tidied so it never shows "at  in" or a dangling comma.
 */
export function fillTemplate(body: string, vars: Partial<Record<Placeholder, string | null | undefined>>): { text: string; missing: Placeholder[] } {
  const missing = new Set<Placeholder>();
  const text = body.replace(/\{([a-z_]+)\}/g, (whole, key: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(key)) return whole;
    const v = vars[key as Placeholder];
    if (v === null || v === undefined || String(v).trim() === "") { missing.add(key as Placeholder); return ""; }
    return String(v).trim();
  });
  const tidy = text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .replace(/([,;:]) *([.!?])/g, "$2")
    .replace(/\( *\)/g, "")
    .replace(/ *\n */g, "\n")
    .trim();
  return { text: tidy, missing: [...missing] };
}

export function messengerHref(handle: string | null | undefined): string | null {
  return handle ? `https://m.me/${encodeURIComponent(handle)}` : null;
}

/** `sms:` link with the message prefilled. "?&body=" is the form both iOS and Android accept. */
export function smsHref(phone: string | null | undefined, body: string): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

export const DEFAULT_TEMPLATES: { key: string; name: string; body: string }[] = [
  {
    key: "area_trip", name: "Trip announcement",
    body: "Hi {first_name}! Mag-service mi sa {area} sa {date}. Gusto ka ba nga i-tune ang imong {piano}? Ma-schedule tika kung naay slot pa. Salamat! — Herrero Pianos",
  },
  {
    key: "follow_up", name: "Follow-up",
    body: "Hi {first_name}! Follow-up lang sa imong {piano} tuning sa {area}. Naa pa ba ka'y interest? Pwede ta mag-set og adlaw. Salamat! — Herrero Pianos",
  },
  {
    key: "confirm_day_before", name: "Confirm the day before",
    body: "Hi {first_name}! Reminder: ugma, {date} mga {time}, moadto mi sa {location} para sa imong {piano}. Si {tech_name} ang moabot. Palihug confirm kung naa ka. Salamat! — Herrero Pianos",
  },
  {
    key: "recall", name: "Tuning recall",
    body: "Hi {first_name}! Panahon na para sa regular nga tuning sa imong {piano}. Naa mi'y schedule sa {area} karong {date}. Gusto ka ba nga i-book? Salamat! — Herrero Pianos",
  },
];

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(d);
const fmtClock = (d: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(d);
export const messageDate = (d: Date | null | undefined): string => (d ? fmtDay(d) : "");
export const messageTime = (d: Date | null | undefined): string => (d ? fmtClock(d) : "");

/* ------------------------------------------------------------------ grouping */

export type WaitRow = {
  id: string;
  cityCode: string | null; cityName: string | null;
  provinceCode: string | null; provinceName: string | null;
  regionCode: string | null; regionShort: string | null;
  requestedAt: Date;
  estValueCents: number;
};

export type CityGroup<T extends WaitRow> = { key: string; name: string; count: number; oldestDays: number; estValueCents: number; entries: T[] };
export type ProvinceGroup<T extends WaitRow> = { key: string; name: string; count: number; oldestDays: number; estValueCents: number; cities: CityGroup<T>[] };
export type RegionGroup<T extends WaitRow> = { key: string; name: string; count: number; oldestDays: number; estValueCents: number; provinces: ProvinceGroup<T>[] };

const UNSORTED = "unsorted";

function stats<T extends WaitRow>(rows: T[], now: Date) {
  const oldest = rows.reduce((m, r) => Math.min(m, r.requestedAt.getTime()), Infinity);
  return { count: rows.length, oldestDays: rows.length ? daysWaiting(new Date(oldest), now) : 0, estValueCents: rows.reduce((s, r) => s + r.estValueCents, 0) };
}

/** Bigger groups first, then the one that has waited longest; "Unsorted" always sits last. Entries oldest first. */
function order<G extends { key: string; count: number; oldestDays: number }>(groups: G[]): G[] {
  return groups.sort((a, b) => (a.key === UNSORTED ? 1 : 0) - (b.key === UNSORTED ? 1 : 0) || b.count - a.count || b.oldestDays - a.oldestDays);
}

export function groupWaitlist<T extends WaitRow>(rows: T[], now: Date): RegionGroup<T>[] {
  const regions = new Map<string, T[]>();
  for (const r of rows) regions.set(r.cityCode ? r.regionCode ?? UNSORTED : UNSORTED, [...(regions.get(r.cityCode ? r.regionCode ?? UNSORTED : UNSORTED) ?? []), r]);
  const out: RegionGroup<T>[] = [];
  for (const [rKey, rRows] of regions) {
    const provs = new Map<string, T[]>();
    for (const r of rRows) { const k = r.provinceCode ?? (r.cityCode ? `none-${r.regionCode}` : UNSORTED); provs.set(k, [...(provs.get(k) ?? []), r]); }
    const provinces: ProvinceGroup<T>[] = [];
    for (const [pKey, pRows] of provs) {
      const cities = new Map<string, T[]>();
      for (const r of pRows) { const k = r.cityCode ?? UNSORTED; cities.set(k, [...(cities.get(k) ?? []), r]); }
      const cityGroups: CityGroup<T>[] = [...cities.entries()].map(([k, list]) => ({
        key: k, name: k === UNSORTED ? "Unsorted" : list[0]!.cityName ?? "—", ...stats(list, now),
        entries: [...list].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
      }));
      provinces.push({ key: pKey, name: pKey === UNSORTED ? "Unsorted" : pRows[0]!.provinceName ?? "Independent cities", ...stats(pRows, now), cities: order(cityGroups) });
    }
    out.push({ key: rKey, name: rKey === UNSORTED ? "Unsorted" : `Region ${rRows[0]!.regionShort ?? ""}`.trim(), ...stats(rRows, now), provinces: order(provinces) });
  }
  return order(out);
}

/* ------------------------------------------------------------------ metrics */

export function avgDaysWaiting(rows: { status: string; requestedAt: Date }[], now: Date): number | null {
  const open = rows.filter((r) => ["waiting", "messaged"].includes(r.status) && !isUpcoming(r.requestedAt, now));
  if (!open.length) return null;
  return Math.round((open.reduce((s, r) => s + daysWaiting(r.requestedAt, now), 0) / open.length) * 10) / 10;
}

/**
 * Of the clients messaged in the last `days` days, the share that said yes. Uses the last time each entry
 * was contacted (there is no per-message history), so it reads as "of recent outreach, how much converted".
 */
export function messagedToConfirmedRate(rows: { status: string; lastContactedAt: Date | null }[], now: Date, days = 30): { messaged: number; confirmed: number; ratePct: number | null } {
  const since = now.getTime() - days * DAY_MS;
  const recent = rows.filter((r) => r.lastContactedAt && r.lastContactedAt.getTime() >= since);
  const confirmed = recent.filter((r) => (YES_STATUSES as string[]).includes(r.status)).length;
  return { messaged: recent.length, confirmed, ratePct: recent.length ? Math.round((confirmed / recent.length) * 100) : null };
}

export function jobsPerTrip(trips: { jobCount: number }[]): number | null {
  const real = trips.filter((t) => t.jobCount > 0);
  if (!real.length) return null;
  return Math.round((real.reduce((s, t) => s + t.jobCount, 0) / real.length) * 10) / 10;
}
