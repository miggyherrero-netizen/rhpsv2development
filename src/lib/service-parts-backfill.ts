/**
 * Plan for the one-time backfill of the derived `service_jobs.parts_cost_cents` column. PURE: no DB.
 * Uses the same `partsCostFromLines` as the save path (recalcJobMoney) and the Finance health check, so the three
 * can never disagree. Selling price never feeds a cost: a line with no explicit cost costs 0.
 */
import { partsCostFromLines } from "@/lib/service-lines";

export type BackfillJob = { id: string; label: string; storedPartsCostCents: number };
export type BackfillLine = { jobId: string; kind: string; qty: number; unitPriceCents: number; costCents: number };
export type BackfillChange = { jobId: string; label: string; oldCents: number; newCents: number };

export function planPartsCostBackfill(jobs: BackfillJob[], lines: BackfillLine[]): BackfillChange[] {
  const byJob = new Map<string, BackfillLine[]>();
  for (const l of lines) {
    const list = byJob.get(l.jobId) ?? [];
    list.push(l);
    byJob.set(l.jobId, list);
  }
  const out: BackfillChange[] = [];
  for (const j of jobs) {
    const newCents = partsCostFromLines(byJob.get(j.id) ?? []);
    if (newCents !== j.storedPartsCostCents) out.push({ jobId: j.id, label: j.label, oldCents: j.storedPartsCostCents, newCents });
  }
  return out;
}
