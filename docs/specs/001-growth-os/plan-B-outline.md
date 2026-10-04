# Plan B (outline for approval): Customers, Add inquiry, Reply

**Spec:** `spec.md` (Approved v1.0) · **Builds on:** Step A (merged, PR #1)
**Status:** DRAFT. Waiting for Robert's "sige" before any code.

## Goal
Robert taps **+ Add inquiry**, a customer is saved as **New**, he copies a ready reply, marks it **Replied**, can mark **Lost** with Undo, and finds any customer in 2 seconds.

## Scope (proposed)
| Story | ACs | In Step B? |
|---|---|---|
| 2 Add inquiry | AC-2.1 – 2.13 | Yes (AC-2.12 repeat-customer link only links to customer; piano link waits for Step C) |
| 3 Reply | AC-3.1 – 3.11 | Yes (Send kit: Copy, Open Inbox, "Did you send it?", Undo 10 s, Lost) |
| 13 Customers + search | AC-13.1 – 13.9 | Yes (list, record, search, duplicates, merge, delete, reopen) |
| 9 Today (Reply first only) | part of AC-9.1–9.3 | Only "Reply first" + red badge for overdue replies; other sections come in Step D |

Not in B: quotes (C), visits (C), payments (C), pianos (C), full Today (D), Growth numbers (E).

## New tables (all `gos_`, centavos/UTC timestamps)
- `gos_customers`: id, name (≤60), phone (optional), area, status (New/Replied/Quoted/Booked/Completed/Paid/Lost), came_from, ad_id → `gos_ads`, no_ad_tag flag, note (≤500), lost_reason, status_before_lost, replied_at, created_at, updated_at, not_duplicate_of
- `gos_activity`: id, customer_id, kind, detail jsonb, created_at, undone_at (powers the Activity log and Undo)

## Phases (test first in each)
0. Pure logic + unit tests: status transitions (R3 subset), reply due time (R4), name normalize + duplicate match, fuzzy search ("maira" finds "Maria"), template fill (area line dropped if empty).
1. Schema + migration + server actions (owner-only, zod): add, markReplied, undoReplied, markLost, reopen, undo, merge, delete, search.
2. Send kit component: copy, clipboard-blocked fallback, "Did you send it?" on return within 30 min.
3. Add-inquiry sheet: phone bottom sheet / desktop 480px panel, discard check, 60/500 limits, no-internet and server-error keep typing, duplicate prompt.
4. Customers list + record page (Activity, Next step card).
5. Today "Reply first" + red tab badge.
6. Verify: unit tests, typecheck, build, eslint on new files, browser run (320/375/1280), existing `npm test`.

## Questions for Robert (these change the build)
1. **Phone number:** save it as plain text in the database (needed for tap-to-call, AC-13.8). OK?
2. **Open Inbox:** which link? Facebook Business Suite inbox URL for your page. Please send the link, or I use `https://business.facebook.com/latest/inbox` as a default.
3. **Ad list in the form** comes from Settings ad names (Photo 01, Creative 02 Grand, Creative 03 Upright). OK, or do you want different names now?
