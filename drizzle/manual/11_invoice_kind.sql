-- 11: Invoice kind. Lets an invoice be marked as a piano sale ('sale') or a normal service invoice ('service').
-- Used by the dashboard "Invoiced this month" card to show Service and Piano sales separately.
-- Additive and idempotent. No data is changed: every existing invoice stays 'service'.
-- Paste this into the live database BEFORE using the deploy that reads service_invoices.kind.
ALTER TABLE service_invoices ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service';
