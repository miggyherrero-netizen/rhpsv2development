# Architecture

Snapshot taken from the code on 2026-10-06. Line counts are from the files as they are today. Where this
file disagrees with `CLAUDE.md`, this file reflects what the code does.

## 1. Overview

Herrero Pianos is one Next.js 16 (App Router) app on one Postgres database (Drizzle ORM). It serves
**seven** route areas, not six: the public site, the admin back-office, the owner's personal workspace,
the home-service workspace, the client portal, the workshop kiosk, and a newer **Growth OS** (`/os/*`)
that `CLAUDE.md` does not mention yet. Every area reads data in `src/server/*data*.ts`, writes through
`"use server"` files, and shares `src/db`, `src/lib/auth.ts` and `src/lib/*` helpers. There is no
`middleware.ts` or `proxy.ts`; every area guards itself in its own layout, page or action.

```
                           Browser
  +--------+--------+--------+---------+---------+---------+--------+
  |   /    | /admin | /owner | /service|  /os    |/portal/ |/workshop|
  |/showroom|  /*   |  /*    |   /*    | (Growth |  :uuid  | (kiosk) |
  |        |        |        |/share/..|   OS)   |         |         |
  +---+----+---+----+---+----+----+----+----+----+----+----+----+----+
      |        |        |         |         |         |         |
  public-*  admin-*,   owner-*   service-*  gos/*   (page.tsx  workshop-
  piano-    tasks-*,                                  only)      kiosk
  card      projects-*
      |        |        |         |         |         |         |
  public-  admin.ts  owner.ts  service*.ts server/  (reads    workshop.ts
  actions                                   gos/*   only)     (reads+writes)
      |        |        |         |         |         |         |
      +--------+--- src/server/data.ts (admin, owner, portal, public reads)
               |        +--- service-data.ts + service-*-data.ts (service reads)
               |
         +-----+------------------------------------------------+
         | src/db/schema.ts (43 tables)  src/db/gos-schema.ts (5)  |  Postgres
         +-----+------------------------------------------------+
  Auth:  users/sessions -> hp_session cookie (src/lib/auth.ts) for admin, owner, service, os
         workers + signed cookie (src/lib/security.ts)          for workshop
         secret UUID / hashed token in the URL                  for portal and /share/service
         none                                                   for / and /showroom
  Shared: src/lib/{dates,format,config,security,auth,dashboard}.ts, components/ui.tsx, tickers.tsx
```

## 2. Areas at a glance

| Area | Routes | Components (`src/components`) | Writes (`src/server`) | Reads | Auth |
|---|---|---|---|---|---|
| Public | `/`, `/showroom`, `/hero-image` | `public-site`, `public-chrome`, `piano-card`, `showroom-page`, `reveal` | `public-actions.ts` (`submitInquiry`) | `data.ts` (`getShowroom`, `getWebsiteContent`) | None |
| Admin | `/admin` (dashboard, projects, tasks, inventory, workers, curator, monitor, settings, showroom, showroom/[id]/cost, website) | `admin-*`, `projects-board`, `tasks-board`, `inventory-client`, `workers-client`, `curator-client`, `showroom-client`, `showroom-cost-client`, `website-editor-client`, `settings-client`, `live-ops`, `today-timesheet` | `admin.ts` | `data.ts` | `requireUser()` in `admin/layout.tsx` and in each action |
| Owner | `/owner` (today, calendar, tasks, inbox, overdue, upcoming, settings) | `owner-*` | `owner.ts` | `data.ts` (`getOwnerBundle`, `searchOwner`) | `requireUser()` in `owner/layout.tsx`, in most pages, and in each action |
| Service | `/service` (today, schedule, jobs, customers, invoices, expenses, expenses/review, finance, time, waitlist, waitlist/plan, reminders, settings), `/share/service/[token]` | `service-*` (about 35 files) | `service.ts`, `service-waitlist.ts`, `service-reminders.ts`, `service-document-actions.ts`; non-action helpers in `service-waitlist-core.ts` | `service-data.ts`, `service-waitlist-data.ts`, `service-reminders-data.ts`, `service-document-data.ts` | `requireUser()` in layout, pages and actions; finance actions also use `canViewFinance`. Share links: SHA-256 token hash in `service_document_shares` |
| Growth OS | `/os` (today, customers, customers/[id], growth, work, settings) | `gos/*` | `server/gos/customers.ts`, `server/gos/settings.ts` (reads and writes together) | same files, plus `lib/gos/*` pure logic | `requireOwnerPage()` / `requireOwnerAction()` in `server/gos/guard.ts` (session plus `isOwner`, plus a startup env check) |
| Portal | `/portal/[uuid]` | none (page renders directly) | none | `data.ts` (`getPortal`: project plus client-visible `updates`) | Secret UUID (`projects.portal_uuid`) |
| Workshop | `/workshop` | `workshop-kiosk`, `tickers`, `ui` | `workshop.ts` (also holds the reads `getKioskWorkers`, `getWorkerState`) | `workshop.ts` | Worker PIN, then a signed cookie (`verifySigned`); not the sessions table |

