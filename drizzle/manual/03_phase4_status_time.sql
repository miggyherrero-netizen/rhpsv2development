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
