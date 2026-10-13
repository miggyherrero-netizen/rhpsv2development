-- 12: Maintenance Phase 1: ONE new table, service_notification_preferences (consent per customer).
--   * READ by /service/maintenance. No row = "No consent recorded". Nothing WRITES it yet: Phase 1 has no screen to record consent,
--     sends nothing and has no cron.
--   * The page works without this file (it says the consent table is not set up). Run it when convenient.
--   * The Phase 2 tables (reminder queue, send attempts) are deliberately NOT here: they will be designed when Phase 2 starts.
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS only, no existing table is touched, safe to run more than once.
-- Needs service_customers (created by the earlier files). The foreign key has a short explicit name on purpose: Postgres cuts
-- names at 63 characters, and a cut default name makes `drizzle-kit push` drop and re-add the key on every run.
-- Run it ONLY on the real database you intend to use; test on a local copy first.

BEGIN;
CREATE TABLE IF NOT EXISTS service_notification_preferences (
  customer_id uuid PRIMARY KEY NOT NULL CONSTRAINT service_notif_prefs_customer_fk REFERENCES service_customers(id) ON DELETE CASCADE,
  email_consent boolean NOT NULL DEFAULT false,
  sms_consent boolean NOT NULL DEFAULT false,
  preferred_channel text NOT NULL DEFAULT 'manual',
  opted_out_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
COMMIT;
