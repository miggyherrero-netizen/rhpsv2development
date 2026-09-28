import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Recurrence } from "@/lib/dates";
import type { WorkingHours } from "@/lib/service";

/* ============ AUTH ============ */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/* ============ PIANO MANAGEMENT ============ */

export const workers = pgTable("workers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull().default("Technician"),
  avatarUrl: text("avatar_url"),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(35000),
  pinHash: text("pin_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  clientAddress: text("client_address"),
  pianoBrand: text("piano_brand").notNull(),
  pianoModel: text("piano_model").notNull(),
  pianoYear: integer("piano_year"),
  serialNumber: text("serial_number"),
  serviceType: text("service_type").notNull().default("Full Restoration"),
  status: text("status").notNull().default("intake"),
  progress: integer("progress").notNull().default(0),
  dueDate: timestamp("due_date", { mode: "date" }),
  assignedWorkerId: uuid("assigned_worker_id").references(() => workers.id, {
    onDelete: "set null",
  }),
  portalUuid: uuid("portal_uuid").defaultRandom().notNull().unique(),
  imageUrl: text("image_url"),
  notes: text("notes"),
  lastClientUpdateAt: timestamp("last_client_update_at", { mode: "date" }),
  /** Owner Accounting: agreed contract value, materialized from project_items. */
  quotedCents: integer("quoted_cents").notNull().default(0),
  /** VAT rate applied when project billing is finalized (basis points; 0 = VAT-exempt). */
  taxRateBps: integer("tax_rate_bps").notNull().default(1200),
  /** Set when the owner finalizes billing — payments after this reduce AR, not deposits. */
  billingFinalizedAt: timestamp("billing_finalized_at", { mode: "date" }),
  /** Final billed subtotal (pre-VAT) as confirmed at finalize; null until then. */
  billedCents: integer("billed_cents"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("backlog"),
  priority: text("priority").notNull().default("normal"),
  assignedWorkerId: uuid("assigned_worker_id").references(() => workers.id, {
    onDelete: "set null",
  }),
  claimedByWorkerId: uuid("claimed_by_worker_id").references(() => workers.id, {
    onDelete: "set null",
  }),
  estimatedMinutes: integer("estimated_minutes").notNull().default(60),
  dueDate: timestamp("due_date", { mode: "date" }),
  position: integer("position").notNull().default(0),
  waitingParts: boolean("waiting_parts").notNull().default(false),
  completedAt: timestamp("completed_at", { mode: "date" }),
  archivedAt: timestamp("archived_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** Many-to-many task <-> worker assignment. `tasks.assignedWorkerId` remains the "primary" assignee for backward compat. */
export const taskAssignees = pgTable("task_assignees", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.taskId, t.workerId] }),
}));

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: "cascade" }),
  clockIn: timestamp("clock_in", { mode: "date" }).notNull(),
  clockOut: timestamp("clock_out", { mode: "date" }),
  rateAtClockInCents: integer("rate_at_clock_in_cents").notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  onBreak: boolean("on_break").notNull().default(false),
  breakStartedAt: timestamp("break_started_at", { mode: "date" }),
  breakMinutes: integer("break_minutes").notNull().default(0),
  paidAt: timestamp("paid_at", { mode: "date" }),
  paidCents: integer("paid_cents").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/** One row per break taken during a shift — records exactly when it started and when (if) it ended. */
export const workerBreaks = pgTable("worker_breaks", {
  id: uuid("id").defaultRandom().primaryKey(),
  timeEntryId: uuid("time_entry_id")
    .notNull()
    .references(() => timeEntries.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { mode: "date" }).notNull(),
  endedAt: timestamp("ended_at", { mode: "date" }),
});

/** One row per cash payment made against a shift — supports partial payments; sum against paidCents on the entry. */
export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  timeEntryId: uuid("time_entry_id")
    .notNull()
    .references(() => timeEntries.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { mode: "date" }).defaultNow().notNull(),
});

