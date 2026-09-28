# Plan — Owner Accounting System (inside the Admin workspace)

**Goal:** a full owner-level accounting system for the whole business — wallets and cash
position, a correct double-entry journal underneath, project/restoration billing, piano
sales, payroll aggregation, owner money (draws / contributions / personal), receivables,
reconciliation, period locks, and accountant-ready reports — living **as a major section of
the existing Admin back-office** (`/admin/accounting/*`), with money still *entered* in the
module where the work happens.

Decisions confirmed with the owner (in order):

1. **Correct accounting underneath, simple owner UX on top.** Not a pure single-entry
   journal — a legged journal over a lightweight chart of accounts. The owner never sees
   debits/credits; posting rules build every entry.
2. **No new top-level workspace.** Accounting is a section of `/admin/*`. It uses the
   admin theme (`card-dark` / `bg-ink`), the admin shell (new nav group), and existing
   `ui.tsx` primitives. The Owner workspace gets a cross-link only.
3. **Money is entered where the work lives** — service money in `/service/*` (unchanged),
   project billing on the project, piano costs/sales on the piano, payroll in the existing
   worker/monitor area, owner/general business money in the Accounting section. Accounting
   consolidates, classifies, reconciles, analyzes, and reports. It does not duplicate
   operational screens.
4. **Flexible wallets** (cash / bank / e-wallets, owner-created, no hardcoded bank names)
   with **opening balances** — the business predates the system.
5. **Restoration billing is first-class:** quotation, deposits, progress payments,
   additional approved charges, costs, labor (derived), customer payment history,
   profitability, final billing. Powerful underneath, simple surface.
6. **Owner draws are never blocked** and never classified as business expense. The system
   shows context (available cash, retained profit, safe-to-withdraw) — the owner decides.
7. **Piano sales are first-class** with snapshotting (acquisition/prep cost, price) so
   later edits never corrupt realized margin.
8. **Personal vs. business money is structural:** owner draw, owner contribution, personal
   expense paid from business money, and transfers between own accounts are distinct
   journal kinds with distinct account postings. Personal expenses never touch the
   business P&L.
9. **Reconciliation is core, not optional** (moved into the first phases): manual
   statement reconciliation per wallet — statement ending balance, book balance,
   cleared/uncleared lines, reconciliation date, difference, completed history.
10. **Billing ≠ payment.** The engine posts the *invoice/billing* event (revenue +
    receivable + VAT payable) separately from the *collection* event (wallet + AR
    reduction) wherever the underlying treatment requires it. Owner dashboards may still
    show simple cash views, but the journal is correct. The existing Service module is
    reused as-is — its invoice/payment records feed the engine through a posting bridge.

> **Status: Phases 1–4 implemented and verified** (§9). Phase 5 remains optional/later.

---

## 1. Placement (what lives where)

### The Accounting section — `/admin/accounting/*` (new nav group in `admin-shell.tsx`)

| Route | Nav label | Purpose |
| --- | --- | --- |
| `/admin/accounting` | Overview | Cash position per wallet + total, month in/out, P&L strip (month + YTD, by stream), receivables + deposits held, **safe to withdraw**, reconciliation status, recent money feed, link to settings |
| `/admin/accounting/accounts` | Accounts | Wallets & book accounts with balances; add / rename / deactivate |
| `/admin/accounting/accounts/[id]` | *(from Accounts)* | Per-account running history, **manual reconciliation** (start, clear lines, difference, complete), reconciliation history |
| `/admin/accounting/transactions` | Transactions | Consolidated journal feed (all sources) + Record actions for money with no other home: business expense, other income, transfer, loan, tax payment, payable payment |
| `/admin/accounting/receivables` | Receivables | Business-wide AR aging (service invoices reused + project balances + piano-sale balances) and deposits held by source |
| `/admin/accounting/reports` | Reports | P&L (accrual + cash view) · Cash flow by account · Project profitability · Sales register · Payroll register · Owner equity · VAT summary · Balance sheet · CSV export |
| `/admin/accounting/owner` | Owner Money | Draws, contributions, personal expenses — history + context before recording |
| `/admin/accounting/settings` | *(from Overview)* | Books start date, method→wallet map, payroll wallet, period locks, bridge exceptions |

