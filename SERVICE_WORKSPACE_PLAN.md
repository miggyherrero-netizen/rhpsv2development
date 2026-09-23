# Plan — Home Service Workspace (`/service/*`)

**Goal:** a fourth, fully separate workspace for **in-home piano service** — scheduling
(who goes where, when), **time management** (travel + on-site + breaks, job costing),
and **finance** (quotes → invoices → payments → expenses → AR aging → P&L).

Decisions confirmed with the owner: new top-level route area · dedicated tables ·
full finance depth · owner-only access (existing session) · plan first, then build.

> **Status: built and verified.** Every screen in §1, every table in §2, and the rules in
> §3 are implemented. Verification evidence is in §8. Two decisions were changed during
> the build and are recorded here: the travel fee is only added to an invoice when the job
> has no fee line of its own (§3), and the demo seed is reachable at any time from
> **Settings → Sample data** because `src/db/seed.ts` only runs against an empty database.

---

## 1. Shape

A true fourth area alongside `/admin/*`, `/owner/*`, `/workshop`:

| Route | Purpose |
| --- | --- |
| `/service` | redirect → `/service/today` |
| `/service/today` | **Run sheet** — today's visits, travel gaps, live timers, start/arrive/complete, quick-add job |
| `/service/schedule` | **Dispatch board** — week grid (7 days × 07:00–20:00), unscheduled tray, drag/reschedule, technician columns |
| `/service/jobs` | Work orders list — filter by status / type / technician / date / search |
| `/service/jobs/[id]` | Job detail — client + location + piano, line items, time log, timeline, invoice |
| `/service/customers` | Customers, their locations, their pianos, service history, **recalls (due for tuning)** |
| `/service/invoices` | Invoice list + AR aging summary |
| `/service/invoices/[id]` | Invoice detail, record payments, print view |
| `/service/expenses` | Expense capture + category breakdown (fuel, materials, subcontractor, …) |
| `/service/time` | Timesheets — travel/work/break minutes per technician per day, utilization |
| `/service/finance` | Dashboard — revenue, collections, AR aging buckets, expenses, P&L, job margins, cashflow |
| `/service/settings` | Price book, tax/terms/invoice prefix, travel fees, working hours, technician rates |

Sidebar sections: **Operations** (Today, Schedule, Jobs, Time) · **Money** (Invoices,
Expenses, Finance) · **People & Places** (Customers) · Settings.
Cross-links added to `admin-shell.tsx` and `owner-shell.tsx` ("Home Service").

---

## 2. Domain model (new tables, `service_*` prefix)

Money: **integer cents everywhere** (matches `peso()` in `src/lib/format.ts`).
Timestamps: `mode: "date"`, stored UTC, all day-boundaries via `startOfManilaDayUTC()`.

**`service_customers`** — id, name, email, phone, company (schools/chapels),
source (referral|website|walk_in|repeat|facebook), tags jsonb, notes, archivedAt, timestamps.

**`service_locations`** — id, customerId (cascade), label, addressLine, city, area
(travel zone, e.g. "Matina"), landmark, accessNotes (gate code / stairs / parking),
travelMinutes, travelFeeCents, lat/lng (text), timestamps.

**`service_pianos`** — id, customerId (cascade), locationId (set null), brand, model,
type (grand|upright|digital|organ), serialNumber, year, conditionNotes,
lastServiceAt, tuningIntervalMonths (default 6), **nextServiceDueAt** (materialized →
powers the Recalls view), notes, timestamps.

**`service_catalog`** — price book: name, description, kind (service|part|fee|package),
unitPriceCents, taxable, estimatedMinutes, active, position, timestamps.

**`service_technicians`** — the home-service crew, isolated from the workshop `workers`
roster: id, name, title, phone, avatarUrl, color (dispatch-board tint),
`hourlyRateCents` (what the business pays → labor cost), `billableRateCents`
(what a time-based job can be charged at), active, notes, timestamps.

**`service_jobs`** (work order) — id, **jobNumber serial** (→ human code `WO-2026-0012`),
customerId (restrict — never lose history), locationId, pianoId, title,
serviceType (tuning|repair|regulation|voicing|cleaning|delivery|assessment|maintenance|other),
status (lead|quoted|scheduled|en_route|in_progress|on_hold|completed|invoiced|paid|cancelled),
priority (low|normal|high|urgent — reuses `PRIORITIES`),
scheduledStart, scheduledEnd, estimatedMinutes, actualMinutes,
technicianId → **service_technicians.id** (set null),
travelMinutes, travelFeeCents, quotedCents, laborCostCents, partsCostCents,
notes, privateNotes, startedAt, completedAt, invoicedAt, cancelledAt, cancelReason, timestamps.
Indexes: `scheduled_start`, `status`, `customer_id`, composite `(status, scheduled_start)`.

**`service_job_items`** — id, jobId (cascade), kind (service|part|fee|discount), description,
qty, unitPriceCents, taxable, minutes, catalogItemId (set null), position.
Line total = `qty × unitPriceCents` (discount lines are negative).