Login (`/login`, `/login-gate`) is shared by admin, owner, service and os. `server/auth-actions.ts`
holds `login`, `logout`, the 4-digit gate PIN and the PIN reset.

### Tables (48 in total: 43 in `schema.ts`, 5 in `gos-schema.ts`)

| Group | Tables |
|---|---|
| Shared auth/config (3) | `users`, `sessions`, `settings` |
| Workshop + admin (11) | `workers`, `projects`, `tasks`, `task_assignees`, `time_entries`, `worker_breaks`, `payments`, `updates`, `inventory_items`, `pianos` (the showroom), `inquiries` |
| Owner (5) | `owner_categories`, `owner_preferences`, `owner_events`, `owner_tasks`, `owner_inbox` |
| Service (20) | `service_technicians`, `service_customers`, `service_locations`, `service_pianos`, `service_catalog`, `service_trips`, `service_jobs`, `service_job_items`, `service_job_events`, `service_time_logs`, `service_invoices`, `service_invoice_items`, `service_payments`, `service_document_shares`, `service_expenses`, `service_settings`, `service_waitlist_entries`, `service_message_templates`, `service_routes`, `service_reminders` |
| Philippine geography (4, read-only reference data used by service) | `ph_regions`, `ph_provinces`, `ph_cities`, `ph_barangays` |
| Growth OS (5, `gos-schema.ts`) | `gos_login_attempts`, `gos_settings` (single row), `gos_ads`, `gos_customers`, `gos_activity` |

Plus 5 Postgres enums, all in the service group (`service_job_type`, `service_expense_kind`,
`service_waitlist_status`, `service_waitlist_source`, `service_reminder_status`).

## 3. Data flow

```
page.tsx (server)          thin: auth check, fetch, pass props
   -> src/server/*data.ts  reads, plain async functions using db
   -> client component     "use client", owns UI state
   -> Server Action        "use server" file, called as a function from the client
   -> db (Drizzle)         then revalidatePath(...), result goes back to the client
```

Worked example: **creating a home-service job** at `/service/jobs`.

1. `src/app/service/layout.tsx` calls `requireUser()` (redirects to `/login` if there is no session) and
   loads settings and due reminders for the shell.
2. `src/app/service/jobs/page.tsx` calls `requireUser()` again, then reads in parallel with
   `getJobs`, `getCustomerOptions`, `getPianoOptions` and `getTechnicians` from `server/service-data.ts`.
   It passes the results to `JobsClient` (`components/service-jobs.tsx`). No logic lives in the page.
3. `JobsClient` renders `JobFormModal` (`service-forms.tsx`). On submit it runs
   `run(() => createJob(values))`, which wraps the call in `useTransition` and refreshes on success.