export const updates = pgTable("updates", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body"),
  imageUrl: text("image_url"),
  updateDate: timestamp("update_date", { mode: "date" }).defaultNow().notNull(),
  isVisibleToClient: boolean("is_visible_to_client").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  sku: text("sku"),
  supplier: text("supplier"),
  qtyOnHand: integer("qty_on_hand").notNull().default(0),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(0),
  location: text("location"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ============ SHOWROOM (PUBLIC SITE) ============ */

export const pianos = pgTable("pianos", {
  id: uuid("id").defaultRandom().primaryKey(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year"),
  type: text("type").notNull().default("Grand"),
  condition: text("condition").notNull().default("Restored"),
  description: text("description"),
  technicianNotes: text("technician_notes"),
  dimensions: text("dimensions"),
  recommendedUse: text("recommended_use").default("Home"),
  priceCents: integer("price_cents"),
  costCents: integer("cost_cents"),
  status: text("status").notNull().default("available"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const inquiries = pgTable("inquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  pianoContext: text("piano_context"),
  message: text("message"),
  source: text("source").notNull().default("assessment"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/* ============ OWNER PERSONAL WORKSPACE ============ */

export const ownerCategories = pgTable("owner_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#64748b"),
  position: integer("position").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const ownerPreferences = pgTable("owner_preferences", {
  id: serial("id").primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  defaultView: text("default_view").notNull().default("week"),
  weekStart: integer("week_start").notNull().default(1),
  timeFormat: text("time_format").notNull().default("12h"),
  defaultEventMinutes: integer("default_event_minutes").notNull().default(60),
  defaultTaskPriority: text("default_task_priority").notNull().default("normal"),
  workingHours: jsonb("working_hours").notNull().default({}),
  showWeekends: boolean("show_weekends").notNull().default(true),
  showCompleted: boolean("show_completed").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const ownerEvents = pgTable("owner_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  startAt: timestamp("start_at", { mode: "date" }).notNull(),
  endAt: timestamp("end_at", { mode: "date" }),
  isAllDay: boolean("is_all_day").notNull().default(false),
  kind: text("kind").notNull().default("event"), // event | focus | reminder
  location: text("location"),
  person: text("person"),
  color: text("color"),
  categoryId: uuid("category_id").references(() => ownerCategories.id, {
    onDelete: "set null",
  }),
  reminderMinutes: integer("reminder_minutes"),
  recurrence: jsonb("recurrence").$type<Recurrence>(),
  status: text("status").notNull().default("scheduled"), // scheduled | done | cancelled
  notes: text("notes"),
  completedAt: timestamp("completed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
});

export const ownerTasks = pgTable("owner_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { mode: "date" }),
  scheduledStart: timestamp("scheduled_start", { mode: "date" }),
  scheduledEnd: timestamp("scheduled_end", { mode: "date" }),
  estimatedMinutes: integer("estimated_minutes"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("pending"), // pending | in_progress | done | cancelled
  categoryId: uuid("category_id").references(() => ownerCategories.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  onToday: boolean("on_today").notNull().default(false),
  position: integer("position").notNull().default(0),
  reminderMinutes: integer("reminder_minutes"),
  recurrence: jsonb("recurrence").$type<Recurrence>(),
  completedAt: timestamp("completed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
});

export const ownerInbox = pgTable("owner_inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes"),
  priority: text("priority").notNull().default("normal"),
  dueDate: timestamp("due_date", { mode: "date" }),
  capturedAt: timestamp("captured_at", { mode: "date" }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { mode: "date" }),
  convertedType: text("converted_type"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/* ============ HOME SERVICE (in-home piano service) ============ */

/**
 * Field-service crew. Deliberately separate from the workshop `workers` roster: home
 * service is scheduled, costed, and paid independently of the shop floor.
 */
export const serviceTechnicians = pgTable("service_technicians", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull().default("Field Technician"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  color: text("color").notNull().default("#4d8df0"), // dispatch-board tint
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(25000), // cost to the business
  billableRateCents: integer("billable_rate_cents").notNull().default(0), // charged per hour, 0 = flat-rate jobs
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const serviceCustomers = pgTable("service_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  company: text("company"), // schools, chapels, hotels
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull().default("referral"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  nameIdx: index("service_customers_name_idx").on(t.name),
}));

export const serviceLocations = pgTable("service_locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => serviceCustomers.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Residence"),
  addressLine: text("address_line").notNull(),
  city: text("city").notNull().default("Davao City"),
  area: text("area"), // travel zone, e.g. "Matina", "Buhangin"
  landmark: text("landmark"),
  accessNotes: text("access_notes"), // gate code, stairs, parking
  travelMinutes: integer("travel_minutes").notNull().default(0),
  travelFeeCents: integer("travel_fee_cents").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("service_locations_customer_idx").on(t.customerId),
}));

export const servicePianos = pgTable("service_pianos", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => serviceCustomers.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").references(() => serviceLocations.id, { onDelete: "set null" }),
  brand: text("brand").notNull(),
  model: text("model"),
  type: text("type").notNull().default("Upright"), // Grand | Upright | Digital | Organ
  serialNumber: text("serial_number"),
  year: integer("year"),
  conditionNotes: text("condition_notes"),
  lastServiceAt: timestamp("last_service_at", { mode: "date" }),
  tuningIntervalMonths: integer("tuning_interval_months").notNull().default(6),
  /** Materialized on job completion — powers the "due for service" recall list. */
  nextServiceDueAt: timestamp("next_service_due_at", { mode: "date" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("service_pianos_customer_idx").on(t.customerId),
  dueIdx: index("service_pianos_due_idx").on(t.nextServiceDueAt),
}));

/** Price book — reusable service/part lines offered on home visits. */
export const serviceCatalog = pgTable("service_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind").notNull().default("service"), // service | part | fee | package
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  taxable: boolean("taxable").notNull().default(true),
  estimatedMinutes: integer("estimated_minutes").notNull().default(60),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const serviceJobs = pgTable("service_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Monotonic human-facing number; the displayed code is `${jobPrefix}-${year}-${padded}`. */
  jobNumber: serial("job_number").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => serviceCustomers.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => serviceLocations.id, { onDelete: "set null" }),
  pianoId: uuid("piano_id").references(() => servicePianos.id, { onDelete: "set null" }),
  technicianId: uuid("technician_id").references(() => serviceTechnicians.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  serviceType: text("service_type").notNull().default("tuning"),
  status: text("status").notNull().default("lead"),
  priority: text("priority").notNull().default("normal"),
  scheduledStart: timestamp("scheduled_start", { mode: "date" }),
  scheduledEnd: timestamp("scheduled_end", { mode: "date" }),
  estimatedMinutes: integer("estimated_minutes").notNull().default(60),
  actualMinutes: integer("actual_minutes"), // work minutes, materialized on completion
  travelMinutes: integer("travel_minutes").notNull().default(0),
  travelFeeCents: integer("travel_fee_cents").notNull().default(0),
  quotedCents: integer("quoted_cents").notNull().default(0), // pre-tax line-item total
  laborCostCents: integer("labor_cost_cents").notNull().default(0), // materialized from time logs
  partsCostCents: integer("parts_cost_cents").notNull().default(0), // materialized from part lines
  notes: text("notes"), // client-visible
  privateNotes: text("private_notes"),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  invoicedAt: timestamp("invoiced_at", { mode: "date" }),
  cancelledAt: timestamp("cancelled_at", { mode: "date" }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  scheduledIdx: index("service_jobs_scheduled_idx").on(t.scheduledStart),
  statusIdx: index("service_jobs_status_idx").on(t.status),
  customerIdx: index("service_jobs_customer_idx").on(t.customerId),
  statusScheduledIdx: index("service_jobs_status_scheduled_idx").on(t.status, t.scheduledStart),
}));

export const serviceJobItems = pgTable("service_job_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => serviceJobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("service"), // service | part | fee | discount
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  taxable: boolean("taxable").notNull().default(true),
  minutes: integer("minutes"),
  catalogItemId: uuid("catalog_item_id").references(() => serviceCatalog.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index("service_job_items_job_idx").on(t.jobId),
}));

/** Append-only timeline for a job: status changes, calls, notes, payments. */
export const serviceJobEvents = pgTable("service_job_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => serviceJobs.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("note"),
  message: text("message"),
  actorName: text("actor_name"),
  at: timestamp("at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index("service_job_events_job_idx").on(t.jobId),
}));

/** Travel / work / break segments for a technician on a job. `endedAt` null = running. */
export const serviceTimeLogs = pgTable("service_time_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => serviceJobs.id, { onDelete: "cascade" }),
  technicianId: uuid("technician_id").references(() => serviceTechnicians.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("work"), // travel | work | break
  startedAt: timestamp("started_at", { mode: "date" }).notNull(),
  endedAt: timestamp("ended_at", { mode: "date" }),
  minutes: integer("minutes"), // materialized when stopped
  billable: boolean("billable").notNull().default(true),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(0), // snapshot for labor costing
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index("service_time_logs_job_idx").on(t.jobId),
  techStartIdx: index("service_time_logs_tech_start_idx").on(t.technicianId, t.startedAt),
  /** At most one running timer per technician — enforced by the database, not just the UI. */
  oneRunningIdx: uniqueIndex("service_time_logs_one_running_idx")
    .on(t.technicianId)
    .where(sql`"ended_at" IS NULL AND "technician_id" IS NOT NULL`),
}));

export const serviceInvoices = pgTable("service_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceNumber: serial("invoice_number").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => serviceCustomers.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft | sent | partial | paid | void
  issueDate: timestamp("issue_date", { mode: "date" }).defaultNow().notNull(),
  dueDate: timestamp("due_date", { mode: "date" }),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(1200), // 12% PH VAT, snapshotted
  notes: text("notes"),
  terms: text("terms"),
  sentAt: timestamp("sent_at", { mode: "date" }),
  paidAt: timestamp("paid_at", { mode: "date" }),
  voidedAt: timestamp("voided_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("service_invoices_status_idx").on(t.status),
  dueIdx: index("service_invoices_due_idx").on(t.dueDate),
  customerIdx: index("service_invoices_customer_idx").on(t.customerId),
}));

export const serviceInvoiceItems = pgTable("service_invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => serviceInvoices.id, { onDelete: "cascade" }),
  jobItemId: uuid("job_item_id").references(() => serviceJobItems.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  taxable: boolean("taxable").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("service_invoice_items_invoice_idx").on(t.invoiceId),
}));

/** One row per payment received against an invoice — supports part payments and deposits. */
export const servicePayments = pgTable("service_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => serviceInvoices.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull().default("cash"),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { mode: "date" }).defaultNow().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("service_payments_invoice_idx").on(t.invoiceId),
  receivedIdx: index("service_payments_received_idx").on(t.receivedAt),
}));

/** Bearer links for read-only invoice and individual payment-receipt documents.
 * Only SHA-256 hashes of the random tokens are persisted. */
export const serviceDocumentShares = pgTable("service_document_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => serviceInvoices.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").references(() => servicePayments.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"invoice" | "receipt">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  revokedAt: timestamp("revoked_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("service_document_shares_invoice_idx").on(t.invoiceId),
  ownerIdx: index("service_document_shares_owner_idx").on(t.ownerId),
}));

export const serviceExpenses = pgTable("service_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull().default("other"),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  spentAt: timestamp("spent_at", { mode: "date" }).defaultNow().notNull(),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  vendor: text("vendor"),
  method: text("method").notNull().default("cash"),
  reimbursable: boolean("reimbursable").notNull().default(false),
  receiptUrl: text("receipt_url"),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  spentIdx: index("service_expenses_spent_idx").on(t.spentAt),
  jobIdx: index("service_expenses_job_idx").on(t.jobId),
}));

