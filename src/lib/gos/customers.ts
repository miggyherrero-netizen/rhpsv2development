import type { TEMPLATE_KEYS } from "@/lib/gos/settings";

export const STATUSES = ["New", "Replied", "Quoted", "Booked", "Completed", "Paid", "Lost"] as const;
export type CustomerStatus = (typeof STATUSES)[number];

export const CAME_FROM = ["Messenger", "Phone / text", "Walk-in", "Referral", "Repeat customer", "Other"] as const;

const STATUS_ICON: Record<CustomerStatus, string> = {
  New: "●", Replied: "↩", Quoted: "₱", Booked: "▣", Completed: "✔", Paid: "✔✔", Lost: "✕",
};

/** Status is always shown as icon + text, never color alone. */
export function customerStatusLabel(status: CustomerStatus): string {
  return `${STATUS_ICON[status]} ${status}`;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isDuplicateName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

export function replyDue(inquiryAt: Date, noReplyMinutes: number): Date {
  return new Date(inquiryAt.getTime() + noReplyMinutes * 60_000);
}

export type ReplyState = "waiting" | "overdue" | "overdue-day";

export function replyState(inquiryAt: Date, noReplyMinutes: number, now: Date): ReplyState {
  if (now.getTime() - inquiryAt.getTime() >= 24 * 3_600_000) return "overdue-day";
  return now.getTime() >= replyDue(inquiryAt, noReplyMinutes).getTime() ? "overdue" : "waiting";
}

export const statusAfterMarkReplied = (s: CustomerStatus): CustomerStatus | null => (s === "New" ? "Replied" : null);
export const statusAfterUndoReplied = (s: CustomerStatus): CustomerStatus | null => (s === "Replied" ? "New" : null);
export const statusAfterLost = (s: CustomerStatus): CustomerStatus | null => (s === "Lost" ? null : "Lost");
export function statusAfterReopen(s: CustomerStatus, before: CustomerStatus | null): CustomerStatus | null {
  return s === "Lost" ? (before && before !== "Lost" ? before : "New") : null;
}

export function templateKeyFor(status: CustomerStatus): (typeof TEMPLATE_KEYS)[number] {
  return status === "New" ? "newInquiry" : "general";
}

/** Fills {name} {area}; when area is empty, the sentence/line holding {area} is dropped (AC-3.1). */
export function fillTemplate(text: string, vars: { name: string; area?: string | null }): string {
  const area = vars.area?.trim() ?? "";
  const lines = text.split("\n").map((line) => {
    if (area) return line;
    return line.split(/(?<=[.?!])\s+/).filter((s) => !s.includes("{area}")).join(" ");
  });
  return lines
    .filter((l, i) => area || l.trim() !== "" || text.split("\n")[i].trim() === "")
    .join("\n")
    .replaceAll("{name}", vars.name)
    .replaceAll("{area}", area);
}

/** Optimal-string-alignment distance (counts a swap of two letters as 1). */
function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** 0 = no match. Prefix 100, contains 60, typo (1–2 edits) 30. */
export function searchScore(query: string, text: string): number {
  const q = normalizeName(query);
  const t = normalizeName(text);
  if (!q || !t) return 0;
  if (t.startsWith(q) || t.split(/[\s,]+/).some((w) => w.startsWith(q))) return 100;
  if (t.includes(q)) return 60;
  const maxEdits = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  if (maxEdits === 0) return 0;
  return t.split(/[\s,]+/).some((w) => osa(q, w.slice(0, q.length + 1)) <= maxEdits || osa(q, w) <= maxEdits) ? 30 : 0;
}
