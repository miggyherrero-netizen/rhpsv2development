# Task: Security & RBAC Foundations — Herrero Pianos

**IMPORTANT — read first:** Do NOT explore, scaffold, or invent your own project/sandbox structure. This document contains the task brief AND the full, real, current content of every relevant existing file in the project, pasted below. Treat those files as the actual current state of the repo. Only modify/create the files explicitly listed in "Files you'll touch." Do not invent new files, folders, or a different architecture.

## Project
- Stack: Next.js 16 (App Router, Turbopack), Drizzle ORM, Postgres, Docker Compose
- Run/rebuild: `docker compose up -d --build web` (web serves on host port 9847, mapped from container port 3000)
- DB migrations + seed run automatically on container start via `init-db.sh`

## Context — key facts you must respect

- **Auth already works** via DB-backed httpOnly session cookies — see `src/lib/auth.ts` (`requireUser`, `createSession`, `getUser`, `endSession`), sessions stored in the `sessions` table, password hashing via `scrypt` in `src/lib/security.ts`. **Do not migrate to JWT.** Keep this system, extend it.
- **Mutations already go through Next.js Server Actions** (`"use server"` files in `src/server/admin.ts`, `owner.ts`, `workshop.ts`, `auth-actions.ts`). These already get built-in Origin-header CSRF protection from Next.js itself. **Do not build a separate REST CRUD API layer or a CSRF double-submit-token system.**
- **DB connection pooling is already correct** — `src/db/index.ts` uses a singleton `pg.Pool` with a global cache guard. No pooling work needed.
- **There is exactly one authenticated human role today**: `users.role` defaults to `"owner"`. `/admin/*` and `/owner/*` are two feature areas used by the *same* person, not two separate roles. **Do not invent a second role or build a multi-role/decorator RBAC framework.** Just add a reusable guard function so a future role is a one-line addition.

## Real gaps — fix these

