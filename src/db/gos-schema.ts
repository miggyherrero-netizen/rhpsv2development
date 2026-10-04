import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, uuid, boolean, check, index } from "drizzle-orm/pg-core";

export const gosLoginAttempts = pgTable("gos_login_attempts", {
  email: text("email").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  firstFailedAt: timestamp("first_failed_at", { mode: "date", withTimezone: true }),
  lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),
});

export const gosSettings = pgTable(
  "gos_settings",
  {
    id: integer("id").primaryKey().default(1),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("gos_settings_single_row", sql`${t.id} = 1`)],
);

export const gosAds = pgTable("gos_ads", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  retired: boolean("retired").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export type GosAd = typeof gosAds.$inferSelect;

export const gosCustomers = pgTable(
  "gos_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    area: text("area"),
    status: text("status").notNull().default("New"),
    statusBeforeLost: text("status_before_lost"),
    lostReason: text("lost_reason"),
    cameFrom: text("came_from").notNull(),
    adKind: text("ad_kind").notNull().default("none"),
    adId: uuid("ad_id").references(() => gosAds.id),
    note: text("note").notNull().default(""),
    inquiryAt: timestamp("inquiry_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    repliedAt: timestamp("replied_at", { mode: "date", withTimezone: true }),
    notDuplicate: boolean("not_duplicate").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("gos_customers_status_idx").on(t.status)],
);

export const gosActivity = pgTable(
  "gos_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull().references(() => gosCustomers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    /** Previous values, so "Undo" can restore them. */
    undoData: jsonb("undo_data"),
    undoneAt: timestamp("undone_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("gos_activity_customer_idx").on(t.customerId, t.createdAt)],
);

export type GosCustomer = typeof gosCustomers.$inferSelect;
export type GosActivity = typeof gosActivity.$inferSelect;