/** One row per owner — invoice numbering, tax, terms, travel defaults, dispatch hours. */
export const serviceSettings = pgTable("service_settings", {
  id: serial("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull().default("Herrero Pianos"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  jobPrefix: text("job_prefix").notNull().default("WO"),
  taxRateBps: integer("tax_rate_bps").notNull().default(1200),
  taxLabel: text("tax_label").notNull().default("VAT (12%)"),
  defaultTermsDays: integer("default_terms_days").notNull().default(15),
  defaultHourlyRateCents: integer("default_hourly_rate_cents").notNull().default(25000),
  defaultTravelFeeCents: integer("default_travel_fee_cents").notNull().default(0),
  defaultTuningIntervalMonths: integer("default_tuning_interval_months").notNull().default(6),
  reminderLeadDays: integer("reminder_lead_days").notNull().default(30),
  currency: text("currency").notNull().default("PHP"),
  workingHours: jsonb("working_hours").$type<WorkingHours>().notNull().default({}),
  /** Charge VAT on newly created invoices (existing invoices keep their saved rate). */
  vatEnabled: boolean("vat_enabled").notNull().default(true),
  /** Job profit is measured on revenue before VAT. */
  marginExcludesVat: boolean("margin_excludes_vat").notNull().default(true),
  /** Count recorded crew labor as a job cost in margin reports. */
  includeLaborCost: boolean("include_labor_cost").notNull().default(true),
  /** Finance "average invoice" denominator: non-void invoices or completed jobs. */
  avgInvoiceBasis: text("avg_invoice_basis").$type<"invoice" | "job">().notNull().default("invoice"),
  /** Show the Finance link in the workspace menu (the route itself stays reachable). */
  showFinance: boolean("show_finance").notNull().default(true),
  /** Show profit/margin on job pages and in Finance. */
  showJobMargins: boolean("show_job_margins").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ============ OWNER ACCOUNTING ============ */
/*
 * Lightweight chart of accounts + append-only legged journal. Money is entered in the
 * module where the work happens (service, projects, showroom, payroll); this section
 * consolidates, classifies, reconciles, and reports. See ACCOUNTING_WORKSPACE_PLAN.md.
 */

/** Wallets (cash/bank/e-wallet) and book accounts (AR, deposits, equity, VAT, …). */
export const accAccounts = pgTable("acc_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | equity | revenue | expense
  isWallet: boolean("is_wallet").notNull().default(false),
  walletKind: text("wallet_kind"), // cash | bank | ewallet | other — null for book accounts
  /** Locks posting-rule lookups for built-in accounts ("ar", "deposits_held", …). */
  systemKey: text("system_key").unique(),
  /** Baseline before any journal lines; editable only while the account has no lines. */
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  openingAsOf: timestamp("opening_as_of", { mode: "date" }),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  typeIdx: index("acc_accounts_type_idx").on(t.type),
  walletIdx: index("acc_accounts_wallet_idx").on(t.isWallet),
}));

/** One row per economic event. Append-only — corrections are reversal entries. */
export const accJournal = pgTable("acc_journal", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Monotonic human-facing number; displayed as `JE-${year}-${padded}`. */
  entryNumber: serial("entry_number").notNull().unique(),
  occurredAt: timestamp("occurred_at", { mode: "date" }).notNull(),
  kind: text("kind").notNull(), // see JOURNAL_KINDS in src/lib/accounting.ts
  stream: text("stream").notNull().default("operations"),
  memo: text("memo"),
  /** Pointer back to the operational row this entry was posted from (bridge / inline). */
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  /** Hash of the source state at posting time — change detection for the bridge. */
  sourceHash: text("source_hash"),
  postedAt: timestamp("posted_at", { mode: "date" }).defaultNow().notNull(),
  postedBy: text("posted_by"),
  reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => accJournal.id, { onDelete: "set null" }),
  voidedAt: timestamp("voided_at", { mode: "date" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  occurredIdx: index("acc_journal_occurred_idx").on(t.occurredAt),
  kindIdx: index("acc_journal_kind_idx").on(t.kind),
  sourceIdx: index("acc_journal_source_idx").on(t.sourceType, t.sourceId),
  reversalIdx: index("acc_journal_reversal_idx").on(t.reversalOfId),
}));

