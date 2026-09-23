# Smart Auto-Routing Maintenance Guide

This document explains how the Smart Auto-Routing system works, how to maintain it, and how to evolve it as the project grows.

---

## System Components

The Smart Auto-Routing system consists of:

### 1. **CLAUDE.md** (Project context & quick intro)
- **What**: Top-level project guide
- **Contains**: Stack, routes, code layout, known gotchas, workflow notes, theme rules
- **Audience**: Every Claude Code session should start here
- **Update when**: Project architecture changes, new stack components, new gotchas discovered

### 2. **.claude/agents/tech-lead-orchestrator.md** (Full orchestrator logic)
- **What**: The primary decision-making agent for substantial requests
- **Contains**: Workflow (INSPECT → ROUTE → IMPLEMENT → VERIFY → REVIEW → FIX → REPORT), routing matrix summary, guardrails, when to ask user, examples
- **Audience**: Orchestrator uses this; Claude references it for major decisions
- **Update when**: Routing logic changes, new guardrails discovered, workflow improvements, new agent/skill added

### 3. **.claude/ROUTING.md** (Detailed routing matrix)
- **What**: Quick reference for which agent/skill to use for each task type
- **Contains**: By task type (UI, backend, DB, bugs, security, performance, testing), by code area (`/`, `/admin`, `/owner`, `/portal`, `/workshop`), by risk level, decision tree, verification checklist, examples
- **Audience**: Quick lookup during work
- **Update when**: New task patterns emerge, agent assignments change, new verification requirements

### 4. **.claude/SMART_AUTO_ROUTING.md** (User guide)
- **What**: How to use Smart Auto-Routing as a user
- **Contains**: Workflow explanation, how to use it, routing at a glance, guardrails, when to delegate vs. inline, examples, key files, verification commands
- **Audience**: You (the user) read this first to understand the system
- **Update when**: Workflow changes, new examples, clarifications needed

### 5. **.claude/settings.json** (Workflow configuration)
- **What**: Verification commands, Docker commands, browser test config, verification strategy
- **Contains**: npm/docker commands, verification rules by change type
- **Audience**: Used during verification phase
- **Update when**: New verification commands added, Docker configuration changes

### 6. **.claude/settings.local.json** (Permission rules)
- **What**: Permissions for Bash, PowerShell, WebFetch
- **Contains**: Allowed commands for dev workflow
- **Audience**: Claude Code permission system
- **Update when**: New command categories needed, permission scope changes

---

## How Smart Auto-Routing Works

### When a Request Comes In

1. **Assess complexity**:
   - Simple (typo, one-line fix, label change)? → Work inline
   - Complex/multi-layer/isolated? → Route via orchestrator

2. **Orchestrator inspects**:
   - Read relevant code (schema, layout, components, patterns)
   - Identify affected area(s)
   - Note existing patterns and constraints

3. **Orchestrator routes**:
   - Use ROUTING.md to determine primary agent(s)
   - Select relevant skills (not all, just useful ones)
   - Plan verification strategy
   - Determine if independent review needed

4. **Specialist implements or orchestrator works inline**:
   - Follow project conventions (file layout, naming, auth boundaries, theme rules)
   - Reuse existing components/utilities
   - Preserve intentional architecture

5. **Verify**:
   - Run appropriate checks from settings.json
   - Use browser testing for UI changes
   - Validate schema for DB changes
   - Test auth paths for security changes

6. **Review** (if substantial):
   - code-reviewer agent independently reviews diff
   - Checks correctness, regressions, security, types, DB, React patterns, accessibility, complexity, duplicates

7. **Fix findings**:
   - If issues found, fix and re-verify
   - Iterate until solid

8. **Report**:
   - Summary of what changed
   - Files affected
   - Verification results
   - Any open issues

---

## Routing Decision Logic

### The Decision Tree