4. `createJob` in `server/service.ts` (a `"use server"` file) calls `requireUser()`, then checks that the
   customer exists, validates the piano ownership (or sale fields), normalises every field with the
   `lib/service.ts` helpers (`str`, `oneOf`, `moneyToCents`), and inserts into `service_jobs`.
5. It then inserts a `created` row into `service_job_events` and calls `touch()`, which runs
   `revalidatePath("/service", "layout")`. It returns `{ ok: true, data: { id } }`, or
   `{ ok: false, error }`, never throws for validation errors.
6. The client sees the result, shows the error or refreshes, and the page re-reads from step 2.

The pattern holds in every area except the exceptions in section 4.

## 4. Cross-area coupling

Verified by grepping imports.

| Coupling | Where | Note |
|---|---|---|
| Public inquiry feeds the service waitlist | `server/public-actions.ts` imports `createWaitlistFromInquiry` from `server/service-waitlist-core.ts` | **Surprising.** A public, unauthenticated action writes into `service_waitlist_entries`. It is the one place the public site touches service tables. |
| Login lockout lives in Growth OS | `server/auth-actions.ts` imports `lib/gos/lockout` and `server/gos/login-attempts` | **Surprising.** The login for all areas depends on `gos_login_attempts`. If that table is missing the login code path breaks; the lockout test mocks exactly that failure. |
| Service reads showroom pianos | `service-data.ts` and `service.ts` use `pianos` (and `phCities`/`phBarangays`) | Intentional: "stock" expenses and sale jobs point at showroom pianos. Read-mostly. |
| `schema.ts` imports from `lib/service.ts` | `import type { WorkingHours } from "@/lib/service"` | The DB layer depends on a feature library (type-only). `owner-utils` also exports a `WorkingHours`, and `data.ts` imports that one. |
| Service shell links into other areas | `service-shell.tsx`, `admin-shell.tsx` | Navigation only. |
| `lib/dashboard.ts` (admin helpers) used by service | `service-today.tsx`, `service-customer-detail.tsx` import `telHref` | A generic helper sitting in an admin-named module. |
| Shared UI primitives | `ui.tsx` (admin, workshop, owner), `tickers.tsx` (admin `live-ops` + workshop), `owner-ui.tsx` (owner only) | Service has its own `service-ui.tsx` (753 lines) and does not use `ui.tsx`. |
| Admin writes call data reads | `admin.ts` imports `getProjectDetail`, `getWorkerDetail`, `getWebsiteContent` from `data.ts` | Reads inside a write file; fine but blurs the convention. |
| `service.ts` imports a read | `import { getServiceSettings } from "@/server/service-data"` | Also `service-waitlist.ts` imports `createJob` from `service.ts`, and `service.ts` imports `service-waitlist-core`. Waitlist and jobs depend on each other (through the core file, so no import cycle). |
| `data.ts` serves four areas | admin, owner, portal, public | One 507-line file mixing four unrelated domains. |
| Settings reset PIN | `owner-settings.tsx` calls `resetLoginGatePin` from `auth-actions.ts` | The owner area edits a login-wide PIN. |
| Dead import | `service-data.ts` imports `expandRecurrence` and never uses it | Suggests the service schedule once showed owner events. No owner table is read there today. |

Convention breaks worth knowing:

- **Workshop** mixes reads and writes in `workshop.ts`; **Growth OS** does the same in `server/gos/*`.
- `login-gate` cookie value is the literal string `"ok"` (httpOnly, 10 minutes). It is not signed.
- **`service.ts` is a `"use server"` file, and every export in such a file becomes a public endpoint.**
  `recalcJobMoney(jobId)` and `recalcJobLabor(jobId)` are exported with no `requireUser()` call.
  They only recompute derived columns from existing rows, so the impact is small, but they should
  not be reachable without a session. Moving them to a non-`"use server"` module fixes it.

