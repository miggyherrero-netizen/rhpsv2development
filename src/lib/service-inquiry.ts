/**
 * Quick inquiry: one short form that becomes a waitlist entry. The checks live here, as pure functions, so the
 * screen and the server action apply exactly the same rules. No DB, no React.
 */
import { WAIT_SOURCES, type WaitSource } from "@/lib/service-waitlist";

export const INQUIRY_LIMITS = { name: 120, phone: 40, request: 240, pianoModel: 80, notes: 600, maxValuePesos: 10_000_000 } as const;
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

export const digitsOnly = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
/** Cuts to `max` characters (code points, so an emoji is never split in half). */
const cut = (s: string, max: number): string => Array.from(s).slice(0, max).join("");
const clean = (v: unknown, max: number): string => (typeof v === "string" ? cut(v.trim().replace(/[ \t]+/g, " "), max).trim() : "");

/**
 * The key two phone numbers are compared by. Philippine numbers come as 0917…, +63 917… and 63917…: when a number of at
 * least 10 digits starts with 0 or 63, only its last 10 digits count. The SQL matcher in service-waitlist-core.ts does the
 * same thing, so keep the two in step.
 */
export function phoneMatchKey(digits: string): string {
  const d = digitsOnly(digits);
  return d.length >= 10 && (d.startsWith("0") || d.startsWith("63")) ? d.slice(-10) : d;
}

export type InquiryField = "name" | "phone" | "cityCode" | "request" | "estValue" | "source";
export type QuickInquiryInput = {
  name?: unknown; phone?: unknown; cityCode?: unknown; barangayCode?: unknown; request?: unknown;
  pianoModel?: unknown; estValue?: unknown; notes?: unknown; source?: unknown;
};
export type QuickInquiryValue = {
  name: string; phone: string; phoneDigits: string; phoneKey: string; cityCode: string; barangayCode: string | null; request: string;
  pianoModel: string | null; estValueCents: number; notes: string | null; source: WaitSource;
};
export type QuickInquiryCheck =
  | { ok: true; value: QuickInquiryValue }
  | { ok: false; error: string; errors: Partial<Record<InquiryField, string>> };

/** Accepts 2500, "2,500", "₱2,500.50"; blank means none. Returns centavos, or null when unreadable. */
function pesosToCents(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const cleaned = typeof v === "number" ? String(v) : String(v).replace(/[₱\s,]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function validateQuickInquiry(raw: QuickInquiryInput): QuickInquiryCheck {
  const errors: Partial<Record<InquiryField, string>> = {};
  const name = clean(raw.name, INQUIRY_LIMITS.name);
  const phone = clean(raw.phone, INQUIRY_LIMITS.phone);
  const phoneDigits = digitsOnly(phone);
  const cityCode = clean(raw.cityCode, 20);
  const barangayCode = clean(raw.barangayCode, 20) || null;
  const request = clean(raw.request, INQUIRY_LIMITS.request);
  const pianoModel = clean(raw.pianoModel, INQUIRY_LIMITS.pianoModel) || null;
  const notes = typeof raw.notes === "string" ? cut(raw.notes.trim(), INQUIRY_LIMITS.notes) || null : null;

  if (!name) errors.name = "Enter the customer's name.";
  if (!phone) errors.phone = "Enter a phone number.";
  else if (!/^[\d\s().\-+]+$/.test(phone)) errors.phone = "Use digits only, like 0917 123 4567.";
  else if (/^(\d)\1*$/.test(phoneDigits)) errors.phone = "That doesn't look like a real number.";
  else if (phoneDigits.length < MIN_PHONE_DIGITS) errors.phone = `That number is too short. Use at least ${MIN_PHONE_DIGITS} digits.`;
  else if (phoneDigits.length > MAX_PHONE_DIGITS) errors.phone = `That number is too long. Use at most ${MAX_PHONE_DIGITS} digits.`;
  if (!cityCode) errors.cityCode = "Pick the area.";
  if (!request) errors.request = "Write what they asked for.";

  const cents = pesosToCents(raw.estValue);
  if (cents === null || cents < 0) errors.estValue = "Use a number like 2,500.";
  else if (cents > INQUIRY_LIMITS.maxValuePesos * 100) errors.estValue = "That value is too high.";

  let source: WaitSource = "phone";
  if (raw.source !== undefined && raw.source !== null && raw.source !== "") {
    const found = WAIT_SOURCES.find((s) => s.key === raw.source);
    if (found) source = found.key; else errors.source = "Pick where it came from.";
  }

  const first = (["name", "phone", "cityCode", "request", "estValue", "source"] as InquiryField[]).map((f) => errors[f]).find(Boolean);
  if (first) return { ok: false, error: first, errors };
  return { ok: true, value: { name, phone, phoneDigits, phoneKey: phoneMatchKey(phoneDigits), cityCode, barangayCode, request, pianoModel, estValueCents: cents ?? 0, notes, source } };
}

/** The entry's notes: the request first, then the piano model, then anything extra. Always under 1,000 characters. */
export function composeInquiryNotes(v: Pick<QuickInquiryValue, "request" | "pianoModel" | "notes">): string {
  return cut([v.request, v.pianoModel ? `Piano: ${v.pianoModel}` : "", v.notes ?? ""].filter(Boolean).join("\n"), 1_000);
}

/** Entry sources and customer sources are different lists; this keeps the customer's "where from" honest. */
export function customerSourceFor(source: WaitSource): string {
  return source === "website" || source === "facebook" || source === "walk_in" ? source : "other";
}
