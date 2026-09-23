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
} from "drizzle-orm/pg-core";
import type { Recurrence } from "@/lib/dates";

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
