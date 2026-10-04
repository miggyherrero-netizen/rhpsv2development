# Implementation Plan: Herrero Growth OS — Step A (Base)

**Spec:** docs/specs/001-growth-os/spec.md (Approved v1.0, 4 Oct 2026)
**Data model:** docs/specs/001-growth-os/data-model-A.md
**Decisions:** PRE-BUILD-READINESS.md §3 (ADR-001 own area `/os` + `gos_*`, ADR-002 Drizzle on Supabase Postgres, ADR-003 existing login, ADR-005 nightly backup in Step D)
**Created:** 2026-10-04
**Scope:** Step A of 5 (A Base · B Customers · C Money flow · D Today · E Growth). Each step gets its own plan so each produces working, testable software (sdd-plan scope check). Plans B–E are written just before each step, from the same approved spec.

## Global Constraints

- Growth OS only ADDS: new files under `src/app/os/`, `src/components/gos/`, `src/lib/gos/`, `src/server/gos/`, `src/db/gos-schema.ts`, `scripts/`. Existing files may change ONLY where listed in this plan: `src/server/auth-actions.ts` (lockout, AC-1.5), `drizzle.config.ts` (add schema file), `package.json` (deps + scripts).
- Every Growth OS table name starts with `gos_`.
- Money is stored as integer centavos.
- Dates/"today" use Asia/Manila.
- Gold `#C9A24A` only on black `#161616`; "+ Add inquiry" = black pill with gold text (added in Step B).
- Status/warnings never by color alone; touch targets ≥ 44px; works at 320px width.
- No secrets, passwords or tokens in code, docs or chat.
- Never commit to `main`; branch `001-growth-os`.
- Versions pinned (no `^`) for new packages: `zod@4.6.5`, `vitest@5.0.3`.

---

## Goal

Robert signs in with the existing login (now protected by a 15-minute lockout), opens `/os` on phone and desktop, moves between the 5 screens, and sets his prices, travel costs, reminder timings, reply texts, ad names and lost reasons in Settings — all saved in the database, validated on the server, and invisible to anyone who is not the owner.

---

## Phase 0: Branch, lock file, test runner, contracts

**Implements:** FR-7 (setup) | **Satisfies:** — (enables all ACs)
**Files:** `package.json`, `package-lock.json`, `vitest.config.mts`, `src/lib/gos/contracts.test.ts`
**Interfaces:** Consumes: nothing. Produces: `npm test` (Vitest), `npm run db:generate`, `npm run db:migrate`, `npm run gos:create-owner`; failing contract tests that Phases 1–4 must turn green.

Prerequisite (Robert, one time): GitHub access to `miggyherrero-netizen/rhpsv2development` connected to Claude so the assistant can clone, push branch `001-growth-os` and open a pull request. Without it, the assistant prepares files in the GROWTH OS folder and Robert commits them.

- [ ] Create branch: `git checkout -b 001-growth-os`
- [ ] Install pinned packages and create the lock file:
  `npm install --save-exact zod@4.6.5 && npm install --save-dev --save-exact vitest@5.0.3`
  Expect: `package-lock.json` created; `package.json` lists `"zod": "4.6.5"` and `"vitest": "5.0.3"`.
- [ ] Add scripts to `package.json` → `"scripts"` (keep existing ones):
  ```json
  "test": "vitest run",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "gos:create-owner": "tsx scripts/gos-create-owner.ts"
  ```
