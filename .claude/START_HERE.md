# Smart Auto-Routing: START HERE

**Welcome to your new Claude Code development workflow.**

This file points you to the right guide based on what you're trying to do.

---

## 👤 I'm a Developer Using This Project

### First Time Setup
1. Read **[CLAUDE.md](../CLAUDE.md)** — Project context, stack, architecture
2. Read **[SMART_AUTO_ROUTING.md](./SMART_AUTO_ROUTING.md)** — How the new workflow works
3. Bookmark **[ROUTING.md](./ROUTING.md)** — Quick reference for everyday work

### I Want to Request Work
Just describe what you need naturally:
- "Fix the projects page"
- "Add invoice management"
- "Optimize this query"
- "Clean up unused imports"

Claude will:
1. Inspect the relevant code
2. Route to the right specialist(s)
3. Implement the change
4. Verify it works
5. Review for quality
6. Report the results

**That's it.** No manual agent selection, no guessing which skill to load.

### I Want to Understand the Workflow Better
Read **[SMART_AUTO_ROUTING.md](./SMART_AUTO_ROUTING.md)** — Explains:
- The 7-step workflow
- How routing decisions are made
- Examples of complex requests
- Guardrails (don't break these)
- Verification commands

---

## 🛠️ I'm Implementing Features / Fixing Bugs

### For Any Task
1. Start with natural language description (no agent names needed)
2. Claude determines routing automatically
3. Follow verification steps in **[ROUTING.md](./ROUTING.md)**
4. Use **[settings.json](.settings.json)** verification commands when needed

### For Specific Task Types

**Building UI**
- Agent: frontend-developer
- Skills: senior-frontend, react-best-practices, nextjs-best-practices
- Verify: browser test, typecheck, lint
- See: [ROUTING.md](./ROUTING.md) → "UI / React / Pages"

**Fixing Backend**
- Agent: backend-developer
- Skills: security-best-practices (if sensitive)
- Verify: typecheck, lint, build
- See: [ROUTING.md](./ROUTING.md) → "Backend / Server Actions"

**Database Work**
- Agent: postgres-pro
- Skills: drizzle-orm-expert, postgresql-optimization, database-migration
- Verify: schema consistency, migration safety
- See: [ROUTING.md](./ROUTING.md) → "Database / Drizzle / PostgreSQL"

**Bug Fixing**
- Agent: debugger
- Skills: systematic-debugging
- Verify: reproduce failure, verify fix, check regressions
- See: [ROUTING.md](./ROUTING.md) → "Bugs / Failures"

**Security Issues**
- Agent: security-auditor
- Skills: security-best-practices, security-threat-model
- Verify: allowed/denied paths, sensitive data access
- See: [ROUTING.md](./ROUTING.md) → "Security / Auth"

**Performance**
- Agent: performance-profiler
- Skills: web-vitals-optimizer (frontend) or postgresql-optimization (backend)
- Verify: baseline metrics, profiling
- See: [ROUTING.md](./ROUTING.md) → "Performance Issues"

---

## 🏗️ I'm Maintaining / Extending This System

### Understanding the System
Read **[ROUTING_MAINTENANCE.md](./ROUTING_MAINTENANCE.md)** — Explains:
- System components and their purpose
- How Smart Auto-Routing works step-by-step
- Routing decision logic
- When to update routing assignments
- How to evolve the system

### Adding New Routes
1. Update [ROUTING.md](./ROUTING.md) with new task type or code area
2. Add examples showing routing decision
3. Update [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md) if workflow changes
4. Test routing with real requests

### Handling Edge Cases
1. Document the edge case in [ROUTING.md](./ROUTING.md) or [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md)
2. Explain why it doesn't fit standard routes
3. Provide examples
4. Add to examples section for future reference

### Validation
Check **[SYSTEM_VALIDATION.md](./SYSTEM_VALIDATION.md)** — Documents:
- What's been created and validated
- Internal consistency checks
- Guardrails preserved
- Known limitations
- Success criteria

---

## 📚 I Want the Full Reference

| Document | Purpose | Read When |
|----------|---------|-----------|
| [CLAUDE.md](../CLAUDE.md) | Project context & stack | First time, architecture questions |
| [SMART_AUTO_ROUTING.md](./SMART_AUTO_ROUTING.md) | User guide | You're new to the system |
| [ROUTING.md](./ROUTING.md) | Routing matrix | You need to decide which agent |
| [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md) | Full workflow logic | Understanding deep decisions |
| [ROUTING_MAINTENANCE.md](./ROUTING_MAINTENANCE.md) | System evolution | Maintaining or extending the system |
| [SYSTEM_VALIDATION.md](./SYSTEM_VALIDATION.md) | Validation report | Confirming everything works |
| [settings.json](./settings.json) | Verification commands | Running verification steps |
| [settings.local.json](./settings.local.json) | Permissions | Understanding allowed commands |

---

## ⚡ Quick Reference

### The Workflow
```
INSPECT → ROUTE → IMPLEMENT → VERIFY → REVIEW → FIX → REPORT
```

### Routing at a Glance
| Task | Agent | Skills | Verify |
|------|-------|--------|--------|
| UI/Component | frontend-developer | react, nextjs, design | browser test, typecheck, lint |
| Backend/Server Action | backend-developer | security (if needed) | typecheck, lint, build |
| Database/Query | postgres-pro | drizzle, optimization | schema safety, tests |
| Bug/Failure | debugger | systematic-debugging | reproduce + verify fix |
| Auth/Security | security-auditor | security-best-practices, threat-model | allowed/denied paths |
| Performance | performance-profiler | perf skills | profile + measure |

### Key Guardrails (Don't Break These)
- **Auth**: `/admin` and `/owner` share sessions; `/workshop` is separate
- **Themes**: Owner (teal/blue/violet/rose), Admin (card-dark/card-light), Public (near-black/brass)
- **Data Models**: `tasks` (projects) and `ownerTasks` (personal) are separate
- **Timezone**: Use `startOfManilaDayUTC()` for Manila boundaries
- **Verification**: Always use fresh browser tab after rebuild

### Verification Commands
```bash
npm run typecheck       # TypeScript
npm run lint            # ESLint
npm run build           # Production build
docker compose up -d --build web   # Rebuild/restart
docker compose ps       # Check status
```

---

## 🆘 Something's Not Working?

### Routing Decision Feels Wrong
1. Check [ROUTING.md](./ROUTING.md) — Does the matrix say something different?
2. Check [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md) — Are guardrails being respected?
3. Ask Claude to explain the routing decision
4. Report via feedback for future reference

### Verification Failed
1. Check [settings.json](./settings.json) — Is the verification strategy correct?
2. Run the verification command manually
3. Check for typos or configuration issues
4. Ask Claude to diagnose the problem

### New Pattern Doesn't Fit
1. Document it in [ROUTING_MAINTENANCE.md](./ROUTING_MAINTENANCE.md)
2. Add examples to [ROUTING.md](./ROUTING.md)
3. Update [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md) if needed
4. Test with real requests

---

## 💡 Tips for Success

✅ **DO:**
- Describe tasks naturally ("Fix X", "Add Y", "Optimize Z")
- Let Claude determine routing automatically
- Trust the verification steps
- Report if routing feels wrong so the system improves
- Update guardrails if you discover new risk areas

❌ **DON'T:**
- Manually specify agents unless Claude asks
- Skip verification steps
- Assume routing without checking ROUTING.md
- Modify auth boundaries, theme systems, or data models without asking
- Break timezone handling or ignore locale boundaries

---

## 📖 Full System Documentation

**For users**: [SMART_AUTO_ROUTING.md](./SMART_AUTO_ROUTING.md)  
**For developers**: [agents/tech-lead-orchestrator.md](./agents/tech-lead-orchestrator.md)  
**For maintenance**: [ROUTING_MAINTENANCE.md](./ROUTING_MAINTENANCE.md)  
**For quick lookup**: [ROUTING.md](./ROUTING.md)  
**For validation**: [SYSTEM_VALIDATION.md](./SYSTEM_VALIDATION.md)  
**For project context**: [../CLAUDE.md](../CLAUDE.md)

---

## Ready? Let's Build

Your first request:

```
[Describe what you need]
```

Claude will:
1. ✅ Inspect the codebase
2. ✅ Route to the right specialist(s)
3. ✅ Implement the change
4. ✅ Verify it works
5. ✅ Get independent review if needed
6. ✅ Report the results

**No manual agent selection. No guessing which skill to load. Just results.**

---

**Questions? See the docs above. Ready to start? Give Claude a task.**
