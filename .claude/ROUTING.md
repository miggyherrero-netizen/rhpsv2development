# Smart Auto-Routing Matrix

Quick reference for determining which agent(s) and skill(s) to use for common tasks in Herrero Pianos.

## By Task Type

### UI / React / Pages / Components

**When**: Need to build, fix, or redesign a page, component, form, or visual element.

**Primary Agent**: `frontend-developer`

**Skills** (select as needed):
- `senior-frontend` — React/Next.js/TypeScript/Tailwind component patterns
- `react-best-practices` — rendering, hydration, re-render optimization
- `nextjs-best-practices` — App Router, Server vs Client Components, data fetching
- `frontend-design` — aesthetic direction, typography, design decisions (load first for visual redesigns)
- `ui-design-system` / `tailwind-design-system` — design tokens, component variants
- `web-design-guidelines` — review against web interface best practices
- `accessibility-auditor` — WCAG/ARIA compliance (if major redesign or accessibility-critical)
- `react-component-performance` — diagnose slow components
- `webapp-testing` — browser automation to verify changes

**Independent Review**: `code-reviewer` if substantial (touches multiple components, refactors layout, new patterns)

**Verify**: Browser test if observable, typecheck, lint

---

### Backend / Server Actions / APIs / Business Logic

**When**: Need to build, fix, or refactor a Server Action, business logic, or API endpoint.

**Primary Agent**: `backend-developer`

**Skills** (select as needed):
- `security-best-practices` — if touching auth, sessions, sensitive data, or input validation
- Relevant domain skill if the logic is complex (e.g., postgres-pro for query-heavy business logic)

**Independent Review**: `code-reviewer` after implementation (especially if touching auth, payment, or data mutations)

**Verify**: Typecheck, lint, targeted Server Action tests, replay scenarios in browser

---

### Database / Drizzle ORM / PostgreSQL

**When**: Need to design, modify, or optimize the database schema or queries.

**Primary Agent**: `postgres-pro`

**Skills** (select as needed):
- `drizzle-orm-expert` — Drizzle schema design, relations, queries
- `postgresql-optimization` — query optimization, indexes, performance tuning
- `database-migration` — migration safety, rollback strategies, zero-downtime deploys

**Independent Review**: `code-reviewer` if substantial schema changes

**Verify**: Schema consistency, migration safety, affected queries, existing record compatibility

---

### Bugs / Failures / Production Issues

**When**: Need to diagnose and fix unexpected behavior.

**Primary Agent**: `debugger`

**Skills**:
- `systematic-debugging` — root-cause tracing, bisection, hypothesis testing

**Workflow**:
1. Inspect code and logs
2. Reproduce the failure if possible
3. Form hypotheses about the root cause
4. Test hypotheses systematically
5. Fix the root cause (not symptoms)
6. Verify original failure is resolved
7. Check for regressions

**Independent Review**: `code-reviewer` if fix touches sensitive logic (auth, payroll, client data)

**Verify**: Reproduce original failure, confirm fix resolves it, run affected tests

---

### Security / Authentication / Authorization / Sensitive Data

**When**: Changes involve auth, secrets, sessions, worker PINs, client/payroll data, file uploads, or external input.

**Primary Agent**: `security-auditor`

**Skills** (select as needed):
- `security-best-practices` — Next.js/TypeScript web server security
- `security-threat-model` — structured threat/trust boundary analysis
- `vulnerability-scanner` — OWASP audit, npm audit wrapper
- `supply-chain-guard` — malicious package detection

**Workflow**:
1. Audit the change systematically
2. Identify vulnerabilities and compliance gaps
3. Prioritize by risk
4. Provide remediation with specifics
5. Re-verify after fixes

**Verify**: Both allowed and denied paths where practical, permission/scope checks

---

### Performance Issues / Optimization

**When**: Need to diagnose or improve performance (queries, bundle, render, load time).

**Primary Agent**: `performance-profiler` (or `performance-engineer` for infra/deployment performance)

**Skills** (select as needed):
- `postgresql-optimization` — query latency
- `web-vitals-optimizer` — Core Web Vitals (LCP, FID, CLS)
- `react-component-performance` — render time
- Relevant domain skill (frontend-developer for bundle, backend-developer for API latency)

**Workflow**:
1. Profile and identify bottleneck
2. Measure baseline metrics
3. Optimize
4. Re-measure and compare
5. Document findings and tradeoffs

**Verify**: Latency/throughput before/after, load test if applicable