```
Is it UI/component?
  → Yes: frontend-developer + design/react skills
  → No: Continue

Is it database/query?
  → Yes: postgres-pro + drizzle/optimization skills
  → No: Continue

Is it backend logic/Server Action?
  → Yes: backend-developer + security if sensitive
  → No: Continue

Is it a bug?
  → Yes: debugger + systematic-debugging
  → No: Continue

Does it touch auth/secrets/sensitive data?
  → Yes: security-auditor
  → No: Continue

Is it performance?
  → Yes: performance-profiler + perf skills
  → No: Continue

Is it code cleanup?
  → Yes: unused-code-cleaner
  → No: Continue

Is it testing/documentation?
  → Yes: test-* agents or technical-writer
  → No: Unclear — ask user for clarification
```

### Key Routing Rules

1. **Frontend changes** → frontend-developer (never skip, even small UI changes benefit from design review)
2. **Database changes** → postgres-pro (always, for schema/migration safety)
3. **Bug fixes** → debugger (always, for systematic root-cause methodology)
4. **Security/auth** → security-auditor (always, for comprehensive review)
5. **Performance** → performance-profiler (always, for profiling and measurement)

**Do NOT** route trivial changes. Inline work is fine for:
- One-line typos
- Label/copy changes that don't need design review
- Variable renames following existing patterns
- Simple bug fixes (obvious one-liner)

---

## Maintaining the Routing Matrix

### When to Add a New Route

Add a new entry to ROUTING.md when:
- A new task type emerges that doesn't fit existing categories
- A new code area is added to the project (e.g., new `/api/` route, new workflow)
- Existing routing isn't working well for some pattern

**Process**:
1. Update ROUTING.md with new task type or area
2. Update tech-lead-orchestrator.md with new examples if relevant
3. Update CLAUDE.md if the change affects project structure or architecture

### When to Change an Existing Route

Refine routing when:
- An agent/skill assignment isn't working well in practice
- A new skill is installed and should be included
- Verification strategy needs adjustment
- Security/sensitivity rules change

**Process**:
1. Update ROUTING.md
2. Update tech-lead-orchestrator.md if the change affects major decisions
3. Consider updating CLAUDE.md if the change reflects a project pattern shift

### Documenting Examples

Each route should have at least one example. Examples should:
- Show the user request exactly as they might phrase it
- Show the routing decision and why
- Show primary agent and skills selected
- Show verification steps
- Show expected outcome

Good example:
```
| Request | Route | Primary | Skills | Verify | Review |
|---------|-------|---------|--------|--------|--------|
| "Add invoice PDF generation" | backend + frontend | backend-developer, frontend-developer | security-best-practices (file handling), react-best-practices | typecheck, lint, browser test PDF generation | code-reviewer |
```

Bad example (too vague):
```
| "Add feature" | varies | varies | varies | varies | varies |
```

---

## Known Decision Points (Don't Change These Without Thinking)

### 1. Separate Auth Contexts
- **Why**: `/admin` and `/owner` share owner sessions, but `/workshop` uses worker PIN
- **Impact**: All auth checks must respect these boundaries
- **If you want to change**: Discuss with user first—this is architectural

### 2. Three Theme Systems
- **Why**: Owner workspace (teal/blue/violet/rose), Admin (card-dark/card-light), Public (near-black/brass)
- **Impact**: Any color/theme change must pick the right system
- **If you want to change**: Discuss with user first—these are intentional

### 3. Separate Task Models
- **Why**: `tasks` (project tasks) and `ownerTasks` (personal workspace tasks) are separate
- **Impact**: Any feature touching tasks must pick the right table
- **If you want to change**: Discuss with user first—this boundary is intentional

### 4. Timezone Handling
- **Why**: Container is UTC, business is Manila (UTC+8); startOfManilaDayUTC() handles boundary logic
- **Impact**: Any "today" logic must use the Manila function
- **If you want to change**: Don't—this is a known gotcha that caused a real bug before

### 5. Security-Sensitive Areas
Auto-trigger security-auditor for:
- Auth logic, sessions, cookies
- Worker PINs
- Public portal UUID access
- Client/worker/payroll data
- Secrets, env vars
- File uploads
- External input

**If you want to add a new sensitive area**: Update tech-lead-orchestrator.md and ROUTING.md

---

## Verification Commands

These are defined in settings.json and should stay current:

