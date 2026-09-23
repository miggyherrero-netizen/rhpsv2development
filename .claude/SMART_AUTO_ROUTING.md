# Smart Auto-Routing: Quick Start Guide

**You:** Give Claude a task. Claude automatically picks the right specialist(s) and tools.

No more manual agent selection. No more guessing which skill to load. Just describe what you want fixed or built, and the system handles the rest.

---

## The Workflow

Every substantial request follows this flow:

```
1. INSPECT → 2. ROUTE → 3. IMPLEMENT → 4. VERIFY → 5. REVIEW → 6. FIX → 7. REPORT
```

### 1. INSPECT
Claude reads the relevant code, schema, and existing patterns to understand what area you're touching and what conventions are already in place.

### 2. ROUTE
Claude decides:
- **Which specialist agent** should do the work (frontend-developer, postgres-pro, debugger, etc.)
- **Which skills** are relevant (react-best-practices, drizzle-orm-expert, systematic-debugging, etc.)
- **What verification** is needed (browser test? typecheck? schema validation?)
- **Whether independent review** is required (code-reviewer for substantial changes)

### 3. IMPLEMENT
The specialist (or Claude inline for small changes) makes the changes, following project conventions:
- Existing file structure and naming
- Existing components and utilities
- Authentication boundaries
- Theme constraints
- Data sensitivity rules

### 4. VERIFY
After changes, Claude runs appropriate checks:
- **UI changes**: typecheck, lint, browser test in fresh tab
- **Backend changes**: typecheck, lint, build, targeted tests
- **Database changes**: schema consistency, migration safety, query impact
- **Security changes**: allowed/denied paths, sensitive data access
- **Bug fixes**: reproduce original failure, verify fix, check for regressions

### 5. REVIEW
For substantial changes, the code-reviewer agent independently reviews the diff for:
- Correctness (does it work?)
- Regressions (could it break something?)
- Security vulnerabilities
- Type safety issues
- Database mistakes
- React/Next.js misuse
- Accessibility violations
- Unnecessary complexity
- Code duplication

### 6. FIX RELEVANT FINDINGS
If verification or review finds problems, Claude fixes them and re-verifies.

### 7. REPORT
Claude tells you:
- What changed
- Which files were affected
- Verification results
- Any open issues

---

## How to Use It

### Simple Requests (Inline Work)
Keep it short and direct:
- "Fix the typo in the projects header"
- "Update this button label"
- "Rename this variable to match the pattern"

Claude will handle these inline without complex routing.

### Complex Requests (Auto-Routed)
Be descriptive about what you want:
- "Improve the projects page" — Claude routes to frontend-developer + design skills
- "Fix workshop clock out" — Claude routes to debugger + systematic-debugging
- "Add invoice management" — Claude routes to postgres-pro + backend-developer + frontend-developer + security-auditor
- "Optimize project queries" — Claude routes to postgres-pro + postgresql-optimization
- "Clean up unused imports" — Claude routes to unused-code-cleaner

You don't specify which agent. Claude figures it out.

### When to Ask for Clarification
Claude will ask if there's a genuine **product/business decision** that can't be inferred:
- "Should invoices have separate status from projects?" — Claude asks
- "Where in the UI should the invoice button go?" — Claude asks if there's no existing pattern

Claude will **NOT ask** when the answer is in the code:
- "Is this a Next.js app?" — read package.json
- "Which agent should I use?" — read ROUTING.md and decide
- "Is there a workers table?" — read schema.ts

---

## Routing at a Glance

**UI / React / Components**
- Agent: `frontend-developer`
- Skills: react-best-practices, nextjs-best-practices, frontend-design (if visual redesign)
- Verify: browser test, typecheck, lint

**Backend / Server Actions**
- Agent: `backend-developer`
- Skills: security-best-practices (if sensitive)
- Verify: typecheck, lint, tests

**Database / Queries**
- Agent: `postgres-pro`
- Skills: drizzle-orm-expert, postgresql-optimization
- Verify: schema safety, migration safety, query impact

**Bugs**
- Agent: `debugger`
- Skills: systematic-debugging
- Verify: reproduce failure, verify fix, check regressions

**Security / Auth**
- Agent: `security-auditor`
- Skills: security-best-practices, security-threat-model
- Verify: allowed/denied paths, sensitive data access

**Performance**
- Agent: `performance-profiler`
- Skills: web-vitals-optimizer (frontend) or postgresql-optimization (backend)
- Verify: baseline metrics, profiling, measurement

**Code Review / Testing**
- Agents: `code-reviewer`, `test-generator`, `test-automator`
- Verify: test coverage, code quality checks

**See also**: [.claude/ROUTING.md](./ROUTING.md) for the full matrix, decision tree, and examples.

---

## Project Guardrails (Don't Break These)

Smart Auto-Routing respects these intentional boundaries:

### Authentication
- `/admin` and `/owner` use owner sessions (same `users` table and `sessions`)
- `/workshop` uses separate worker PIN + signed cookie (different auth, intentional)
- `/portal/[uuid]` is secret-link access, no login
- `/api/live` requires authentication (was a data leak before the fix)

### Themes (Three Separate Systems)
- **Owner Personal Workspace** (`/owner/*`): Dark premium with teal/blue/violet/rose (NO brown/beige/yellow/amber)
- **Admin** (`/admin/*`): Older theme with `card-dark`/`card-light` + `bg-ink` tokens
- **Public Site** (`/` and `/portal`): Deep near-black + brass (dark luxury redesign)

