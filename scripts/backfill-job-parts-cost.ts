/**
 * One-time backfill: recompute service_jobs.parts_cost_cents from the job lines (qty x explicit cost, null cost = 0).
 * Only that derived column is written. Idempotent: a second run finds nothing to change.
 *
 *   npx tsx scripts/backfill-job-parts-cost.ts --dry-run   # prints job no., old value, new value; writes nothing
 *   npx tsx scripts/backfill-job-parts-cost.ts --apply     # writes, in one transaction
 *
 * Without a flag it behaves like --dry-run. Reads DATABASE_URL (same as the app); run it yourself against the live DB.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { serviceJobItems, serviceJobs, serviceSettings } from "../src/db/schema";
import { jobCode } from "../src/lib/service";
import { planPartsCostBackfill } from "../src/lib/service-parts-backfill";

const peso = (cents: number) => `P${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

async function main() {
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const [prefixRow] = await db.select({ jobPrefix: serviceSettings.jobPrefix }).from(serviceSettings).limit(1);
  const prefix = prefixRow?.jobPrefix ?? "WO";

  const jobs = await db.select({ id: serviceJobs.id, jobNumber: serviceJobs.jobNumber, createdAt: serviceJobs.createdAt, stored: serviceJobs.partsCostCents }).from(serviceJobs);
  const lines = await db
    .select({ jobId: serviceJobItems.jobId, kind: serviceJobItems.kind, qty: serviceJobItems.qty, unitPriceCents: serviceJobItems.unitPriceCents, costCents: serviceJobItems.costCents })
    .from(serviceJobItems);

  const changes = planPartsCostBackfill(
    jobs.map((j) => ({ id: j.id, label: jobCode(prefix, j.jobNumber, j.createdAt), storedPartsCostCents: j.stored })),
    lines,
  );

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${jobs.length} jobs checked, ${changes.length} to change`);
  for (const c of changes) console.log(`  ${c.label}  old ${peso(c.oldCents)}  ->  new ${peso(c.newCents)}`);

  if (apply && changes.length) {
    await db.transaction(async (tx) => {
      for (const c of changes) await tx.update(serviceJobs).set({ partsCostCents: c.newCents }).where(eq(serviceJobs.id, c.jobId));
    });
    console.log(`Updated ${changes.length} job(s).`);
  } else if (!apply) {
    console.log("Nothing written. Re-run with --apply to write.");
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
