# Finance plan: balance, reconcile, and edit freely (with history)

Owner goal (2026-10-07): reconcile the Home Service books so they balance, and be able to **edit finance records freely**,
including already-paid ones, without losing the paper trail. Chosen scope (owner's answers):

- Edit: **invoices / payments / expenses even when paid**, plus **adjustment entries (+/-)**.
- Reconcile: **payments vs invoices**, **GCash / bank statement vs payments**, **expenses vs receipts**.
- First step: **health check** (read-only) before any editing feature.

Business facts that shape the rules: not VAT-registered (VAT feature stays, row hidden when 0), money is integer cents,
Asia/Manila timezone, invoice statuses `draft | sent | partial | paid | void`.

## Principles (money rules)
1. **Nothing is ever lost.** Every edit/adjustment writes an immutable history row (who, when, field, before, after, reason).
2. **Derived numbers are recomputed, never typed.** Totals, balance, status come from items and payments through one function (`computeTotals`).
3. **Freedom with a reason.** Editing a paid/closed record is allowed but asks for a short reason; it is saved in the history.
4. **Adjustments over rewrites** when the change is a correction after the fact (+/- line with a reason), so the original stays visible.
5. **Every phase ships with tests** in `tests/` proving the books still balance (`npm run test:service`, `test:finance-audit`).
6. **Schema changes need a manual migration** (CLAUDE.md gotcha 6): additive, idempotent SQL in `drizzle/manual/`, pasted into the live DB before use.

## Phases
| # | Phase | What the owner gets | Schema change | Status |
|---|---|---|---|---|
| 1 | **Health check** | A read-only page that lists every record that does not balance (invoice totals, paid vs payments, status vs money, job drift, expense gaps, duplicates) | none | in progress |
| 2 | **History (audit trail)** | A `service_finance_history` table + a helper every money action writes to; a "History" panel on invoice/payment/expense | new table + SQL | **built** — paste `drizzle/manual/09_finance_history.sql` into the live DB (safe to run twice). Until then everything still works; edits just are not recorded and the History panels say so |
| 3 | **Edit paid records** | Edit invoice items, payments (amount/date/method), expenses after they are paid, with a required reason; totals/status recompute automatically | uses phase 2 | **built** (invoices, lines and payments; expenses already editable with history, no reason prompt) |
| 4 | **Adjustment entries** | "Add adjustment (+/-)" on an invoice or the books, shown as its own line, included in totals and reports | new table + SQL | planned |
| 5a | **Payments vs invoices** | Reconcile view built on phase 1 findings with one-click "open record" and a fixed/ignored state | maybe small table | planned |
| 5b | **GCash / bank statement vs payments** | Paste or upload a statement (CSV), auto-match to recorded payments by amount/date/reference, list unmatched on both sides | new tables + SQL | planned |
| 5c | **Expenses vs receipts** | Flag expenses without a receipt or amount mismatch, attach/replace receipts | maybe column + SQL | planned |

## Agents and skills
| Work | Use |
|---|---|
| Data design (history, adjustments, statements) | `database-architect`, `postgres-pro` + skills `drizzle-orm-expert`, `database-migration` |
| Finance logic and server actions | `backend-developer` / `fullstack-developer` |
| Safety review of every money change | `security-auditor`, skill `security-best-practices` |
| Proving the books balance | `test-automator`, `systematic-debugging` |
| Finance screens | `frontend-developer` + `ui-ux-pro-max` |
| Statement import / export to spreadsheet | skill `xlsx` |

## Open decisions (defaults used until the owner says otherwise)
- Editing needs a reason note: **yes**. History is permanent and cannot be edited: **yes**.
- Deleting a paid invoice or a payment: keep allowed only through **void**, not hard delete.
- Who can edit finance: the existing finance role gate (`canViewFinance`); owner only for edits on closed periods.
- Statement formats to support first: GCash CSV export and generic bank CSV (date, amount, reference).

## Phase 2 notes (built)
- Table `service_finance_history` is insert-only (no update/delete code path), has no foreign keys so rows survive deletes, and stores `{ field: { from, to } }` with money in whole centavos. `reason` is reserved for phase 3.
- Written by `recordFinanceHistory` (`src/server/service-finance-history.ts`, not a server action) AFTER each money write, best-effort: a failure or a missing table is logged and never breaks the action.
- Wired: create invoice (and from job), update invoice, add/update/delete invoice line, invoice status, record/delete payment (plus the automatic invoice status change they cause), delete invoice, create/update/delete expense. Not recorded: `setExpenseKinds` (bulk review) and the job-level timeline, which keeps its own events.
- Shown as a "History" section on the invoice page and a History button per expense row (owner only).
- Pure logic + tests: `src/lib/service-finance-history.ts`, `tests/service-finance-history.ts` (`npm run test:finance-history`).

## Phase 3 notes (built): editing paid and part-paid invoices
Pure rules and tests: `src/lib/service-finance-edit.ts`, `tests/service-finance-edit.ts` (`npm run test:finance-edit`, in `npm run test:domain`). Database scenario (local Postgres only, throw-away database, not in `npm test`): `DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-finance-edit-db.ts`.

Rules
1. **Reason**: once an invoice has any payment or is paid / part-paid (`needsReason`), every change needs the owner and a written reason (3-500 characters), checked on the server after the invoice is locked and re-read. Draft / sent invoices with no payments stay free, no reason, exactly as before.
2. **One lock, one recalculation**: all invoice, line, payment and status writes run in `withInvoiceLock` (`src/server/service-invoice-core.ts`): one transaction, `SELECT ... FOR UPDATE` on the invoice row, then `recalcInvoice(tx, id)` which uses the pure `computeInvoiceState`. Write logic lives in `src/server/service-invoice-ops.ts`; the Server Actions in `service.ts` only authenticate and revalidate.
3. **History in the same transaction** for reasoned edits (`recordFinanceHistoryStrict`): if the history row cannot be written (including a missing `service_finance_history` table) the whole edit rolls back and the owner sees a clear message. Unpaid edits keep the old best-effort history.
4. **Never overpaid**: `recordPayment`, `editPayment` and any line / discount / tax edit or line delete that would leave payments above the total are rejected and rolled back. Discount above subtotal is rejected (always when typed as a discount; on line edits only for invoices that already carry money). An invoice that was already overpaid before this phase can still be fixed or have notes edited, but never made worse.
5. **Recording a payment is deliberately lighter**: `recordPayment` needs no reason and its history row stays best-effort (written after commit), same as before phase 3. It still runs under the invoice lock and can never overpay. Only changing or removing money already recorded needs a reason, and `editPayment` / `deletePayment` ALWAYS require a valid reason with strict history, whatever the invoice status.
6. **Payments**: `editPayment` changes the SAME payment row (amount, date, method, reference, note) and never adds an adjustment. `deletePayment` stays as the owner correction path (owner + reason; the history row keeps amount, method, date, reference, note). Void invoices cannot be edited at all.
7. **Status and dates**: `paidAt` is the latest payment date once the invoice is paid, otherwise empty (it used to be the time of the last recalculation). `sentAt` is never touched by edits. The linked job goes `invoiced -> paid` when the invoice becomes paid and `paid -> invoiced` when it stops being paid (only on that real transition; other job statuses are never touched).
8. **Delete**: an invoice with any payment (or paid / part-paid) cannot be deleted; void it instead. Void and reopen on an invoice with payments need owner + reason.
9. **UI**: Edit payment modal on each payment row; "Edit lines" on an invoice with payments asks for the reason once and saves it with every line change until "Done editing"; "Edit invoice details" shows a required reason field; History shows the reason under each entry.

Hardening (review fixes): a reason needs at least one letter or digit (zero-width characters are stripped); quantity is clamped to 1-9,999, a line may not exceed PHP 20,000,000, tax rate is clamped to 0-100%, and a database overflow (22003) returns "Amount too large" instead of crashing; the job status sync is conditional, so a job that was cancelled or put on hold meanwhile is never overwritten; unknown invoice statuses are rejected (they used to fall back to "draft" and clear `sentAt`) and "sent" on a void invoice needs a reopen first; UI actions that throw show "Could not save. Try again."

Known limits
- `computeTotals` is unchanged (the whole discount comes off the taxable base, so a discount above the taxable part gives 0 tax). Documented in the tests.
- Line edits autosave, so one reason covers a whole editing session; each saved change is its own History row carrying that reason.
- `service_payments` has no "voided" flag, so a payment correction is an edit or a delete (both audited); there is no soft-delete.
- Expenses keep their phase 2 edit + history (no reason prompt). `setExpenseKinds` and the job-level timeline are still not in History.
- Old rows whose stored `status` disagrees with their payments (e.g. a "sent" invoice with payments) are corrected the next time anything on the invoice is saved.

## Job cost rules (R1 + R2 + F, owner decision 2026-10-08)
The job page margin and the Finance per-job margin both use `jobCostBasis` (`src/lib/service-job-cost.ts`) and then `jobMargin`.
1. **R1** - a part line with no explicit cost costs 0 (it used to cost its selling price). An explicit cost still wins (qty x cost).
2. **R2** - if a counted expense on the job is Materials or Parts, the cost of PART lines is ignored and the expenses win (no double counting). Fee/service line costs always count. The job page then shows "Parts cost comes from the linked materials/parts expenses."
3. **F** - only expenses of kind `job` (or not yet sorted, kind empty) count in job margin. Overhead and stock expenses linked to a job do not (Finance health shows this as an info note).

Part cost is computed from the job lines at read time, not from the stored `service_jobs.parts_cost_cents` (still kept up to date on every write, with the new rule). Old rows hold the old selling-price value: run `drizzle/manual/10_recalc_job_parts_cost.sql` (optional, idempotent, derived column only) to clear the Finance health "Job parts cost differs from its lines" warnings. The old check "Parts and expenses may be counted twice" is removed.

Backfill alternative to the SQL file: `npm run backfill:job-parts-cost -- --dry-run` prints job no., old value and new value; `-- --apply` writes (one transaction, only `parts_cost_cents`, idempotent). It uses the same `partsCostFromLines` as the save path and the Finance health check.
