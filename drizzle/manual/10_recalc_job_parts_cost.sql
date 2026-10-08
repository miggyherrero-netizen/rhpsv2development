-- 10_recalc_job_parts_cost.sql
-- Job cost rules R1+R2+F (2026-10-08): a part line with no explicit cost now costs 0 (it used to cost its selling price).
--
-- This only rewrites a DERIVED column: service_jobs.parts_cost_cents is a materialized copy of
-- sum(qty * cost_cents) over the job's part lines (cost_cents > 0). The app computes job margins from the lines at
-- read time anyway, so the numbers owners see do not depend on this file; it just clears the "Parts cost does not
-- match the job lines" warnings in Finance health for jobs saved under the old rule.
--
-- Additive and idempotent: no schema change, no other column touched (updated_at is left as is), safe to run repeatedly.
BEGIN;

UPDATE service_jobs j
SET parts_cost_cents = COALESCE((
  SELECT SUM(i.qty * i.cost_cents)
  FROM service_job_items i
  WHERE i.job_id = j.id AND i.kind = 'part' AND i.cost_cents > 0
), 0)
WHERE j.parts_cost_cents IS DISTINCT FROM COALESCE((
  SELECT SUM(i.qty * i.cost_cents)
  FROM service_job_items i
  WHERE i.job_id = j.id AND i.kind = 'part' AND i.cost_cents > 0
), 0);

COMMIT;
