-- Home Service · Finance history (audit trail)
-- Additive only: one new table + three indexes. Nothing existing is changed or deleted. Safe to run more than once.
-- Until this is run the app still works; edits simply are not recorded (and the History panels say so).
-- No foreign keys on purpose: history rows must survive when an invoice, payment or expense is deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS service_finance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  invoice_id uuid,
  job_id uuid,
  action text NOT NULL,
  summary text NOT NULL,
  changes jsonb,
  reason text,
  actor_name text
);
CREATE INDEX IF NOT EXISTS service_finance_history_entity_idx ON service_finance_history (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS service_finance_history_invoice_idx ON service_finance_history (invoice_id);
CREATE INDEX IF NOT EXISTS service_finance_history_created_idx ON service_finance_history (created_at);

COMMIT;