### Features that live in their existing modules

| Feature | Placement |
| --- | --- |
| Project billing & costs | **New project detail page** `/admin/projects/[id]` (the projects board currently has no detail page) with a *Billing & costs* section. Board cards link to it. |
| Piano costs & sales | Existing `/admin/showroom/[id]/cost` page, widened into **Costs & Sale** (cost entries, reserve with deposit, partial payments, complete sale with snapshots) |
| Service invoices / payments / expenses / finance | **Unchanged** — `/service/*` remains the only entry point for service money |
| Payroll payouts | **Unchanged** — `/admin/monitor` + worker detail; Accounting aggregates |
| Owner workspace | "Accounting" cross-link in `owner-shell.tsx` (later, optional: summary cards on `/owner/today`) |

### Never duplicated

No second invoice screen, no second field-expense screen, no second customer-payment
screen. The Transactions page is a read feed plus the manual kinds listed above. Every
transaction type has **exactly one entry point** — the module where the work lives.

---

## 2. Accounting model

### Chart of accounts — `acc_accounts`

One table for wallets and book accounts. `type`: asset | liability | equity | revenue |
expense. `is_wallet` marks the money places (wallet_kind: cash | bank | ewallet | other).
`system_key` locks posting-rule lookups for the built-in accounts (renameable, never
deletable). Owner-created wallets and loan accounts are ordinary rows — nothing hardcoded.

System accounts (auto-created, idempotent):

| key | name | type | role |
| --- | --- | --- | --- |
| `ar` | Accounts Receivable | asset | control account for billed-unpaid |
| `deposits_held` | Customer Deposits Held | liability | unearned customer money until billing is recognized |
| `owner_draws` | Owner Draws | equity | withdrawals — never an expense |
| `personal` | Owner Personal | equity | personal costs paid from business money — never P&L |
| `capital` | Owner Capital | equity | contributions |
| `opening_equity` | Opening Equity | equity | opening balances + pre-books adjustments |
| `vat_payable` | VAT Payable | liability | output VAT owed until paid |
| `ap` | Accounts Payable | liability | costs recorded but not yet paid |
| `pianos_on_hand` | Pianos on Hand | asset | acquisition + prep costs of sale stock |
| `piano_cogs` | Piano Cost of Sales | expense | carrying cost recognized at sale |
| `wages` | Payroll Wages | expense | shop crew payouts |
| `service_revenue` | Service Revenue | revenue | home-service billing |
| `project_revenue` | Project Revenue | revenue | restoration billing |
| `piano_revenue` | Piano Sales Revenue | revenue | showroom sales |
| `other_income` | Other Income | revenue | misc business income |
| `unmapped` | Unmapped Clearing | asset | safety net for unmapped payment methods (flagged) |
| default wallets | Cash, Bank, GCash, Maya | asset | renameable, deactivate-or-add freely |
| `exp_*` | Fuel, Transport, Materials, Parts, Subcontractor, Meals, Tools & Equipment, Marketing, Rent & Utilities, Interest & Bank Fees, Other | expense | mirrors service categories (bridge maps by key) + manual expenses |

### Journal — `acc_journal` + `acc_journal_lines`

- Append-only. Corrections are **reversal entries** (`reversal_of_id`); rows are never
  edited or deleted. `voided_at` + `void_reason` mark voided entries (excluded from
  aggregates; their reversal carries the effect).
- Every entry is **balanced by construction** (Σ debits = Σ credits), validated before
  insert. `entry_number` serial → `JE-2026-0001`.
- `source_type` / `source_id` / `source_hash` link each entry to its operational row and
  detect later changes (bridge writes compensating entries, never rewrites).
- `kind` (owner-facing label) + `stream` (service | workshop | sales | payroll | overhead |
  owner | tax | financing | operations) classify each entry.
