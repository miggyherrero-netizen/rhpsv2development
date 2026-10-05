/**
 * "Last service" for a customer — one rule used by the customer list and the customer page.
 *
 * It is the newest of: the date each finished service job was done, and the last-serviced date kept on each piano
 * (set when a tuning completes, or typed in by the owner for work done before the app). A finished job that never got
 * a `completedAt` (older / imported data) still counts, dated by when it was started or scheduled.
 */

/** Statuses that mean the visit actually happened. */
export const SERVED_STATUSES = ["completed", "invoiced", "paid"] as const;

export type LastServiceJob = {
  status: string;
  jobType?: string | null;
  completedAt?: Date | string | null;
  startedAt?: Date | string | null;
  scheduledStart?: Date | string | null;
  invoicedAt?: Date | string | null;
};

const toTime = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

/** When one job was served, or null if it was not (open, cancelled, a piano sale, no usable date). */
export function jobServedAt(job: LastServiceJob): Date | null {
  if (job.jobType && job.jobType !== "service") return null;
  if (!(SERVED_STATUSES as readonly string[]).includes(job.status)) return null;
  const t = toTime(job.completedAt) ?? toTime(job.startedAt) ?? toTime(job.scheduledStart) ?? toTime(job.invoicedAt);
  return t === null ? null : new Date(t);
}

export function lastServiceDate(
  jobs: LastServiceJob[],
  pianos: { lastServiceAt?: Date | string | null }[] = [],
): Date | null {
  let best: number | null = null;
  for (const t of [...jobs.map((j) => jobServedAt(j)?.getTime() ?? null), ...pianos.map((p) => toTime(p.lastServiceAt))]) {
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}