**`service_job_events`** — timeline/audit: id, jobId (cascade),
type (created|quoted|scheduled|assigned|en_route|started|paused|resumed|completed|invoiced|payment|cancelled|note|call),
message, at, actorName.

**`service_time_logs`** — id, jobId (cascade), technicianId → service_technicians.id,
kind (travel|work|break), startedAt, endedAt (null = running), minutes (materialized on stop),
billable, hourlyRateCents (snapshot at start → labor costing), note.
Partial unique index `(technician_id) WHERE ended_at IS NULL` — one running timer per technician.

**`service_invoices`** — id, **invoiceNumber serial** (`INV-2026-0031`), customerId (restrict),
jobId (set null), status (draft|sent|partial|paid|void), issueDate, dueDate,
subtotalCents, discountCents, taxCents, totalCents, amountPaidCents,
taxRateBps (default 1200 = 12% PH VAT, snapshotted), notes, terms, sentAt, paidAt, voidedAt, timestamps.
Indexes: `status`, `due_date`, `customer_id`.

**`service_invoice_items`** — id, invoiceId (cascade), jobItemId (set null), description,
qty, unitPriceCents, taxable, position.

**`service_payments`** — id, invoiceId (cascade), amountCents,
method (cash|gcash|maya|bank_transfer|card|check|other), reference, receivedAt, note.

**`service_expenses`** — id, category (fuel|transport|materials|parts|subcontractor|meals|tools|
marketing|rent|utilities|other), description, amountCents, spentAt, jobId (set null),
vendor, method, reimbursable, receiptUrl, note.

**`service_settings`** — one row per owner: ownerId (cascade, unique), businessName,
invoicePrefix, jobPrefix, taxRateBps, taxLabel, defaultTermsDays, defaultHourlyRateCents,
defaultTravelFeeCents, defaultTuningIntervalMonths, reminderLeadDays, currency,
workingHours jsonb (dispatch board hours), updatedAt.

**Recalls are derived**, not a table: `service_pianos.nextServiceDueAt` is advanced when a
tuning/maintenance job completes → "Due for service" list on Customers + Today widget.

---

## 3. Money & time rules (pure functions in `src/lib/service.ts`)

- `lineTotal = qty × unitPriceCents`
- `subtotal = Σ lineTotal` (discounts negative) · `taxableBase = Σ taxable lineTotals`
- `tax = round(taxableBase × taxRateBps / 10_000)` · `total = subtotal + tax`
- `paid = Σ payments` · `balance = total − paid`
- **Invoice status is derived:** void → paid (balance ≤ 0 and total > 0) → partial
  (0 < paid < total) → sent (sentAt) → draft. *Overdue* is display-only
  (`dueDate < now && balance > 0 && !void`).
- **AR aging buckets** (days past due): Current, 1–30, 31–60, 61–90, 90+.
- **Job costing:** labor = Σ work-log `minutes/60 × hourlyRateCents`; parts = Σ part line items;
  other = Σ linked expenses; **margin = invoiced total − labor − parts − expenses**.
- **The call-out fee is charged once:** `createInvoiceFromJob` adds the job's travel fee only
  when the job has no `fee` line already, so a quote that lists "Travel / service call" is not
  billed twice (caught during live verification, fixed, re-verified).
- **Time:** minutes materialized on stop; utilization = billable minutes ÷ scheduled window.
- Totals are recomputed inside the same server action that mutates items/payments — never
  trusted from the client.

---

## 4. Code layout (follows existing conventions)

| File | Role |
| --- | --- |
| `src/db/schema.ts` *(edit)* | new `HOME SERVICE` section + inferred types |
| `src/lib/service.ts` *(new)* | statuses/labels/colors, catalog & expense enums, pure money/time/aging math |
| `src/server/service-data.ts` *(new)* | **all reads** (today bundle, schedule, jobs, customers, invoices/AR, expenses, timesheets, finance report) |
| `src/server/service.ts` *(new)* | **all writes** — Server Actions, every one calls `requireUser()` |
| `src/app/service/**` *(new)* | thin pages: fetch → client component |
| `src/components/service-*.tsx` *(new)* | flat per-page clients + `service-ui.tsx` shared primitives |
| `src/app/globals.css` *(edit)* | `--color-svc-*` tokens + `.card-svc`, `.input-svc`, `.btn-svc-primary`, `.chip-svc` |
| `src/components/admin-shell.tsx`, `owner-shell.tsx` *(edit)* | "Home Service" cross-link |
| `src/db/seed.ts` *(edit)* | home-service demo rows **inside the existing existing-user guard** (fresh installs only) |
| `src/server/service.ts` | `seedServiceDemo()` — explicit, idempotent (no-ops if any customer exists) for existing databases |

New reads/writes get their own files (`service-data.ts` / `service.ts`) instead of growing
`data.ts` (507 lines) — same one-file-per-area rule the repo already uses.

