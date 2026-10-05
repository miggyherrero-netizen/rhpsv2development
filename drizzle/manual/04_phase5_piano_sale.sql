-- Home Service redesign · Phase 5 (piano sale jobs)
-- Additive only. Every existing job becomes job_type = 'service' (the default) with zero sale amounts.
-- Safe to run more than once.

BEGIN;

DO $$ BEGIN
  CREATE TYPE service_job_type AS ENUM ('service', 'sale');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS job_type service_job_type NOT NULL DEFAULT 'service';
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS sale_piano_id uuid;
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS buy_cost_cents integer NOT NULL DEFAULT 0;
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS prep_cost_cents integer NOT NULL DEFAULT 0;
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS sale_price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_sale_piano_id_pianos_id_fk') THEN
    ALTER TABLE service_jobs
      ADD CONSTRAINT service_jobs_sale_piano_id_pianos_id_fk
      FOREIGN KEY (sale_piano_id) REFERENCES pianos(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_jobs_job_type_idx ON service_jobs (job_type);
CREATE INDEX IF NOT EXISTS service_jobs_sale_piano_idx ON service_jobs (sale_piano_id);

COMMIT;