### Data Models
- `tasks` (project tasks in `/admin`) and `ownerTasks` (personal tasks in `/owner/*`) are separate by design
- `ownerEvents` and `ownerTasks` are both in the owner workspace
- `workers` are separate from `users` (different auth context)

### Timezone
- Container runs in UTC, but business is Asia/Manila (UTC+8)
- Use `startOfManilaDayUTC()` for any "today" boundary logic
- Plain `new Date()` uses container timezone and **silently misclassifies days**

### Known Sensitive Areas (Easy to Break)
- **Seed script** (`src/db/seed.ts`): Must stay idempotent — has guard to skip if user exists
- **Public assets** (`public/`): Must be copied in both Docker build stages
- **Database mutations**: All Server Actions must call `requireUser()` (admin/owner) or worker auth check
- **Stale references**: After rebuild, always use a fresh browser tab to avoid stale Server Action references

---

## When Smart Auto-Routing Delegates vs. Works Inline

### Smart Auto-Routing Will Delegate When:
- Task is complex/self-contained (full feature, major refactor, audit)
- Multiple files/layers are involved
- Specialized verification/review is needed
- A specialist's tool is beneficial (debugger's methodology, security-auditor's framework)

### Smart Auto-Routing Will Work Inline When:
- Change is small/obvious (typo, add a button, one-line fix)
- You can complete + verify + review in one focused session
- No complex specialist knowledge is required

---

## Verification Commands You Can Run

If you want to verify manually:

```bash
# TypeScript checking
npm run typecheck

# ESLint linting
npm run lint

# Production build
npm run build

# Local dev server (if not using Docker)
npm run dev

# Docker operations
docker compose up -d --build web     # Rebuild/restart
docker compose ps                    # Check status
docker compose logs -f web           # Watch web logs
```

After any Docker rebuild, **always open a fresh browser tab** to test (old tabs hold stale Server Action references).

---

## Example Interactions

### Example 1: "Improve the projects page"

**You:**
```
Improve the projects page.
```

**Claude:**
1. INSPECTS: Projects layout, components, queries, current styling
2. ROUTES: frontend-developer primary, react-best-practices + nextjs-best-practices + (frontend-design if visual redesign)
3. IMPLEMENTS: Delegates to frontend-developer, who follows existing patterns
4. VERIFIES: Typecheck, lint, browser test in fresh tab
5. REVIEWS: code-reviewer checks the diff
6. REPORTS: "Updated projects page with [changes]. Verified in browser. All checks pass."

### Example 2: "Fix workshop clock out"

**You:**
```
Workshop clock out is broken. Workers can't finish their shift.
```

**Claude:**
1. INSPECTS: Workshop route, clock-out Server Action, timeEntries logic, attempts to reproduce failure
2. ROUTES: debugger primary, systematic-debugging skill for root-cause analysis
3. IMPLEMENTS: debugger systematically identifies the issue (e.g., missing null check, incorrect timestamp)
4. VERIFIES: Reproduces original failure, confirms fix resolves it, checks time-tracking tests
5. REVIEWS: code-reviewer (payroll data is sensitive)
6. REPORTS: "Fixed workshop clock-out: [root cause details]. Verified failure no longer occurs."

### Example 3: "Add invoice management"

**You:**
```
Add invoice management so we can track and print invoices for clients.
```

**Claude:**
1. INSPECTS: Existing project/task structure, payment data, how costs are tracked, existing invoice context
2. ROUTES: 
   - postgres-pro for schema design
   - backend-developer for Server Actions
   - frontend-developer for UI
   - security-auditor for financial data handling
3. IMPLEMENTS: Parallel/sequential delegation; all layers follow conventions and data sensitivity rules
4. VERIFIES: Schema migrations, backend logic, browser UI test, security review
5. REVIEWS: code-reviewer after implementation
6. REPORTS: "Added invoice management: [what was added]. All layers verified, security reviewed."

---

## Key Files

- **CLAUDE.md** (this file's sibling) — Full project context, stack, architecture, gotchas
- **.claude/agents/tech-lead-orchestrator.md** — Full orchestrator workflow and guardrails
- **.claude/ROUTING.md** — Detailed routing matrix, decision tree, and examples
- **.claude/settings.json** — Verification commands and workflow configuration
- **.claude/launch.json** — Dev server configuration (Docker Compose)
- **.claude/settings.local.json** — Permission rules for Bash, PowerShell, WebFetch

---

## When Something Feels Off

If Claude's routing decision feels wrong or the result doesn't match your expectation:

1. **Check ROUTING.md** — Does the routing matrix say something different?
2. **Check tech-lead-orchestrator.md** — Are the guardrails being respected?
3. **Ask for clarification** — "I expected [X], but got [Y]. Can you explain?"
4. **Flag it in memory** — If it's a pattern, it can be added to your feedback memory for future sessions

---

## Summary

Smart Auto-Routing means:
- ✅ Give Claude a natural task description
- ✅ Claude automatically picks specialists and tools
- ✅ You get consistent workflow: INSPECT → ROUTE → IMPLEMENT → VERIFY → REVIEW → REPORT
- ✅ Project conventions are preserved
- ✅ Intentional boundaries (auth, themes, data models) stay intact
- ✅ High-risk areas (security, payroll, client data) get appropriate review

**The system works because it knows your project, respects its guardrails, and uses specialists only when beneficial.**

---

For deep dives:
- [Full Orchestrator Workflow](./agents/tech-lead-orchestrator.md)
- [Detailed Routing Matrix](./ROUTING.md)
- [Project Context & Stack](../CLAUDE.md)
