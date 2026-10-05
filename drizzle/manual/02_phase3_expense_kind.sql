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