```bash
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm run build          # Full build
npm run dev            # Local dev (if not using Docker)
docker compose up -d --build web    # Rebuild/restart
docker compose ps      # Check status
```

**If you add new verification commands**:
1. Add to settings.json under `development.verification_commands`
2. Update ROUTING.md if the command applies to specific task types
3. Update SMART_AUTO_ROUTING.md if it's commonly used

---

## Evolving the System

### Adding a New Installed Agent or Skill

When a new agent or skill is installed:

1. **Determine where it fits** in the routing matrix
2. **Update ROUTING.md** to include it in the appropriate section
3. **Update tech-lead-orchestrator.md** with examples if it changes routing logic
4. **Update .claude/agents/ or .claude/skills/** as appropriate
5. **Test** a few requests that would use it to make sure routing works

### Adding a New Code Area

When a major new area is added (e.g., new `/api/` route, new workflow):

1. **Add to ROUTING.md** under "By Code Area" section
2. **Specify**: route, components, data (tables), auth, theme, typical work
3. **Update CLAUDE.md** route map if it's user-facing
4. **Update tech-lead-orchestrator.md** if guardrails change

### Handling Edge Cases

Some requests won't fit the matrix perfectly. **Document them**:

1. **In ROUTING.md** under "Example Quick Decisions" if it's a common pattern
2. **In tech-lead-orchestrator.md** under "Example Decompositions" if the routing is complex
3. **In SMART_AUTO_ROUTING.md** if it affects how users should phrase requests

---

## When Routing Fails

If the orchestrator makes a wrong routing decision:

1. **Identify the problem**: What was routed, what should have been routed?
2. **Root cause**: Is it a gap in ROUTING.md? A new pattern? A misunderstanding?
3. **Fix**:
   - If routing matrix gap: update ROUTING.md, add example
   - If new pattern: add to tech-lead-orchestrator.md with guardrails
   - If misunderstanding: clarify in SMART_AUTO_ROUTING.md
4. **Validate**: Test a similar request to confirm the fix works

---

## Performance & Iteration

Smart Auto-Routing should improve over time:

- **First month**: Foundation solid, basic patterns working
- **3 months**: New patterns emerging, refine routing for common tasks
- **6 months**: Well-tuned; only edge cases need adjustment
- **Ongoing**: Update as project grows (new features, areas, patterns)

**Metrics to watch**:
- Are simple requests routed correctly inline?
- Are complex requests getting the right specialists?
- Are verifications catching real issues?
- Is review catching problems the implementation missed?

---

## Maintaining Consistency

Keep the system consistent by:

1. **Always update ROUTING.md when routing changes**
2. **Always include examples when adding new patterns**
3. **Always cross-reference between CLAUDE.md, tech-lead-orchestrator.md, and ROUTING.md**
4. **Always test routing decisions against real requests**
5. **Always document guardrails and decision points**

---

## Files at a Glance

| File | Purpose | Update Frequency |
|------|---------|------------------|
| CLAUDE.md | Project context | When architecture changes |
| .claude/agents/tech-lead-orchestrator.md | Orchestrator workflow | When routing logic changes |
| .claude/ROUTING.md | Routing matrix | When patterns change |
| .claude/SMART_AUTO_ROUTING.md | User guide | When workflow changes |
| .claude/settings.json | Verification commands | When commands change |
| .claude/settings.local.json | Permission rules | When command scope changes |
| .claude/ROUTING_MAINTENANCE.md | This file | Reference guide |

---

## Summary

Smart Auto-Routing works because:
1. ✅ It knows your project (CLAUDE.md)
2. ✅ It has a clear workflow (tech-lead-orchestrator.md)
3. ✅ It has a routing matrix (ROUTING.md)
4. ✅ It respects guardrails (no rewrites, preserve boundaries, data sensitivity)
5. ✅ It verifies consistently (settings.json)
6. ✅ It improves over time (maintenance & examples)

**Keep these principles in mind when maintaining the system, and it will continue to serve the project well.**

---

For day-to-day use, see [SMART_AUTO_ROUTING.md](./SMART_AUTO_ROUTING.md).
For implementation details, see [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md).
For quick routing decisions, see [ROUTING.md](./ROUTING.md).
