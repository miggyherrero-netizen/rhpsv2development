-- Growth OS tables for Supabase. Safe to run more than once. Paste in Supabase > SQL Editor > Run.
-- Only creates gos_* tables; does not touch any existing table or data.

CREATE TABLE IF NOT EXISTS "gos_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gos_ads_name_unique" UNIQUE("name")
);

CREATE TABLE IF NOT EXISTS "gos_login_attempts" (
	"email" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"locked_until" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "gos_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gos_settings_single_row" CHECK ("gos_settings"."id" = 1)
);

CREATE TABLE IF NOT EXISTS "gos_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"undo_data" jsonb,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "gos_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"area" text,
	"status" text DEFAULT 'New' NOT NULL,
	"status_before_lost" text,
	"lost_reason" text,
	"came_from" text NOT NULL,
	"ad_kind" text DEFAULT 'none' NOT NULL,
	"ad_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"inquiry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replied_at" timestamp with time zone,
	"not_duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gos_activity_customer_id_gos_customers_id_fk') THEN
    ALTER TABLE "gos_activity" ADD CONSTRAINT "gos_activity_customer_id_gos_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."gos_customers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gos_customers_ad_id_gos_ads_id_fk') THEN
    ALTER TABLE "gos_customers" ADD CONSTRAINT "gos_customers_ad_id_gos_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."gos_ads"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "gos_activity_customer_idx" ON "gos_activity" USING btree ("customer_id","created_at");

CREATE INDEX IF NOT EXISTS "gos_customers_status_idx" ON "gos_customers" USING btree ("status");