1. **`src/app/api/live/route.ts` has zero authentication.** Publicly leaks live operational data (who's clocked in, which project/task) to anyone. Needs to require a valid session.
2. **`src/lib/security.ts`**: `AUTH_SECRET` silently falls back to a hardcoded string if the env var isn't set. In production this lets anyone forge signed worker-PIN cookies. No startup check catches a missing `AUTH_SECRET` in production.
3. **Zero input validation anywhere.** Every server action in `admin.ts`, `owner.ts`, `workshop.ts` takes a raw untyped object straight into a Drizzle `insert`/`update`/`select` call.
4. **No global error boundary.** Use Next.js App Router convention (`error.tsx` / `global-error.tsx`), not a hack inside `layout.tsx`.
5. **No rate limiting** on `/api/health` and `/api/live`.

## Implementation plan

### 1. `src/lib/env.ts` (new)
Reads `DATABASE_URL` and `AUTH_SECRET` from `process.env`. If either is missing while `process.env.NODE_ENV === "production"`, throw a clear error immediately. Outside production, allow the existing dev fallback values.

Wire it in:
- `src/lib/security.ts` — replace the inline `AUTH_SECRET` fallback with an import from `src/lib/env.ts`.
- `src/db/index.ts` — replace the inline `DATABASE_URL` read/throw with an import from `src/lib/env.ts`. Keep the existing `Pool`/global-cache singleton logic exactly as-is.

### 2. Role guard helper
Add to `src/lib/auth.ts`, next to `requireUser()`:
```ts
export async function requireRole(...roles: string[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/login");
  return user;
}
```
Don't apply it anywhere yet — no second role exists today.

### 3. Auth-gate `/api/live`
Edit `src/app/api/live/route.ts`: call `requireUser()` before calling `getLiveOps()`. If no valid session, return a 401 JSON response. Mirror the pattern already used throughout `admin.ts`/`owner.ts`.

### 4. Zod validation on all mutations
- Add `zod` to `package.json` dependencies.
- Create `src/lib/validation.ts` with Zod schemas matching the input types already declared inline in `admin.ts` (`ProjectInput`, `TaskInput`, worker input, `InventoryInput`), `owner.ts` (`OwnerEventInput`, `OwnerTaskInput`), and `workshop.ts` (PIN format, clock actions).
- Reuse existing enum constants from `src/lib/config.ts` (`PRIORITIES`, `TASK_COLUMNS`, `PROJECT_STAGES`) via `z.enum(...)`.
- In each server action, parse `input` through the matching schema first. On failure return `{ ok: false, error: <message> }` — matches existing return shape (see `login()` in `auth-actions.ts`), so no client-side changes needed.

### 5. Global error boundary
- Add `src/app/error.tsx` — client component, Next.js App Router convention, styled with the app's existing dark/panel visual language (see `src/components/ui.tsx` for the `Modal`/`EmptyState` styling patterns to match — dark bg `bg-panel`/`text-chrome`, rounded-2xl cards, serif headings).
- Add `src/app/global-error.tsx` (must include its own `<html>`/`<body>` per Next.js convention).

### 6. Rate limiting
- Create `src/lib/rate-limit.ts`: minimal in-memory sliding-window limiter (plain JS Map, no Redis — single Docker container).
- Apply to `src/app/api/health/route.ts` and `src/app/api/live/route.ts` (after the auth check). On exceed, return 429 with `Retry-After` header.

## Explicitly out of scope
- JWT migration, separate REST CRUD API layer, CSRF double-submit tokens, multi-role RBAC decorators, WebSocket/SSE, notifications, cursor pagination, full Vitest/Playwright suite, winston logging, audit logging.

## Files you'll touch
**New:** `src/lib/env.ts`, `src/lib/validation.ts`, `src/lib/rate-limit.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`
**Edited:** `src/lib/security.ts`, `src/lib/auth.ts`, `src/db/index.ts`, `src/app/api/live/route.ts`, `src/app/api/health/route.ts`, `src/server/admin.ts`, `src/server/owner.ts`, `src/server/workshop.ts`, `package.json`

## Verification
1. `npm run typecheck` and `npm run lint` pass.
2. `docker compose up -d --build web` boots cleanly.
3. `curl -i http://localhost:9847/api/live` with no cookie → `401` (currently `200`).
4. Logged-in session → `/api/live` still returns `200` with same data shape.
5. Invalid form submit → inline validation error, not raw DB error.
6. `NODE_ENV=production` + missing `AUTH_SECRET` → container fails to start with clear error.
7. Forced error in a server component → renders `error.tsx`, not Next's default crash screen.
8. Hammering `/api/health` → `429` with `Retry-After`.

## OUTPUT FORMAT — IMPORTANT

Output the **complete, full content of each file** (not a diff, not a snippet) in its own labeled code block, one file at a time:

```
### FILE: src/lib/env.ts
```ts
<full file content here>
```
```

Go through every New file first, then every Edited file (full file after your edit, not just changed lines). Do not skip any file. Do not invent new files, folders, or a different project structure.

---

# EXISTING FILES — CURRENT REAL CONTENT (ground truth, do not deviate)

### FILE: package.json
```json
{
  "name": "nextjs-postgresql-template",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "17.3.1",
    "drizzle-kit": "0.31.10",
    "drizzle-orm": "0.45.2",
    "lucide-react": "^1.47.0",
    "next": "16.2.6",
    "pg": "8.20.0",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "tsx": "^4.23.15"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.1.17",
    "@types/node": "22.19.15",
    "@types/pg": "8.18.0",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "eslint": "9.39.4",
    "eslint-config-next": "16.2.6",
    "postcss": "8.5.8",
    "tailwindcss": "4.1.17",
    "typescript": "5.9.3"
  }
}
```

### FILE: src/lib/auth.ts
```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { newToken } from "@/lib/security";

export const SESSION_COOKIE = "hp_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ token, userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.token, token));
  jar.delete(SESSION_COOKIE);
}
```

### FILE: src/lib/security.ts
```ts
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
  createHash,
} from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(`herrero-pin-v1:${pin}`).digest("hex");
}

export function verifyPin(pin: string, stored: string): boolean {
  const a = Buffer.from(hashPin(pin));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "herrero-atelier-dev-secret-do-not-use-in-prod";

export function signPayload(payload: string): string {
  const sig = createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySigned(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
```

### FILE: src/lib/config.ts
```ts
export const PROJECT_STAGES = [
  { key: "intake", label: "Intake" },
  { key: "disassembly", label: "Disassembly" },
  { key: "restoration", label: "Restoration" },
  { key: "finishing", label: "Finishing" },
  { key: "quality", label: "Quality Control" },
  { key: "delivery", label: "Delivery" },
] as const;

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STAGES.map((s) => [s.key, s.label]),
);

export const TASK_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "available", label: "Available" },
  { key: "claimed", label: "Claimed" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
] as const;

export const TASK_LABEL: Record<string, string> = Object.fromEntries(
  TASK_COLUMNS.map((s) => [s.key, s.label]),
);

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  low: { label: "Low", dot: "bg-slate-400", text: "text-slate-400" },
  normal: { label: "Normal", dot: "bg-sky-400", text: "text-sky-300" },
  high: { label: "High", dot: "bg-amber-400", text: "text-amber-300" },
  urgent: { label: "Urgent", dot: "bg-rose-500", text: "text-rose-400" },
};

export const PRIORITY_STYLE_LIGHT: Record<string, { label: string; dot: string; text: string }> = {
  low: { label: "Low", dot: "bg-slate-400", text: "text-slate-500" },
  normal: { label: "Normal", dot: "bg-sky-500", text: "text-sky-700" },
  high: { label: "High", dot: "bg-amber-500", text: "text-amber-700" },
  urgent: { label: "Urgent", dot: "bg-rose-500", text: "text-rose-600" },
};

export const PIANO_STATUS: Record<string, { label: string; cls: string }> = {
  available: { label: "Available", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  reserved: { label: "Reserved", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  sold: { label: "Sold", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const OWNER_EVENT_KINDS = [
  { key: "event", label: "Appointment" },
  { key: "focus", label: "Focus Block" },
  { key: "reminder", label: "Reminder" },
] as const;

export const REMINDER_OPTIONS = [
  { value: 0, label: "At start" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

export const CATEGORY_COLORS = [
  "#1e293b", "#64748b", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#b08d57", "#0f766e",
];

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
```

### FILE: src/db/index.ts
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
```

### FILE: src/db/schema.ts
```ts
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: "cascade" }),
  clockIn: timestamp("clock_in", { mode: "date" }).notNull(),
  clockOut: timestamp("clock_out", { mode: "date" }),
  rateAtClockInCents: integer("rate_at_clock_in_cents").notNull(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
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
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Update = typeof updates.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type Piano = typeof pianos.$inferSelect;
export type Inquiry = typeof inquiries.$inferSelect;
export type OwnerEvent = typeof ownerEvents.$inferSelect;
export type OwnerTask = typeof ownerTasks.$inferSelect;
export type OwnerInboxItem = typeof ownerInbox.$inferSelect;
export type OwnerCategory = typeof ownerCategories.$inferSelect;
export type OwnerPreference = typeof ownerPreferences.$inferSelect;
```

### FILE: src/app/api/live/route.ts
```ts
import { NextResponse } from "next/server";
import { getLiveOps } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getLiveOps();
  return NextResponse.json(data);
}
```

### FILE: src/app/api/health/route.ts
```ts
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
```

### FILE: src/server/admin.ts
```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects, tasks, workers, updates, inventoryItems, settings, inquiries,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hashPin } from "@/lib/security";
import { randomUUID } from "crypto";
import { getProjectDetail, getWorkerDetail } from "@/server/data";

