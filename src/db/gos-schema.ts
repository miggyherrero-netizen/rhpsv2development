import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, uuid, boolean, check } from "drizzle-orm/pg-core";

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
