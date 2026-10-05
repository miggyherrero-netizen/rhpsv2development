-- Home Service redesign — ALL 4 migrations in one paste (run once, in this order). Additive + safe to re-run.

-- ===== 01_phase1_inline_lines.sql =====
-- Home Service redesign · Phase 1 (inline quote/invoice lines)
-- Additive only: new columns with safe defaults. No rows are changed, moved or deleted.
-- Safe to run more than once. Run this on the live database BEFORE the matching deploy is used.

BEGIN;

-- Price book: one-tap chips under the line editor, and package membership
-- (a row of kind 'package' is the parent; member rows point to it with package_id).
ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS is_quick_add boolean NOT NULL DEFAULT false;
ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS package_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_package_id_service_catalog_id_fk') THEN
    ALTER TABLE service_catalog
      ADD CONSTRAINT service_catalog_package_id_service_catalog_id_fk
      FOREIGN KEY (package_id) REFERENCES service_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Optional per-unit cost on a job line (0 = not entered), used for job margin.
ALTER TABLE service_job_items ADD COLUMN IF NOT EXISTS cost_cents integer NOT NULL DEFAULT 0;

COMMIT;

-- ===== 02_phase3_expense_kind.sql =====
-- Home Service redesign · Phase 3 (expense kind + piano link)
-- Additive only. Existing expenses keep kind = NULL ("not reviewed yet"); Finance treats them by category
-- until you set a kind on the new "Review expenses" screen. Nothing is moved, rewritten or deleted.
-- Safe to run more than once.

BEGIN;

DO $$ BEGIN
  CREATE TYPE service_expense_kind AS ENUM ('job', 'stock', 'overhead');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE service_expenses ADD COLUMN IF NOT EXISTS kind service_expense_kind;
ALTER TABLE service_expenses ADD COLUMN IF NOT EXISTS piano_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_expenses_piano_id_pianos_id_fk') THEN
    ALTER TABLE service_expenses
      ADD CONSTRAINT service_expenses_piano_id_pianos_id_fk
      FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_expenses_piano_idx ON service_expenses (piano_id);

COMMIT;

-- ===== 03_phase4_status_time.sql =====
-- Home Service redesign · Phase 4 (status = time)
-- Additive only. Existing events and time entries are untouched: old entries stay source = 'timer',
-- old events keep status = NULL (they are not re-read). New status taps write the status and derive the time entries.
-- Safe to run more than once.

BEGIN;

ALTER TABLE service_job_events ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE service_time_logs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'timer';
ALTER TABLE service_time_logs ADD COLUMN IF NOT EXISTS start_event_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_time_logs_start_event_id_service_job_events_id_fk') THEN
    ALTER TABLE service_time_logs
      ADD CONSTRAINT service_time_logs_start_event_id_service_job_events_id_fk
      FOREIGN KEY (start_event_id) REFERENCES service_job_events(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS service_time_logs_start_event_idx
  ON service_time_logs (start_event_id) WHERE "start_event_id" IS NOT NULL;

COMMIT;

-- ===== 04_phase5_piano_sale.sql =====
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
