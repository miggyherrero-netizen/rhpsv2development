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
| 3 | **Edit paid records** | Edit invoice items, payments (amount/date/method), expenses after they are paid, with a required reason; totals/status recompute automatically | uses phase 2 | planned |
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