- [ ] Create `vitest.config.mts` (`.mts` because the repo is CommonJS; avoids a Vite config warning — verified in dry run):
  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    test: { environment: "node", include: ["src/**/*.test.ts"] },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  });
  ```
- [ ] Write contract tests `src/lib/gos/contracts.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { gosEnvProblems, DEV_AUTH_SECRET } from "@/lib/gos/env";
  import { afterFailure, afterSuccess, isLocked, LOCK_MESSAGE, EMPTY_ATTEMPTS } from "@/lib/gos/lockout";
  import { isOwner } from "@/lib/gos/owner";
  import { gosSettingsSchema, defaultGosSettings, unknownPlaceholders, fuelPerKmCentavos, pesosToCentavos } from "@/lib/gos/settings";

  describe("contracts", () => {
    it("env checker exists and is silent outside production", () => {
      expect(gosEnvProblems({ NODE_ENV: "development" })).toEqual([]);
      expect(typeof DEV_AUTH_SECRET).toBe("string");
    });
    it("lockout functions exist", () => {
      expect(isLocked(EMPTY_ATTEMPTS, new Date())).toBe(false);
      expect(afterSuccess()).toEqual(EMPTY_ATTEMPTS);
      expect(typeof afterFailure).toBe("function");
      expect(LOCK_MESSAGE).toBe("Too many tries. Try again in 15 minutes.");
    });
    it("owner check exists", () => {
      expect(isOwner({ role: "owner" })).toBe(true);
    });
    it("default settings pass their own schema", () => {
      expect(gosSettingsSchema.parse(defaultGosSettings())).toEqual(defaultGosSettings());
      expect(typeof unknownPlaceholders).toBe("function");
      expect(typeof fuelPerKmCentavos).toBe("function");
      expect(typeof pesosToCentavos).toBe("function");
    });
  });
  ```
- [ ] Run: `npm test` — expect: FAIL (modules `@/lib/gos/*` not found)
- [ ] Commit: `test(gos): add Step A contract tests + vitest + lock file`

---

## Phase 1: Growth OS start-up safety check

**Implements:** NFR Security (start-up check) | **Satisfies:** NFR "refuses to start in production if AUTH_SECRET missing/dev value or database address missing"
**Files:** `src/lib/gos/env.ts`, `src/lib/gos/env.test.ts`
**Interfaces:** Consumes: nothing. Produces: `DEV_AUTH_SECRET: string`, `gosEnvProblems(env: Record<string, string | undefined>): string[]`, `assertGosEnv(env?: Record<string, string | undefined>): void`.

- [ ] Write unit test `src/lib/gos/env.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { assertGosEnv, DEV_AUTH_SECRET, gosEnvProblems } from "@/lib/gos/env";

  describe("gosEnvProblems", () => {
    it("allows anything outside production", () => {
      expect(gosEnvProblems({ NODE_ENV: "development" })).toEqual([]);
    });
    it("flags missing AUTH_SECRET in production", () => {
      expect(gosEnvProblems({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }))
        .toEqual(["AUTH_SECRET is missing or uses the dev value"]);
    });
    it("flags the dev fallback AUTH_SECRET in production", () => {
      expect(gosEnvProblems({ NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_SECRET: DEV_AUTH_SECRET }))
        .toEqual(["AUTH_SECRET is missing or uses the dev value"]);
    });
    it("flags missing DATABASE_URL in production", () => {
      expect(gosEnvProblems({ NODE_ENV: "production", AUTH_SECRET: "a-long-real-secret" }))
        .toEqual(["DATABASE_URL is missing"]);
    });
    it("passes a correct production setup", () => {
      expect(gosEnvProblems({ NODE_ENV: "production", AUTH_SECRET: "a-long-real-secret", DATABASE_URL: "postgres://x" })).toEqual([]);
    });
    it("assertGosEnv throws with all problems", () => {
      expect(() => assertGosEnv({ NODE_ENV: "production" }))
        .toThrow("Growth OS cannot start: AUTH_SECRET is missing or uses the dev value; DATABASE_URL is missing");
    });
  });
  ```
- [ ] Run: `npx vitest run src/lib/gos/env.test.ts` — expect: FAIL (module not found)
- [ ] Implement `src/lib/gos/env.ts`:
  ```ts
  /** Same string as the fallback in src/lib/security.ts (left unchanged there on purpose). */
  export const DEV_AUTH_SECRET = "herrero-atelier-dev-secret-do-not-use-in-prod";

  export function gosEnvProblems(env: Record<string, string | undefined>): string[] {
    if (env.NODE_ENV !== "production") return [];
    const problems: string[] = [];
    if (!env.AUTH_SECRET || env.AUTH_SECRET === DEV_AUTH_SECRET) {
      problems.push("AUTH_SECRET is missing or uses the dev value");
    }
    if (!env.DATABASE_URL) problems.push("DATABASE_URL is missing");
    return problems;
  }

  export function assertGosEnv(env: Record<string, string | undefined> = process.env): void {
    const problems = gosEnvProblems(env);
    if (problems.length > 0) {
      throw new Error(`Growth OS cannot start: ${problems.join("; ")}`);
    }
  }
  ```
- [ ] Run: `npx vitest run src/lib/gos/env.test.ts` — expect: PASS (6 tests)
- [ ] Commit: `feat(gos): start-up safety check for AUTH_SECRET and DATABASE_URL`

---

## Phase 2: Login lockout (the one approved change to the old login)

**Implements:** FR-7 exception | **Satisfies:** AC-1.5, AC-1.4
**Files:** `src/lib/gos/lockout.ts`, `src/lib/gos/lockout.test.ts`, `src/db/gos-schema.ts` (table `gos_login_attempts`), `src/server/gos/login-attempts.ts`, `src/server/auth-actions.ts` (modify `login` only)
**Interfaces:** Consumes: `db` from `@/db`. Produces: `AttemptState`, `EMPTY_ATTEMPTS`, `isLocked(state, now)`, `afterFailure(state, now)`, `afterSuccess()`, `LOCK_MESSAGE`, `LOCK_MAX_FAILS = 5`, `LOCK_MINUTES = 15`; table `gosLoginAttempts`.

- [ ] Write unit test `src/lib/gos/lockout.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { afterFailure, afterSuccess, EMPTY_ATTEMPTS, isLocked, type AttemptState } from "@/lib/gos/lockout";

  const t0 = new Date("2026-10-05T01:00:00Z");
  const min = (n: number) => new Date(t0.getTime() + n * 60_000);

  function failTimes(times: Date[]): AttemptState {
    return times.reduce((s, t) => afterFailure(s, t), EMPTY_ATTEMPTS);
  }

  describe("lockout", () => {
    it("4 wrong tries do not lock", () => {
      const s = failTimes([min(0), min(1), min(2), min(3)]);
      expect(isLocked(s, min(4))).toBe(false);
      expect(s.failedCount).toBe(4);
    });
    it("5 wrong tries within 15 min lock for 15 min after the 5th", () => {
      const s = failTimes([min(0), min(1), min(2), min(3), min(4)]);
      expect(isLocked(s, min(5))).toBe(true);
      expect(isLocked(s, min(18))).toBe(true);
      expect(isLocked(s, min(19))).toBe(false);
    });
    it("wrong tries spread over more than 15 min start a new window", () => {
      const s = failTimes([min(0), min(1), min(2), min(3), min(16)]);
      expect(s.failedCount).toBe(1);
      expect(isLocked(s, min(17))).toBe(false);
    });
    it("a wrong try while locked does not extend the lock", () => {
      const locked = failTimes([min(0), min(1), min(2), min(3), min(4)]);
      const again = afterFailure(locked, min(10));
      expect(again.lockedUntil).toEqual(locked.lockedUntil);
    });
    it("success resets everything", () => {
      expect(afterSuccess()).toEqual(EMPTY_ATTEMPTS);
    });
  });
  ```
- [ ] Run: `npx vitest run src/lib/gos/lockout.test.ts` — expect: FAIL
- [ ] Implement `src/lib/gos/lockout.ts`:
  ```ts
  export const LOCK_MAX_FAILS = 5;
  export const LOCK_MINUTES = 15;
  export const LOCK_MESSAGE = "Too many tries. Try again in 15 minutes.";

  export type AttemptState = {
    failedCount: number;
    firstFailedAt: Date | null;
    lockedUntil: Date | null;
  };

  export const EMPTY_ATTEMPTS: AttemptState = { failedCount: 0, firstFailedAt: null, lockedUntil: null };

  const windowMs = LOCK_MINUTES * 60_000;

  export function isLocked(state: AttemptState, now: Date): boolean {
    return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
  }

  export function afterFailure(state: AttemptState, now: Date): AttemptState {
    if (isLocked(state, now)) return state;
    const inWindow =
      state.firstFailedAt !== null && now.getTime() - state.firstFailedAt.getTime() <= windowMs;
    const failedCount = inWindow ? state.failedCount + 1 : 1;
    const firstFailedAt = inWindow ? state.firstFailedAt : now;
    const lockedUntil = failedCount >= LOCK_MAX_FAILS ? new Date(now.getTime() + windowMs) : null;
    return { failedCount, firstFailedAt, lockedUntil };
  }

  export function afterSuccess(): AttemptState {
    return { ...EMPTY_ATTEMPTS };
  }
  ```
- [ ] Run: `npx vitest run src/lib/gos/lockout.test.ts` — expect: PASS (5 tests)
- [ ] Create `src/db/gos-schema.ts` (Phase 4 adds two more tables to this file):
  ```ts
  import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

  export const gosLoginAttempts = pgTable("gos_login_attempts", {
    email: text("email").primaryKey(),
    failedCount: integer("failed_count").notNull().default(0),
    firstFailedAt: timestamp("first_failed_at", { mode: "date", withTimezone: true }),
    lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),
  });
  ```
- [ ] Update `drizzle.config.ts` (only the `schema` line changes):
  ```ts
  import { defineConfig } from "drizzle-kit";

  export default defineConfig({
    dialect: "postgresql",
    schema: ["./src/db/schema.ts", "./src/db/gos-schema.ts"],
    dbCredentials: {
      url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    },
  });
  ```
- [ ] Create `src/server/gos/login-attempts.ts`:
  ```ts
  import { eq } from "drizzle-orm";
  import { db } from "@/db";
  import { gosLoginAttempts } from "@/db/gos-schema";
  import { EMPTY_ATTEMPTS, type AttemptState } from "@/lib/gos/lockout";

  export async function getAttemptState(email: string): Promise<AttemptState> {
    const [row] = await db.select().from(gosLoginAttempts).where(eq(gosLoginAttempts.email, email)).limit(1);
    if (!row) return { ...EMPTY_ATTEMPTS };
    return { failedCount: row.failedCount, firstFailedAt: row.firstFailedAt, lockedUntil: row.lockedUntil };
  }

  export async function saveAttemptState(email: string, state: AttemptState): Promise<void> {
    await db
      .insert(gosLoginAttempts)
      .values({ email, ...state })
      .onConflictDoUpdate({ target: gosLoginAttempts.email, set: { ...state } });
  }

  export async function clearAttemptState(email: string): Promise<void> {
    await db.delete(gosLoginAttempts).where(eq(gosLoginAttempts.email, email));
  }
  ```
- [ ] Modify ONLY the `login` function in `src/server/auth-actions.ts` (add 2 imports at the top; everything else in the file stays the same):
  ```ts
  import { afterFailure, isLocked, LOCK_MESSAGE } from "@/lib/gos/lockout";
  import { clearAttemptState, getAttemptState, saveAttemptState } from "@/server/gos/login-attempts";

  export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
    const key = email.trim().toLowerCase();
    const now = new Date();
    const attempts = await getAttemptState(key);
    if (isLocked(attempts, now)) {
      return { ok: false, error: LOCK_MESSAGE };
    }
    const [user] = await db.select().from(users).where(eq(users.email, key)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const next = afterFailure(attempts, now);
      await saveAttemptState(key, next);
      return { ok: false, error: isLocked(next, now) ? LOCK_MESSAGE : "Incorrect email or password." };
    }
    await clearAttemptState(key);
    await createSession(user.id);
    return { ok: true };
  }
  ```
- [ ] Run: `npm test && npm run typecheck` — expect: lockout + env tests PASS, typecheck 0 errors
- [ ] Commit: `feat(gos): lock login 15 min after 5 wrong tries (approved AC-1.5)`

---

## Phase 3: Owner-only access

**Implements:** FR-7, NFR Security | **Satisfies:** AC-1.1, AC-1.2, AC-1.3
**Files:** `src/lib/gos/owner.ts`, `src/lib/gos/owner.test.ts`, `src/server/gos/guard.ts`
**Interfaces:** Consumes: `getUser()` from `@/lib/auth`, `assertGosEnv()` (Phase 1). Produces: `isOwner(user)`, `requireOwnerPage(): Promise<User | "forbidden">`, `requireOwnerAction(): Promise<{ ok: true; user: User } | { ok: false; error: string }>`.

- [ ] Write unit test `src/lib/gos/owner.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { isOwner } from "@/lib/gos/owner";

  describe("isOwner", () => {
    it("accepts the owner role", () => expect(isOwner({ role: "owner" })).toBe(true));
    it("rejects other roles", () => expect(isOwner({ role: "staff" })).toBe(false));
    it("rejects no user", () => expect(isOwner(null)).toBe(false));
  });
  ```
- [ ] Run: `npx vitest run src/lib/gos/owner.test.ts` — expect: FAIL
- [ ] Implement `src/lib/gos/owner.ts`:
  ```ts
  export function isOwner(user: { role: string } | null): boolean {
    return user !== null && user.role === "owner";
  }
  ```
- [ ] Implement `src/server/gos/guard.ts`:
  ```ts
  import { redirect } from "next/navigation";
  import { getUser } from "@/lib/auth";
  import type { User } from "@/db/schema";
  import { assertGosEnv } from "@/lib/gos/env";
  import { isOwner } from "@/lib/gos/owner";

  /** Pages: signed out → login; signed in but not owner → "forbidden". */
  export async function requireOwnerPage(): Promise<User | "forbidden"> {
    assertGosEnv();
    const user = await getUser();
    if (!user) redirect("/login");
    return isOwner(user) ? user : "forbidden";
  }

  /** Server actions: never return data unless the caller is the owner. */
  export async function requireOwnerAction(): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
    assertGosEnv();
    const user = await getUser();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (!isOwner(user)) return { ok: false, error: "No access (403)." };
    return { ok: true, user };
  }
  ```
- [ ] Run: `npx vitest run src/lib/gos/owner.test.ts && npm run typecheck` — expect: PASS, 0 errors
- [ ] Commit: `feat(gos): owner-only guard for pages and actions`

---

## Phase 4: Settings data (schema, defaults, validation, save)

**Implements:** FR-3, FR-4, Story 12 | **Satisfies:** AC-12.2, AC-12.3, AC-12.4, AC-12.5, AC-12.6
**Files:** `src/lib/gos/settings.ts`, `src/lib/gos/settings.test.ts`, `src/db/gos-schema.ts` (add `gos_settings`, `gos_ads`), `src/server/gos/settings.ts`
**Interfaces:** Consumes: `requireOwnerAction()` (Phase 3). Produces: `GosSettings` type, `gosSettingsSchema`, `defaultGosSettings()`, `pesosToCentavos(text)`, `centavosToPesos(n)`, `fuelPerKmCentavos(s)`, `unknownPlaceholders(text)`, `ALLOWED_PLACEHOLDERS`, `TEMPLATE_KEYS`; server functions `loadGosSettings()`, `saveGosSettings(next)`, `listAds()`, `addAd(name)`, `setAdRetired(id, retired)`.

- [ ] Write unit test `src/lib/gos/settings.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import {
    defaultGosSettings, fuelPerKmCentavos, gosSettingsSchema, pesosToCentavos, unknownPlaceholders,
  } from "@/lib/gos/settings";

  describe("settings defaults (Business Facts)", () => {
    const s = defaultGosSettings();
    it("tuning starts at ₱3,000", () => expect(s.prices.tuningCentavos).toBe(300000));
    it("cleaning, repair, vehicle cost and home base start blank", () => {
      expect(s.prices.cleaningCentavos).toBeNull();
      expect(s.prices.repairLaborCentavos).toBeNull();
      expect(s.travel.vehicleCostPerKmCentavos).toBeNull();
      expect(s.travel.homeBase).toBeNull();
    });
    it("diesel ₱110/L at 10 km/L = ₱11/km fuel", () => expect(fuelPerKmCentavos(s)).toBe(1100));
    it("reminder defaults", () => {
      expect(s.reminders).toMatchObject({
        noReplyMinutes: 60, quoteFollowUpDays: 1, noQuoteDays: 1, visitSameDayTime: "07:00",
        dayBeforeTime: "18:00", unpaidDays: 3, unpaidRepeatDays: 7, tuningLeadDays: 14,
      });
    });
  });

  describe("validation (AC-12.3)", () => {
    it("refuses 0 or negative prices", () => {
      const bad = { ...defaultGosSettings(), prices: { ...defaultGosSettings().prices, tuningCentavos: 0 } };
      expect(gosSettingsSchema.safeParse(bad).success).toBe(false);
    });
    it("allows blank cleaning price", () => {
      expect(gosSettingsSchema.safeParse(defaultGosSettings()).success).toBe(true);
    });
    it("refuses template over 1,000 characters", () => {
      const s = defaultGosSettings();
      const bad = { ...s, templates: { ...s.templates, newInquiry: "x".repeat(1001) } };
      expect(gosSettingsSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe("pesosToCentavos", () => {
    it("parses 3,000 → 300000", () => expect(pesosToCentavos("3,000")).toBe(300000));
    it("parses 110.50 → 11050", () => expect(pesosToCentavos("110.50")).toBe(11050));
    it("returns null for blank", () => expect(pesosToCentavos("  ")).toBeNull());
    it("returns NaN for text", () => expect(pesosToCentavos("abc")).toBeNaN());
  });

  describe("unknownPlaceholders (AC-12.5)", () => {
    it("accepts all allowed placeholders", () => {
      expect(unknownPlaceholders("{name} {area} {total} {date} {time} {balance} {piano} {minutes}")).toEqual([]);
    });
    it("names unknown ones", () => expect(unknownPlaceholders("Hi {nmae}, {total}")).toEqual(["{nmae}"]));
  });
  ```
- [ ] Run: `npx vitest run src/lib/gos/settings.test.ts` — expect: FAIL
- [ ] Implement `src/lib/gos/settings.ts`:
  ```ts
  import { z } from "zod";

  const positiveCentavos = z.number().int().positive();
  const optionalCentavos = positiveCentavos.nullable();
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const template = z.string().min(1).max(1000);

  export const TEMPLATE_KEYS = [
    "newInquiry", "general", "noQuoteFollowUp", "quoteFollowUp", "confirmation",
    "onMyWay", "thankYou", "paymentReminder", "tuningInvite",
  ] as const;

  export const ALLOWED_PLACEHOLDERS = [
    "{name}", "{area}", "{total}", "{date}", "{time}", "{balance}", "{piano}", "{minutes}",
  ] as const;

  export const gosSettingsSchema = z.object({
    prices: z.object({
      tuningCentavos: positiveCentavos,
      cleaningCentavos: optionalCentavos,
      repairLaborCentavos: optionalCentavos,
    }),
    travel: z.object({
      dieselPerLiterCentavos: positiveCentavos,
      kmPerLiter: z.number().positive(),
      vehicleCostPerKmCentavos: optionalCentavos,
      roundTripDefault: z.boolean(),
      homeBase: z.string().trim().min(1).max(60).nullable(),
      roundUpTo10: z.boolean(),
      mealsDefaultCentavos: positiveCentavos,
    }),
    reminders: z.object({
      noReplyMinutes: z.number().int().positive(),
      quoteFollowUpDays: z.number().int().positive(),
      noQuoteDays: z.number().int().positive(),
      visitSameDayTime: hhmm,
      dayBeforeTime: hhmm,
      unpaidDays: z.number().int().positive(),
      unpaidRepeatDays: z.number().int().positive(),
      tuningLeadDays: z.number().int().positive(),
    }),
    replyLanguage: z.enum(["mix", "cebuano", "english"]),
    templates: z.object(Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, template])) as Record<(typeof TEMPLATE_KEYS)[number], typeof template>),
    lostReasons: z.array(z.string().trim().min(1).max(60)).min(1),
    business: z.object({
      name: z.string().trim().min(1).max(80),
      quoteFooter: z.string().max(300),
    }),
    allowance: z.object({
      amountCentavos: positiveCentavos,
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dailyRateCentavos: positiveCentavos,
    }),
  });

  export type GosSettings = z.infer<typeof gosSettingsSchema>;

  export function defaultGosSettings(): GosSettings {
    return {
      prices: { tuningCentavos: 300000, cleaningCentavos: null, repairLaborCentavos: null },
      travel: {
        dieselPerLiterCentavos: 11000, kmPerLiter: 10, vehicleCostPerKmCentavos: null,
        roundTripDefault: true, homeBase: null, roundUpTo10: true, mealsDefaultCentavos: 15000,
      },
      reminders: {
        noReplyMinutes: 60, quoteFollowUpDays: 1, noQuoteDays: 1, visitSameDayTime: "07:00",
        dayBeforeTime: "18:00", unpaidDays: 3, unpaidRepeatDays: 7, tuningLeadDays: 14,
      },
      replyLanguage: "mix",
      templates: {
        newInquiry: "Hi {name}! Salamat sa message. Tuning starts at ₱3,000 depending on location — I'll confirm the final price. Asa dapit imong piano sa {area}?",
        general: "Hi {name}! Salamat sa message. I'll get back to you shortly. — Robert",
        noQuoteFollowUp: "Hi {name}! Following up lang — gusto pa ba nimo ipa-tune imong piano? I can send a quote today.",
        quoteFollowUp: "Hi {name}! Following up on your quote ({total}). Kung OK na, I can set your schedule.",
        confirmation: "Hi {name}! Confirmed: {date}, {time}. Total {total}. See you! — Robert",
        onMyWay: "Hi {name}, on the way na ko, mga {minutes} mins 🙂",
        thankYou: "Salamat kaayo {name}! Your piano is done. Next tuning around {date}.",
        paymentReminder: "Hi {name}! Friendly reminder lang sa balance nga {balance}. Any method OK (cash, GCash, Maya, bank). Salamat!",
        tuningInvite: "Hi {name}! Mga panahon na para sa next tuning sa imong {piano}. Gusto ka ma-schedule?",
      },
      lostReasons: ["Too expensive", "No reply from customer", "Went with someone else", "Just asking", "Other"],
      business: {
        name: "R. Herrero Piano Sales & Services",
        quoteFooter: "Valid 7 days. Any payment method OK (cash, GCash, Maya, bank).",
      },
      allowance: { amountCentavos: 500000, startDate: "2026-10-05", dailyRateCentavos: 50000 },
    };
  }

  /** "3,000" → 300000 · "110.50" → 11050 · "" → null · "abc" → NaN */
  export function pesosToCentavos(text: string): number | null {
    const clean = text.replace(/[₱,\s]/g, "");
    if (clean === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
    const [whole, frac = ""] = clean.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }

  export function centavosToPesos(centavos: number | null): string {
    if (centavos === null) return "";
    const whole = Math.floor(centavos / 100).toLocaleString("en-PH");
    const frac = centavos % 100;
    return frac === 0 ? whole : `${whole}.${String(frac).padStart(2, "0")}`;
  }

  /** Fuel cost per km in centavos, e.g. ₱110/L ÷ 10 km/L = 1100. */
  export function fuelPerKmCentavos(s: GosSettings): number {
    return Math.round(s.travel.dieselPerLiterCentavos / s.travel.kmPerLiter);
  }

  export function unknownPlaceholders(text: string): string[] {
    const found = text.match(/\{[^{}]*\}/g) ?? [];
    const allowed: readonly string[] = ALLOWED_PLACEHOLDERS;
    return [...new Set(found.filter((p) => !allowed.includes(p)))];
  }
  ```
- [ ] Run: `npx vitest run src/lib/gos/settings.test.ts` — expect: PASS (13 tests)
- [ ] Add tables to `src/db/gos-schema.ts` (full file now):
  ```ts
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
  ```
- [ ] Implement `src/server/gos/settings.ts`:
  ```ts
  "use server";

  import { and, asc, eq, ne } from "drizzle-orm";
  import { db } from "@/db";
  import { gosAds, gosSettings, type GosAd } from "@/db/gos-schema";
  import { defaultGosSettings, gosSettingsSchema, type GosSettings } from "@/lib/gos/settings";
  import { requireOwnerAction } from "@/server/gos/guard";

  type Result<T> = { ok: true; value: T } | { ok: false; error: string };

  const DEFAULT_ADS = ["Photo 01", "Creative 02 Grand", "Creative 03 Upright"];

  export async function loadGosSettings(): Promise<Result<GosSettings>> {
    const auth = await requireOwnerAction();
    if (!auth.ok) return auth;
    const [row] = await db.select().from(gosSettings).where(eq(gosSettings.id, 1)).limit(1);
    if (!row) {
      const fresh = defaultGosSettings();
      await db.insert(gosSettings).values({ id: 1, data: fresh }).onConflictDoNothing();
      return { ok: true, value: fresh };
    }
    const parsed = gosSettingsSchema.safeParse(row.data);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Settings are damaged. Restore from backup." };
  }

  export async function saveGosSettings(next: GosSettings): Promise<Result<GosSettings>> {
    const auth = await requireOwnerAction();
    if (!auth.ok) return auth;
    const parsed = gosSettingsSchema.safeParse(next);
    if (!parsed.success) return { ok: false, error: "Not saved — check the highlighted value." };
    await db
      .insert(gosSettings)
      .values({ id: 1, data: parsed.data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: gosSettings.id, set: { data: parsed.data, updatedAt: new Date() } });
    return { ok: true, value: parsed.data };
  }

  export async function listAds(): Promise<Result<GosAd[]>> {
    const auth = await requireOwnerAction();
    if (!auth.ok) return auth;
    let rows = await db.select().from(gosAds).orderBy(asc(gosAds.sortOrder), asc(gosAds.createdAt));
    if (rows.length === 0) {
      await db.insert(gosAds).values(DEFAULT_ADS.map((name, i) => ({ name, sortOrder: i }))).onConflictDoNothing();
      rows = await db.select().from(gosAds).orderBy(asc(gosAds.sortOrder), asc(gosAds.createdAt));
    }
    return { ok: true, value: rows };
  }

  export async function addAd(name: string): Promise<Result<GosAd>> {
    const auth = await requireOwnerAction();
    if (!auth.ok) return auth;
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60) return { ok: false, error: "Ad name must be 1–60 characters." };
    const [row] = await db.insert(gosAds).values({ name: clean, sortOrder: 99 }).onConflictDoNothing().returning();
    return row ? { ok: true, value: row } : { ok: false, error: "That ad name already exists." };
  }

  export async function setAdRetired(id: string, retired: boolean): Promise<Result<null>> {
    const auth = await requireOwnerAction();
    if (!auth.ok) return auth;
    if (retired) {
      const active = await db.select({ id: gosAds.id }).from(gosAds).where(and(eq(gosAds.retired, false), ne(gosAds.id, id)));
      if (active.length === 0) return { ok: false, error: "Keep at least one active ad name." };
    }
    await db.update(gosAds).set({ retired }).where(eq(gosAds.id, id));
    return { ok: true, value: null };
  }
  ```
- [ ] Run: `npm test && npm run typecheck` — expect: all PASS, 0 errors
- [ ] Commit: `feat(gos): settings + ad names stored and validated`

> **Complexity note:** Gate: Simplicity (new dependency `zod`). Justification: NFR Security requires every input checked on the server; the repo has no validator (known gap).

---

## Phase 5: The `/os` shell, 5 screens, Black & Gold, Settings screen

**Implements:** FR-7, NFR Accessibility, Story 12 UI | **Satisfies:** AC-1.1, AC-1.2, AC-1.3, AC-9.4, AC-12.1, AC-12.2, AC-12.4, AC-12.5, AC-12.6, G6
**Files:** `src/app/os/gos.css`, `src/app/os/layout.tsx`, `src/app/os/page.tsx`, `src/app/os/{today,customers,work,growth,settings}/page.tsx`, `src/components/gos/shell.tsx`, `src/components/gos/empty.tsx`, `src/components/gos/settings-client.tsx`
**Interfaces:** Consumes: `requireOwnerPage()`, `loadGosSettings()`, `saveGosSettings()`, `listAds()`, `addAd()`, `setAdRetired()`, `pesosToCentavos()`, `centavosToPesos()`, `fuelPerKmCentavos()`, `unknownPlaceholders()`. Produces: `GosShell`, `GosEmpty` components used by Steps B–E.

- [ ] Create `src/app/os/gos.css` (scoped to `.gos`, nothing global changes):
  ```css
  .gos {
    --gos-bg: #f7f7f6;
    --gos-surface: #ffffff;
    --gos-ink: #161616;
    --gos-ink-dim: #4a4a4a;
    --gos-line: #e3e3e0;
    --gos-black: #161616;
    --gos-gold: #c9a24a;        /* only on black */
    --gos-gold-text: #80601a;   /* gold text on light backgrounds */
    --gos-focus: #1d4ed8;
    --gos-danger: #b42318;
    --gos-ok: #1f7a3a;
    background: var(--gos-bg);
    color: var(--gos-ink);
    min-height: 100dvh;
    font-family: var(--font-gos-body), system-ui, sans-serif;
  }
  .gos h1, .gos h2 { font-family: var(--font-gos-head), system-ui, sans-serif; }
  .gos :focus-visible { outline: 3px solid var(--gos-focus); outline-offset: 2px; }
  .gos .gos-tap { min-height: 44px; min-width: 44px; }
  .gos .gos-card { background: var(--gos-surface); border: 1px solid var(--gos-line); border-radius: 14px; padding: 16px; }
  .gos .gos-input { width: 100%; min-height: 44px; border: 1px solid #9a9a96; border-radius: 10px; padding: 8px 12px; background: #fff; color: var(--gos-ink); }
  .gos .gos-btn-black { background: var(--gos-black); color: var(--gos-gold); border-radius: 999px; min-height: 44px; padding: 0 18px; font-weight: 600; }
  ```
- [ ] Create `src/app/os/layout.tsx`:
  ```tsx
  import type { ReactNode } from "react";
  import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
  import { requireOwnerPage } from "@/server/gos/guard";
  import GosShell from "@/components/gos/shell";
  import "./gos.css";

  export const dynamic = "force-dynamic";
  export const metadata = { title: "Growth OS" };

  const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-gos-body" });
  const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-gos-head" });

  export default async function GosLayout({ children }: { children: ReactNode }) {
    const user = await requireOwnerPage();
    if (user === "forbidden") {
      return (
        <main className={`gos ${body.variable} ${head.variable} flex items-center justify-center p-6`}>
          <div className="gos-card max-w-sm text-center">
            <h1 className="text-xl font-bold">No access (403)</h1>
            <p className="mt-2">This area is for the owner only.</p>
          </div>
        </main>
      );
    }
    return (
      <div className={`gos ${body.variable} ${head.variable}`}>
        <GosShell userName={user.name}>{children}</GosShell>
      </div>
    );
  }
  ```
- [ ] Create `src/app/os/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";

  export default function GosHome() {
    redirect("/os/today");
  }
  ```
- [ ] Create `src/components/gos/shell.tsx`:
  ```tsx
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";
  import type { ReactNode } from "react";
  import { CalendarCheck, Users, Briefcase, TrendingUp, Settings } from "lucide-react";

  const NAV = [
    { href: "/os/today", label: "Today", Icon: CalendarCheck },
    { href: "/os/customers", label: "Customers", Icon: Users },
    { href: "/os/work", label: "Work", Icon: Briefcase },
    { href: "/os/growth", label: "Growth", Icon: TrendingUp },
    { href: "/os/settings", label: "Settings", Icon: Settings },
  ] as const;

  export default function GosShell({ userName, children }: { userName: string; children: ReactNode }) {
    const path = usePathname();
    return (
      <div className="min-h-dvh lg:flex">
        <a href="#gos-main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:border-[var(--gos-line)] lg:p-4" aria-label="Main">
          <p className="mb-4 rounded-xl bg-[var(--gos-black)] px-3 py-2 font-bold text-[var(--gos-gold)]">Growth OS</p>
          {NAV.map(({ href, label, Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`gos-tap flex items-center gap-3 rounded-xl px-3 ${active ? "bg-[var(--gos-black)] text-white" : "hover:bg-white"}`}>
                <Icon size={20} aria-hidden="true" /> {label}
              </Link>
            );
          })}
          <p className="mt-auto text-sm text-[var(--gos-ink-dim)]">Signed in: {userName}</p>
        </aside>
        <main id="gos-main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-[var(--gos-line)] bg-white lg:hidden">
          {NAV.map(({ href, label, Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`gos-tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${active ? "font-bold text-[var(--gos-ink)]" : "text-[var(--gos-ink-dim)]"}`}>
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }
  ```
- [ ] Create `src/components/gos/empty.tsx`:
  ```tsx
  export default function GosEmpty({ title, text }: { title: string; text: string }) {
    return (
      <section className="gos-card mt-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-[var(--gos-ink-dim)]">{text}</p>
      </section>
    );
  }
  ```
- [ ] Create the 4 screen pages (Step A shows honest empty states; Steps B–E fill them):
  `src/app/os/today/page.tsx`
  ```tsx
  import GosEmpty from "@/components/gos/empty";

  export default function TodayPage() {
    return <GosEmpty title="Today" text="No customers yet. Tap + Add inquiry when someone messages you." />;
  }
  ```
  `src/app/os/customers/page.tsx`
  ```tsx
  import GosEmpty from "@/components/gos/empty";

  export default function CustomersPage() {
    return <GosEmpty title="Customers" text="No customers yet. Adding customers arrives in Step B." />;
  }
  ```
  `src/app/os/work/page.tsx`
  ```tsx
  import GosEmpty from "@/components/gos/empty";

  export default function WorkPage() {
    return <GosEmpty title="Work" text="No quotes yet. Quotes, schedule and money arrive in Step C." />;
  }
  ```
  `src/app/os/growth/page.tsx`
  ```tsx
  import GosEmpty from "@/components/gos/empty";

  export default function GrowthPage() {
    return <GosEmpty title="Growth" text="Ad spend: Not recorded. Growth numbers arrive in Step E." />;
  }
  ```
- [ ] Create `src/app/os/settings/page.tsx`:
  ```tsx
  import { listAds, loadGosSettings } from "@/server/gos/settings";
  import SettingsClient from "@/components/gos/settings-client";

  export default async function SettingsPage() {
    const [settings, ads] = await Promise.all([loadGosSettings(), listAds()]);
    if (!settings.ok) return <p role="alert" className="gos-card mt-4">{settings.error}</p>;
    if (!ads.ok) return <p role="alert" className="gos-card mt-4">{ads.error}</p>;
    return <SettingsClient initial={settings.value} initialAds={ads.value} />;
  }
  ```
- [ ] Create `src/components/gos/settings-client.tsx` (autosave on blur, "Saved ✓" / "Not saved — try again", AC-12.2):
  ```tsx
  "use client";

  import { useState } from "react";
  import type { GosAd } from "@/db/gos-schema";
  import {
    centavosToPesos, fuelPerKmCentavos, pesosToCentavos, TEMPLATE_KEYS, unknownPlaceholders, type GosSettings,
  } from "@/lib/gos/settings";
  import { addAd, saveGosSettings, setAdRetired } from "@/server/gos/settings";

  type Status = Record<string, "saved" | "error" | undefined>;

  /* Field components live at top level (not inside SettingsClient) so React keeps their state and focus between saves. */
  function Note({ value }: { value: "saved" | "error" | undefined }) {
    if (value === "saved") return <span role="status" className="text-sm text-[var(--gos-ok)]">Saved ✓</span>;
    if (value === "error") return <span role="alert" className="text-sm text-[var(--gos-danger)]">✕ Not saved — try again</span>;
    return null;
  }

  function MoneyField(props: {
    label: string; value: number | null; allowBlank: boolean; status: "saved" | "error" | undefined;
    onSave: (centavos: number | null) => void; onInvalid: () => void;
  }) {
    const [text, setText] = useState(centavosToPesos(props.value));
    return (
      <label className="block">
        <span className="font-bold">{props.label}</span>
        <input className="gos-input mt-1" inputMode="decimal" value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const c = pesosToCentavos(text);
            if (c === null) { if (props.allowBlank) props.onSave(null); else props.onInvalid(); return; }
            if (Number.isNaN(c) || c <= 0) { props.onInvalid(); return; }
            props.onSave(c);
          }} />
        <Note value={props.status} />
      </label>
    );
  }

  function NumberField(props: {
    label: string; value: number; status: "saved" | "error" | undefined;
    onSave: (n: number) => void; onInvalid: () => void;
  }) {
    const [text, setText] = useState(String(props.value));
    return (
      <label className="block">
        <span className="font-bold">{props.label}</span>
        <input className="gos-input mt-1" inputMode="decimal" value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (!Number.isFinite(n) || n <= 0) { props.onInvalid(); return; }
            props.onSave(n);
          }} />
        <Note value={props.status} />
      </label>
    );
  }

  const TEMPLATE_LABELS: Record<(typeof TEMPLATE_KEYS)[number], string> = {
    newInquiry: "New inquiry", general: "General (fallback)", noQuoteFollowUp: "Follow-up: no quote yet",
    quoteFollowUp: "Follow-up: quote sent", confirmation: "Visit confirmation", onMyWay: "On my way",
    thankYou: "Thank you", paymentReminder: "Payment reminder", tuningInvite: "Tuning invite",
  };

  export default function SettingsClient({ initial, initialAds }: { initial: GosSettings; initialAds: GosAd[] }) {
    const [s, setS] = useState(initial);
    const [ads, setAds] = useState(initialAds);
    const [status, setStatus] = useState<Status>({});
    const [newAd, setNewAd] = useState("");
    const [adError, setAdError] = useState("");

    const mark = (field: string, v: "saved" | "error") => setStatus((st) => ({ ...st, [field]: v }));

    async function save(field: string, next: GosSettings) {
      const res = await saveGosSettings(next);
      if (res.ok) {
        setS(res.value);
        mark(field, "saved");
      } else {
        mark(field, "error");
      }
    }

    /** Props for a field: current status + save/invalid handlers bound to its key. */
    const bind = (field: string) => ({
      status: status[field],
      onInvalid: () => mark(field, "error"),
    });

    return (
      <div className="mt-2 space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <fieldset className="gos-card space-y-4">
          <legend className="px-1 text-lg font-bold">Prices</legend>
          <MoneyField {...bind("tuning")} label="Tuning, pesos" value={s.prices.tuningCentavos} allowBlank={false}
            onSave={(c) => void save("tuning", { ...s, prices: { ...s.prices, tuningCentavos: c as number } })} />
          <MoneyField {...bind("cleaning")} label="Cleaning, pesos (blank = not set)" value={s.prices.cleaningCentavos} allowBlank
            onSave={(c) => void save("cleaning", { ...s, prices: { ...s.prices, cleaningCentavos: c } })} />
          <MoneyField {...bind("repair")} label="Repair labor, pesos (blank = not set)" value={s.prices.repairLaborCentavos} allowBlank
            onSave={(c) => void save("repair", { ...s, prices: { ...s.prices, repairLaborCentavos: c } })} />
          <p className="text-sm text-[var(--gos-ink-dim)]">New quotes only. Old quotes keep their price.</p>
        </fieldset>

        <fieldset className="gos-card space-y-4">
          <legend className="px-1 text-lg font-bold">Travel</legend>
          <MoneyField {...bind("diesel")} label="Diesel price, pesos per liter" value={s.travel.dieselPerLiterCentavos} allowBlank={false}
            onSave={(c) => void save("diesel", { ...s, travel: { ...s.travel, dieselPerLiterCentavos: c as number } })} />
          <NumberField {...bind("kmpl")} label="Kilometers per liter" value={s.travel.kmPerLiter}
            onSave={(n) => void save("kmpl", { ...s, travel: { ...s.travel, kmPerLiter: n } })} />
          <p aria-live="polite">Fuel: ₱{centavosToPesos(fuelPerKmCentavos(s))}/km</p>
          <MoneyField {...bind("vehicle")} label="Vehicle cost, pesos per km (blank = not set)" value={s.travel.vehicleCostPerKmCentavos} allowBlank
            onSave={(c) => void save("vehicle", { ...s, travel: { ...s.travel, vehicleCostPerKmCentavos: c } })} />
          <MoneyField {...bind("meals")} label="Meals default, pesos" value={s.travel.mealsDefaultCentavos} allowBlank={false}
            onSave={(c) => void save("meals", { ...s, travel: { ...s.travel, mealsDefaultCentavos: c as number } })} />
          <label className="gos-tap flex items-center gap-3">
            <input type="checkbox" checked={s.travel.roundTripDefault}
              onChange={(e) => void save("roundtrip", { ...s, travel: { ...s.travel, roundTripDefault: e.target.checked } })} />
            Round trip by default <Note value={status.roundtrip} />
          </label>
          <label className="gos-tap flex items-center gap-3">
            <input type="checkbox" checked={s.travel.roundUpTo10}
              onChange={(e) => void save("round10", { ...s, travel: { ...s.travel, roundUpTo10: e.target.checked } })} />
            Round travel up to ₱10 <Note value={status.round10} />
          </label>
          <p className="text-sm text-[var(--gos-ink-dim)]">New quotes only. Old quotes keep their price.</p>
        </fieldset>

        <fieldset className="gos-card space-y-4">
          <legend className="px-1 text-lg font-bold">Reminders</legend>
          <NumberField {...bind("noreply")} label="No reply after, minutes" value={s.reminders.noReplyMinutes}
            onSave={(n) => void save("noreply", { ...s, reminders: { ...s.reminders, noReplyMinutes: Math.round(n) } })} />
          <NumberField {...bind("noquote")} label="No quote after reply, days" value={s.reminders.noQuoteDays}
            onSave={(n) => void save("noquote", { ...s, reminders: { ...s.reminders, noQuoteDays: Math.round(n) } })} />
          <NumberField {...bind("quotefu")} label="Quote follow-up after, days" value={s.reminders.quoteFollowUpDays}
            onSave={(n) => void save("quotefu", { ...s, reminders: { ...s.reminders, quoteFollowUpDays: Math.round(n) } })} />
          <NumberField {...bind("unpaid")} label="Unpaid reminder after, days" value={s.reminders.unpaidDays}
            onSave={(n) => void save("unpaid", { ...s, reminders: { ...s.reminders, unpaidDays: Math.round(n) } })} />
          <NumberField {...bind("tuningdays")} label="Tuning reminder, days before due" value={s.reminders.tuningLeadDays}
            onSave={(n) => void save("tuningdays", { ...s, reminders: { ...s.reminders, tuningLeadDays: Math.round(n) } })} />
        </fieldset>

        <fieldset className="gos-card space-y-4">
          <legend className="px-1 text-lg font-bold">Reply texts</legend>
          {TEMPLATE_KEYS.map((key) => {
            const unknown = unknownPlaceholders(s.templates[key]);
            return (
              <label key={key} className="block">
                <span className="font-bold">{TEMPLATE_LABELS[key]}</span>
                <textarea className="gos-input mt-1 min-h-24" maxLength={1000} defaultValue={s.templates[key]}
                  onBlur={(e) => void save(`tpl-${key}`, { ...s, templates: { ...s.templates, [key]: e.target.value } })} />
                {unknown.length > 0 && (
                  <span role="alert" className="block text-sm text-[var(--gos-danger)]">✕ Unknown: {unknown.join(", ")}</span>
                )}
                <Note value={status[`tpl-${key}`]} />
              </label>
            );
          })}
          <p className="text-sm text-[var(--gos-ink-dim)]">Allowed: {"{name} {area} {total} {date} {time} {balance} {piano} {minutes}"}</p>
        </fieldset>

        <fieldset className="gos-card space-y-3">
          <legend className="px-1 text-lg font-bold">Ad names</legend>
          <ul className="space-y-2">
            {ads.map((ad) => (
              <li key={ad.id} className="flex items-center justify-between gap-3">
                <span>{ad.name}{ad.retired ? " (retired)" : ""}</span>
                <button type="button" className="gos-tap rounded-full border px-4"
                  onClick={async () => {
                    const res = await setAdRetired(ad.id, !ad.retired);
                    if (res.ok) { setAds(ads.map((a) => (a.id === ad.id ? { ...a, retired: !a.retired } : a))); setAdError(""); }
                    else setAdError(res.error);
                  }}>
                  {ad.retired ? "Bring back" : "Retire"}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className="gos-input" aria-label="New ad name" maxLength={60} value={newAd} onChange={(e) => setNewAd(e.target.value)} />
            <button type="button" className="gos-btn-black shrink-0 whitespace-nowrap"
              onClick={async () => {
                const res = await addAd(newAd);
                if (res.ok) { setAds([...ads, res.value]); setNewAd(""); setAdError(""); }
                else setAdError(res.error);
              }}>+ Add</button>
          </div>
          {adError && <p role="alert" className="text-sm text-[var(--gos-danger)]">✕ {adError}</p>}
        </fieldset>

        <fieldset className="gos-card space-y-2">
          <legend className="px-1 text-lg font-bold">Lost reasons</legend>
          <textarea className="gos-input min-h-24" aria-label="Lost reasons, one per line" defaultValue={s.lostReasons.join("\n")}
            onBlur={(e) => {
              const list = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
              void save("lost", { ...s, lostReasons: list });
            }} />
          <Note value={status.lost} />
        </fieldset>

        <fieldset className="gos-card space-y-2">
          <legend className="px-1 text-lg font-bold">Ads connection</legend>
          <p>Not connected</p>
        </fieldset>
      </div>
    );
  }
  ```
- [ ] Run: `npm run typecheck && npm test && npx eslint src/app/os src/components/gos` — expect: 0 errors, all tests PASS
- [ ] Commit: `feat(gos): /os shell with 5 screens and Settings`

---

## Phase 6: Database migration + owner account script

**Implements:** FR-7, NFR Reliability | **Satisfies:** AC-1.1 (owner exists on a fresh database)
**Files:** `drizzle/*.sql` (generated), `scripts/gos-create-owner.ts`
**Interfaces:** Consumes: `hashPassword()` from `@/lib/security`, `users` table. Produces: reviewed migration files; `npm run gos:create-owner`.

- [ ] Run: `npm run db:generate` — expect: a new SQL file in `drizzle/` that CREATEs every table in `schema.ts` + `gos-schema.ts` (first migration for a fresh Supabase database). Review it: only CREATE statements, no DROP.
- [ ] Create `scripts/gos-create-owner.ts` (Robert runs it once on his PC; the password is typed only into his own terminal, never into chat or docs):
  ```ts
  import "dotenv/config";
  import { createInterface } from "node:readline/promises";
  import { stdin as input, stdout as output } from "node:process";
  import { eq } from "drizzle-orm";
  import { db, pool } from "../src/db";
  import { users } from "../src/db/schema";
  import { hashPassword } from "../src/lib/security";

  async function main() {
    const rl = createInterface({ input, output });
    const email = (await rl.question("Owner email: ")).trim().toLowerCase();
    const name = (await rl.question("Name (e.g. Robert Herrero): ")).trim();
    const password = await rl.question("New password (12+ characters): ");
    rl.close();
    if (!email.includes("@") || name.length === 0 || password.length < 12) {
      throw new Error("Need a valid email, a name and a password of 12+ characters.");
    }
    const passwordHash = hashPassword(password);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      await db.update(users).set({ passwordHash, name, role: "owner" }).where(eq(users.id, existing.id));
      console.log("Owner password updated.");
    } else {
      await db.insert(users).values({ email, name, passwordHash, role: "owner" });
      console.log("Owner account created.");
    }
    await pool.end();
  }

  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
  ```
- [ ] Local Docker database (already has the old tables, created by `init-db.sh` with `drizzle-kit push`): run `npx drizzle-kit push` (adds the 3 `gos_` tables), then `npm run gos:create-owner`. Fresh Supabase database: run `npm run db:migrate`, then `npm run gos:create-owner`. Expect: "Owner account created." (Password is typed on Robert's own PC and shows on his screen while typing; it is never sent to chat.)
- [ ] Connection string rule (found in dry run): `src/db/index.ts` always uses SSL, and the `pg` driver treats `sslmode=require` as full certificate checking. Use the Supabase pooler URL with `?sslmode=require&uselibpqcompat=true` for `DATABASE_URL`. 🔬 Confirm on the first Supabase connection.
- [ ] Commit: `feat(gos): first migration + owner account script`

---

## Phase 7: Integration Verification

**Implements:** All Step A FRs | **Satisfies:** AC-1.1–1.5, AC-9.4, AC-12.1–12.6, G6

- [ ] Run: `npm test` — expect: all Growth OS tests PASS (env 6, lockout 5, owner 3, settings 13, contracts 4)
- [ ] Run: `npm run typecheck && npm run build` — expect: 0 errors, build succeeds
- [ ] Run: `npx eslint src/app/os src/components/gos src/lib/gos src/server/gos src/server/auth-actions.ts scripts` — expect: 0 problems. (Note: `npm run lint` on the whole repo already shows 2 errors + 1 warning in OLD files `owner-today.tsx` and `showroom-client.tsx` before any Growth OS change — not touched, per "only ADD".)
- [ ] Run the existing app test: `node tests/task-flow.cjs` (local Docker DB) — expect: PASS as before (AC-1.4)
- [ ] Manual check on local Docker (`docker compose up -d --build web`, fresh tab at http://localhost:9847):
  1. Signed out → open `/os` → sent to login (AC-1.2)
  2. 5 wrong passwords → 6th shows "Too many tries. Try again in 15 minutes." even with the right password (AC-1.5)
  3. Sign in → open `/os` → Today shows "No customers yet…" (AC-1.1, AC-9.4)
  4. Settings: change Diesel to 115 → "Saved ✓", fuel shows ₱11.50/km; type 0 → "✕ Not saved — try again" (AC-12.2, AC-12.3)
  5. Type `{nmae}` in a template → "✕ Unknown: {nmae}" (AC-12.5)
  6. Retire all 3 ads → the last one refuses with "Keep at least one active ad name." (AC-12.6)
  7. Phone width 320px and 375px: no sideways scroll, bottom bar visible; desktop 1280px: sidebar (G6)
- [ ] Spec-alignment: run `sdd-superpowers:sdd-review` Mode B for Step A ACs
- [ ] Push branch `001-growth-os`, open pull request → Vercel preview link to Robert (never merge to `main` without his OK)
- [ ] Commit: `feat(gos): complete Step A (base)`

---

## Quickstart Validation

1. Robert opens the Vercel preview link on his phone → login gate → login → types `/os` → sees Today.
2. He opens Settings, changes Diesel from 110 to 115 → sees "Saved ✓" and "Fuel: ₱11.50/km".
3. He opens the same link on desktop → same Settings value is there (saved in the database).
4. He tells the assistant "OK Step A" → assistant starts Plan B.

---

## Dry-Run Evidence (4 Oct 2026, cloud copy of the repo — NOT the real repo yet)

The assistant applied this plan to a copy of the repo in its cloud workspace to catch mistakes before Robert approves:
| Check | Result |
|---|---|
| Baseline `tsc --noEmit` before changes | 0 errors |
| `vitest run` | 31 / 31 tests PASS |
| `tsc --noEmit` after changes | 0 errors |
| ESLint on Growth OS files | 0 problems (old files: 2 errors + 1 warning already there) |
| `next build` | succeeds, routes `/os`, `/os/today`, `/os/customers`, `/os/work`, `/os/growth`, `/os/settings` built (Google Fonts were stubbed only because the cloud sandbox cannot download them; Vercel can) |
| `drizzle-kit generate` | 1 migration, 22 CREATE TABLE, 0 DROP; 3 new `gos_` tables |
| Real Postgres 16 + `next start` + browser test (Playwright) | 24 / 24 checks PASS: signed-out → login; 4 wrong = normal error; 5th = lock; correct password refused while locked; works after lock ends; counter reset; Today empty state; Diesel 115 saved + "₱11.50/km" + kept after reload; 0 refused and DB unchanged; `{nmae}` warned; last ad can't be retired; no sideways scroll at 320/375px; bottom bar visible; non-owner sees "No access (403)" and no data |
| Start-up check | without AUTH_SECRET, `/os` refuses with "Growth OS cannot start…" ✅ |
| Fixes made from the dry run | vitest config → `.mts`; sidebar sticky on desktop; "+ Add" button no longer wraps; Supabase SSL connection rule; local Docker uses `push` not `migrate`; lint scoped to new files |

## Self-Review (sdd-plan Step 5–6)

| Check | Result |
|---|---|
| Every Step A AC mapped to a phase | AC-1.1 (P3, P5, P6) · AC-1.2 (P3, P5) · AC-1.3 (P3, P5) · AC-1.4 (P2, P7) · AC-1.5 (P2) · AC-9.4 (P5) · AC-12.1–12.6 (P4, P5) |
| Step A ACs NOT covered here (by design) | AC-12.7 backup status → Step D · AC-12.8 Export all → Step D (needs customer data) · Ad allowance + Business group UI → Step E (data + defaults already stored in P4) |
| Placeholders (TBD/TODO/"handle errors") | none |
| Test before code in every phase | yes (P1–P4 unit tests first; P5 UI verified in P7 manual + typecheck; UI tests arrive with Playwright in Step B) |
| Gates | Simplicity: 3 modules (lib/gos, server/gos, app/os) ✅ · new deps zod + vitest justified ✅ · Anti-abstraction: Next.js server actions + Drizzle used directly ✅ · Integration-first: contract tests in Phase 0 ✅ |
| Honest gap | AC-1.3: a signed-in non-owner page shows "No access (403)" text with HTTP status 200 (actions return the 403 error). Data is never shown. A true HTTP 403 needs Next's experimental `forbidden()`; not worth the risk now. |
| Risks | 🔬 Needs GitHub access or Robert commits manually · 🔬 PC workspace shell not starting — assistant builds in the cloud copy · next/font names `Atkinson_Hyperlegible`, `Bricolage_Grotesque` verified at build time (fallback: system fonts) |
