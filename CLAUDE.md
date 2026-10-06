# Herrero Pianos — Project Context

Piano atelier business app: public marketing site + showroom, admin back-office (projects/tasks/workers/inventory/payroll), a personal "owner workspace" (calendar/tasks/inbox), a **home service workspace** (in-home scheduling, time, and finance), a client portal, and a workshop kiosk for technicians.

## Smart Auto-Routing (Developer Workflow)

**The new way: just tell Claude what you need, Claude picks the right specialist.**

Instead of manually specifying agents ("use code-reviewer", "invoke frontend-developer"), you can now give simple instructions and Claude automatically:

1. **Inspects** the codebase to understand the affected area
2. **Routes** to the correct specialist(s) and skills
3. **Implements** the change following project conventions
4. **Verifies** using appropriate checks (browser test, typecheck, lint, etc.)
5. **Reviews** via independent review agent if needed
6. **Reports** what changed and how it was verified

### How to Use It

**Simple requests work inline:**
- "Fix this typo"
- "Update this component label"
- "Rename this variable"

**Complex requests auto-route:**
- "Improve the projects page" → frontend-developer + design skills
- "Fix workshop clock out" → debugger + systematic-debugging
- "Add invoice management" → postgres-pro + backend-developer + frontend-developer + security-auditor
- "Optimize this query" → postgres-pro + postgresql-optimization

**You don't need to specify which agent or skill to use.** Claude's tech-lead orchestrator analyzes the task and delegates appropriately.

### Routing Rules (Quick Reference)

| Task | Primary | Skills | Verify |
|------|---------|--------|--------|
| UI / component change | frontend-developer | react, nextjs, design as needed | browser test, typecheck, lint |
| Backend / Server Action | backend-developer | security if sensitive | typecheck, lint, tests |
| Database / query | postgres-pro | drizzle, optimization as needed | schema safety, tests |
| Bug / failure | debugger | systematic-debugging | reproduce fix, verify |
| Auth / security | security-auditor | security-best-practices, threat-model | allowed/denied paths |

**Full routing matrix**: See `.claude/ROUTING.md` for detailed decision tree, risk levels, and examples.

**Orchestrator details**: See `.claude/agents/tech-lead-orchestrator.md` for the full workflow, guardrails, and when to ask the user.

## Stack
- Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS 4 (`@theme` tokens in `src/app/globals.css`)
- Drizzle ORM + Postgres, schema in `src/db/schema.ts`
- Docker Compose: `db` (Postgres) + `web` (Next.js). Rebuild with `docker compose up -d --build web`, host port **9847**.
- Auth: DB-backed httpOnly session cookies (`src/lib/auth.ts`), **not JWT** — keep it that way unless explicitly asked to change.

## Installed skills (`.claude/skills/`)
Reviewed and installed from aitmpl.com — use proactively when relevant, no need to ask before invoking.

**Frontend / framework:**
- `senior-frontend` — React/Next.js/TypeScript/Tailwind component work, performance, bundle analysis
- `react-best-practices` — React/Next.js rendering, hydration, re-render, server-cache rules
- `react-component-performance` — diagnose and fix slow-rendering React components
- `nextjs-best-practices` — App Router principles (Server vs Client Components, data fetching, routing)
- `ui-design-system` / `tailwind-design-system` — design tokens, component variants, design-dev handoff
- `frontend-design` — aesthetic direction, typography, avoiding templated-default UI choices (highest-downloaded skill in the whole catalog, 4,338)
- `web-design-guidelines` — review UI code against web interface best-practice guidelines
- `landing-page-design` — **Part A only** (intake, page structure, conversion copy, SEO/AEO). Its Part B visual rules (fonts, colors, spacing, motion, tagline reveal) are deliberately ignored: they conflict with the public site's ivory & slate theme and the other area themes. The override is written at the top of its SKILL.md.
- `accessibility-auditor` — WCAG/ARIA compliance, keyboard nav, semantic HTML review

