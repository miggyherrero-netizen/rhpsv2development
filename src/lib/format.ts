const pesoFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export const peso = (cents: number) => pesoFmt.format(cents / 100);

export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function fmtClockDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Display always renders in the business's own timezone, not the server process's local zone —
// the Docker container runs in UTC, so an unzoned Intl.DateTimeFormat silently shows the wrong wall-clock time.
const BUSINESS_TZ = "Asia/Manila";

export function fmtTime(d: Date, format: "12h" | "24h" = "12h"): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
    timeZone: BUSINESS_TZ,
  }).format(d);
}

export function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TZ,
  }).format(d);
}

export function fmtDateLong(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: BUSINESS_TZ,
  }).format(d);
}

export function fmtMonthYear(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: BUSINESS_TZ }).format(d);
}

export function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function earnedCents(clockIn: Date, rateCents: number, now = Date.now()): number {
  return Math.max(0, ((now - new Date(clockIn).getTime()) / 3_600_000) * rateCents);
}

/** Earnings that pause while on break — completed break minutes plus any break in progress are excluded. */
export function earnedCentsWithBreaks(
  clockIn: Date,
  rateCents: number,
  breakMinutes: number,
  breakStartedAt: Date | null,
  now = Date.now(),
): number {
  const grossMs = now - new Date(clockIn).getTime();
  const ongoingBreakMs = breakStartedAt ? Math.max(0, now - new Date(breakStartedAt).getTime()) : 0;
  const workedMs = grossMs - breakMinutes * 60_000 - ongoingBreakMs;
  return Math.max(0, (workedMs / 3_600_000) * rateCents);
}

function manilaParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { y: get("year"), mo: get("month"), da: get("day"), h: get("hour") === "24" ? "00" : get("hour"), mi: get("minute") };
}

export function toLocalInput(d: Date): string {
  const p = manilaParts(d);
  return `${p.y}-${p.mo}-${p.da}T${p.h}:${p.mi}`;
}

export function toDateInput(d: Date): string {
  const p = manilaParts(d);
  return `${p.y}-${p.mo}-${p.da}`;
}