/** One reconciliation attempt per wallet against a real statement. */
export const accReconciliations = pgTable("acc_reconciliations", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accAccounts.id, { onDelete: "restrict" }),
  statementDate: timestamp("statement_date", { mode: "date" }).notNull(),
  statementEndingCents: integer("statement_ending_cents").notNull(),
  status: text("status").notNull().default("open"), // open | completed
  /** Snapshots taken at completion, so history survives later activity. */
  bookBalanceCents: integer("book_balance_cents"),
  clearedBalanceCents: integer("cleared_balance_cents"),
  differenceCents: integer("difference_cents"),
  startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { mode: "date" }),
  completedBy: text("completed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  accountIdx: index("acc_reconciliations_account_idx").on(t.accountId),
  statusIdx: index("acc_reconciliations_status_idx").on(t.status),
}));

/** Journal legs. Σ debits = Σ credits per entry; enforced by the posting helpers. */
export const accJournalLines = pgTable("acc_journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalId: uuid("journal_id")
    .notNull()
    .references(() => accJournal.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accAccounts.id, { onDelete: "restrict" }),
  debitCents: integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  lineMemo: text("line_memo"),
  /** Reconciliation state: when this line was confirmed against a statement. */
  clearedAt: timestamp("cleared_at", { mode: "date" }),
  reconciliationId: uuid("reconciliation_id").references(() => accReconciliations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  journalIdx: index("acc_journal_lines_journal_idx").on(t.journalId),
  accountIdx: index("acc_journal_lines_account_idx").on(t.accountId),
  reconIdx: index("acc_journal_lines_recon_idx").on(t.reconciliationId),
}));