**Database:**
- `drizzle-orm-expert` — Drizzle ORM schema design, relational queries, migrations (our exact ORM)
- `supabase-postgres-best-practices` / `postgresql-optimization` — Postgres query/schema/index tuning (applies generally, not Supabase-specific)
- `database-migration` — schema/data migration patterns, rollback strategies, zero-downtime deploys

**Security (defensive only — offensive/pentest skills were deliberately skipped, not applicable to our own app):**
- `security-best-practices` — has a dedicated Next.js/TypeScript web-server security reference
- `vulnerability-scanner` — OWASP-aligned audit, includes a local `npm audit` wrapper script (reviewed, no network exfiltration)
- `supply-chain-guard` — scans installed npm packages against a known-malicious-package list (reviewed, local-only)
- `security-threat-model` — structured trust-boundary/threat-model writeup for the repo

**Infra / testing:**
- `docker-expert` — Dockerfile/Compose optimization, security hardening, container issues
- `webapp-testing` — Playwright-based toolkit for testing/debugging the running app in-browser
- `systematic-debugging` — root-cause tracing / bisection methodology, use before proposing bug fixes

All script-bearing skills above (`vulnerability-scanner`, `supply-chain-guard`, `systematic-debugging`) were read in full before install — no network calls, no telemetry, local static analysis only.

## Installed agents (`.claude/agents/`)
Unlike skills (passive reference docs I read myself), agents are subagent personas invoked via the Agent tool for **delegated, isolated work** — they run with their own context and tool set. 31 installed, reviewed for safety (read-only or standard dev tools, no destructive capabilities):

**Core dev delegation:** `frontend-developer`, `backend-developer`, `fullstack-developer`, `expert-nextjs-developer`, `typescript-pro`, `code-architect`, `code-explorer`, `code-reviewer`, `debugger`, `context-manager`, `performance-profiler`, `dependency-manager`, `unused-code-cleaner`

**Testing:** `test-generator`, `test-runner`, `test-automator`, `accessibility-tester`, `performance-engineer`, `web-vitals-optimizer`

**Database:** `postgres-pro`, `database-architect`, `database-administrator`

**Security:** `security-auditor`, `api-security-audit`, `incident-responder`

**Ops / API / docs:** `deployment-engineer`, `devops-troubleshooter`, `api-designer`, `technical-writer`, `api-documenter`, `changelog-generator`

**Commitment: actually use these, not just have them installed.** When a task is large enough to isolate (a full audit, a big isolated feature, a dedicated test-writing pass, a focused review) rather than a quick inline edit, spawn the matching agent via the Agent tool instead of doing it all inline — that's the point of having them.

**Hard triggers — dispatch, don't default to inline fixes:**
- **Any visual/UX/copy change** (new section, restyle, palette change, card layout, wording a user will read) → load `frontend-design` (and `web-design-guidelines` if reviewing existing UI) first, then delegate the build to `frontend-developer` or `code-architect` for anything touching more than one component. Flag naming/copy/structure decisions to the user *before* shipping them, not bundled into the post-build summary.
- **Any bug whose root cause isn't immediately obvious** (not a typo/one-line fix) → `debugger` agent, following `systematic-debugging`'s root-cause-before-fix approach, instead of guessing-and-patching inline.
- **A confusing/awkward-feeling result the user flags** ("this looks off", "wtf") → treat as a real signal, investigate via the matching skill/agent rather than a quick unreviewed tweak.
- Default to dispatching even when the inline fix looks fast — the point is using the installed roster, not just having it available.

