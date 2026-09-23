export type Recurrence = {
  freq: "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
  interval: number;
  byDay?: number[]; // 0=Sun
  until?: string | null;
  count?: number | null;
  exdates?: string[];
};

const DAY = 86_400_000;
const BUSINESS_TZ = "Asia/Manila";

/**
 * Extract date/time parts in Manila timezone (UTC+8, the business timezone).
 * All date-bucketing logic (ymd, sameDay, etc.) must use this to avoid timezone-dependent bugs
 * when the browser or server process runs in a different timezone.
 */
// Constructing an Intl.DateTimeFormat is expensive (locale/timezone data lookup);
// this function is called many times per render (once per calendar item per day),
// so the formatter is created once and reused rather than on every call.
const MANILA_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Small cache keyed by timestamp: within a single render pass the same Date instants
// (e.g. "now", item.start) are frequently re-parsed via ymd/sameDay/minutesOf calls.
const partsCache = new Map<number, { year: number; month: number; day: number; hour: number; minute: number }>();
const PARTS_CACHE_MAX = 2000;

function manilaParts(d: Date) {
  const t = d.getTime();
  const cached = partsCache.get(t);
  if (cached) return cached;

  const parts = MANILA_FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const result = {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10) - 1, // 0-indexed like Date.getMonth()
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour") === "24" ? "0" : get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };

  if (partsCache.size >= PARTS_CACHE_MAX) partsCache.clear();
  partsCache.set(t, result);
  return result;
}

export const startOfDay = (d: Date) => {
  const p = manilaParts(d);
  return new Date(p.year, p.month, p.day);
};

/**
 * Start of "today" in Asia/Manila (UTC+8, no DST), as a UTC instant — independent of the
 * server process's own timezone (Docker containers default to UTC, not Manila).
 */
export function startOfManilaDayUTC(now: Date = new Date()): Date {
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0) - MANILA_OFFSET_MS);
}

export const endOfDay = (d: Date) => {
  const p = manilaParts(d);
  return new Date(p.year, p.month, p.day, 23, 59, 59, 999);
};

export const addDays = (d: Date, n: number) => {
  const p = manilaParts(d);
  return new Date(p.year, p.month, p.day + n);
};

export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

export const sameDay = (a: Date, b: Date) => {
  const pa = manilaParts(a);
  const pb = manilaParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
};

export const ymd = (d: Date) => {
  const p = manilaParts(d);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

export const minutesOf = (d: Date) => {
  const p = manilaParts(d);
  return p.hour * 60 + p.minute;
};

export function startOfWeek(d: Date, weekStart = 1): Date {
  const p = manilaParts(d);
  const dateInManila = new Date(p.year, p.month, p.day);
  const dayOfWeek = dateInManila.getDay();
  const diff = (dayOfWeek - weekStart + 7) % 7;
  return startOfDay(addDays(d, -diff));
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export function monthDiff(a: Date, b: Date): number {
  const pa = manilaParts(a);
  const pb = manilaParts(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

function dayMatches(d: Date, start: Date, rec: Recurrence): boolean {
  if (d.getTime() < startOfDay(start).getTime()) return false;
  if (rec.until && startOfDay(d).getTime() > startOfDay(new Date(rec.until)).getTime()) return false;
  const iv = Math.max(1, rec.interval || 1);
  const pd = manilaParts(d);
  const pStart = manilaParts(start);
  const dateInManila = new Date(pd.year, pd.month, pd.day);
  const startDateInManila = new Date(pStart.year, pStart.month, pStart.day);
  const dow = dateInManila.getDay();
  const startDow = startDateInManila.getDay();

  switch (rec.freq) {
    case "daily":
      return dayDiff(start, d) % iv === 0;
    case "weekdays":
      return dow >= 1 && dow <= 5;
    case "weekly": {
      const days = rec.byDay && rec.byDay.length ? rec.byDay : [startDow];
      if (!days.includes(dow)) return false;
      const aligned = addDays(startOfDay(start), -startDow);
      const weeks = Math.floor((startOfDay(d).getTime() - aligned.getTime()) / (7 * DAY));
      return weeks % iv === 0;
    }
    case "monthly":
      return pd.day === pStart.day && monthDiff(start, d) % iv === 0;
    case "yearly":
      return pd.day === pStart.day && pd.month === pStart.month;
  }
}

/** Expand a recurring item starting at `start` into concrete occurrence dates within [from, to]. */
export function expandRecurrence(
  start: Date,
  rec: Recurrence | null | undefined,
  from: Date,
  to: Date,
): Date[] {
  if (!rec) {
    return start >= from && start <= to ? [start] : [];
  }
  const ex = new Set(rec.exdates ?? []);
  const out: Date[] = [];
  let produced = 0;
  // count occurrences from start up to `from` to honor `count`
  const cap = rec.count ?? Infinity;
  let cursor = startOfDay(start);
  const rangeFrom = startOfDay(from);
  while (cursor.getTime() < rangeFrom.getTime()) {
    if (dayMatches(cursor, start, rec) && !ex.has(ymd(cursor))) produced++;
    if (produced >= cap) return out;
    cursor = addDays(cursor, 1);
    if (cursor.getTime() > to.getTime()) return out;
  }
  cursor = rangeFrom;
  const rangeTo = endOfDay(to);
  const pStart = manilaParts(start);
  while (cursor.getTime() <= rangeTo.getTime()) {
    if (dayMatches(cursor, start, rec) && !ex.has(ymd(cursor))) {
      produced++;
      if (produced > cap) break;
      const pCursor = manilaParts(cursor);
      out.push(
        new Date(
          pCursor.year,
          pCursor.month,
          pCursor.day,
          pStart.hour,
          pStart.minute,
        ),
      );
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function isOccurrenceOn(start: Date, rec: Recurrence | null | undefined, day: Date): boolean {
  if (!rec) return sameDay(start, day);
  const ex = new Set(rec.exdates ?? []);
  return dayMatches(startOfDay(day), start, rec) && !ex.has(ymd(day));
}

export const RECURRENCE_PRESETS: { key: string; label: string; rec: Recurrence | null }[] = [
  { key: "none", label: "Does not repeat", rec: null },
  { key: "daily", label: "Daily", rec: { freq: "daily", interval: 1 } },
  { key: "weekdays", label: "Every weekday", rec: { freq: "weekdays", interval: 1 } },
  { key: "weekly", label: "Weekly", rec: { freq: "weekly", interval: 1 } },
  { key: "biweekly", label: "Every 2 weeks", rec: { freq: "weekly", interval: 2 } },
  { key: "monthly", label: "Monthly", rec: { freq: "monthly", interval: 1 } },
  { key: "yearly", label: "Yearly", rec: { freq: "yearly", interval: 1 } },
];

export function recurrenceLabel(rec: Recurrence | null | undefined): string {
  if (!rec) return "";
  const preset = RECURRENCE_PRESETS.find(
    (p) => p.rec && p.rec.freq === rec.freq && p.rec.interval === rec.interval,
  );
  if (preset) return preset.label;
  const base = { daily: "days", weekdays: "weekdays", weekly: "weeks", monthly: "months", yearly: "years" }[rec.freq];
  return `Every ${rec.interval} ${base}`;
}