- `occurred_at` is the economic date. Month bucketing is always **Asia/Manila**
  (`monthKeyManila`), never the container's UTC zone.

### Posting rules (built by pure helpers in `src/lib/accounting.ts`)

| Event | Dr | Cr |
| --- | --- | --- |
| Owner draw | Owner Draws | Wallet |
| Personal expense (business money) | Owner Personal | Wallet |
| Owner contribution | Wallet | Owner Capital |
| Transfer between own wallets | Wallet B | Wallet A |
| Business expense (paid) | Expense category | Wallet |
| Business expense (unpaid) | Expense category | Accounts Payable |
| Pay a payable | Accounts Payable | Wallet |
| Other income | Wallet | Other Income |
| Loan received | Wallet | Loan account (owner-created liability) |
| Loan payment | Loan (+ Interest & Bank Fees on the interest part) | Wallet |
| VAT / tax payment | VAT Payable | Wallet |
| **Service invoice billed** (bridge) | Accounts Receivable (total) | Service Revenue (net) + VAT Payable (tax) |
| **Service payment collected** (bridge) | Wallet (by method map) | Accounts Receivable |
| Service expense (bridge) | Expense category | Wallet |
| Payroll payout (bridge) | Payroll Wages | Payroll wallet (default Cash) |
| Project payment (deposit/progress) | Wallet | Customer Deposits Held |
| Project payment after finalize | Wallet | Accounts Receivable |
| Project billing finalized | Deposits Held (Σ payments) + AR (remainder) | Project Revenue (net) + VAT Payable |
| Project cost (paid/unpaid) | Expense category | Wallet / AP |
| Piano cost (acquisition/prep) | Pianos on Hand | Wallet / AP |
| Piano reservation / partial payment | Wallet | Customer Deposits Held |
| Piano payment after completion | Wallet | Accounts Receivable |
| Piano sale completed — revenue | Deposits Held (Σ payments) + AR (balance) | Piano Sales Revenue (net, VAT extracted from the VAT-inclusive price) + VAT Payable |
| Piano sale completed — COGS | Piano Cost of Sales | Pianos on Hand (carrying cost snapshot) |
| Piano sale cancelled (refund) | Customer Deposits Held | Wallet |