/** Closed months. Journal writes inside a locked period are rejected (bridge: exception). */
export const accPeriodLocks = pgTable("acc_period_locks", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  lockedAt: timestamp("locked_at", { mode: "date" }).defaultNow().notNull(),
  lockedBy: text("locked_by"),
  note: text("note"),
}, (t) => ({
  periodIdx: uniqueIndex("acc_period_locks_period_idx").on(t.year, t.month),
}));

/** Events the bridge could not post cleanly (locked period, changed source, unmapped method). */
export const accExceptions = pgTable("acc_exceptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"), // open | resolved
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("acc_exceptions_status_idx").on(t.status),
}));

/** One row per owner — books start date, payment-method → wallet map, payroll wallet. */
export const accSettings = pgTable("acc_settings", {
  id: serial("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Events before this date are not posted (except pre-books collections). */
  booksStartDate: timestamp("books_start_date", { mode: "date" }).notNull(),
  /** PAYMENT_METHODS key → acc_accounts.id. */
  methodMap: jsonb("method_map").$type<Record<string, string>>().notNull().default({}),
  payrollAccountId: uuid("payroll_account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** Append-only record of every accounting-relevant write. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  action: text("action").notNull(), // create | update | void | post | lock | unlock | reconcile | resolve
  before: jsonb("before"),
  after: jsonb("after"),
  actor: text("actor"),
  note: text("note"),
  at: timestamp("at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  rowIdx: index("audit_log_row_idx").on(t.tableName, t.rowId),
  atIdx: index("audit_log_at_idx").on(t.at),
}));

/* ============ PROJECT BILLING (restorations) ============ */

/** Quote lines + approved additional charges. Contract value = Σ qty × unit_price. */
export const projectItems = pgTable("project_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("service"), // service | part | fee | discount
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("project_items_project_idx").on(t.projectId),
}));

