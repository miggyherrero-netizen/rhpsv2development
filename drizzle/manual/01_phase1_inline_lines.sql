-- Home Service redesign · Phase 1 (inline quote/invoice lines)
-- Additive only: new columns with safe defaults. No rows are changed, moved or deleted.
-- Safe to run more than once. Run this on the live database BEFORE the matching deploy is used.

BEGIN;

-- Price book: one-tap chips under the line editor, and package membership
-- (a row of kind 'package' is the parent; member rows point to it with package_id).
ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS is_quick_add boolean NOT NULL DEFAULT false;
ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS package_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_catalog_package_id_fkey') THEN
    ALTER TABLE service_catalog
      ADD CONSTRAINT service_catalog_package_id_fkey
      FOREIGN KEY (package_id) REFERENCES service_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Optional per-unit cost on a job line (0 = not entered), used for job margin.
ALTER TABLE service_job_items ADD COLUMN IF NOT EXISTS cost_cents integer NOT NULL DEFAULT 0;

COMMIT;
