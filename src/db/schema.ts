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
  type AnyPgColumn,
  pgEnum,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/* ============ PHILIPPINE GEOGRAPHY (Mindanao) — seeded from PSGC, read-only reference data ============ */

export const phRegions = pgTable("ph_regions", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(), // IX, X, XI, XII, XIII, BARMM
});

export const phProvinces = pgTable("ph_provinces", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  regionCode: text("region_code").notNull().references(() => phRegions.code, { onDelete: "cascade" }),
}, (t) => ({ regionIdx: index("ph_provinces_region_idx").on(t.regionCode) }));

export const phCities = pgTable("ph_cities", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  kind: text("kind").notNull().default("municipality"), // city | municipality
  /** NULL for independent cities that PSGC lists without a province. */
  provinceCode: text("province_code").references(() => phProvinces.code, { onDelete: "set null" }),
  regionCode: text("region_code").notNull().references(() => phRegions.code, { onDelete: "cascade" }),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
}, (t) => ({
  provinceIdx: index("ph_cities_province_idx").on(t.provinceCode),
  regionIdx: index("ph_cities_region_idx").on(t.regionCode),
}));

export const phBarangays = pgTable("ph_barangays", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  cityCode: text("city_code").notNull().references(() => phCities.code, { onDelete: "cascade" }),
}, (t) => ({ cityIdx: index("ph_barangays_city_idx").on(t.cityCode) }));

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
  /** Where it is, from the PSGC lists: pick a city/municipality (province and region follow). Barangay is optional. */
  cityCode: text("city_code").references(() => phCities.code, { onDelete: "set null" }),
  barangayCode: text("barangay_code").references(() => phBarangays.code, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("service_locations_customer_idx").on(t.customerId),
  cityIdx: index("service_locations_city_idx").on(t.cityCode),
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
  /** Shown under the item name on quotes and invoices. For a `package`: what is included, one item per line. */
  description: text("description"),
  kind: text("kind").notNull().default("service"), // service | part | fee | package
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  taxable: boolean("taxable").notNull().default(true),
  estimatedMinutes: integer("estimated_minutes").notNull().default(60),
  active: boolean("active").notNull().default(true),
  /** Shown as a one-tap chip under the line editor. */
  isQuickAdd: boolean("is_quick_add").notNull().default(false),
  /** Legacy: a member row pointing at a `package` row. New packages are one price with an "includes" list in `description`; this is only read as a fallback when a package has no list. */
  packageId: uuid("package_id").references((): AnyPgColumn => serviceCatalog.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** A planned run to one place (e.g. "Gensan, Oct 18"): the waitlist clients confirmed for it become its jobs. */
export const serviceTrips = pgTable("service_trips", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  cityCode: text("city_code").references(() => phCities.code, { onDelete: "set null" }),
  tripDate: timestamp("trip_date", { mode: "date" }),
  /** planned | done | cancelled — "done" once the owner has seen the "still waiting nearby" prompt. */
  status: text("status").notNull().default("planned"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** A home-service visit, or the sale of a showroom piano. */
export const serviceJobType = pgEnum("service_job_type", ["service", "sale"]);

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
  /** service (default) or sale. A sale's delivery date is `scheduledStart` and its delivery crew is `technicianId`. */
  jobType: serviceJobType("job_type").notNull().default("service"),
  /** Sale only: the showroom piano being sold (read from Piano Management; never changed from here). */
  salePianoId: uuid("sale_piano_id").references(() => pianos.id, { onDelete: "set null" }),
  buyCostCents: integer("buy_cost_cents").notNull().default(0),
  prepCostCents: integer("prep_cost_cents").notNull().default(0),
  salePriceCents: integer("sale_price_cents").notNull().default(0),
  /** Deposit already received; balance = price − deposit until the sale is completed (collected at delivery). */
  depositCents: integer("deposit_cents").notNull().default(0),
  /** The waitlist trip this visit belongs to, if it was planned from the waitlist. */
  tripId: uuid("trip_id").references(() => serviceTrips.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  tripIdx: index("service_jobs_trip_idx").on(t.tripId),
  jobTypeIdx: index("service_jobs_job_type_idx").on(t.jobType),
  salePianoIdx: index("service_jobs_sale_piano_idx").on(t.salePianoId),
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
  /** Optional per-unit cost to the business, for job margin. 0 = not entered. */
  costCents: integer("cost_cents").notNull().default(0),
  /** Small print under the item name on the quote and invoice ("Includes: tuning · cleaning"). */
  details: text("details"),
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
  /** The job status this event moved the job into (null for notes, payments, …). Time entries are derived from these. */
  status: text("status"),
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
  /** event = derived from job status events · timer = started with a timer button · manual = typed in or edited by hand. */
  source: text("source").notNull().default("timer"),
  /** The status event that opened this entry (event-derived entries only). */
  startEventId: uuid("start_event_id").references(() => serviceJobEvents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index("service_time_logs_job_idx").on(t.jobId),
  startEventIdx: uniqueIndex("service_time_logs_start_event_idx").on(t.startEventId).where(sql`"start_event_id" IS NOT NULL`),
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
  kind: text("kind").notNull().default("service"), // service | sale (piano sale; dashboard split only)
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
  /** Small print under the item name (copied from the job line, or typed on the invoice). */
  details: text("details"),
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

/** What an expense is for: a cost of home-service work, stock for a piano to sell, or overhead. NULL = not reviewed yet. */
export const serviceExpenseKind = pgEnum("service_expense_kind", ["job", "stock", "overhead"]);

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
  /** NULL until the owner (or the form) picks one; finance falls back to the category default meanwhile. */
  kind: serviceExpenseKind("kind"),
  /** Showroom piano this stock expense belongs to (kind = stock). */
  pianoId: uuid("piano_id").references(() => pianos.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  spentIdx: index("service_expenses_spent_idx").on(t.spentAt),
  jobIdx: index("service_expenses_job_idx").on(t.jobId),
  pianoIdx: index("service_expenses_piano_idx").on(t.pianoId),
}));

/**
 * Permanent, insert-only history of money edits ("what it was before -> what it is now").
 * No foreign keys on purpose: rows must survive when the invoice / payment / expense is deleted.
 */
export const serviceFinanceHistory = pgTable("service_finance_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  entityType: text("entity_type").$type<"invoice" | "invoice_item" | "payment" | "expense">().notNull(),
  entityId: uuid("entity_id").notNull(),
  /** Groups an invoice with its lines and payments. */
  invoiceId: uuid("invoice_id"),
  jobId: uuid("job_id"),
  action: text("action").$type<"create" | "update" | "delete" | "status">().notNull(),
  summary: text("summary").notNull(),
  /** { field: { from, to } }, money as whole centavos. */
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
  /** Reserved for phase 3 (required reason when editing paid records). */
  reason: text("reason"),
  actorName: text("actor_name"),
}, (t) => ({
  entityIdx: index("service_finance_history_entity_idx").on(t.entityType, t.entityId),
  invoiceIdx: index("service_finance_history_invoice_idx").on(t.invoiceId),
  createdIdx: index("service_finance_history_created_idx").on(t.createdAt),
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
  /** Where trips start from (a PSGC city code; Davao City by default) and how far from the route / destination to look. */
  homeBaseCityCode: text("home_base_city_code").notNull().default("112402000"),
  tripRadiusKm: integer("trip_radius_km").notNull().default(40),
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
export type ServiceFinanceHistory = typeof serviceFinanceHistory.$inferSelect;
export type ServiceSetting = typeof serviceSettings.$inferSelect;

/* ============ WAITLIST BY AREA ============ */

export const serviceWaitlistStatus = pgEnum("service_waitlist_status", ["waiting", "messaged", "confirmed", "scheduled", "done", "not_now"]);
export const serviceWaitlistSource = pgEnum("service_waitlist_source", ["website", "facebook", "phone", "recall", "walk_in"]);

export const serviceWaitlistEntries = pgTable("service_waitlist_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").notNull().references(() => serviceCustomers.id, { onDelete: "cascade" }),
  pianoId: uuid("piano_id").references(() => servicePianos.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull().default("tuning"),
  /** The area, from the PSGC lists (defaults from the customer's location; NULL = "Unsorted"). */
  cityCode: text("city_code").references(() => phCities.code, { onDelete: "set null" }),
  barangayCode: text("barangay_code").references(() => phBarangays.code, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { mode: "date" }).defaultNow().notNull(),
  status: serviceWaitlistStatus("status").notNull().default("waiting"),
  lastContactedAt: timestamp("last_contacted_at", { mode: "date" }),
  /** Required: every entry always has a next nudge (default 3 days out). */
  nextFollowUpAt: timestamp("next_follow_up_at", { mode: "date" }).notNull(),
  followUpCount: integer("follow_up_count").notNull().default(0),
  estValueCents: integer("est_value_cents").notNull().default(0),
  notes: text("notes"),
  tripId: uuid("trip_id").references(() => serviceTrips.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => serviceJobs.id, { onDelete: "set null" }),
  source: serviceWaitlistSource("source").notNull().default("phone"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("service_waitlist_status_idx").on(t.status),
  cityIdx: index("service_waitlist_city_idx").on(t.cityCode),
  followUpIdx: index("service_waitlist_follow_up_idx").on(t.nextFollowUpAt),
  customerIdx: index("service_waitlist_customer_idx").on(t.customerId),
}));

/** Editable message texts with {first_name} {area} {date} {time} {piano} {location} {price} {tech_name} placeholders. */
export const serviceMessageTemplates = pgTable("service_message_templates", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** A saved run ("South Run"): an ordered list of cities, used to filter the waitlist. */
export const serviceRoutes = pgTable("service_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  cityCodes: jsonb("city_codes").$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export type PhCity = typeof phCities.$inferSelect;
export type ServiceWaitlistEntry = typeof serviceWaitlistEntries.$inferSelect;
export type ServiceTrip = typeof serviceTrips.$inferSelect;
export type ServiceRoute = typeof serviceRoutes.$inferSelect;
export type ServiceMessageTemplate = typeof serviceMessageTemplates.$inferSelect;

/** "Remind me to follow up with this client" — a dated nudge with a note. Shown on Today when due. */
export const serviceReminderStatus = pgEnum("service_reminder_status", ["open", "done"]);

export const serviceReminders = pgTable("service_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").notNull().references(() => serviceCustomers.id, { onDelete: "cascade" }),
  /** What the follow-up is about, e.g. "ask about the Yamaha quote". */
  note: text("note"),
  dueAt: timestamp("due_at", { mode: "date" }).notNull(),
  status: serviceReminderStatus("status").notNull().default("open"),
  doneAt: timestamp("done_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("service_reminders_customer_idx").on(t.customerId),
  openDueIdx: index("service_reminders_status_due_idx").on(t.status, t.dueAt),
}));

export type ServiceReminder = typeof serviceReminders.$inferSelect;