/** Customer payments on a restoration. `restrict` — payment history is never lost. */
export const projectPayments = pgTable("project_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  kind: text("kind").notNull().default("deposit"), // deposit | progress | final
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull().default("cash"),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { mode: "date" }).defaultNow().notNull(),
  note: text("note"),
  /** Voids reverse the journal entry and keep the row for history — never hard-delete. */
  voidedAt: timestamp("voided_at", { mode: "date" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("project_payments_project_idx").on(t.projectId),
  receivedIdx: index("project_payments_received_idx").on(t.receivedAt),
}));

/** Materials / subcontractor / other project costs. Unpaid rows sit in Accounts Payable. */
export const projectCosts = pgTable("project_costs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("materials"), // materials | parts | subcontractor | tools | other
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  spentAt: timestamp("spent_at", { mode: "date" }).defaultNow().notNull(),
  vendor: text("vendor"),
  /** Wallet the cost was paid from; null = unpaid (posted to Accounts Payable). */
  paidAccountId: uuid("paid_account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at", { mode: "date" }),
  receiptUrl: text("receipt_url"),
  note: text("note"),
  voidedAt: timestamp("voided_at", { mode: "date" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("project_costs_project_idx").on(t.projectId),
}));

/* ============ PIANO SALES (showroom) ============ */