No new npm dependencies: inputs are typed interfaces validated by small runtime guards
in `src/lib/service.ts` (the repo has no Zod today; adding one is a separate decision).

---

## 5. Theme

Fourth design system with its own tokens, deliberately distinct from the public site
(near-black + brass), admin (`card-dark`), and the Personal Workspace (teal/blue/violet/rose):

```
--color-svc-bg #0b0f14   --color-svc-surface #121821   --color-svc-surface-2 #18212c
--color-svc-border rgba(255,255,255,.075)              --color-svc-text #e7edf5
--color-svc-text-dim #94a3b8  --color-svc-faint #6b7a8d
--color-svc-accent #4d8df0   /* scheduled / primary  */
--color-svc-success #3fb984  /* paid / completed     */
--color-svc-warn #d9a05b     /* overdue / unpaid     */
--color-svc-danger #dd7b7b   /* cancelled / loss     */
--color-svc-violet #8f9ae0   /* travel / admin       */
```
Classes `.card-svc`, `.input-svc`, `.btn-svc-primary`, `.chip-svc`, `.svc-divide`, `.svc-shell`,
`.svc-sidebar` — mirroring the `ow-*` pattern so the four themes never bleed into each other.

---

## 6. Build order

**Phase 1 (this session):** schema + tokens + `src/lib/service.ts` + data/actions +
shell + Today + Schedule + Jobs + job detail (items, timers, timeline) + Customers + price book.
**Phase 2:** Invoices + payments + AR aging + Expenses + Time/timesheets + Finance dashboard + Settings.
Phases may merge if momentum allows; each phase ends green on typecheck + lint.

---

## 7. Decisions (confirmed)

1. **Technicians — isolated.** New `service_technicians` table with its own cost
   (`hourlyRateCents`) and charge (`billableRateCents`) rates. No FK to the workshop
   `workers` roster, so the field crew can be scheduled, costed, and paid independently of
   the shop payroll. (Trade-off, documented: a person who does both shop and field work has
   two records — acceptable now, and a later `workerId` link column is a one-line migration.)
2. **Theme — dark graphite + azure/emerald** (`--color-svc-*`), per §5.

**Known boundary:** `service_time_logs` track job costing and dispatch time for the field
crew; the workshop's `time_entries` remain the shop payroll source. A technician is never
both clocked into the shop and running a home-service timer in the same window — the
Time screen flags overlaps so the two systems never double-count.

---

## 8. Verification — what was actually run

1. **`npm run typecheck` — clean.** `npm run lint` — no new problems; the two remaining
   errors (`owner-today.tsx:54`, `showroom-client.tsx:48`) pre-date this work and are the
   same `setState`-in-effect pattern this workspace deliberately avoids via
   `useSyncExternalStore` in `src/components/service-ui.tsx`.
2. **`drizzle-kit push`** against a local Postgres 18 → 14 `service_*` tables and 34 indexes
   created, including the partial unique index `service_time_logs_one_running_idx`.
3. **Domain checks — `npm run test:service`** (25 assertions, no database needed):
   tax/discount arithmetic, invoice status derivation, AR aging buckets, job margins,
   and Manila wall-clock parsing (`2026-09-23T09:30` → `01:30Z`).
4. **Action flow — 44 assertions** driving the real Server Actions against the database
   (only `next/cache` and `lib/auth` stubbed, everything else production code):
   customer → location → piano → job → quote lines → reschedule → timers → completion →
   invoice → payments → expenses → void → cleanup. Verified: blank names rejected,
   backwards time ranges rejected, zero-value payments rejected, one running timer per
   technician (also enforced by the database), labor cost = 1.5 h × crew rate, recall date
   advanced by the tuning interval, invoice totals (₱2,750 quote + ₱500 travel + 12 % VAT =
   ₱3,640), part-payment → `partial`, full payment → `paid` + job promoted to `paid`,
   deleting a payment reopening the invoice, and no orphan rows after deletion.
5. **`src/db/seed.ts` guard re-run on a populated database — skipped as designed**
   ("Database already has data — skipping seed"), so existing business data is safe.
6. **All nine `/service/*` screens plus job and invoice detail return HTTP 200** with no
   runtime errors in the dev log (only Google-Fonts download warnings, which are sandbox
   network limits, not code).
7. **Database invariants confirmed directly:** deleting a customer with job history is
   blocked (`restrict`), a second concurrent timer for one technician is rejected, and a
   different technician may run a timer at the same time.

### Not verified
- Browser interaction (drag-and-drop on the dispatch board, print layout, mobile drawer):
  no browser engine could be installed in this sandbox. The logic behind each is covered by
  the action-flow checks; the visuals should be clicked through once in the preview.
- Behaviour against the real Docker/Postgres 17 stack: schema push was verified on
  Postgres 18 locally. `init-db.sh` runs `drizzle-kit push` on container start, so the new
  tables appear automatically on the next rebuild.
