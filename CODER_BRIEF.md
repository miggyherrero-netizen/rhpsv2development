# Task: Security & RBAC Foundations — Herrero Pianos

## Project
- Path: `E:\docker containers\herrero-pianos-implementation-brief-max`
- Stack: Next.js 16 (App Router, Turbopack), Drizzle ORM, Postgres, Docker Compose
- Run/rebuild: `docker compose up -d --build web` (web serves on host port 9847, mapped from container port 3000)
- DB migrations + seed run automatically on container start via `init-db.sh` (already fixed — don't touch this file unless directly relevant)

## Context — read this before writing any code

I already read the actual codebase (not guessing). Key facts you must respect:

- **Auth already works** via DB-backed httpOnly session cookies — see `src/lib/auth.ts` (`requireUser`, `createSession`, `getUser`, `endSession`), sessions stored in the `sessions` table, password hashing via `scrypt` in `src/lib/security.ts`. **Do not migrate to JWT.** Keep this system, extend it.
- **Mutations already go through Next.js Server Actions** (`"use server"` files in `src/server/admin.ts`, `owner.ts`, `workshop.ts`, `auth-actions.ts`). These already get built-in Origin-header CSRF protection from Next.js itself. **Do not build a separate REST CRUD API layer or a CSRF double-submit-token system** — both would duplicate protection that already exists for no current benefit.
- **DB connection pooling is already correct** — `src/db/index.ts` uses a singleton `pg.Pool` with a global cache guard. No pooling work needed.
- **There is exactly one authenticated human role today**: `users.role` defaults to `"owner"`, and the one seeded user has that role. `/admin/*` and `/owner/*` are two feature areas used by the *same* person, not two separate roles. **Do not invent a second role or build a multi-role/decorator RBAC framework.** Just add a reusable guard function so a future role is a one-line addition.

## Real gaps (confirmed by reading the code) — fix these

1. **`src/app/api/live/route.ts` has zero authentication.** It's a public, unauthenticated endpoint that returns live operational data (who's clocked in, which project/task) to anyone who hits it. This needs to require a valid session.
2. **`src/lib/security.ts` lines ~33-34**: `AUTH_SECRET` silently falls back to a hardcoded string (`"herrero-atelier-dev-secret-do-not-use-in-prod"`) if the env var isn't set. In production this means anyone who knows/reads that fallback string can forge signed worker-PIN cookies (`signPayload`/`verifySigned`, used for the workshop kiosk). There is no startup check that catches a missing `AUTH_SECRET` in production.
3. **Zero input validation anywhere.** Every server action in `src/server/admin.ts`, `src/server/owner.ts`, `src/server/workshop.ts` takes a raw untyped object straight into a Drizzle `insert`/`update`/`select` call. No Zod, no manual checks beyond the occasional regex (e.g. PIN format in `workshop.ts`).
4. **No global error boundary.** An unhandled exception in a Server Component currently shows Next.js's default crash screen. Next.js has a dedicated file convention for this (`error.tsx` / `global-error.tsx` in the App Router) — use that, not a hack inside `layout.tsx`.
5. **No rate limiting** on the two public API routes: `/api/health` and `/api/live`.

## Implementation plan

### 1. `src/lib/env.ts` (new)
Small startup-validation helper. Reads `DATABASE_URL` and `AUTH_SECRET` from `process.env`. If either is missing while `process.env.NODE_ENV === "production"`, throw a clear error immediately (fail fast at boot, not silently at request time). Outside production, allow the existing dev fallback values.

Wire it in:
- `src/lib/security.ts` — replace the inline `AUTH_SECRET` fallback with an import from `src/lib/env.ts`.
- `src/db/index.ts` — replace the inline `DATABASE_URL` read/throw with an import from `src/lib/env.ts`. Keep the existing `Pool`/global-cache singleton logic exactly as-is.

### 2. Role guard helper
Add to `src/lib/auth.ts`, next to the existing `requireUser()`:
```ts
export async function requireRole(...roles: string[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/login");
  return user;
}
```
Don't apply it anywhere yet — there's no second role to protect against today. This just makes adding one later a one-line change.

### 3. Auth-gate `/api/live`
Edit `src/app/api/live/route.ts`: call `requireUser()` from `src/lib/auth.ts` before calling `getLiveOps()`. If no valid session, return a 401 JSON response (e.g. `NextResponse.json({ error: "Unauthorized" }, { status: 401 })`) instead of calling the data layer. Mirror the exact pattern already used throughout `admin.ts`/`owner.ts`.

