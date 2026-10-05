-- Home Service · Client follow-up reminders
-- Additive only: one new enum + one new table. Nothing existing is changed. Safe to run more than once.

BEGIN;

DO $$ BEGIN
  CREATE TYPE service_reminder_status AS ENUM ('open', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS service_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL CONSTRAINT service_reminders_customer_id_service_customers_id_fk REFERENCES service_customers(id) ON DELETE CASCADE,
  note text,
  due_at timestamp NOT NULL,
  status service_reminder_status NOT NULL DEFAULT 'open',
  done_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_reminders_customer_idx ON service_reminders (customer_id);
CREATE INDEX IF NOT EXISTS service_reminders_status_due_idx ON service_reminders (status, due_at);

COMMIT;
