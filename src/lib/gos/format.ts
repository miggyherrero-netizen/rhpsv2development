const TZ = "Asia/Manila";

export function manilaTime(d: Date): string {
  return new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

export function manilaDate(d: Date): string {
  return new Intl.DateTimeFormat("en-PH", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }).format(d);
}

export function manilaDateTime(d: Date): string {
  return `${manilaDate(d)}, ${manilaTime(d)}`;
}

export const INBOX_URL = "https://business.facebook.com/latest/inbox";