### 4. Zod validation on all mutations
- Add `zod` to `package.json` dependencies.
- Create `src/lib/validation.ts` with Zod schemas matching the input types already declared inline in:
  - `src/server/admin.ts` — `ProjectInput` and the task/worker/inventory input shapes used by `createProject`, `updateProject`, and the equivalent task/worker/inventory functions.
  - `src/server/owner.ts` — `OwnerEventInput` and the owner-task input shape.
  - `src/server/workshop.ts` — PIN format (already has a regex, formalize as a schema), clock-in/out inputs.
- Reuse existing enum constants from `src/lib/config.ts` (`PRIORITIES`, `TASK_COLUMNS`, `PROJECT_STAGES`) inside the Zod schemas via `z.enum(...)` — don't redeclare these string unions.
- In each server action, parse the incoming `input` through the matching schema first. On validation failure, return `{ ok: false, error: <message> }` — this matches the return shape server actions already use (see `login()` in `src/server/auth-actions.ts`), so no client-side component changes are needed.

### 5. Global error boundary
- Add `src/app/error.tsx` — client component (`"use client"`), Next.js App Router error boundary convention. Render a simple branded "something went wrong" page with a retry button (`reset()` prop), matching the app's existing dark/paper visual style — check `src/components/ui.tsx` for existing button/card patterns to reuse.
- Add `src/app/global-error.tsx` for failures at the root layout level (must include its own `<html>`/`<body>` per Next.js convention since it replaces the root layout).

### 6. Rate limiting
- Create `src/lib/rate-limit.ts`: a minimal in-memory sliding-window limiter (plain JS Map keyed by IP or session — no Redis needed, this runs as a single Docker container, not multi-instance).
- Apply it to `src/app/api/health/route.ts` and `src/app/api/live/route.ts` (after the auth check in step 3). On limit exceeded, return HTTP 429 with a `Retry-After` header.

## Explicitly out of scope — do not do these
- JWT migration (keep session cookies)
- Separate REST CRUD API layer (Server Actions already cover this)
- CSRF double-submit tokens (Next.js Server Actions already have Origin-header CSRF protection)
- Multi-role RBAC / decorator framework (only one role exists; the guard helper in step 2 is sufficient)
- WebSocket/SSE live updates, in-app notifications system, cursor-based pagination (deferred to a later phase)
- Full Vitest/Playwright test suite with coverage gates, winston structured logging, audit logging (separate follow-up phases, not this one)

## Files you'll touch
**New:** `src/lib/env.ts`, `src/lib/validation.ts`, `src/lib/rate-limit.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`
**Edited:** `src/lib/security.ts`, `src/lib/auth.ts`, `src/db/index.ts`, `src/app/api/live/route.ts`, `src/app/api/health/route.ts`, `src/server/admin.ts`, `src/server/owner.ts`, `src/server/workshop.ts`, `package.json`

## Verification — run all of these after implementing
1. `npm run typecheck` and `npm run lint` both pass.
2. `docker compose up -d --build web` — container boots cleanly, migrations/seed still run.
3. `curl -i http://localhost:9847/api/live` with no cookie → expect `401` (currently returns `200` with data — this is the bug being fixed).
4. Log in through the browser, then hit `/api/live` again with the session cookie → expect `200` with the same data shape as before your changes.
5. Submit an admin form (project/task/inventory) with a missing required field → expect an inline validation error message, not a raw Postgres/Drizzle error.
6. Set `NODE_ENV=production` with `AUTH_SECRET` unset → container should fail to start with a clear, readable error instead of silently running with the fallback secret.
7. Temporarily throw an error inside a server component → confirm `error.tsx` renders (not Next's default dev overlay/crash screen), then remove the test error.
8. Send requests past the configured rate limit to `/api/health` → expect `429` with a `Retry-After` header.

## OUTPUT FORMAT — IMPORTANT

Do not just describe the changes. For each file listed in "Files you'll touch," output the **complete, full content of that file** (not a diff, not a snippet) inside its own labeled code block, one file at a time, in this exact format:

```
### FILE: src/lib/env.ts
```ts
<full file content here>
```
```

Go through every New file first, then every Edited file (showing the complete file after your edit, not just the changed lines). Do not skip any file from the list. Do not invent new files, folders, or a different project structure — only touch the files explicitly listed in this brief.