## 5. Complexity hotspots

### Biggest files

| File | Lines | Problem |
|---|---|---|
| `src/server/service.ts` | 1809 | Eight domains in one Server Actions file, 55 auth checks |
| `src/server/service-data.ts` | 1248 | Seven read domains in one file |
| `src/db/schema.ts` | 835 | All 43 tables, 5 enums, types |
| `src/components/service-customers.tsx` | 819 | List, sheet, recall list in one file |
| `src/components/service-job-detail.tsx` | 776 | Detail page plus several modals |
| `src/components/service-ui.tsx` | 753 | Design-system primitives plus Money, pickers, dialogs |
| `src/components/owner-calendar.tsx` | 589 | Calendar views and state |
| `src/components/service-line-editor.tsx` | 580 | Line item editor |
| `src/components/service-forms.tsx` | 565 | Job, expense, time, customer forms and pickers |
| `src/components/service-invoices.tsx` | 536 | List plus create flow |
| `src/components/service-settings.tsx` | 531 | Many settings cards in one component |
| `src/server/admin.ts` | 530 | Projects, tasks, workers, inventory, showroom, website, payments |
| `src/server/data.ts` | 507 | Admin, owner, portal, public reads |
| `src/components/service-today.tsx` | 481 | Run sheet |
| `src/components/service-invoice-detail.tsx` | 475 | Invoice detail |
| `src/components/tasks-board.tsx` | 471 | Admin kanban |
| `src/db/seed.ts` | 467 | Initial seed (must keep its idempotency guard) |

### Proposed split lines

`service.ts` already has section banners; the split follows them, with the shared helpers
(`Result`, `ok`, `fail`, `touch`, `requireFinance`) moved to `server/service/shared.ts` (not `"use server"`).

| New file | Existing lines (approx.) | Contents |
|---|---|---|
| `service/people.ts` | 65-466 | customers, locations, pianos, technicians, price book |
| `service/jobs.ts` | 468-860 | create/update/reschedule/assign/status/advance/delete, recalcs |
| `service/job-items.ts` | 864-960 | job line items |
| `service/time.ts` | 964-1100 | timers and time logs |
| `service/invoices.ts` | 1108-1500 | invoices, items, payments |
| `service/expenses.ts` | 1500-1615 | expenses and receipt |
| `service/settings.ts` | 1616-1809 | `updateSettings` and `seedServiceDemo` |

`service-data.ts` splits on its own banners: settings/crew, customers, jobs, schedule+today, invoices,
expenses+time, finance, customer detail, lookups. Keep a barrel file re-exporting names so the roughly
40 component and page imports do not all change at once. `data.ts` should split into `data-admin.ts`,
`data-owner.ts`, `data-public.ts` (portal and showroom). `schema.ts` can split into
`schema/{core,workshop,owner,service}.ts` re-exported from `schema.ts` so drizzle-kit and all imports keep
working.

### Duplicated logic

- `Result`/`ok`/`fail` is redefined in `service.ts` and `service-waitlist.ts` (`data` shape), differently in
  `service-reminders.ts`, and as a `value` shape in `server/gos/customers.ts` and `server/gos/settings.ts`.
  Two incompatible result shapes in one codebase.
- Money parsing: `moneyToCents` (`lib/service.ts`), `pesoToCents` (`service-waitlist.ts`),
  `pesosToCentavos` (`lib/gos/settings.ts`). Formatting: `peso` (`lib/format.ts`) and a private `pesoText`
  in `lib/service-today.ts`, plus a money formatter in `lib/service-reports.ts`.
- Title casing: `titleCaseName` (`service-reports.ts`) and `titleCase` (`pub-text.ts`).
- `service.ts` imports `@/lib/service-reports` twice and `@/lib/service` twice (cosmetic).
- Two "WorkingHours" types (`lib/service.ts`, `lib/owner-utils.ts`).
- Per-area shells (`admin-shell`, `owner-shell`, `service-shell`, `gos/shell`) each repeat the nav and
  logout pattern; per-area modals (`Modal` in `ui.tsx`, `OwnerModal`, `SvcModal`) overlap.

