-- Home Service · Waitlist by Area (structure)
-- Additive only: new tables + new nullable / defaulted columns. Nothing existing is changed or removed.
-- Safe to run more than once. Run BEFORE 06_ph_geo_seed.sql.

BEGIN;

-- ---- Philippine geography (Mindanao) — filled by 06_ph_geo_seed.sql
CREATE TABLE IF NOT EXISTS ph_regions (
  code text PRIMARY KEY,
  name text NOT NULL,
  short_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS ph_provinces (
  code text PRIMARY KEY,
  name text NOT NULL,
  region_code text NOT NULL CONSTRAINT ph_provinces_region_code_ph_regions_code_fk REFERENCES ph_regions(code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ph_provinces_region_idx ON ph_provinces (region_code);
CREATE TABLE IF NOT EXISTS ph_cities (
  code text PRIMARY KEY,
  name text NOT NULL,
  full_name text NOT NULL,
  kind text NOT NULL DEFAULT 'municipality',
  province_code text CONSTRAINT ph_cities_province_code_ph_provinces_code_fk REFERENCES ph_provinces(code) ON DELETE SET NULL,
  region_code text NOT NULL CONSTRAINT ph_cities_region_code_ph_regions_code_fk REFERENCES ph_regions(code) ON DELETE CASCADE,
  lat double precision,
  lng double precision
);
CREATE INDEX IF NOT EXISTS ph_cities_province_idx ON ph_cities (province_code);
CREATE INDEX IF NOT EXISTS ph_cities_region_idx ON ph_cities (region_code);
CREATE TABLE IF NOT EXISTS ph_barangays (
  code text PRIMARY KEY,
  name text NOT NULL,
  city_code text NOT NULL CONSTRAINT ph_barangays_city_code_ph_cities_code_fk REFERENCES ph_cities(code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ph_barangays_city_idx ON ph_barangays (city_code);

-- ---- Customer locations get a city (and optional barangay)
ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS city_code text;
ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS barangay_code text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_locations_city_code_ph_cities_code_fk') THEN
    ALTER TABLE service_locations ADD CONSTRAINT service_locations_city_code_ph_cities_code_fk
      FOREIGN KEY (city_code) REFERENCES ph_cities(code) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_locations_barangay_code_ph_barangays_code_fk') THEN
    ALTER TABLE service_locations ADD CONSTRAINT service_locations_barangay_code_ph_barangays_code_fk
      FOREIGN KEY (barangay_code) REFERENCES ph_barangays(code) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_locations_city_idx ON service_locations (city_code);

-- ---- Settings: home base + search radius
ALTER TABLE service_settings ADD COLUMN IF NOT EXISTS home_base_city_code text NOT NULL DEFAULT '112402000';
ALTER TABLE service_settings ADD COLUMN IF NOT EXISTS trip_radius_km integer NOT NULL DEFAULT 40;

-- ---- Trips (+ the link from a job to its trip)
CREATE TABLE IF NOT EXISTS service_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city_code text CONSTRAINT service_trips_city_code_ph_cities_code_fk REFERENCES ph_cities(code) ON DELETE SET NULL,
  trip_date timestamp,
  status text NOT NULL DEFAULT 'planned',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS trip_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_trip_id_service_trips_id_fk') THEN
    ALTER TABLE service_jobs ADD CONSTRAINT service_jobs_trip_id_service_trips_id_fk
      FOREIGN KEY (trip_id) REFERENCES service_trips(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_jobs_trip_idx ON service_jobs (trip_id);

-- ---- Waitlist
DO $$ BEGIN
  CREATE TYPE service_waitlist_status AS ENUM ('waiting', 'messaged', 'confirmed', 'scheduled', 'done', 'not_now');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE service_waitlist_source AS ENUM ('website', 'facebook', 'phone', 'recall', 'walk_in');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS service_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL CONSTRAINT service_waitlist_entries_customer_id_service_customers_id_fk REFERENCES service_customers(id) ON DELETE CASCADE,
  piano_id uuid CONSTRAINT service_waitlist_entries_piano_id_service_pianos_id_fk REFERENCES service_pianos(id) ON DELETE SET NULL,
  service_type text NOT NULL DEFAULT 'tuning',
  city_code text CONSTRAINT service_waitlist_entries_city_code_ph_cities_code_fk REFERENCES ph_cities(code) ON DELETE SET NULL,
  barangay_code text CONSTRAINT service_waitlist_entries_barangay_code_ph_barangays_code_fk REFERENCES ph_barangays(code) ON DELETE SET NULL,
  requested_at timestamp NOT NULL DEFAULT now(),
  status service_waitlist_status NOT NULL DEFAULT 'waiting',
  last_contacted_at timestamp,
  next_follow_up_at timestamp NOT NULL,
  follow_up_count integer NOT NULL DEFAULT 0,
  est_value_cents integer NOT NULL DEFAULT 0,
  notes text,
  trip_id uuid CONSTRAINT service_waitlist_entries_trip_id_service_trips_id_fk REFERENCES service_trips(id) ON DELETE SET NULL,
  job_id uuid CONSTRAINT service_waitlist_entries_job_id_service_jobs_id_fk REFERENCES service_jobs(id) ON DELETE SET NULL,
  source service_waitlist_source NOT NULL DEFAULT 'phone',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_waitlist_status_idx ON service_waitlist_entries (status);
CREATE INDEX IF NOT EXISTS service_waitlist_city_idx ON service_waitlist_entries (city_code);
CREATE INDEX IF NOT EXISTS service_waitlist_follow_up_idx ON service_waitlist_entries (next_follow_up_at);
CREATE INDEX IF NOT EXISTS service_waitlist_customer_idx ON service_waitlist_entries (customer_id);

-- ---- Message templates (editable in Settings) — seeded once, never overwritten on re-run
CREATE TABLE IF NOT EXISTS service_message_templates (
  key text PRIMARY KEY,
  name text NOT NULL,
  body text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO service_message_templates (key, name, body) VALUES
  ('area_trip', 'Trip announcement', 'Hi {first_name}! Mag-service mi sa {area} sa {date}. Gusto ka ba nga i-tune ang imong {piano}? Ma-schedule tika kung naay slot pa. Salamat! — Herrero Pianos'),
  ('follow_up', 'Follow-up', 'Hi {first_name}! Follow-up lang sa imong {piano} tuning sa {area}. Naa pa ba ka''y interest? Pwede ta mag-set og adlaw. Salamat! — Herrero Pianos'),
  ('confirm_day_before', 'Confirm the day before', 'Hi {first_name}! Reminder: ugma, {date} mga {time}, moadto mi sa {location} para sa imong {piano}. Si {tech_name} ang moabot. Palihug confirm kung naa ka. Salamat! — Herrero Pianos'),
  ('recall', 'Tuning recall', 'Hi {first_name}! Panahon na para sa regular nga tuning sa imong {piano}. Gusto ka ba nga i-book karong bulana para sa {area}? Salamat! — Herrero Pianos')
ON CONFLICT (key) DO NOTHING;

-- ---- Saved routes
CREATE TABLE IF NOT EXISTS service_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

COMMIT;
