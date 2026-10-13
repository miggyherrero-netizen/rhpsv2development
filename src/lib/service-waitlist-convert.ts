/**
 * Waitlist -> job, as pure functions: which entries can be converted, what a converted job starts with,
 * and how the Jobs page reads the ?new=1&customer=..&piano=.. link. No DB, no React.
 */
import { peso } from "@/lib/format";
import { SERVICE_TYPE_LABEL } from "@/lib/service";

/** The statuses that still need a visit booked. "Scheduled" and "done" already have one. */
export const CONVERTIBLE_STATUSES = ["waiting", "messaged", "confirmed", "not_now"] as const;

/** A waitlist row can be turned into a job unless it is already booked, finished, or linked to a job. */
export function canConvertEntry(e: { status: string; jobId: string | null }): boolean {
  return !e.jobId && (CONVERTIBLE_STATUSES as readonly string[]).includes(e.status);
}

export type ConvertEntry = {
  customerId: string; pianoId: string | null; serviceType: string;
  cityCode: string | null; barangayCode: string | null; estValueCents: number; notes: string | null;
};
export type ConvertLocation = { id: string; cityCode: string | null; barangayCode: string | null };
/** `titleName`: what the job title may say (never a placeholder); defaults to `label`. */
export type ConvertPiano = { id: string; label: string; titleName?: string };

/**
 * What the job form starts with. Only what the entry knows; time, technician, price and the rest stay open.
 * The entry's notes and estimate are the owner's own, so they go into the PRIVATE notes; the client-visible notes start empty.
 */
export type JobInitial = {
  customerId: string; locationId: string | null; pianoId: string | null;
  title: string; serviceType: string; privateNotes: string;
};

/** The location in the entry's city (and barangay, when both match), else the customer's first one. */
export function pickLocationId(entry: Pick<ConvertEntry, "cityCode" | "barangayCode">, locations: ConvertLocation[]): string | null {
  if (!locations.length) return null;
  const inCity = entry.cityCode ? locations.filter((l) => l.cityCode === entry.cityCode) : [];
  const exact = entry.barangayCode ? inCity.find((l) => l.barangayCode === entry.barangayCode) : undefined;
  return (exact ?? inCity[0] ?? locations[0])!.id;
}

/** The entry's piano; failing that the customer's only piano; failing that none (the form asks). */
export function pickPianoId(entryPianoId: string | null, pianos: ConvertPiano[]): string | null {
  if (entryPianoId) return entryPianoId;
  return pianos.length === 1 ? pianos[0]!.id : null;
}

export function waitlistToJobInitial(
  entry: ConvertEntry, customer: { id: string }, locations: ConvertLocation[], pianos: ConvertPiano[],
): JobInitial {
  const pianoId = pickPianoId(entry.pianoId, pianos);
  const typeLabel = SERVICE_TYPE_LABEL[entry.serviceType] ?? "Visit";
  const picked = pianos.find((p) => p.id === pianoId);
  const pianoLabel = picked ? picked.titleName ?? picked.label : "";
  const lines = [entry.notes?.trim() ?? "", entry.estValueCents > 0 ? `Estimated value ${peso(entry.estValueCents)}` : ""].filter(Boolean);
  return {
    customerId: customer.id,
    locationId: pickLocationId(entry, locations),
    pianoId,
    title: pianoLabel ? `${typeLabel} — ${pianoLabel}` : typeLabel,
    serviceType: entry.serviceType,
    privateNotes: lines.join("\n"),
  };
}

/* ------------------------------------------------------------------ Jobs page link */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const uuidOrNull = (v: string | string[] | undefined): string | null => { const s = one(v)?.trim(); return s && UUID_RE.test(s) ? s.toLowerCase() : null; };

export type JobsPageParams = { open: boolean; customerId: string | null; pianoId: string | null; filter: string | undefined };

/** ?new=1 opens the new-job form; ?customer / ?piano fill it in. Anything that isn't a UUID is dropped. */
export function parseJobsPageParams(sp: { new?: string | string[]; filter?: string | string[]; customer?: string | string[]; piano?: string | string[] }): JobsPageParams {
  return { open: one(sp.new) === "1", customerId: uuidOrNull(sp.customer), pianoId: uuidOrNull(sp.piano), filter: one(sp.filter) };
}

/**
 * Checks the ids from the link against what exists. The piano must belong to the customer; a piano alone brings its
 * owner along; an unknown customer or a piano of someone else is ignored (the form still opens, just not filled in).
 */
export function resolveJobsPrefill(
  p: Pick<JobsPageParams, "customerId" | "pianoId">,
  known: { customerIds: ReadonlySet<string>; pianoOwnerId: string | null },
): { customerId: string; pianoId: string | null } | null {
  const pianoOwner = p.pianoId ? known.pianoOwnerId?.toLowerCase() ?? null : null;
  const customerId = p.customerId ?? pianoOwner;
  if (!customerId || ![...known.customerIds].some((id) => id.toLowerCase() === customerId)) return null;
  const pianoOk = !!p.pianoId && pianoOwner === customerId;
  return { customerId: [...known.customerIds].find((id) => id.toLowerCase() === customerId)!, pianoId: pianoOk ? p.pianoId : null };
}

/** The link's customer/piano only matter when it also asks to open the form (?new=1). */
export const wantsJobsPrefill = (p: Pick<JobsPageParams, "open" | "customerId" | "pianoId">): boolean => p.open && !!(p.customerId || p.pianoId);