const touch = () => revalidatePath("/admin", "layout");

export type ProjectInput = {
  clientName: string; clientEmail?: string; clientPhone?: string; clientAddress?: string;
  pianoBrand: string; pianoModel: string; pianoYear?: number | null; serialNumber?: string;
  serviceType?: string; status?: string; dueDate?: string | null; assignedWorkerId?: string | null;
  imageUrl?: string; notes?: string;
};

export async function createProject(input: ProjectInput) {
  await requireUser();
  await db.insert(projects).values({
    clientName: input.clientName,
    clientEmail: input.clientEmail || null,
    clientPhone: input.clientPhone || null,
    clientAddress: input.clientAddress || null,
    pianoBrand: input.pianoBrand,
    pianoModel: input.pianoModel,
    pianoYear: input.pianoYear ?? null,
    serialNumber: input.serialNumber || null,
    serviceType: input.serviceType || "Full Restoration",
    status: input.status || "intake",
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    assignedWorkerId: input.assignedWorkerId || null,
    imageUrl: input.imageUrl || null,
    notes: input.notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateProject(id: string, patch: Partial<ProjectInput> & { progress?: number }) {
  await requireUser();
  const { dueDate, ...rest } = patch;
  await db.update(projects).set({
    ...rest,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    updatedAt: new Date(),
  }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function setProjectStatus(id: string, status: string) {
  await requireUser();
  const progressMap: Record<string, number> = { intake: 8, disassembly: 22, restoration: 50, finishing: 72, quality: 88, delivery: 98 };
  await db.update(projects).set({ status, ...(progressMap[status] ? { progress: progressMap[status] } : {}), updatedAt: new Date() }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteProject(id: string) {
  await requireUser();
  await db.delete(projects).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function rotatePortalLink(id: string) {
  await requireUser();
  await db.update(projects).set({ portalUuid: randomUUID(), updatedAt: new Date() }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

/* ================= TASKS ================= */

export type TaskInput = {
  projectId?: string | null; title: string; description?: string; priority?: string;
  assignedWorkerId?: string | null; estimatedMinutes?: number; dueDate?: string | null;
  status?: string; waitingParts?: boolean;
};

export async function createTask(input: TaskInput) {
  await requireUser();
  await db.insert(tasks).values({
    projectId: input.projectId || null,
    title: input.title,
    description: input.description || null,
    priority: input.priority || "normal",
    assignedWorkerId: input.assignedWorkerId || null,
    estimatedMinutes: input.estimatedMinutes ?? 60,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    status: input.status || "available",
    waitingParts: input.waitingParts ?? false,
  });
  touch();
  return { ok: true as const };
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  await requireUser();
  const { dueDate, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (patch.status === "done") data.completedAt = new Date();
  await db.update(tasks).set(data).where(eq(tasks.id, id));
  touch();
  return { ok: true as const };
}

export async function setTaskStatus(id: string, status: string) {
  await requireUser();
  await db.update(tasks).set({
    status,
    completedAt: status === "done" ? new Date() : null,
    ...(status === "available" || status === "backlog" ? { claimedByWorkerId: null } : {}),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteTask(id: string) {
  await requireUser();
  await db.delete(tasks).where(eq(tasks.id, id));
  touch();
  return { ok: true as const };
}

/* ================= WORKERS ================= */

export async function createWorker(input: { name: string; title?: string; hourlyRateCents: number; pin: string; avatarUrl?: string }) {
  await requireUser();
  if (!/^\d{4}$/.test(input.pin)) return { ok: false as const, error: "PIN must be exactly 4 digits." };
  await db.insert(workers).values({
    name: input.name,
    title: input.title || "Technician",
    hourlyRateCents: input.hourlyRateCents,
    pinHash: hashPin(input.pin),
    avatarUrl: input.avatarUrl || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateWorker(id: string, patch: { name?: string; title?: string; hourlyRateCents?: number; active?: boolean; avatarUrl?: string | null }) {
  await requireUser();
  await db.update(workers).set(patch).where(eq(workers.id, id));
  touch();
  return { ok: true as const };
}

export async function resetWorkerPin(id: string, pin: string) {
  await requireUser();
  if (!/^\d{4}$/.test(pin)) return { ok: false as const, error: "PIN must be exactly 4 digits." };
  await db.update(workers).set({ pinHash: hashPin(pin) }).where(eq(workers.id, id));
  touch();
  return { ok: true as const };
}

/* ================= INVENTORY ================= */

export type InventoryInput = {
  name: string; category: string; sku?: string; supplier?: string; qtyOnHand?: number;
  unitCostCents?: number; reorderPoint?: number; location?: string; notes?: string;
};

export async function createInventoryItem(input: InventoryInput) {
  await requireUser();
  await db.insert(inventoryItems).values({
    name: input.name, category: input.category || "General",
    sku: input.sku || null, supplier: input.supplier || null,
    qtyOnHand: input.qtyOnHand ?? 0, unitCostCents: input.unitCostCents ?? 0,
    reorderPoint: input.reorderPoint ?? 0, location: input.location || null, notes: input.notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryInput>) {
  await requireUser();
  await db.update(inventoryItems).set({ ...patch, updatedAt: new Date() }).where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

export async function adjustInventoryQty(id: string, delta: number) {
  await requireUser();
  await db.update(inventoryItems)
    .set({ qtyOnHand: sql`GREATEST(0, ${inventoryItems.qtyOnHand} + ${delta})`, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteInventoryItem(id: string) {
  await requireUser();
  await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

/* ================= CURATOR / STORY ================= */

export async function createUpdate(input: { projectId: string; title: string; body?: string; imageUrl?: string; visible?: boolean }) {
  await requireUser();
  const [max] = await db.select({ m: sql<number>`COALESCE(MAX(${updates.position}),0)` }).from(updates).where(eq(updates.projectId, input.projectId));
  await db.insert(updates).values({
    projectId: input.projectId, title: input.title, body: input.body || null,
    imageUrl: input.imageUrl || null, isVisibleToClient: input.visible ?? false,
    position: (max?.m ?? 0) + 1, updateDate: new Date(),
  });
  if (input.visible) {
    await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, input.projectId));
  }
  touch();
  return { ok: true as const };
}

export async function toggleUpdateVisibility(id: string, visible: boolean, projectId: string) {
  await requireUser();
  await db.update(updates).set({ isVisibleToClient: visible }).where(eq(updates.id, id));
  if (visible) await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, projectId));
  touch();
  return { ok: true as const };
}

export async function reorderUpdates(projectId: string, orderedIds: string[]) {
  await requireUser();
  await Promise.all(orderedIds.map((id, i) => db.update(updates).set({ position: i + 1 }).where(eq(updates.id, id))));
  touch();
  return { ok: true as const };
}

export async function deleteUpdate(id: string) {
  await requireUser();
  await db.delete(updates).where(eq(updates.id, id));
  touch();
  return { ok: true as const };
}

export async function publishAllUpdates(projectId: string) {
  await requireUser();
  await db.update(updates).set({ isVisibleToClient: true }).where(eq(updates.projectId, projectId));
  await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, projectId));
  touch();
  return { ok: true as const };
}

/* ================= MISC ================= */

export async function resolveInquiry(id: string) {
  await requireUser();
  await db.update(inquiries).set({ status: "handled" }).where(eq(inquiries.id, id));
  touch();
  return { ok: true as const };
}

export async function saveStaleDays(days: number) {
  await requireUser();
  await db.insert(settings).values({ key: "staleUpdateDays", value: String(days) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(days) } });
  touch();
  return { ok: true as const };
}

export async function fetchProjectDetail(id: string) {
  await requireUser();
  return getProjectDetail(id);
}

export async function fetchWorkerDetail(id: string) {
  await requireUser();
  return getWorkerDetail(id);
}

export async function fetchProjectUpdates(projectId: string) {
  await requireUser();
  return db.select().from(updates).where(eq(updates.projectId, projectId)).orderBy(updates.position);
}
```

### FILE: src/server/owner.ts
```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { ownerEvents, ownerTasks, ownerInbox, ownerCategories, ownerPreferences } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { RECURRENCE_PRESETS, type Recurrence } from "@/lib/dates";

const touch = () => revalidatePath("/owner", "layout");
const recFromKey = (key?: string | null): Recurrence | null =>
  RECURRENCE_PRESETS.find((p) => p.key === (key ?? "none"))?.rec ?? null;

/* ================= EVENTS ================= */

export type OwnerEventInput = {
  title: string; kind?: string; startAt: string; endAt?: string | null; isAllDay?: boolean;
  location?: string; person?: string; categoryId?: string | null; color?: string | null;
  reminderMinutes?: number | null; recurrenceKey?: string; notes?: string; description?: string;
};

export async function createOwnerEvent(input: OwnerEventInput) {
  const user = await requireUser();
  await db.insert(ownerEvents).values({
    ownerId: user.id,
    title: input.title,
    kind: input.kind || "event",
    startAt: new Date(input.startAt),
    endAt: input.endAt ? new Date(input.endAt) : null,
    isAllDay: input.isAllDay ?? false,
    location: input.location || null,
    person: input.person || null,
    categoryId: input.categoryId || null,
    color: input.color || null,
    reminderMinutes: input.reminderMinutes ?? null,
    recurrence: recFromKey(input.recurrenceKey),
    notes: input.notes || null,
    description: input.description || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateOwnerEvent(id: string, patch: Partial<OwnerEventInput> & { status?: string }) {
  const user = await requireUser();
  const { startAt, endAt, recurrenceKey, ...rest } = patch;
  await db.update(ownerEvents).set({
    ...rest,
    ...(startAt ? { startAt: new Date(startAt) } : {}),
    ...(endAt !== undefined ? { endAt: endAt ? new Date(endAt) : null } : {}),
    ...(recurrenceKey !== undefined ? { recurrence: recFromKey(recurrenceKey) } : {}),
    updatedAt: new Date(),
  }).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

/** mode: "series" edits whole record; "occurrence" exempts a single date. */
export async function deleteOwnerEvent(id: string, mode: "series" | "occurrence", dateYmd?: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  if (mode === "occurrence" && ev.recurrence && dateYmd) {
    const rec: Recurrence = { ...ev.recurrence, exdates: [...(ev.recurrence.exdates ?? []), dateYmd] };
    await db.update(ownerEvents).set({ recurrence: rec, updatedAt: new Date() }).where(eq(ownerEvents.id, id));
  } else {
    await db.update(ownerEvents).set({ deletedAt: new Date() }).where(eq(ownerEvents.id, id));
  }
  touch();
  return { ok: true as const };
}

export async function completeOwnerEvent(id: string, mode: "series" | "occurrence", dateYmd?: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  if (mode === "occurrence" && ev.recurrence && dateYmd) {
    const rec: Recurrence = { ...ev.recurrence, exdates: [...(ev.recurrence.exdates ?? []), dateYmd] };
    await db.update(ownerEvents).set({ recurrence: rec }).where(eq(ownerEvents.id, id));
    const base = new Date(`${dateYmd}T00:00:00`);
    const start = new Date(base); start.setHours(ev.startAt.getHours(), ev.startAt.getMinutes());
    const dur = ev.endAt ? ev.endAt.getTime() - ev.startAt.getTime() : 30 * 60_000;
    await db.insert(ownerEvents).values({
      ownerId: user.id, title: ev.title, kind: ev.kind, startAt: start,
      endAt: new Date(start.getTime() + dur), categoryId: ev.categoryId, color: ev.color,
      location: ev.location, status: "done", completedAt: new Date(),
    });
  } else {
    await db.update(ownerEvents).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(ownerEvents.id, id));
  }
  touch();
  return { ok: true as const };
}

export async function duplicateOwnerEvent(id: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  await db.insert(ownerEvents).values({
    ownerId: user.id, title: `${ev.title}`, kind: ev.kind, startAt: ev.startAt, endAt: ev.endAt,
    isAllDay: ev.isAllDay, location: ev.location, person: ev.person, categoryId: ev.categoryId,
    color: ev.color, notes: ev.notes, description: ev.description, reminderMinutes: ev.reminderMinutes,
  });
  touch();
  return { ok: true as const };
}

/* ================= TASKS ================= */

export type OwnerTaskInput = {
  title: string; description?: string; dueDate?: string | null; scheduledStart?: string | null;
  scheduledEnd?: string | null; estimatedMinutes?: number | null; priority?: string;
  categoryId?: string | null; notes?: string; recurrenceKey?: string; reminderMinutes?: number | null;
};

const taskPatch = (input: Partial<OwnerTaskInput>) => {
  const { dueDate, scheduledStart, scheduledEnd, recurrenceKey, ...rest } = input;
  return {
    ...rest,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    ...(scheduledStart !== undefined ? { scheduledStart: scheduledStart ? new Date(scheduledStart) : null } : {}),
    ...(scheduledEnd !== undefined ? { scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null } : {}),
    ...(recurrenceKey !== undefined ? { recurrence: recFromKey(recurrenceKey) } : {}),
    updatedAt: new Date(),
  };
};

export async function createOwnerTask(input: OwnerTaskInput) {
  const user = await requireUser();
  await db.insert(ownerTasks).values({ ownerId: user.id, title: input.title, ...taskPatch(input) });
  touch();
  return { ok: true as const };
}

export async function updateOwnerTask(id: string, patch: Partial<OwnerTaskInput>) {
  const user = await requireUser();
  await db.update(ownerTasks).set(taskPatch(patch)).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function setOwnerTaskDone(id: string, done: boolean) {
  const user = await requireUser();
  await db.update(ownerTasks).set({
    status: done ? "done" : "pending",
    completedAt: done ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function cancelOwnerTask(id: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function scheduleOwnerTask(id: string, startIso: string | null, endIso: string | null) {
  const user = await requireUser();
  await db.update(ownerTasks).set({
    scheduledStart: startIso ? new Date(startIso) : null,
    scheduledEnd: endIso ? new Date(endIso) : null,
    updatedAt: new Date(),
  }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function postponeOwnerTask(id: string, dateIso: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ dueDate: new Date(dateIso), scheduledStart: null, scheduledEnd: null, updatedAt: new Date() })
    .where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function toggleOnToday(id: string, onToday: boolean) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ onToday, updatedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function deleteOwnerTask(id: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ deletedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

/* ================= INBOX ================= */

export async function addInboxItem(title: string, priority?: string, dueDate?: string | null, notes?: string) {
  const user = await requireUser();
  await db.insert(ownerInbox).values({
    ownerId: user.id, title, priority: priority || "normal",
    dueDate: dueDate ? new Date(dueDate) : null, notes: notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function archiveInboxItem(id: string) {
  const user = await requireUser();
  await db.update(ownerInbox).set({ processedAt: new Date(), convertedType: "archived" })
    .where(and(eq(ownerInbox.id, id), eq(ownerInbox.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function convertInboxItem(id: string, type: "task" | "event" | "reminder", dateIso?: string | null) {
  const user = await requireUser();
  const [item] = await db.select().from(ownerInbox).where(and(eq(ownerInbox.id, id), eq(ownerInbox.ownerId, user.id))).limit(1);
  if (!item || item.processedAt) return { ok: false as const };
  const when = dateIso ? new Date(dateIso) : null;
  if (type === "task") {
    await db.insert(ownerTasks).values({ ownerId: user.id, title: item.title, notes: item.notes, priority: item.priority, dueDate: when ?? item.dueDate });
  } else {
    const start = when ?? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
    await db.insert(ownerEvents).values({
      ownerId: user.id, title: item.title, kind: type === "reminder" ? "reminder" : "event",
      startAt: start, endAt: new Date(start.getTime() + 45 * 60_000), notes: item.notes,
    });
  }
  await db.update(ownerInbox).set({ processedAt: new Date(), convertedType: type }).where(eq(ownerInbox.id, id));
  touch();
  return { ok: true as const };
}

/* ================= CATEGORIES & PREFS ================= */

export async function createCategory(name: string, color: string) {
  const user = await requireUser();
  await db.insert(ownerCategories).values({ name, color, position: 99 });
  touch();
  return { ok: true as const };
}

export async function updateCategory(id: string, patch: { name?: string; color?: string; hidden?: boolean }) {
  await requireUser();
  await db.update(ownerCategories).set(patch).where(eq(ownerCategories.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteCategory(id: string, reassignTo: string | null) {
  await requireUser();
  await db.update(ownerEvents).set({ categoryId: reassignTo }).where(eq(ownerEvents.categoryId, id));
  await db.update(ownerTasks).set({ categoryId: reassignTo }).where(eq(ownerTasks.categoryId, id));
  await db.delete(ownerCategories).where(eq(ownerCategories.id, id));
  touch();
  return { ok: true as const };
}

export type PrefsPatch = {
  defaultView?: string; weekStart?: number; timeFormat?: string; defaultEventMinutes?: number;
  defaultTaskPriority?: string; showWeekends?: boolean; showCompleted?: boolean;
  workingHours?: Record<number, [number, number] | null>; timezone?: string;
};

export async function updatePreferences(patch: PrefsPatch) {
  const user = await requireUser();
  const [existing] = await db.select().from(ownerPreferences).where(eq(ownerPreferences.ownerId, user.id)).limit(1);
  if (existing) {
    await db.update(ownerPreferences).set({ ...patch, updatedAt: new Date() }).where(eq(ownerPreferences.id, existing.id));
  } else {
    await db.insert(ownerPreferences).values({ ownerId: user.id, ...patch });
  }
  touch();
  return { ok: true as const };
}
```

### FILE: src/server/workshop.ts
```ts
"use server";

import { cookies } from "next/headers";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { workers, timeEntries, tasks, projects, type Worker } from "@/db/schema";
import { verifyPin, signPayload, verifySigned } from "@/lib/security";

const WORKER_COOKIE = "hp_worker";
const SESSION_MS = 14 * 3_600_000;

export type KioskWorker = Pick<Worker, "id" | "name" | "title" | "avatarUrl">;

export async function getKioskWorkers(): Promise<KioskWorker[]> {
  return db
    .select({ id: workers.id, name: workers.name, title: workers.title, avatarUrl: workers.avatarUrl })
    .from(workers)
    .where(eq(workers.active, true))
    .orderBy(asc(workers.name));
}

export async function verifyWorkerPin(workerId: string, pin: string) {
  const [w] = await db.select().from(workers).where(eq(workers.id, workerId)).limit(1);
  if (!w || !w.active) return { ok: false as const, error: "This account is inactive." };
  if (!/^\d{4}$/.test(pin) || !verifyPin(pin, w.pinHash)) {
    return { ok: false as const, error: "Incorrect PIN" };
  }
  const payload = `${w.id}:${Date.now() + SESSION_MS}`;
  const jar = await cookies();
  jar.set(WORKER_COOKIE, signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return { ok: true as const };
}

async function workerFromCookie(): Promise<Worker | null> {
  const jar = await cookies();
  const payload = verifySigned(jar.get(WORKER_COOKIE)?.value);
  if (!payload) return null;
  const [id, exp] = payload.split(":");
  if (!id || Number(exp) < Date.now()) return null;
  const [w] = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
  return w?.active ? w : null;
}

export async function signOutWorker() {
  const jar = await cookies();
  jar.delete(WORKER_COOKIE);
  return { ok: true as const };
}

export async function getWorkerState() {
  const w = await workerFromCookie();
  if (!w) return null;
  const [openEntry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut)))
    .limit(1);
  const allTasks = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(ne(tasks.status, "done"))
    .orderBy(asc(tasks.position));
  const shape = (r: (typeof allTasks)[number]) => ({
    id: r.task.id,
    title: r.task.title,
    status: r.task.status,
    priority: r.task.priority,
    estimatedMinutes: r.task.estimatedMinutes,
    dueDate: r.task.dueDate ? r.task.dueDate.toISOString() : null,
    waitingParts: r.task.waitingParts,
    piano: r.project ? `${r.project.pianoBrand} ${r.project.pianoModel}` : "Shop",
    client: r.project?.clientName ?? null,
  });
  return {
    worker: { id: w.id, name: w.name, title: w.title, avatarUrl: w.avatarUrl },
    clock: openEntry
      ? { entryId: openEntry.id, clockIn: openEntry.clockIn.toISOString(), rateCents: openEntry.rateAtClockInCents, taskId: openEntry.taskId }
      : null,
    myActive: allTasks.filter((r) => r.task.claimedByWorkerId === w.id && ["claimed", "in_progress"].includes(r.task.status)).map(shape),
    myAssigned: allTasks.filter((r) => r.task.assignedWorkerId === w.id && r.task.claimedByWorkerId !== w.id).map(shape),
    available: allTasks.filter((r) => r.task.status === "available").map(shape),
  };
}
export type WorkerState = NonNullable<Awaited<ReturnType<typeof getWorkerState>>>;
export type KioskTask = WorkerState["available"][number];

export async function clockIn() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (open) return { ok: true as const };
  await db.insert(timeEntries).values({ workerId: w.id, clockIn: new Date(), rateAtClockInCents: w.hourlyRateCents });
  return { ok: true as const };
}

export async function clockOut() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  await db
    .update(timeEntries)
    .set({ clockOut: new Date() })
    .where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut)));
  return { ok: true as const };
}

export async function claimTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  await db
    .update(tasks)
    .set({ status: "claimed", claimedByWorkerId: w.id, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "available")));
  return { ok: true as const };
}

export async function startTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  // anything else in progress by me falls back to claimed
  await db
    .update(tasks)
    .set({ status: "claimed", updatedAt: new Date() })
    .where(and(eq(tasks.claimedByWorkerId, w.id), eq(tasks.status, "in_progress")));
  await db
    .update(tasks)
    .set({ status: "in_progress", claimedByWorkerId: w.id, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), ne(tasks.status, "done")));
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (open) {
    await db.update(timeEntries).set({ taskId }).where(eq(timeEntries.id, open.id));
  }
  return { ok: true as const };
}

export async function finishTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  await db
    .update(tasks)
    .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.claimedByWorkerId, w.id)));
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (open?.taskId === taskId) {
    await db.update(timeEntries).set({ taskId: null }).where(eq(timeEntries.id, open.id));
  }
  return { ok: true as const };
}

export async function releaseTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  await db
    .update(tasks)
    .set({ status: "available", claimedByWorkerId: null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.claimedByWorkerId, w.id)));
  return { ok: true as const };
}
```

### FILE: src/server/auth-actions.ts
```ts
"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/security";
import { createSession, endSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Incorrect email or password." };
  }
  await createSession(user.id);
  return { ok: true };
}

export async function logout() {
  await endSession();
  redirect("/login");
}
```

### FILE: src/components/ui.tsx (for visual style reference — do not need to modify)
```tsx
"use client";

import { X, Loader2, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function Modal({
  open, onClose, title, children, dark = true, wide = false,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; dark?: boolean; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm anim-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto thin-scroll anim-sheet p-6 sm:p-7 sm:rounded-2xl rounded-t-2xl ${
          dark ? "bg-panel text-chrome border border-white/10 shadow-2xl" : "bg-white text-ink border border-slate-200 shadow-2xl"
        }`}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className={`font-serif text-xl ${dark ? "text-white" : "text-ink"}`}>{title}</h3>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition ${dark ? "hover:bg-white/10 text-mist" : "hover:bg-slate-100 text-smoke"}`}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title, body, action, dark = true,
}: {
  title: string; body?: string; action?: ReactNode; dark?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-dashed ${
        dark ? "border-white/10 text-mist" : "border-slate-200 text-smoke"
      }`}
    >
      <Inbox size={26} className="mb-3 opacity-50" strokeWidth={1.5} />
      <p className={`text-sm font-medium ${dark ? "text-chrome" : "text-ink"}`}>{title}</p>
      {body && <p className="text-xs mt-1 max-w-xs opacity-70">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin ${className}`} />;
}
```