**Billing vs. payment (decision #10).** Service invoices post revenue + AR + VAT when
they become real (sent, or first payment — whichever comes first; drafts post nothing).
Payments then reduce AR. Draft→void or post-books invoices never post revenue. The
Overview still shows simple cash numbers (collected / spent) alongside — both views come
from the same journal.

**Pre-books rule.** Events dated before `books_start_date` (set in settings, default:
first day of the current Manila month) are not posted, **except** collections on
pre-books invoices, which post `Dr Wallet / Cr Opening Equity` (money in without
distorting post-books revenue). Extending the start date later picks up newly-qualifying
events on the next sync.

### Balances & reports — always derived

Wallet balance = `opening_balance + Σ signed journal lines`. Account balances, P&L,
equity, VAT payable, and the balance sheet are computed from legs — never stored.
Operational tables remain the AR/deposit sub-ledgers (Receivables page = operational
truth; balance-sheet AR = books truth — the difference is pre-books AR, shown as such).

**Safe to withdraw** = retained profit − draws − personal − unpaid payables − VAT payable
− deposits held − unpaid wages (closed shifts). Advisory only — draws are never blocked.

### Reconciliation — `acc_reconciliations` (core, Phase 1–2)

Manual, per wallet (bank, cash, GCash, Maya, any owner-created account):

- Start: pick account, statement date, statement ending balance.
- The screen lists that account's journal lines up to the statement date; the owner ticks
  the ones that appear on the statement (persisted per line: `cleared_at`,
  `reconciliation_id`).
- Live math: `cleared balance = opening + Σ cleared lines`, `difference = statement
  ending − cleared balance`, plus uncleared in/out (in-transit / outstanding). Completing
  requires difference = 0, or a note to force-close with a discrepancy.
- Completion snapshots statement/book/cleared/difference for history. One open
  reconciliation per account. Completed reconciliations are immutable.

### Controls

- `acc_period_locks` (year + month, unique). Every accounting write calls
  `assertPeriodOpen(occurredAt)` — locked periods reject manual writes; the bridge files
  an `acc_exception` instead of silently skipping. Unlocking is explicit and audited.
- `audit_log` (append-only: table, row, action, before/after jsonb, actor, note) wraps
  every accounting write from day one.
- Voids instead of deletes for journal-linked records (project/piano payments & costs).
  The existing Service module keeps its delete actions — the bridge detects the change and
  writes a compensating entry, listed in the exceptions panel.
- Snapshots: piano sale price + carrying cost frozen at completion; service invoice VAT
  rate already snapshotted; payroll rates snapshotted at clock-in.

---

## 3. Data model (new tables)

Money: integer centavos everywhere (matches `peso()`). Timestamps `mode: "date"`, stored
UTC, Manila day/month boundaries via `startOfManilaDayUTC()` / `monthKeyManila()`.

```
acc_accounts        id, name, type, is_wallet, wallet_kind, system_key (unique),
                    opening_balance_cents, opening_as_of, active, position, notes
acc_journal         id, entry_number (serial), occurred_at, kind, stream, memo,
                    source_type, source_id, source_hash, posted_at, posted_by,
                    reversal_of_id (→ acc_journal, set null), voided_at, void_reason
acc_journal_lines   id, journal_id (cascade), account_id (restrict),
                    debit_cents, credit_cents, line_memo,
                    cleared_at, reconciliation_id (→ acc_reconciliations, set null)
acc_reconciliations id, account_id (restrict), statement_date, statement_ending_cents,
                    status (open|completed), book_balance_cents, cleared_balance_cents,
                    difference_cents (snapshots at completion), started_at, completed_at,
                    completed_by, notes
acc_period_locks    id, year, month (unique together), locked_at, locked_by, note
acc_exceptions      id, source_type, source_id, reason, details, status (open|resolved),
                    resolved_at
acc_settings        id, owner_id (unique), books_start_date, method_map (jsonb),
                    payroll_account_id
audit_log           id, table_name, row_id, action, before, after (jsonb), actor, note, at

projects            + quoted_cents, tax_rate_bps, billing_finalized_at   (additive)
project_items       project_id (cascade), kind (service|part|fee|discount), description,
                    qty, unit_price_cents, position   (quote + approved extras)
project_payments    project_id (restrict), kind (deposit|progress|final), amount_cents,
                    method, reference, received_at, note, voided_at
project_costs       project_id (cascade), category, description, amount_cents, spent_at,
                    vendor, paid_account_id (→ acc_accounts), paid_at, receipt_url, note,
                    voided_at

piano_sales         piano_id (unique, restrict), status (reserved|completed|cancelled),
                    reserved_at, sold_at, price_cents, tax_rate_bps, cost_snapshot_cents,
                    buyer_name, buyer_contact, note
piano_payments      sale_id (cascade), amount_cents, method, reference, received_at,
                    note, voided_at
piano_cost_entries  piano_id (cascade), kind (acquisition|prep|other), description,
                    amount_cents, spent_at, vendor, paid_account_id, paid_at, receipt_url,
                    note, voided_at
```

## 4. Code layout (follows existing conventions)

| File | Role |
| --- | --- |
| `src/db/schema.ts` *(edit)* | ACCOUNTING + PROJECT BILLING + PIANO SALES sections + types |
| `src/lib/accounting.ts` *(new)* | pure domain: enums/labels/tones, system-account spec, posting builders, VAT (exclusive + inclusive extraction), balances, P&L/equity/safe-to-withdraw math, reconciliation math, Manila month keys |
| `src/server/accounting-bridge.ts` *(new)* | idempotent core initialization + posting bridge over service invoices/payments/expenses and payroll payouts |
| `src/server/accounting-data.ts` *(new)* | all reads: overview, accounts, journal feed, receivables, reports, owner money, settings |
| `src/server/accounting.ts` *(new)* | core writes: owner money, expenses, transfers, loans, tax, voids, wallets, settings, locks, reconciliation |
| `src/server/accounting-billing.ts` *(new)* | project billing (items/payments/costs/finalize) + piano sales (reserve/pay/complete/cancel) — each posts the journal inline |
| `src/app/admin/accounting/**` *(new)* | thin pages: fetch → client component |
| `src/components/accounting-*.tsx` *(new)* | flat per-page clients + `accounting-ui.tsx` shared primitives (admin dark theme, `ui.tsx` reused) |
| `src/app/admin/projects/[id]/page.ts` *(new)* | project detail: Billing & costs (+ tasks/labor summary) |
| `src/components/showroom-cost-client.tsx` *(edit)* | widened into Costs & Sale |
| `src/components/admin-shell.tsx`, `owner-shell.tsx` *(edit)* | Accounting nav group + cross-link |
| `src/server/service-data.ts` *(edit)* | Manila month-bucketing fix in `getFinanceReport` (was UTC `to_char`, misbucketing 00:00–08:00 Manila on the 1st) |
| `CLAUDE.md` *(edit)* | route map + conventions updated |

No new npm dependencies. Validation uses the repo's existing runtime guards
(`moneyToCents`, `str`, `oneOf`, `intOr`, `boolOr`, `optionalDate` from `src/lib/service.ts`).
No auth changes — every action calls `requireUser()`; the owner is the only user.

## 5. Reuse / extend / new

**Reused as-is:** the whole service money stack (invoices, payments, AR aging,
`computeTotals`, `jobMargin`, `/service/finance` + toggles, receipts & share links) ·
`service_expenses` · payroll flow (`time_entries` rate snapshots, `payments` payouts) ·
`pianos.priceCents/costCents` · inventory stock value · all conventions.

**Extended (additive):** `projects` (3 columns) · project detail page (new, the board has
none today) · showroom cost page (sale flow) · `getFinanceReport` month fix · shells
(nav group + link) · `CLAUDE.md`.

**New:** everything in §3 + the `/admin/accounting` section + bridge + reports.

## 6. Boundaries and rules

- Service money stays in `/service/*`; the bridge reads it, never writes it.
- Journal-linked records void, never delete. Service deletes produce bridge corrections +
  exceptions.
- Locked periods: manual writes rejected, bridge writes exceptions.
- Personal expenses, draws, contributions, and transfers are equity movements — the P&L
  query cannot include them even by mistake.
- Deposits are liabilities; revenue for projects is recognized at *Finalize billing*, for
  pianos at *Complete sale*, for service at invoice billing — the owner controls each.
- VAT: exclusive for service/project billing (tax on top of subtotal, like
  `computeTotals`); inclusive for piano retail prices (extracted from the price).
- Multi-currency out of scope (PHP only). Receipts remain payment acknowledgements;
  reports are decision support — the accountant confirms anything filed.

## 7. Verification plan

1. `npm run typecheck` and `npm run lint` green.
2. `npx tsx tests/accounting-money.ts` — pure-domain checks: balanced postings, VAT
   extraction, balances, P&L/equity/safe-to-withdraw, reconciliation difference math,
   Manila month keys.
3. `node tests/accounting-flow.cjs` — integration checks against an isolated schema
   (repo's `task-flow.cjs` pattern): core init idempotent, bridge posting + change
   corrections, project billing lifecycle, piano sale lifecycle with snapshots, owner
   money, reconciliation lifecycle, period locks, audit rows.
4. `npx drizzle-kit push` against a real Postgres — schema applies additively.
5. Dev-server smoke test: every accounting page + project detail + showroom cost page
   returns 200 authenticated; seeded service data bridges on first load.
6. `npm run test:service` still green (service domain untouched).

## 8. Implementation order

| Phase | Contents |
| --- | --- |
| **1. Core + reconciliation** | schema · `lib/accounting.ts` · bridge (invoices/payments/expenses/payroll) · Accounting section: Overview, Accounts (+ detail + **reconcile**), Transactions, Owner Money, Settings · audit log · period locks · exceptions |
| **2. Cockpit + reports** | full Overview (streams, AR, deposits, safe-to-withdraw) · equity statement · P&L (accrual + cash view) · cash flow · VAT summary · payroll register · balance sheet · CSV exports · Manila-month fix in `/service/finance` |
| **3. Restoration billing** | project detail page + Billing & costs · items, payments (deposit liability), costs, derived labor, finalize recognition, profitability, voids · receivables incl. projects |
| **4. Piano sales** | Costs & Sale page flow · reserve/deposit · partial payments · complete with snapshots + COGS · cancel/refund · sales register · receivables incl. sales |
| **5. Later (optional)** | `/owner/today` money cards · inventory purchase journaling · budgets |

Each phase ends green on typecheck + lint + tests before the next begins.

---

## 9. Verification evidence (Phases 1–4)

All green as of implementation:

- **Typecheck** — `npx tsc --noEmit` exits 0 across schema, lib, server, and component layers.
- **Lint** — `npm run lint` reports only the 3 pre-existing problems in `owner-today.tsx` /
  `showroom-client.tsx` (present on the base commit; untouched by this work).
- **Domain tests** — `npx tsx tests/accounting-money.ts`: VAT arithmetic (exclusive/inclusive),
  leg builders + balance validation (rejects unbalanced/single/both-sided legs), account
  nature math, equity & safe-to-withdraw, reconciliation math, Manila month keys (incl. the
  UTC-bucketing trap and year boundaries), chart-of-accounts integrity, kind metadata.
- **Integration tests** — `node tests/accounting-flow.cjs` (isolated schema, 315 checks):
  core init + idempotency; owner money incl. void/reversal semantics and reversal-void
  protection; bridge idempotency, method-map remap (void+repost), books-start move,
  invoice void → payment reverts to pre-books; period locks (owner writes refused, bridge
  files exceptions, unlock reposts); project billing (quote, deposits→deposits held, unpaid
  costs→AP, settle, finalize recognition, post-finalize payments, voids); piano sales
  (reserve, deposits, prep costs, legacy carrying cost via Opening Equity, completion with
  frozen snapshots + COGS, cancel with partial refund + forfeited deposit, cancelled-row
  reuse); reconciliation (clear/complete with zero and non-zero difference, cancel,
  duplicate-open block); journal integrity invariants; read layer verified against an
  independently maintained mirror ledger (wallets, AR, VAT, equity, balance sheet balances,
  receivables, payroll register, sales register, project profitability); settings/CRUD.
- **Existing suites** — `service-money`, `service-mock`, and `task-flow` all pass
  (`task-flow` needed `task_assignees` added to its copied-table list — pre-existing gap).
- **Smoke** — `next dev` against a live Postgres: every `/admin/accounting/*` page,
  `/admin/projects/[id]`, and `/admin/showroom/[id]/cost` renders 200 with real content;
  seeded demo data flows through the bridge on first page load.

Bugs found & fixed during verification (all covered by the tests above):

1. `getFinanceReport` month bucketing used UTC `to_char` — now `AT TIME ZONE 'Asia/Manila'`.
2. Piano carrying cost dropped the legacy `pianos.costCents` once any cost entry existed —
   now only a tracked **acquisition** entry supersedes it (prep entries add on top).
3. Cancelled-then-re-reserved piano sales double-counted old deposits on cancel/complete —
   both now count only payments from the current reservation.
4. Forfeited deposits stayed orphaned in Customer Deposits Held on sale cancellation —
   now released to Other Income.
5. Wallet opening balances sat on the asset side with no equity counterpart (unbalanced
   balance sheet) — now mirrored into Opening Equity at create/edit time.
6. Voided-entry lines were excluded from the reconciliation checklist while their reversals
   remained clearable — a wallet with a voided pair could never reconcile. Voided lines are
   now clearable (marked as voided in the UI).
7. Bridge source hashes did not include the resolved wallet, so payment-method remaps never
   migrated old entries off the Unmapped account — hashes now include the wallet id.
