# Home Service cleanup, round 2 (items 16–28) — plan

Scope: `/service/*` only (do not touch `/admin`, `/owner`). Keep the dark `svc-*` theme (the printable invoice/quote
document stays white paper). **No schema migration** and no stored-data rewrites.

## Decisions (confirmed with Boss)
- **Quotes live on the job** (no new table): a job's line items + quoted amount *is* the quote. Add a printable
  **Quote document** (`QT-<job number>`), **Send quote → Mark accepted → Convert to invoice**. "Accepted" is recorded as a
  job event (`quote_accepted`) + the job moving to Scheduled/ready; quotes never appear in the Invoices list.
- **Job flow buttons also drive time logs**: *Start travel* = status En route + travel timer; *Arrived* = stop travel, start
  on-site timer, status On site; *Complete* = stop timers, status Completed (existing labor/recall logic runs);
  then *Create invoice*. Full status list stays under **⋯ More**.

## Defaults I'm choosing (shout if you disagree)
- **Delete** (job, invoice) moves into a **⋯ More** menu, behind a type-to-confirm dialog (type the job code `WO-…` / invoice
  code `INV-…`). Trash icon removed from the Jobs list; the whole row becomes a link.
- **Payment on a Draft**: prompt "Mark as sent and record payment?" (one click does both) instead of blocking.
- **Dates**: keep the app's display format ("Tue, Sep 15"); inputs use the native date picker and echo the chosen date in
  that format underneath, so the picker and the display can't disagree.
- **Receipt photo**: uses the existing `service_expenses.receipt_url` column; image is downsized in the browser (≤1600px JPEG)
  and stored like the showroom photos; `capture="environment"` opens the camera on phones.
- **Role-based access (#28)**: there are **no crew logins today** (`users.role` is only `owner`), so real RBAC can't be
  tested. I will add a server-side `requireFinanceAccess()` (owner role only) on Finance/Expenses pages, margin data and
  finance-related actions, so a future crew role is blocked by default. "Show Finance in menu" stays menu-only (documented).
- **#26**: the print/PDF route already renders white paper; I'll make the in-page invoice preview match, and add the same for quotes.

## Milestones
1. **Pure logic + tests** (`src/lib/service-reports.ts` / new `service-flow.ts`): next-step state machine
   (status → primary button + side effects), type-to-confirm matcher, due-date from payment terms, quote code/status
   derivation, money-input parsing/format, access check. Tests registered in `tests/run-tests.mjs`.
2. **Server actions** (no new tables): `advanceJob(id)` (status + timers atomically), `acceptQuote`, `createQuoteDocument` data,
   `recordPaymentAndSend` for drafts, `createExpense` with `receiptUrl` + `jobId`, `requireFinanceAccess`.
3. **Job detail**: one primary next-step button, ⋯ More (all statuses, quote actions, delete w/ type-to-confirm). Jobs list: row link, no trash.
4. **Invoice detail**: read-only lines until **Edit** → Save/Cancel + × per line; ⋯ More (void/reopen/delete w/ confirm); payment on draft prompt; white-paper preview.
5. **Forms**: one shared Job form for New + Edit (customer + inline new customer, location + add, piano + add, type, technician default,
   duration, start, travel fee, priority, notes, private notes); New invoice (due = today + terms, multi-line, price-book picker, job link, inline customer);
   Add expense (default now, link to job, receipt upload); ₱ prefix inputs + clear placeholders.
6. **Customer detail page** `/service/customers/[id]`: contact (tap-to-call, Messenger), addresses, pianos, jobs, invoices, balance,
   "New job for this customer", "4 jobs · ₱254,000 billed".
7. **Quotes**: Quote document view + print, send/accept/convert flow, kept out of Invoices.
8. **Settings**: hide "Load sample data" when real data exists (else type `LOAD DEMO`); label each save with its section.
9. **Verify**: tsc, lint, tests, mock-data Playwright at 1280px + 390px, axe, independent `code-reviewer`.

## Not doing / limits
- Mock data only here (no DB); real-data check after deploy.
- No real RBAC testing (no crew logins exist).
- Quotes are not a separate numbered table; if you later want a Quotes list/series, that's a migration decision.