**Deliberately not installed, with reason** — every one of aitmpl.com's 29 categories was opened and its listing (title+description) reviewed; full content was only read for skills actually installed:
- Git skills (`commit-smart`, `find-bugs`, `deslop`, etc.) — a git repo now exists (branch work happens on `claude/*` branches); revisit if wanted.
- `playwright-skill` / `browser-automation` (utilities) — redundant with `webapp-testing`, already covers this.
- Offensive/pentest security skills (SQL injection, XSS exploitation, WordPress/SSH/cloud pentest, red-team tooling) — for authorized penetration-testing engagements against *other* systems, not for defending our own app.
- Planning/meta skills (`plan-writing`, `think-tank`, `requirements-clarity`, `skill-creator`, `using-superpowers`, etc.) — overlaps with Claude Code's native plan mode; adding parallel process skills risks conflicting instructions rather than adding value.
- `ai-maestro`, `ai-research`, `curviate`, `workflow-automation` — separate agent/orchestration/LinkedIn-automation platforms requiring their own external CLIs; not applicable (this was the "do we need an orchestration tool" question — answer stays no).
- SEO skills (`seo-optimizer`, `seo-audit`, etc., under business-marketing) — genuinely could help the public marketing site's Google visibility, but that's a business-priority call for the user to make, not a default install.
- Everything under analytics, business-marketing (rest), career, doordash, enterprise-communication (rest), marketing, media, open-banking-io, operations, pocketbase, railway, scientific, sentry (rest), sports, video, web-data, most of document-processing — different tech stacks/platforms/business functions unrelated to this project (Shopify, Railway, PocketBase, Sentry, DoorDash, EU banking APIs, spreadsheet/PDF/PPTX generation — we have built-in equivalents — video editing, resume writing, academic research, sales/marketing ops, etc.).

## Route map
- `/` — public marketing site + showroom (`src/components/public-site.tsx`)
- `/admin/*` — back-office (dashboard, projects, tasks, inventory, workers, curator, monitor/payroll, settings). One role today (`users.role = "owner"`).
- `/owner/*` — the shop owner's **personal** workspace (today/calendar/tasks/inbox/overdue/upcoming/settings) — dark "Personal Workspace" theme, see below.
- `/service/*` — **home service** (in-home visits): today/schedule/jobs/customers/invoices/expenses/time/finance/settings. Its own dark graphite + azure theme (`--color-svc-*`), its own tables (`service_*`), and its own field crew (`service_technicians`, separate from the workshop `workers` roster). See `SERVICE_WORKSPACE_PLAN.md`.
- `/portal/[uuid]` — private client-facing restoration journal, no login (secret UUID link)
- `/os/*` — **Growth OS** (owner-only): today/customers/growth/work/settings. Code in `src/components/gos/`, `src/server/gos/`, `src/lib/gos/`, tables in `src/db/gos-schema.ts` (`gos_*`); `/os/work` and `/os/growth` are placeholders. See `docs/ARCHITECTURE.md`.
- `/workshop` — PIN-based kiosk for technicians (clock in/out, claim tasks, breaks) — separate auth from `users` (uses `workers` table + signed cookie, not session table)

## Code layout convention
- `src/app/**/page.tsx` — thin: fetch data, pass to a client component. No business logic here.
- `src/components/{area}-*.tsx` — flat-file-per-page components, prefixed by area (`owner-*`, `admin-*`). Shared pieces live in `owner-ui.tsx` / `ui.tsx`.
- `src/server/data.ts` — all **reads** (queries), grouped by domain with comment headers. Home service reads live in `src/server/service-data.ts` to keep this file readable.
- `src/server/{admin,owner,workshop,service,public-actions,auth-actions}.ts` — all **writes** (Server Actions, `"use server"`), one file per area. Every mutation calls `requireUser()` (admin/owner) or reads the worker cookie (workshop) as its own auth check.
- `src/lib/` — pure helpers: `dates.ts`, `format.ts`, `security.ts` (hashing/signing), `config.ts` (enums/label maps/priority styles), `env.ts` (startup env validation), `rate-limit.ts`.

## Known gotchas (already fixed — don't reintroduce)
1. **`init-db.sh` seeding must stay idempotent.** `src/db/seed.ts` checks `if (existing user) skip seed` before doing anything. If you ever touch seed.ts, preserve that guard — without it, every container restart wipes all real data (this was a real bug, fixed once already).
2. **`public/` folder must be copied in both Dockerfile stages** (`COPY public ./public` in builder *and* runtime stage). Static assets like `/img/hero.jpg` 404 silently otherwise.
3. **Timezone**: the Docker container runs in UTC, but the business is Asia/Manila (UTC+8). Any "today" boundary logic (e.g. daily timesheets) must use `startOfManilaDayUTC()` from `src/lib/dates.ts` — plain `new Date().setHours(0,0,0,0)` uses the *container's* timezone and silently misclassifies days.
4. **After any rebuild, use a fresh browser tab** when testing — a tab left open across a rebuild can hold stale Server Action references and cause confusing double-submits / phantom mutations. Always verify in a newly opened tab.
5. **`/api/live`** requires a session (`getUser()` check) — don't remove it; it was a real unauthenticated data leak before the fix.

