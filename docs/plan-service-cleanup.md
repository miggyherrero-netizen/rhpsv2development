# Home Service (`/service/*`) cleanup — plan

Scope: `/service/*` only. **Do not touch** `/admin` or `/owner`. No stored-data changes, no deletes, **no schema migration**.
Keeps the dark graphite + azure `svc-*` theme.

## Decisions (confirmed with Boss)
- **Drafts are excluded everywhere** from Outstanding, unpaid, AR aging, "Invoiced", customer "billed" and collection rate. Voids too. Drafts are shown separately: `N drafts · ₱X not yet sent`.
- **Finance range** (This month / Last 90 days / This year / All time, default **Last 90 days**) drives Invoiced (by issue date), Collected (by payment date), Expenses (by spent date), Net, the chart and "By category". **Outstanding / AR = balance as of today** (labelled "as of today"), not range-dependent.
- **Trip/Batch** customer type is stored in the existing `tags` jsonb (e.g. tag `type:batch`) — no migration.
- **Job title**: heuristic only, display-only. Title ≤5 chars with no space, or short ALL-CAPS → heading shows the job type ("Tuning"), original title stays as a small sub-line. Nothing rewritten in the DB.
- **Customer names**: Title Case *on save* for new/edited names; existing names are **displayed** in Title Case without rewriting data. Only fully lower/UPPER-case names are transformed; mixed-case ("McDonald", "dela Cruz" handled, "Atty.", "BDO") left alone.

## Already in place (not redone)
- Desktop ≥1024px sidebar with Home Service sections + links to Piano Management / Personal Workspace (`service-shell.tsx`).
- Recalls exist on Today (moved to the top).

## Milestones
1. **Pure calc layer + tests** — `src/lib/service-reports.ts` (+ `tests/service-reports.ts`, registered in `run-tests.mjs`):
   `isCountable(inv)` (not draft, not void), `outstandingSummary`, `draftSummary`, AR aging via countable only, `resolveRange(range, now)` in Manila time, `inRange`, `needsClosing(job, now)`, `titleCaseName`, `looksAbbreviated`, `jobHeading`, `quoteLabel` ("No quote").
2. **Data layer** (`service-data.ts`, read-only changes): customers outstanding/billed exclude drafts; Today stats + `unfinishedJobs`, `followUpInvoices`, drafts summary; Finance takes `range`; expense-by-category takes `range`.
3. **Finance + Expenses UI**: range picker, tiles labelled with range, cashflow chart with y-axis/gridlines + tooltips, merge duplicate "This month"/"Shown" tiles, category breakdown follows range.
4. **Today + Jobs**: sections at top (Unfinished, Invoices to follow up, Recalls due), clickable Outstanding tile → `/service/invoices?filter=open`, zero tiles collapsed to one line, "Needs closing" badge, "No quote". Jobs filter chips: Open / Scheduled / Completed / All + "More ▾".
6. **Invoices + Customers**: no horizontal scroll on desktop (tight columns, truncated description with tooltip), cards on mobile, drafts line; customers sort (name / billed / last job), equal-height cards, Trip/Batch type, "Link piano" prompt on jobs without a piano.
7. **Nav + naming + type**: mobile bottom tab bar (Today, Schedule, Jobs, Invoices, More), "Schedule" used everywhere (heading too), tabular sans numerals for data values (serif only for page headings), no orphan tiles (3-col / last tile spans).
8. **Settings + Calendar + Contrast**: sticky "Save changes" bar only when dirty + beforeunload / link-click guard, unit prefixes/suffixes inside inputs, VAT-dependent options disabled when "Charge VAT" is off; calendar time labels ("10 AM", no wrap); lighter small labels/table headers (>=4.5:1), filter chips >=36–44px.
9. **Verify** — typecheck, lint, all tests; Playwright with mock data at 1280px + 390px (busy / empty states); axe; independent `code-reviewer` pass.

## Delegation
Milestones 3–8 UI work reviewed by `code-reviewer`; accessibility pass via axe.

## Not doing / limits
- Cannot test with real data (no DB here) — mock data only; live check only if the proxy allows.
- No data backfill. Titles/names are normalised at display time (and names on future saves) only.
- Number "5 tiles in 2 columns" fixed via layout, not by removing tiles.