---

### Code Cleanup / Unused Code / Refactoring (Non-Architectural)

**When**: Need to remove dead code, simplify logic, or improve code quality without changing behavior.

**Primary Agent**: `unused-code-cleaner` (for dead code), or inline for small refactors

**Verify**: All existing tests still pass, typecheck, lint

---

### Testing / Test Coverage / Test Automation

**When**: Need to write tests, improve coverage, or automate test execution.

**Primary Agents**: `test-generator` (write tests), `test-automator` (build framework), `test-runner` (diagnose failures)

**Skills**:
- `webapp-testing` — browser-based UI testing

**Verify**: Test execution, coverage metrics

---

### Code Review / Quality Assessment

**When**: Need an independent review of code quality, correctness, or architectural decisions.

**Primary Agent**: `code-reviewer`

**Scope**: Review specific diff/change, not entire application (unless auditing a specific area)

**Checklist**:
- Correctness (does it do what it's supposed to?)
- Regressions (could it break something else?)
- Security (auth, validation, secrets exposure?)
- Type safety (missing types, unsafe casts?)
- Database (schema mistakes, N+1 queries, missing indexes?)
- React/Next.js (misuse of patterns, hydration issues?)
- Accessibility (WCAG violations when relevant)
- Unnecessary complexity (can it be simpler?)
- Duplication (can code be reused?)
- Edge cases (missing scenarios?)

---

### Architectural / Design Decisions

**When**: Need help understanding existing architecture or designing new features at a system level.

**Primary Agent**: `code-architect` (understand existing), `database-architect` (schema design), `api-designer` (API design)

**Workflow**: Inspect, document, propose, validate with user, then delegate implementation.

---

### Documentation / API / Technical Writing

**When**: Need to create or improve documentation, API docs, or user guides.

**Primary Agent**: `api-documenter` (API docs), `technical-writer` (guides, general docs)

**Verify**: Docs are complete, examples work, clarity is good

---

## By Code Area

### `/` (Public Site)

- **Routes**: `/` (landing page)
- **Components**: Public marketing, showroom piano listings, inquiry forms
- **Data**: `pianos`, `inquiries` tables
- **Theme**: Paper/parchment/ink/gold (dark luxury, separate from owner/admin)
- **Auth**: None (public, forms are unauthenticated)

**Typical Work**: frontend-developer + (frontend-design if visual). No auth concerns.

### `/admin/*` (Back-Office)

- **Routes**: `/admin/projects`, `/admin/tasks`, `/admin/inventory`, `/admin/workers`, `/admin/monitor`, `/admin/curator`, `/admin/settings`
- **Components**: Admin pages, dashboards, project/task management, worker/inventory management, payroll/monitoring
- **Data**: `projects`, `tasks`, `workers`, `timeEntries`, `payments`, `inventoryItems`, `updates`
- **Auth**: Owner session (`requireUser()` in Server Actions)
- **Theme**: Separate `card-dark`/`card-light` + `bg-ink` tokens (not Personal Workspace teal/blue)

**Typical Work**: backend-developer (business logic), frontend-developer (UI), postgres-pro (queries). May need security-auditor if touching payroll/financial logic.

### `/owner/*` (Personal Workspace)

- **Routes**: `/owner/today`, `/owner/calendar`, `/owner/tasks`, `/owner/inbox`, `/owner/overdue`, `/owner/upcoming`, `/owner/settings`
- **Components**: Personal task/calendar management, inbox triage, preferences
- **Data**: `ownerTasks`, `ownerEvents`, `ownerInbox`, `ownerCategories`, `ownerPreferences`
- **Auth**: Owner session (same as `/admin/*` — same user table and sessions)
- **Theme**: Premium dark with `--color-ow-*` tokens (teal, blue, violet, rose, slate only—no brown/beige/yellow/amber)

**Typical Work**: frontend-developer + ui-design-system (must respect color constraints), backend-developer (Server Actions). Calendar/task logic can be complex; postgres-pro if query optimization needed.

### `/portal/[uuid]` (Client Portal)

- **Routes**: `/portal/[uuid]` (client restoration journal)
- **Components**: Public client-facing project updates, timeline, piano photos
- **Data**: `projects`, `updates` (filtered by portalUuid)
- **Auth**: None (secret UUID link, no login required)
- **Theme**: Public site theme (paper/parchment/ink/gold)

**Typical Work**: frontend-developer (UI), no backend work usually. If adding features, security-auditor to review UUID access control.

### `/workshop` (Technician Kiosk)

- **Routes**: `/workshop` (PIN-based kiosk)
- **Components**: Clock in/out, task claim, break management
- **Data**: `workers`, `timeEntries`, `workerBreaks`, `tasks` (filtered by worker context)
- **Auth**: Separate worker PIN + signed cookie (NOT owner sessions)
- **Theme**: Separate from owner/admin (simpler, task-focused)

**Typical Work**: backend-developer (clock in/out Server Actions, payroll logic), frontend-developer (kiosk UI). Security-auditor if touching PIN validation or time tracking. Debugger for time-tracking bugs.

---

## By Risk Level

### ✅ Low Risk (inline work often sufficient)

- UI text changes, button labels
- Component layout tweaks
- Adding simple conditional renders
- Small utility function additions
- Documentation updates
- Moving/renaming low-usage components

**Verify**: Typecheck, lint, visual check if rendering

---

### ⚠️ Medium Risk (consider delegation)

- New page or major component
- Backend Server Action logic
- Database query changes (not schema)
- Bug fixes in business logic
- Dependency updates
- New features in existing areas

**Verify**: Browser test, typecheck, lint, targeted tests

**Review**: code-reviewer for substantial changes

---

### 🔴 High Risk (always delegate)

- **Authentication/Authorization** → security-auditor
- **Schema changes/migrations** → postgres-pro + database-migration
- **Payroll/Payment logic** → backend-developer + security-auditor
- **Client/Worker data exposure** → security-auditor
- **Production bugs/incidents** → debugger + incident-responder
- **Public API / external integration** → api-security-audit
- **Performance regression** → performance-profiler

**Verify**: Comprehensive testing, independent review, security audit where applicable

---

## Decision Tree (Quick Lookup)

```
Is it a UI/component change?
  → Yes: frontend-developer + react/nextjs/design skills as needed
  → No: Continue

Is it a database/query change?
  → Yes: postgres-pro + drizzle/optimization skills as needed
  → No: Continue

Is it a Server Action / backend logic?
  → Yes: backend-developer + security if sensitive
  → No: Continue

Is it a bug?
  → Yes: debugger + systematic-debugging
  → No: Continue

Does it touch auth, secrets, or sensitive data?
  → Yes: security-auditor
  → No: Continue

Is it a performance issue?
  → Yes: performance-profiler + relevant skill
  → No: Continue

Is it a refactor / cleanup?
  → Yes: unused-code-cleaner or inline
  → No: Continue

Is it testing / documentation?
  → Yes: test-* agents or technical-writer
  → No: Unclear—ask user for clarification
```

---

## Verification Checklist

Always verify after making changes. Select relevant checks:

- [ ] TypeScript typecheck (`npm run typecheck`)
- [ ] ESLint lint (`npm run lint`)
- [ ] Build (`npm run build` or Docker rebuild)
- [ ] Browser test if UI change (new tab, verify interaction)
- [ ] Database migration safety (if schema change)
- [ ] Affected unit/integration tests
- [ ] Security review (if auth/sensitive data touched)
- [ ] Performance baseline (if performance work)
- [ ] Independent code review (if substantial)

---

## Example Quick Decisions

| Request | Route | Primary | Skills | Verify | Review |
|---------|-------|---------|--------|--------|--------|
| "Improve the projects page" | frontend | frontend-developer | senior-frontend, nextjs-best-practices | browser test | code-reviewer |
| "Optimize project queries" | database | postgres-pro | postgresql-optimization | before/after latency | code-reviewer |
| "Fix workshop clock out" | bug | debugger | systematic-debugging | reproduce + verify fix | code-reviewer (payroll-sensitive) |
| "Add invoice management" | backend + UI + DB | postgres-pro, backend-developer, frontend-developer | security-best-practices, drizzle-orm-expert | all layers + security | code-reviewer |
| "Fix auth cookie leak" | security | security-auditor | security-best-practices | both allowed/denied paths | N/A (auditor leads) |
| "Update inventory UI" | frontend | frontend-developer | react-best-practices, tailwind-design-system | browser test | code-reviewer |
| "Migrate to new DB schema" | database | postgres-pro | database-migration | migration safety, tests | code-reviewer |
| "Slow page load" | performance | performance-profiler | web-vitals-optimizer (frontend) or postgresql-optimization (backend) | profile + measure | code-reviewer if substantial |

---

**See also**: [tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md) for full decision-making framework and workflow.