6. **Schema changes need a manual migration on the live DB.** Vercel runs `next build` only; `drizzle-kit push` runs in Docker (`init-db.sh`), not on Vercel. Any new column in `src/db/schema.ts` must also get an additive, idempotent SQL file in `drizzle/manual/` (see its README) that the owner pastes into the live database *before* the deploy is used.

## Personal Workspace design system (`/owner/*` only)
Dark, premium theme — deliberately different from the rest of the app. Tokens live in `src/app/globals.css` under `/* ---- Personal Workspace (premium dark) ---- */` (CSS vars prefixed `--color-ow-*`) plus reusable classes `.card-ow`, `.input-ow`, `.btn-ow-primary`, `.chip-ow`, `.ow-divide`, `.ow-shell`, `.ow-sidebar`.
- Background: deep charcoal-navy (`--color-ow-bg` `#10141b`), surfaces one step lighter (`--color-ow-surface` `#171c25`).
- Accent: muted teal (`--color-ow-accent` `#4fb8ab`) for primary actions/active nav — used sparingly.
- Secondary hues: muted blue (`--color-ow-blue`), muted violet (`--color-ow-violet`), muted rose (`--color-ow-rose` for danger/overdue).
- **Hard rule: no brown, beige, or yellow/amber anywhere in this theme** (explicit user requirement) — this also applies to `CATEGORY_COLORS` in `src/lib/config.ts`, which owner categories/calendar event tints pull from. If you add new status colors, stay within the teal/blue/violet/rose/slate family.
- The **home service workspace** (`/service/*`) has a fourth theme: `--color-svc-*` tokens with `.card-svc` / `.input-svc` / `.btn-svc-primary` / `.chip-svc` classes. Deep graphite + azure/emerald, deliberately distinct from the Personal Workspace's teal.
- Admin (`/admin/*`) has its own separate, older theme (`card-dark`/`card-light`, `bg-ink` etc.) — don't apply Personal Workspace tokens there, and don't apply admin's accents to the Personal Workspace.
- The **public site** (`/`, `/showroom` and `/portal/[uuid]`) has its own theme: **ivory & slate** — warm ivory page (`--color-paper` `#f4efe8`), linen bands, slate `#474853` dark bands (hero, "Voices", footer), **terracotta `#844D36`** button fill (white text) / text accent, sky blue `#86B3D1` and olive `#8E8268` as small accents (decoration only — olive fails contrast as text). Fonts: **Fraunces** (headings, prices) + **Instrument Sans** (body), loaded via `src/lib/pub-fonts.ts` (not the root layout). It is **scoped**: the tokens are redefined only inside `.pub-theme` (every public page root uses `PUB_ROOT`), and `.pub-dark` flips them for dark bands, so components just use `text-ink` / `text-subtle` / `text-gold` / `bg-paper`. Never change the base `:root` tokens (`--color-paper`, `--color-gold`, …): admin, owner and service share them. Section labels use `.pub-kicker` (sentence case + short rule), not tracked all-caps. Three separate systems — don't mix with the Personal Workspace palette or admin's theme.

## Workflow notes
- User prefers me to test changes live (Docker rebuild + browser pane) rather than just asserting they work — always verify before reporting done.
- Git repo exists (GitHub). Cloud sessions develop on `claude/*` branches; don't open PRs unless asked.
- `docs/ARCHITECTURE.md` is the up-to-date map of areas, tables, data flow and complexity hotspots. Older briefs are in `docs/archive/`.
- When large/ambiguous feature requests come in, ask scoping questions before implementing (esp. for anything touching money/payroll or auth) rather than guessing.
