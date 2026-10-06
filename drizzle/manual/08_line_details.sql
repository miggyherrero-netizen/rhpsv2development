-- Home Service · "Details" under an item name on quotes and invoices
-- Additive only: two new nullable columns. Nothing existing is changed. Safe to run more than once.

BEGIN;

ALTER TABLE service_job_items ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE service_invoice_items ADD COLUMN IF NOT EXISTS details text;

COMMIT;
