# Admin dashboard cleanup — plan

Scope: `/admin` only (plus small URL-filter support on Projects / Tasks / Inventory). No data-logic, auth or schema changes.
Stack stays: Next.js App Router, Tailwind, existing `card-dark` admin theme.

## Decisions (confirmed with Boss)
- "Unclaimed" = tasks with status `available` only. In-progress/claimed/backlog are counted separately.
- Inquiry action = "Call →" (`tel:`) when a phone exists, plus the existing Resolve. No phone → "Open →" scrolls to the inquiries card.
- Sidebar keeps "Client Curator"; add "Showroom". Sidebar already shows at >=1024px (#10 was mostly done).

## Milestones (each is testable)
1. **Shared terms + helpers** — `src/lib/dashboard.ts`: `pluralize`, `pianoLabel` (hides "N/A"), task counters (unclaimed / in progress / overdue). Unit tests (`tests/dashboard-helpers.ts`).
2. **URL filters (read-only UI)** — `/admin/inventory?low=1`, `/admin/projects?stage=<key>`, `/admin/tasks?status=available|overdue`. Reads `searchParams` only; no query/data changes.
3. **Dashboard layout** (`admin-dashboard.tsx`):
   - Header pills become links (project / unclaimed tasks / low stock / new inquiries), pluralised, hover + focus states, wrap cleanly at 390px.
   - Under greeting: top-3 actions (New Project, Add Project Update, Create Task) + "More actions" menu (rest, incl. client-portal link).
   - **Needs attention** card: clients awaiting update, low-stock items (names listed), overdue tasks, waiting on parts, new inquiries. Rows with 0 are hidden; all 0 -> "All clear — nothing needs you right now." Each row has an action button (Post update / View stock / Open task / Call / Review).
   - Labor: compact one-row when nobody is clocked in ("0 on the clock · ₱0/hr · 0 in progress · Open Live Monitor →"), full card when someone is. "Today at the shop" merged into it; stale threshold becomes a small caption.
   - Inquiries card absorbs "Inbox zero check"; empty cards (inquiries, completions, overdue, parts) collapse into one "Nothing pending: …" summary line at the bottom.
   - Projects by stage: stages with count>0 bright/bold, 0 dimmed, each row a link to `?stage=`; "All" link min 44px; client name shown in full (ellipsis + `title` only if truly long); "Elma piano" without "N/A".
4. **Nav + contrast** — add Showroom to sidebar; lighten small grey labels (admin theme token for small labels, >= 4.5:1), less letter-spaced uppercase on long labels.
5. **Verify** — typecheck, lint, tests; Playwright at 390px + 1280px with mock data (empty state, busy state, all-clear state); screenshots; no horizontal scroll; Needs attention + top 3 actions visible on 390px without long scroll.

## Delegation
Build milestone 3-4 via `frontend-developer`; review via `code-reviewer` after.

## Not doing / limits
- Can't test against your real data (no DB here) — mock data only.
- Not touching `/api/live`, login/PIN, sessions, or any server action.
