CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"piano_context" text,
	"message" text,
	"source" text DEFAULT 'assessment' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"sku" text,
	"supplier" text,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"location" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"location" text,
	"person" text,
	"color" text,
	"category_id" uuid,
	"reminder_minutes" integer,
	"recurrence" jsonb,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "owner_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"due_date" timestamp,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"converted_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"default_view" text DEFAULT 'week' NOT NULL,
	"week_start" integer DEFAULT 1 NOT NULL,
	"time_format" text DEFAULT '12h' NOT NULL,
	"default_event_minutes" integer DEFAULT 60 NOT NULL,
	"default_task_priority" text DEFAULT 'normal' NOT NULL,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_weekends" boolean DEFAULT true NOT NULL,
	"show_completed" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"scheduled_start" timestamp,
	"scheduled_end" timestamp,
	"estimated_minutes" integer,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"category_id" uuid,
	"notes" text,
	"on_today" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"reminder_minutes" integer,
	"recurrence" jsonb,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pianos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer,
	"type" text DEFAULT 'Grand' NOT NULL,
	"condition" text DEFAULT 'Restored' NOT NULL,
	"description" text,
	"technician_notes" text,
	"dimensions" text,
	"recommended_use" text DEFAULT 'Home',
	"price_cents" integer,
	"cost_cents" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"client_address" text,
	"piano_brand" text NOT NULL,
	"piano_model" text NOT NULL,
	"piano_year" integer,
	"serial_number" text,
	"service_type" text DEFAULT 'Full Restoration' NOT NULL,
	"status" text DEFAULT 'intake' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp,
	"assigned_worker_id" uuid,
	"portal_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"image_url" text,
	"notes" text,
	"last_client_update_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_portal_uuid_unique" UNIQUE("portal_uuid")
);
--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'service' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"estimated_minutes" integer DEFAULT 60 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"source" text DEFAULT 'referral' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_document_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "service_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"spent_at" timestamp DEFAULT now() NOT NULL,
	"job_id" uuid,
	"vendor" text,
	"method" text DEFAULT 'cash' NOT NULL,
	"reimbursable" boolean DEFAULT false NOT NULL,
	"receipt_url" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"job_item_id" uuid,
	"description" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"job_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 1200 NOT NULL,
	"notes" text,
	"terms" text,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "service_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text DEFAULT 'note' NOT NULL,
	"message" text,
	"actor_name" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"description" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"minutes" integer,
	"catalog_item_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_number" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"location_id" uuid,
	"piano_id" uuid,
	"technician_id" uuid,
	"title" text NOT NULL,
	"service_type" text DEFAULT 'tuning' NOT NULL,
	"status" text DEFAULT 'lead' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"scheduled_start" timestamp,
	"scheduled_end" timestamp,
	"estimated_minutes" integer DEFAULT 60 NOT NULL,
	"actual_minutes" integer,
	"travel_minutes" integer DEFAULT 0 NOT NULL,
	"travel_fee_cents" integer DEFAULT 0 NOT NULL,
	"quoted_cents" integer DEFAULT 0 NOT NULL,
	"labor_cost_cents" integer DEFAULT 0 NOT NULL,
	"parts_cost_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"private_notes" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"invoiced_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_jobs_job_number_unique" UNIQUE("job_number")
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text DEFAULT 'Residence' NOT NULL,
	"address_line" text NOT NULL,
	"city" text DEFAULT 'Davao City' NOT NULL,
	"area" text,
	"landmark" text,
	"access_notes" text,
	"travel_minutes" integer DEFAULT 0 NOT NULL,
	"travel_fee_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_pianos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"location_id" uuid,
	"brand" text NOT NULL,
	"model" text,
	"type" text DEFAULT 'Upright' NOT NULL,
	"serial_number" text,
	"year" integer,
	"condition_notes" text,
	"last_service_at" timestamp,
	"tuning_interval_months" integer DEFAULT 6 NOT NULL,
	"next_service_due_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"business_name" text DEFAULT 'Herrero Pianos' NOT NULL,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"job_prefix" text DEFAULT 'WO' NOT NULL,
	"tax_rate_bps" integer DEFAULT 1200 NOT NULL,
	"tax_label" text DEFAULT 'VAT (12%)' NOT NULL,
	"default_terms_days" integer DEFAULT 15 NOT NULL,
	"default_hourly_rate_cents" integer DEFAULT 25000 NOT NULL,
	"default_travel_fee_cents" integer DEFAULT 0 NOT NULL,
	"default_tuning_interval_months" integer DEFAULT 6 NOT NULL,
	"reminder_lead_days" integer DEFAULT 30 NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vat_enabled" boolean DEFAULT true NOT NULL,
	"margin_excludes_vat" boolean DEFAULT true NOT NULL,
	"include_labor_cost" boolean DEFAULT true NOT NULL,
	"avg_invoice_basis" text DEFAULT 'invoice' NOT NULL,
	"show_finance" boolean DEFAULT true NOT NULL,
	"show_job_margins" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_settings_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "service_technicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT 'Field Technician' NOT NULL,
	"phone" text,
	"avatar_url" text,
	"color" text DEFAULT '#4d8df0' NOT NULL,
	"hourly_rate_cents" integer DEFAULT 25000 NOT NULL,
	"billable_rate_cents" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_time_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"technician_id" uuid,
	"kind" text DEFAULT 'work' NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"minutes" integer,
	"billable" boolean DEFAULT true NOT NULL,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"task_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	CONSTRAINT "task_assignees_task_id_worker_id_pk" PRIMARY KEY("task_id","worker_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_worker_id" uuid,
	"claimed_by_worker_id" uuid,
	"estimated_minutes" integer DEFAULT 60 NOT NULL,
	"due_date" timestamp,
	"position" integer DEFAULT 0 NOT NULL,
	"waiting_parts" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"clock_in" timestamp NOT NULL,
	"clock_out" timestamp,
	"rate_at_clock_in_cents" integer NOT NULL,
	"task_id" uuid,
	"on_break" boolean DEFAULT false NOT NULL,
	"break_started_at" timestamp,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"image_url" text,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"is_visible_to_client" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "worker_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT 'Technician' NOT NULL,
	"avatar_url" text,
	"hourly_rate_cents" integer DEFAULT 35000 NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gos_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gos_ads_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gos_login_attempts" (
	"email" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gos_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gos_settings_single_row" CHECK ("gos_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "owner_events" ADD CONSTRAINT "owner_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_events" ADD CONSTRAINT "owner_events_category_id_owner_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."owner_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_inbox" ADD CONSTRAINT "owner_inbox_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_preferences" ADD CONSTRAINT "owner_preferences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_tasks" ADD CONSTRAINT "owner_tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_tasks" ADD CONSTRAINT "owner_tasks_category_id_owner_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."owner_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_document_shares" ADD CONSTRAINT "service_document_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_document_shares" ADD CONSTRAINT "service_document_shares_invoice_id_service_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."service_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_document_shares" ADD CONSTRAINT "service_document_shares_payment_id_service_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."service_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_expenses" ADD CONSTRAINT "service_expenses_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoice_items" ADD CONSTRAINT "service_invoice_items_invoice_id_service_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."service_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoice_items" ADD CONSTRAINT "service_invoice_items_job_item_id_service_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."service_job_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_customer_id_service_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."service_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_job_events" ADD CONSTRAINT "service_job_events_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_job_items" ADD CONSTRAINT "service_job_items_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_job_items" ADD CONSTRAINT "service_job_items_catalog_item_id_service_catalog_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."service_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_customer_id_service_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."service_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_location_id_service_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."service_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_piano_id_service_pianos_id_fk" FOREIGN KEY ("piano_id") REFERENCES "public"."service_pianos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_technician_id_service_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."service_technicians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_customer_id_service_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."service_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_payments" ADD CONSTRAINT "service_payments_invoice_id_service_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."service_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pianos" ADD CONSTRAINT "service_pianos_customer_id_service_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."service_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pianos" ADD CONSTRAINT "service_pianos_location_id_service_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."service_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_time_logs" ADD CONSTRAINT "service_time_logs_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_time_logs" ADD CONSTRAINT "service_time_logs_technician_id_service_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."service_technicians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claimed_by_worker_id_workers_id_fk" FOREIGN KEY ("claimed_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_breaks" ADD CONSTRAINT "worker_breaks_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_customers_name_idx" ON "service_customers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "service_document_shares_invoice_idx" ON "service_document_shares" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "service_document_shares_owner_idx" ON "service_document_shares" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "service_expenses_spent_idx" ON "service_expenses" USING btree ("spent_at");--> statement-breakpoint
CREATE INDEX "service_expenses_job_idx" ON "service_expenses" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "service_invoice_items_invoice_idx" ON "service_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "service_invoices_status_idx" ON "service_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_invoices_due_idx" ON "service_invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "service_invoices_customer_idx" ON "service_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_job_events_job_idx" ON "service_job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "service_job_items_job_idx" ON "service_job_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "service_jobs_scheduled_idx" ON "service_jobs" USING btree ("scheduled_start");--> statement-breakpoint
CREATE INDEX "service_jobs_status_idx" ON "service_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_jobs_customer_idx" ON "service_jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_jobs_status_scheduled_idx" ON "service_jobs" USING btree ("status","scheduled_start");--> statement-breakpoint
CREATE INDEX "service_locations_customer_idx" ON "service_locations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_payments_invoice_idx" ON "service_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "service_payments_received_idx" ON "service_payments" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "service_pianos_customer_idx" ON "service_pianos" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_pianos_due_idx" ON "service_pianos" USING btree ("next_service_due_at");--> statement-breakpoint
CREATE INDEX "service_time_logs_job_idx" ON "service_time_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "service_time_logs_tech_start_idx" ON "service_time_logs" USING btree ("technician_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_time_logs_one_running_idx" ON "service_time_logs" USING btree ("technician_id") WHERE "ended_at" IS NULL AND "technician_id" IS NOT NULL;