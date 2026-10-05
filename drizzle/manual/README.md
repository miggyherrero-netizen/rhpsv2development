# Manual migrations (live database)

The Vercel deploy only runs `next build` — it does **not** change the database. Before using a deploy that needs a
new column, run the matching file here on the live database (psql, or the Neon / Supabase SQL console).

Run them **in order**. Each one is additive (`ADD COLUMN IF NOT EXISTS`, defaults, no deletes or rewrites) and safe to run twice.

| # | File | Needed by |
|---|------|-----------|
| all | `00_ALL_IN_ONE.sql` | The four files below combined — easiest: paste this one |
| 1 | `01_phase1_inline_lines.sql` | Inline quote/invoice lines: quick-add chips, packages, per-line cost |
| 2 | `02_phase3_expense_kind.sql` | Expense kind (job / stock / overhead), piano link, review screen, Finance split |
| 3 | `03_phase4_status_time.sql` | Status = time (status events derive travel / on-site entries) |
| 4 | `04_phase5_piano_sale.sql` | Piano sale jobs |

Phase 2 (Today command center) needs no schema change.

Each file was checked against a copy of the previous schema, and the result was compared with what `drizzle-kit push`
produces from `src/db/schema.ts` — the tables, columns, types, defaults, indexes and constraints match.
