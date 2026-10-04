CREATE TABLE "gos_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"undo_data" jsonb,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gos_customers" (
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
--> statement-breakpoint
ALTER TABLE "gos_activity" ADD CONSTRAINT "gos_activity_customer_id_gos_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."gos_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gos_customers" ADD CONSTRAINT "gos_customers_ad_id_gos_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."gos_ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gos_activity_customer_idx" ON "gos_activity" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "gos_customers_status_idx" ON "gos_customers" USING btree ("status");