/** One sale record per showroom piano. Price + carrying cost are snapshotted at completion. */
export const pianoSales = pgTable("piano_sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  pianoId: uuid("piano_id")
    .notNull()
    .unique()
    .references(() => pianos.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("reserved"), // reserved | completed | cancelled
  reservedAt: timestamp("reserved_at", { mode: "date" }),
  soldAt: timestamp("sold_at", { mode: "date" }),
  /** Agreed selling price, VAT-inclusive (retail convention). */
  priceCents: integer("price_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(1200),
  /** Frozen at completion — later cost edits never change realized margin. */
  costSnapshotCents: integer("cost_snapshot_cents"),
  buyerName: text("buyer_name"),
  buyerContact: text("buyer_contact"),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("piano_sales_status_idx").on(t.status),
}));

/** Buyer payments on a piano sale (reservation deposit → partials → balance). */
export const pianoPayments = pgTable("piano_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => pianoSales.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull().default("cash"),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { mode: "date" }).defaultNow().notNull(),
  note: text("note"),
  voidedAt: timestamp("voided_at", { mode: "date" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  saleIdx: index("piano_payments_sale_idx").on(t.saleId),
  receivedIdx: index("piano_payments_received_idx").on(t.receivedAt),
}));

/** Acquisition + preparation costs of sale stock; accumulates the Pianos-on-Hand balance. */
export const pianoCostEntries = pgTable("piano_cost_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  pianoId: uuid("piano_id")
    .notNull()
    .references(() => pianos.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("acquisition"), // acquisition | prep | other
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  spentAt: timestamp("spent_at", { mode: "date" }).defaultNow().notNull(),
  vendor: text("vendor"),
  paidAccountId: uuid("paid_account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at", { mode: "date" }),
  receiptUrl: text("receipt_url"),
  note: text("note"),
  voidedAt: timestamp("voided_at", { mode: "date" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  pianoIdx: index("piano_cost_entries_piano_idx").on(t.pianoId),
}));

/* ============ TYPES ============ */

export type User = typeof users.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type WorkerBreak = typeof workerBreaks.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Update = typeof updates.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type Piano = typeof pianos.$inferSelect;
export type Inquiry = typeof inquiries.$inferSelect;
export type OwnerEvent = typeof ownerEvents.$inferSelect;
export type OwnerTask = typeof ownerTasks.$inferSelect;
export type OwnerInboxItem = typeof ownerInbox.$inferSelect;
export type OwnerCategory = typeof ownerCategories.$inferSelect;
export type OwnerPreference = typeof ownerPreferences.$inferSelect;
export type ServiceTechnician = typeof serviceTechnicians.$inferSelect;
export type ServiceCustomer = typeof serviceCustomers.$inferSelect;
export type ServiceLocation = typeof serviceLocations.$inferSelect;
export type ServicePiano = typeof servicePianos.$inferSelect;
export type ServiceCatalogItem = typeof serviceCatalog.$inferSelect;
export type ServiceJob = typeof serviceJobs.$inferSelect;
export type ServiceJobItem = typeof serviceJobItems.$inferSelect;
export type ServiceJobEvent = typeof serviceJobEvents.$inferSelect;
export type ServiceTimeLog = typeof serviceTimeLogs.$inferSelect;
export type ServiceInvoice = typeof serviceInvoices.$inferSelect;
export type ServiceInvoiceItem = typeof serviceInvoiceItems.$inferSelect;
export type ServicePayment = typeof servicePayments.$inferSelect;
export type ServiceDocumentShare = typeof serviceDocumentShares.$inferSelect;
export type ServiceExpense = typeof serviceExpenses.$inferSelect;
export type ServiceSetting = typeof serviceSettings.$inferSelect;

export type AccAccount = typeof accAccounts.$inferSelect;
export type AccJournalEntry = typeof accJournal.$inferSelect;
export type AccJournalLine = typeof accJournalLines.$inferSelect;
export type AccReconciliation = typeof accReconciliations.$inferSelect;
export type AccPeriodLock = typeof accPeriodLocks.$inferSelect;
export type AccException = typeof accExceptions.$inferSelect;
export type AccSettings = typeof accSettings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type ProjectItem = typeof projectItems.$inferSelect;
export type ProjectPayment = typeof projectPayments.$inferSelect;
export type ProjectCost = typeof projectCosts.$inferSelect;
export type PianoSale = typeof pianoSales.$inferSelect;
export type PianoPayment = typeof pianoPayments.$inferSelect;
export type PianoCostEntry = typeof pianoCostEntries.$inferSelect;
