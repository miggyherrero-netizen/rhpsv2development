# Herrero Pianos — Codex project guide

## Project and architecture

Piano atelier application with a public marketing site and showroom, admin back office,
personal owner workspace, private client journals, and technician workshop kiosk.

- Next.js 16.2.6 App Router, React 19.2.6, TypeScript 5.9, Tailwind CSS 4.
- Drizzle ORM with PostgreSQL 17 in Docker Compose.
- `src/app/`: routes and layouts. Keep page components focused on data loading and composition.
- `src/components/`: page clients and shared UI; owner components use the `owner-` prefix.
- `src/server/data.ts`: shared reads. Server Actions live in `admin.ts`, `owner.ts`, `workshop.ts`, `public-actions.ts`, and `auth-actions.ts`.
- `src/db/schema.ts`: schema; `src/db/seed.ts`: initial seed.
- `src/lib/`: authentication, signing/hashing, dates, formatting, owner helpers, and configuration maps.
- `src/app/globals.css`: global styles and theme tokens.

Read the implementation as the source of truth. `CODER_BRIEF.md` and `ARENA_BUNDLE.md`
provide broader product context, but may describe planned rather than implemented behavior.
The existing `CLAUDE.md` remains the Claude-specific guide. There is currently no Git
repository in this workspace; do not claim to have reviewed a Git diff or created a commit.

## Routes and boundaries

| Route | Purpose |
| --- | --- |
| `/` | Public marketing site and showroom |
| `/admin/*` | Projects, tasks, inventory, workers, curator, monitoring, and settings |
| `/owner/*` | Personal today, calendar, tasks, inbox, overdue, upcoming, and settings views |
| `/portal/[uuid]` | Client restoration journal accessed through a secret UUID link |
| `/workshop` | Technician kiosk with worker PIN authentication |

Admin/owner authentication uses database sessions and httpOnly cookies in
`src/lib/auth.ts`. Workshop identity uses a separate signed worker cookie.
Preserve these boundaries and enforce authorization in server mutations, not only layouts.
Public actions and secret-link access need their own appropriate validation.
Keep `/api/live` authenticated.

## Project invariants

- Preserve the existing-user guard in `src/db/seed.ts`; the subsequent seed clears tables and must not run against established business data.
- Keep public assets available in both Docker build and runtime stages.
- Business dates use Asia/Manila. Use `startOfManilaDayUTC()` for Manila day boundaries; container-local midnight is not equivalent.
- Preserve the owner workspace's premium dark theme: charcoal/navy surfaces with teal, blue, violet, rose, and slate accents. No brown, beige, yellow, or amber in owner views or their category colors.
- Owner styles use `--color-ow-*` tokens and `.ow-*`/`.card-ow`/`.input-ow`/`.btn-ow-primary` classes. Admin and public styles have separate themes.
- Test a newly opened browser tab after rebuilding to avoid stale Server Action references.

## Commands and verification

| Command | Use |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript checking |
| `npm run build` | Production build; database configuration must be available |
| `node tests/task-flow.cjs` | Task/workshop integration checks against a configured PostgreSQL database |
| `docker compose up -d --build web` | Rebuild/restart the app when needed for an authorized implementation |
| `docker compose ps` | Inspect service status and actual published port |

There is no `npm test` script. The integration test creates and removes an isolated
schema, requires existing public tables and schema-creation privileges, and reads local
database settings. Inspect the test before running it against a database.
Compose uses `${WEB_PORT:-3000}`; discover the actual port instead of assuming 9847.
For UI changes, verify the affected flow live when the runtime is available. Documentation
and registration changes need file/schema/reference validation, not a production restart.

## Registered skills

Codex discovers the 20 adapters in `.agents/skills/<name>/SKILL.md`. Each adapter
points to the existing `.claude/skills/<name>/SKILL.md`, retaining its supporting
references and scripts in their original location. Read those instructions when the
skill applies; resolve their relative paths from the original skill directory.

| Area | Skills |
| --- | --- |
| Frontend | `senior-frontend`, `nextjs-best-practices`, `react-best-practices`, `react-component-performance`, `frontend-design` |
| Design/accessibility | `ui-design-system`, `tailwind-design-system`, `web-design-guidelines`, `accessibility-auditor` |
| Database | `drizzle-orm-expert`, `postgresql-optimization`, `supabase-postgres-best-practices`, `database-migration` |
| Defensive security | `security-best-practices`, `security-threat-model`, `vulnerability-scanner`, `supply-chain-guard` |
| Runtime/testing | `docker-expert`, `webapp-testing`, `systematic-debugging` |

Invoke explicitly with `$skill-name`, or allow relevant automatic matching. These are
local registrations, not newly installed plugins. Registration does not execute or
certify source scripts. Inspect scripts before running them. Generic examples do not
authorize migrations, dependency additions, deployments, or changes outside the task.

## Registered agents

The 31 `.codex/agents/*.toml` files register the existing agent roles with Codex-native
names, descriptions, and developer instructions. They reference the original
`.claude/agents/*.md` role guidance, with project and Codex compatibility constraints.
They inherit model settings rather than pinning a different model.

| Area | Agents |
| --- | --- |
| Development | `frontend-developer`, `backend-developer`, `fullstack-developer`, `expert-nextjs-developer`, `typescript-pro` |
| Exploration/review | `code-architect`, `code-explorer`, `code-reviewer`, `debugger`, `context-manager`, `performance-profiler`, `dependency-manager`, `unused-code-cleaner` |
| Testing/performance | `test-generator`, `test-runner`, `test-automator`, `accessibility-tester`, `performance-engineer`, `web-vitals-optimizer` |
| Database | `postgres-pro`, `database-architect`, `database-administrator` |
| Security | `security-auditor`, `api-security-audit`, `incident-responder` |
| Operations/docs | `deployment-engineer`, `devops-troubleshooter`, `api-designer`, `technical-writer`, `api-documenter`, `changelog-generator` |

Ask for a named agent when delegation is useful. Keep assignments bounded and avoid
overlapping edits. Use actual available Codex tools; Claude tool names and example
context-manager messages are not executable APIs. Gather context from project files
instead of assuming an external agent messaging service exists.

`AGENTS.md` is the automatically loaded entry point and directs Codex to this guide.
Reopen the project/start a fresh task if new registrations are not visible. File
validation alone does not prove discovery in an already-running session.

Registration follows the official [skills](https://learn.chatgpt.com/docs/build-skills),
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) documentation.