### Dead or unused-looking

- `src/app/os/work/page.tsx` and `src/app/os/growth/page.tsx` are placeholders (`GosEmpty`, "arrive in Step C"),
  but they are linked from the Growth OS shell, so they are unfinished rather than dead.
- The unused `expandRecurrence` import in `service-data.ts` (above).
- `src/server/service.ts` `seedServiceDemo` ships demo-data seeding inside the production actions file.
- Every other module in `src/lib` and `src/components` I checked is imported by at least one file; I found
  no orphan file. A tool such as `knip` would confirm unused *exports*, which I did not check.

### Known limits
- Expense quick-add (`ExpenseFormModal`, `createExpense`) has no idempotency key. If the network drops after the server saved but before the reply arrives, the form stays open with the owner's entries and says "It may have been saved. Check the list before trying again."; a second tap can create a duplicate. Fixing it needs a client-generated key stored on the row (schema change), so it is deliberately not done yet.
- `createJob` (`src/server/service.ts`) writes the job and its "created" event in ONE transaction (so a failed save leaves no job). "Convert to job" still claims the waitlist entry first and undoes it on failure (`convertEntryToJob`).
- "Type a name" new customers (`src/server/service-new-customer.ts`): the waitlist entry is one transaction with its new customer. For a new job or invoice the customer (and piano) commit first and are removed again only if the save fails and nothing else points at them; a server crash between those two steps can leave an orphan customer, which carries no marker. If cleanup finds anything else on the customer it leaves it and says so.
- Piano placeholder (`src/lib/service-piano-info.ts`): `insertNewCustomer` ALWAYS creates the first piano for a brand-new customer (brand "N/A" when none typed, model null); the new job and the waitlist entry link to it (a piano-sale job and a trip / batch job don't). `isPianoInfoMissing` drives the "Needs piano info" badge (`PianoInfoBadge` in `service-ui.tsx`); displays use `pianoLabel` ("Piano (info needed)", never "N/A" as a brand). The brand/model edit form (customer sheet) starts empty and refuses an empty brand. No schema change.
- Payment -> service date (`src/server/service-recall.ts` `rollPianoRecall`, shared with job completion): after `recordPaymentOp` commits and releases the invoice lock, a payment on an invoice whose job is a tuning/maintenance service with a piano sets `last_service_at` (`pickServedAt`: completedAt, else visit date, else the first payment's date) and `next_service_due_at`, only if newer than what the piano has, and ensures the one open recall entry. Best-effort: errors are logged and never affect the payment. `ensureRecallEntry` closes older open tuning entries for the piano and creates a fresh recall, so a later job completion replaces (not duplicates) the recall.
- Follow-ups (`/service/reminders`) show manual reminders ONLY; the sidebar badge counts open reminders due today or earlier (`service-followups-data.ts`). The waitlist is separate (its own page, Today's "Follow up today" panel, and its own attention line). `src/lib/service-followups.ts` keeps only the waitlist rules: a recall is dropped from Today only when a tuning waitlist entry *on that piano* owns it (`entryOwnsRecall`: its follow-up is due now, so it is on Today's "Follow up today" panel, or it is scheduled with a job); a waiting entry still days away does not hide the recall. A piano-less tuning entry does not suppress a customer's piano recall: it is a different follow-up (backlog: let the owner link it to a piano). Reminders and waitlist entries of archived customers are still counted the same way everywhere (badge, Today); hiding them consistently is backlog.

## 6. Documentation sprawl

Root `.md` files and `docs/`:

| File | Status | Note |
|---|---|---|
| `CLAUDE.md` | Current but incomplete | Says "no git repo" (one exists), omits `/os` Growth OS, says 43 tables (48 with gos), 6 areas (7) |
| `AGENTS.md` | Current | Short pointer to `CODEX.md` |
| `CODEX.md` | Stale | No `/service` or `/os`, says "no Git repository", says project-owned `CODER_BRIEF.md` is context |
| `CODER_BRIEF.md` | Stale | One finished task ("Security & RBAC Foundations"); its main gap (`/api/live` auth) is fixed. Contains a local Windows path |
| `ARENA_BUNDLE.md` | Stale | Same task, bundled with file contents copied at that time |
| `SERVICE_WORKSPACE_PLAN.md` | Historical | Says "built and verified"; useful as design record |
| `DOCUMENT_SHARING_SETUP.md` | Current | Operational setup for share links. Refers to "this branch" and `drizzle-kit push` caution |
| `QA_WORKFLOW.md` | Current | Test workflow; references `tests/` which exists |
| `docs/plan-admin-dashboard.md` | Historical | Completed plan |
| `docs/plan-service-cleanup.md` | Historical | Completed plan |
| `docs/plan-service-cleanup-2.md` | Historical | Completed plan |
| `docs/specs/001-growth-os/*` (spec, plan-A, plan-B-outline, data-model-A, `gos-tables.sql`) | Current (feature in progress) | Placeholder pages say Step C is not built |
| `drizzle/manual/README.md` | Current | Required for live schema changes |
| `.claude/*.md` (ROUTING, SMART_AUTO_ROUTING, ROUTING_MAINTENANCE, START_HERE, SYSTEM_VALIDATION) | Likely overlapping (names only; contents not compared) | Five files named after the same routing system |

Proposed consolidation:

1. Make `CLAUDE.md` the one agent guide. Have `AGENTS.md` and `CODEX.md` shrink to a few lines pointing at it
   and at `docs/ARCHITECTURE.md`, or delete `CODEX.md`.
2. Move `CODER_BRIEF.md`, `ARENA_BUNDLE.md`, the three `plan-*.md` files and `SERVICE_WORKSPACE_PLAN.md`
   into `docs/archive/`.
3. Move `QA_WORKFLOW.md` and `DOCUMENT_SHARING_SETUP.md` into `docs/`.
4. Merge the five `.claude/*.md` routing docs into `ROUTING.md` and `START_HERE.md`.
5. Keep root with `CLAUDE.md`, `AGENTS.md`, and a short `README.md` (none exists at root today).

## 7. Top five simplification candidates

| Rank | Candidate | Effort | Risk | Payoff |
|---|---|---|---|---|
| 1 | Move `recalcJobMoney`, `recalcJobLabor` (and any other non-action helpers) out of the `"use server"` file `service.ts` into a plain module | S | Low: callers are internal; run typecheck and service tests | Closes a real unauthenticated-endpoint exposure; first step of the split |
| 2 | Refresh `CLAUDE.md` / `CODEX.md` (add `/os`, 48 tables, git exists) and archive the stale root docs | S | None (docs only) | Stops agents from working from a wrong map; fewer files to read |
| 3 | Split `service.ts` by its existing banners into `server/service/*` with a shared helper file and a barrel re-export | M | Medium: `touch()` revalidation and shared `Result` type must stay identical; 55 auth checks must survive; no behaviour change intended | Largest file in repo becomes seven files of about 250 lines |
| 4 | One shared `ActionResult` type and one money helper set (`lib/money.ts`) replacing the five variants | M | Medium: gos uses `value`, service uses `data`; client call sites change | Removes two result shapes and three money parsers |
| 5 | Split `data.ts` by area and `service-data.ts` by banner (barrel re-exports), then `schema.ts` into per-area files | M to L | Low for reads; schema split needs a drizzle-kit diff showing no change | Reads become findable by area; smaller diffs and merge conflicts |

Not ranked: splitting the 500-800 line `service-*` components. Worth doing opportunistically when each
is next edited, since they are client components with no shared server state.
