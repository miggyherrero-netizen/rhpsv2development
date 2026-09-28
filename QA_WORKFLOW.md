# Herrero Pianos — QA Workflow

A practical, adaptable quality-assurance workflow designed for this project's
real stack: Next.js 16 App Router, React 19, TypeScript, Drizzle ORM + PostgreSQL 17,
Docker Compose, and the existing custom test suite in `tests/`.

---

## 1. Design principles

| Principle | What it means here |
|---|---|
| **Shift-left, verify-early** | Every contributor runs `lint`, `typecheck`, and domain tests before requesting review — not after. |
| **Pyramid-weighted** | Most coverage lives in fast, pure-function unit tests (like `service-money.ts`). Integration tests (`task-flow.cjs`) guard critical flows. E2E/browser tests are reserved for auth, money, and cross-route journeys. |
| **Adaptable by default** | The workflow scales down to a single-person change and up to a multi-team feature release. A sizing tier (§9) selects which gates apply. |
| **Evidence over assertion** | "Looks fine" is not verification. A gate passes when a named check has run and passed — or when an explicit risk-acceptance is recorded. |
| **Preserve invariants** | Money is integer centavos recomputed server-side. Timezone is Asia/Manila. Auth boundaries are enforced in server mutations. Tests must exercise these, not assume them. |

---

## 2. Current-state assessment

### What exists

| Asset | Location | Coverage |
|---|---|---|
| Pure domain checks | `tests/service-money.ts` | Money arithmetic, invoice status, AR aging, job margins, Manila time parsing |
| Mock-data checks | `tests/service-mock.ts` | Realistic piano-service scenarios, edge cases, catalog/label maps |
| Document/payment checks | `tests/service-documents.ts` | Token validation, payment settlement, receipt codes |
| Integration test | `tests/task-flow.cjs` | Task lifecycle, workshop auth, concurrent takes, archive/restore, cascade deletes |
| Static analysis | `npm run lint`, `npm run typecheck` | ESLint (next core-web-vitals), TypeScript strict |
| Production build | `npm run build` | Next.js production compilation (requires DB config) |
| Manual browser verification | `docker compose up -d --build web` | Live flow testing in a fresh tab |

### Gaps this workflow addresses

1. ~~**No unified test runner**~~ — **Resolved.** `npm test` now runs lint + typecheck + all domain tests via `tests/run-tests.mjs`. Individual suites still runnable with `npm run test:service`, `test:documents`, etc.
2. **No regression suite** — tests are run manually by name; there's no CI gate or scheduled regression. `npm run test:all` provides the full gate (domain + integration + build) but must be triggered manually until CI exists.
3. **No E2E coverage** — auth flows, money mutations, and cross-route journeys have no automated browser tests despite `webapp-testing` (Playwright) being available as a skill.
4. **No defect tracking** — bugs are handled conversationally with no lifecycle, severity, or SLA.
5. **No measurable metrics** — pass/fail counts, defect density, and escape rate are not tracked.
6. **No CI pipeline** — all gates are manual; there is no git repository yet, so CI is the next infrastructure milestone.

---

## 3. Workflow stages

The workflow has six stages. Each stage has **entry criteria** (what must be true
to start), **activities** (what happens), and **exit criteria** (what must be true
to finish). Stages overlap in practice — Stage 2 runs continuously during development.

---

### Stage 0 — Test planning & strategy

**When:** Before a feature, epic, or milestone begins.

**Entry criteria:**
- Requirements or user stories exist (even as a brief description).
- Affected routes/components are identified (e.g., `/service/invoices`, `src/lib/service.ts`).

**Activities:**
1. Identify **risk-ranked test targets** — prioritize anything touching money (`computeTotals`, `recalcInvoice`), auth (`requireUser`, worker cookie), or data integrity (cascade deletes, schema migrations).
2. Define the **test pyramid allocation** for the feature:
   - Unit (pure functions, formatters, parsers) — highest count, fastest.
   - Integration (server actions against isolated schema) — critical flows only.
   - E2E (browser-driven) — auth, money, and cross-route journeys only.
3. Write or update a **test plan note** — a short checklist in the feature description: "What must be true for this to ship?"
4. Identify **regression risk areas** — existing functionality that could break (e.g., changing `parseLocal` affects all time displays).

**Exit criteria:**
- Test targets identified and risk-ranked.
- Test plan note exists in the feature description.
- Regression risk areas listed.

---

### Stage 1 — Test design & authoring

**When:** During development, alongside code.

**Entry criteria:**
- Stage 0 plan exists.
- Developer understands the acceptance criteria.

**Activities:**
1. **Write tests first or alongside** — for pure functions (money, dates, parsing), tests come before or with the implementation. For UI components, write the component and a test in the same session.
2. **Use the existing test conventions:**
   - Pure domain checks → add to `tests/service-*.ts` using the `check(name, actual, expected)` pattern.
   - Integration checks → add to `tests/task-flow.cjs` or a new `tests/{domain}-flow.cjs` following the isolated-schema pattern.
   - E2E checks → new `tests/e2e/*.spec.ts` using Playwright (via the `webapp-testing` skill).
3. **Cover edge cases explicitly** — zero values, negative inputs, null/undefined, boundary dates (Manila midnight, year transitions), concurrent operations.
4. **Tag tests** — annotate each test block with a domain tag (`@money`, `@auth`, `@time`, `@ui`, `@integration`, `@e2e`) to enable selective regression runs.

**Exit criteria:**
- New tests written and passing locally.
- Edge cases documented in test assertions.
- Tests follow existing conventions (same `check()` pattern, same schema-isolation approach).

---

### Stage 2 — Pre-merge verification (developer gate)

**When:** Before requesting review, on every change.

**Entry criteria:**
- Code change is complete.
- New tests are written.

**Activities — run the full gate sequence:**

| Step | Command | Must pass? |
|---|---|---|
| 1. Lint | `npm run lint` | Yes — zero errors |
| 2. Type check | `npm run typecheck` | Yes — zero errors |
| 3. Domain unit tests | `npx tsx tests/service-money.ts` | Yes |
| 4. Mock-data tests | `npx tsx tests/service-mock.ts` | Yes |
| 5. Document tests | `npx tsx tests/service-documents.ts` | Yes (if touched) |
| 6. Integration test | `node tests/task-flow.cjs` | Yes (if server actions touched) |
| 7. Production build | `npm run build` | Yes (before release; can skip for mid-dev iterations) |
| 8. Browser smoke | `docker compose up -d --build web` + fresh-tab check | Yes (for UI/auth/money changes) |

**Exit criteria:**
- All applicable steps pass.
- Developer has verified in a **freshly opened browser tab** (not a tab left open across a rebuild — stale Server Action references cause phantom failures).
- Self-review checklist completed (see §4).

> **Adaptability note:** For a one-line typo fix, steps 1-2 plus the relevant domain test suffice. For a money/auth change, all eight steps are mandatory. The sizing tier (§9) formalizes this.

---

### Stage 3 — Integration & regression testing

**When:** After merge, before release.

**Entry criteria:**
- Change is merged (or ready for staging).
- Stage 2 gate passed.

**Activities:**
1. **Full regression run** — execute the complete test suite in order:
   ```
   npm run lint && npm run typecheck && \
   npx tsx tests/service-money.ts && \
   npx tsx tests/service-mock.ts && \
   npx tsx tests/service-documents.ts && \
   node tests/task-flow.cjs
   ```
2. **Regression selection** — if the change is isolated (e.g., only `src/lib/service.ts`), run the tagged subset (`@money`) plus a smoke of the full suite. Full regression runs before releases.
3. **Cross-route smoke** — verify that changes in one workspace (e.g., `/service/*`) don't break another (e.g., `/owner/*` or `/admin/*`). Key checks:
   - Theme isolation (`--color-ow-*` vs `--color-svc-*` vs admin tokens).
   - Auth boundary (admin mutations reject workshop cookies and vice versa).
   - Shared data reads (`src/server/data.ts`) still return expected shapes.
4. **Database migration safety** — if `src/db/schema.ts` changed, verify:
   - `init-db.sh` seeding guard is preserved.
   - `drizzle-kit` migration generates cleanly.
   - Existing data is not wiped.

**Exit criteria:**
- Full regression suite passes (or tagged subset + smoke for isolated changes).
- No new failures compared to the baseline.
- Cross-route smoke verified.

---

### Stage 4 — Release validation

**When:** Before deploying to production.

**Entry criteria:**
- Stage 3 regression passed.
- Production build succeeds (`npm run build`).
- `docker compose up -d --build web` runs without errors.

**Activities:**
1. **Release checklist** — confirm all invariants from `CODEX.md` are preserved:
   - Money is integer centavos, totals recomputed server-side.
   - Business dates use Asia/Manila / `startOfManilaDayUTC()`.
   - Owner workspace premium dark theme intact (no brown/beige/yellow/amber).
   - Home service theme isolation (`--color-svc-*` not leaking into owner/admin).
   - Public assets available in both Docker build and runtime stages.
   - `/api/live` requires authentication.
   - Seed guard in `src/db/seed.ts` preserved.
2. **Critical-path browser walkthrough** — in a fresh tab, walk through:
   - Public site loads, showroom displays.
   - Admin login, project/task/inventory pages functional.
   - Owner workspace loads with correct dark theme.
   - Service workspace loads with correct graphite theme.
   - Workshop kiosk: clock in, claim task, break, finish, clock out.
   - Client portal loads via secret UUID link.
3. **Money flow verification** — create a test invoice, verify `computeTotals` output, check AR aging buckets, confirm invoice status transitions.

**Exit criteria:**
- All release checklist items confirmed.
- Critical-path walkthrough successful.
- No console errors in browser dev tools.

---

### Stage 5 — Post-release monitoring

**When:** After deployment, ongoing.

**Entry criteria:**
- Release is live.

**Activities:**
1. **Smoke test the live deployment** — hit key routes, verify they load.
2. **Monitor for regression signals** — user-reported issues, error logs, unexpected behavior.
3. **Capture metrics** — record defect count, escape rate, time-to-fix (see §8).
4. **Retrospective** — for significant releases, note what worked, what didn't, and update this workflow.

**Exit criteria:**
- Post-release smoke passed.
- Metrics recorded.
- Any escaped defects logged and triaged.

---

## 4. Developer self-review checklist

Before requesting review, the developer confirms:

- [ ] `npm run lint` passes — zero errors.
- [ ] `npm run typecheck` passes — zero errors.
- [ ] Relevant domain tests pass (`service-money`, `service-mock`, `service-documents`).
- [ ] Integration test passes if server actions were touched (`task-flow.cjs`).
- [ ] No hardcoded secrets, `.env` values, or credentials in code.
- [ ] Money values are integer centavos, computed server-side — no client-sent totals trusted.
- [ ] Timezone logic uses `startOfManilaDayUTC()` or `parseLocal()` — no container-local `new Date().setHours()`.
- [ ] Auth checks are in server mutations, not just layouts.
- [ ] Theme tokens are scoped correctly (`--color-ow-*` in owner only, `--color-svc-*` in service only).
- [ ] Public assets are in `public/` and the Dockerfile copies them in both stages.
- [ ] Verified in a freshly opened browser tab — not a tab left open across a rebuild.

---

## 5. Defect tracking process

### Severity levels

| Severity | Definition | Example | Target resolution |
|---|---|---|---|
| **S1 — Critical** | Blocks core business function; data loss or security exposure. Money calculated wrong, auth bypass, data wipe. | `computeTotals` returns negative tax. | Fix before any other work. Hotfix path. |
| **S2 — High** | Major feature broken, no acceptable workaround. | Workshop can't clock out; invoice status stuck. | Fix within current sprint. |
| **S3 — Medium** | Feature partially broken, workaround exists. | AR aging bucket label wrong but amounts correct. | Fix within 2 sprints. |
| **S4 — Low** | Cosmetic, minor inconvenience. No data impact. | Date format inconsistent in one view. | Fix when convenient. Batch with related work. |

### Defect lifecycle

```
NEW → TRIAGED → ASSIGNED → IN_PROGRESS → FIXED → VERIFIED → CLOSED
                                              ↓
                                         REOPENED (if verification fails)
```

| State | Meaning | Owner |
|---|---|---|
| NEW | Reported, not yet reviewed | Reporter |
| TRIAGED | Severity assigned, priority set | QA / Lead |
| ASSIGNED | Developer assigned | Lead |
| IN_PROGRESS | Developer actively fixing | Developer |
| FIXED | Fix committed, ready for verification | Developer |
| VERIFIED | QA confirmed the fix works | QA / Reviewer |
| CLOSED | No further action needed | QA / Lead |
| REOPENED | Verification failed, back to dev | QA |

### Defect SLAs

| Severity | Triage | First response | Fix | Verification |
|---|---|---|---|---|
| S1 | Immediate | 1 hour | Same day | Within 2 hours of fix |
| S2 | 1 day | 1 day | 3 days | 1 day |
| S3 | 2 days | 3 days | 1 sprint | 2 days |
| S4 | 1 sprint | 1 sprint | Next convenient | 1 sprint |

### Defect report template

```
Title: [Brief, specific description]
Severity: S1 / S2 / S3 / S4
Route: /service/invoices/[id]
Component: src/components/service-invoice-detail.tsx
Steps to reproduce:
  1. ...
  2. ...
Expected: ...
Actual: ...
Environment: Docker compose, port [actual port], fresh tab
Domain tags: @money @auth @time @ui @integration @e2e
```

---

## 6. Regression testing strategy

### Test pyramid

```
                    E2E (browser)
                 ┌─────────────────┐
                 │  Auth, money,   │  ← Few, slow, high-value
                 │  cross-route    │
                 └─────────────────┘
              Integration (DB-backed)
           ┌──────────────────────────┐
           │  task-flow.cjs           │  ← Critical flows, isolated schema
           │  New domain-flow tests    │
           └──────────────────────────┘
        Unit (pure functions)
   ┌──────────────────────────────────────┐
   │  service-money.ts    service-mock.ts │  ← Many, fast, edge-case-rich
   │  service-documents.ts                 │
   └──────────────────────────────────────┘
```

### Regression selection rules

| Change type | What to run |
|---|---|
| `src/lib/service.ts` (money, time, formatting) | `service-money` + `service-mock` + `service-documents` |
| `src/server/admin.ts` or `workshop.ts` | `task-flow.cjs` + `service-money` (if money touched) |
| `src/lib/auth.ts` | `task-flow.cjs` + full regression + browser auth smoke |
| `src/db/schema.ts` | Full regression + migration safety check |
| UI component only (`.tsx`) | Lint + typecheck + browser smoke of affected route |
| Theme/CSS (`globals.css`) | Browser smoke of all affected workspaces |
| `src/lib/dates.ts` | `service-money` (Manila time tests) + `service-mock` |

### Regression cadence

| Trigger | Scope |
|---|---|
| Before merge (Stage 2) | Tagged subset relevant to the change |
| Before release (Stage 3) | Full suite |
| After dependency update | Full suite + `npm run build` |
| After database schema change | Full suite + migration safety check |
| Scheduled (weekly, once CI exists) | Full suite overnight |

---

## 7. Automation integration

### CI pipeline (target state — once a git repository exists)

```
Push / PR
  │
  ├─ Lint (npm run lint)
  ├─ Type check (npm run typecheck)
  ├─ Unit tests (service-money, service-mock, service-documents)
  ├─ Integration tests (task-flow.cjs — requires Postgres service)
  ├─ Build (npm run build — on release branches only)
  └─ E2E (Playwright — on release branches only, needs running app)
```

### Unified test runner (implemented)

The following scripts are wired in `package.json`:

| Script | What it runs |
|---|---|
| `npm test` | Lint + typecheck + all domain tests (`run-tests.mjs`) |
| `npm run test:domain` | Domain tests only (no lint/typecheck) |
| `npm run test:service` | `service-money.ts` only |
| `npm run test:service-mock` | `service-mock.ts` only |
| `npm run test:documents` | `service-documents.ts` only |
| `npm run test:integration` | `task-flow.cjs` (requires running PostgreSQL) |
| `npm run test:all` | Everything: domain + integration + production build |
| `npm run dev:up` | Build and start Docker Compose (db + web) |
| `npm run dev:down` | Stop Docker Compose |
| `npm run dev:ps` | Check Docker Compose service status |

The runner (`tests/run-tests.mjs`) spawns each test file via `node --import tsx`,
captures stdout/stderr, counts checkmarks, and prints a summary table with
per-suite pass/fail counts and an aggregate total.

### Automation tooling map

| Layer | Tool | Status | Notes |
|---|---|---|---|
| Lint | ESLint (`eslint-config-next`) | Active | `npm run lint` |
| Type safety | TypeScript (`tsc --noEmit`) | Active | `npm run typecheck` |
| Unit/domain tests | `tsx` + custom `check()` | Active | `tests/service-*.ts`, unified via `npm test` |
| Integration tests | `node` + `pg` + isolated schema | Active | `tests/task-flow.cjs`, `npm run test:integration` |
| Unified test runner | `tests/run-tests.mjs` | **Active** | `npm test` (lint + typecheck + domain tests) |
| Full regression | Domain + integration + build | **Active** | `npm run test:all` |
| Docker convenience | Compose up/down/ps | **Active** | `npm run dev:up`, `dev:down`, `dev:ps` |
| E2E tests | Playwright (via `webapp-testing` skill) | **Not yet implemented** | Priority: auth, money, workshop kiosk |
| CI pipeline | GitHub Actions / equivalent | **Not yet set up** | Depends on git repository |
| Dependency audit | `npm audit` (via `vulnerability-scanner` skill) | Available, manual | Run before releases |
| Supply-chain scan | `supply-chain-guard` skill | Available, manual | Run on dependency changes |
| Accessibility audit | `accessibility-auditor` skill | Available, on-demand | Run on UI changes |
| Performance audit | `web-vitals-optimizer` skill | Available, on-demand | Run on significant UI changes |

### Test file naming convention

| Pattern | Purpose | Example |
|---|---|---|
| `tests/{domain}-money.ts` | Pure domain logic | `service-money.ts` |
| `tests/{domain}-mock.ts` | Mock-data edge cases | `service-mock.ts` |
| `tests/{domain}-documents.ts` | Document/payment logic | `service-documents.ts` |
| `tests/{domain}-flow.cjs` | Integration against DB | `task-flow.cjs` |
| `tests/e2e/{journey}.spec.ts` | Browser-driven E2E | `tests/e2e/auth.spec.ts` |

---

## 8. Metrics & KPIs

### Effectiveness metrics

| Metric | Definition | Target | Frequency |
|---|---|---|---|
| **Test pass rate** | Passing tests / total tests run | 100% on main; ≥95% on feature branches | Per gate run |
| **Defect density** | S1+S2 defects found / lines changed | < 1 per 500 LOC | Per release |
| **Escape rate** | Defects found post-release / total defects found | < 15% | Per release |
| **Mean time to fix (MTTF)** | Time from ASSIGNED to VERIFIED | S1: < 8h, S2: < 3d, S3: < 1 sprint | Per defect |
| **Regression detection rate** | Defects caught by regression / total defects caught | > 60% | Per release |
| **Test coverage growth** | New test assertions added per feature | ≥ 1 assertion per new pure function | Per merge |
| **Automation ratio** | Automated checks / total checks run | Increasing trend | Monthly |
| **Build success rate** | Successful `npm run build` / total builds | > 95% | Monthly |

### Quality health scorecard (monthly review)

| Dimension | Metric | Green | Yellow | Red |
|---|---|---|---|---|
| Correctness | Escape rate | < 10% | 10-20% | > 20% |
| Speed | MTTF (S2) | < 2 days | 2-5 days | > 5 days |
| Coverage | New tests per feature | ≥ 3 | 1-2 | 0 |
| Stability | Flaky test rate | < 2% | 2-5% | > 5% |
| Debt | Open S3+S4 defects | < 10 | 10-25 | > 25 |

### Tracking method

Until a dedicated dashboard exists, record metrics in a simple log:

```
## Release: [version/date]
- Tests run: X, passed: Y, failed: Z
- Defects found: N (S1: a, S2: b, S3: c, S4: d)
- Escaped defects: M
- MTTF: [avg per severity]
- New test assertions: K
```

---

## 9. Adaptability framework — project sizing

Not every change needs the full eight-step gate. Size the work and apply the
appropriate tier.

### Tier 1 — Trivial (typo, copy, label, single-line fix)

| Gate | Required? |
|---|---|
| Test planning | No |
| New tests | No |
| Lint + typecheck | Yes |
| Domain tests | Only if the file has existing tests |
| Integration test | No |
| Build | No |
| Browser smoke | Only if user-facing text |
| Review | Self-review only |

### Tier 2 — Routine (component update, new field, query change)

| Gate | Required? |
|---|---|
| Test planning | Brief — identify affected area |
| New tests | Yes — at least one assertion for new logic |
| Lint + typecheck | Yes |
| Domain tests | Yes — if pure functions touched |
| Integration test | Yes — if server actions touched |
| Build | Before release |
| Browser smoke | Yes — affected route in fresh tab |
| Review | Peer review |

### Tier 3 — Significant (new feature, new route, schema change, money/auth change)

| Gate | Required? |
|---|---|
| Test planning | Yes — full test plan note |
| New tests | Yes — unit + integration + E2E for critical paths |
| Lint + typecheck | Yes |
| Domain tests | Yes — full run |
| Integration test | Yes — full run |
| Build | Yes |
| Browser smoke | Yes — all affected routes + cross-route check |
| Review | Peer review + lead sign-off |
| Release checklist | Yes (Stage 4) |

### Tier 4 — Major release (multiple features, infra change, dependency upgrade)

All gates mandatory, plus:
- Full regression suite (Stage 3).
- Release checklist (Stage 4).
- Post-release monitoring (Stage 5).
- Metrics capture and retrospective.
- Dependency audit (`vulnerability-scanner`, `supply-chain-guard`).
- Accessibility and performance audit if UI changed significantly.

### Sizing decision guide

```
Does it touch money, auth, or schema?         → At least Tier 3
Does it touch only a .tsx component?          → Tier 2 (or Tier 1 if cosmetic)
Does it touch src/lib/ pure functions?        → Tier 2 + domain tests
Is it a single-line text fix?                 → Tier 1
Are there multiple features or routes?        → Tier 4
```

---

## 10. Cross-team collaboration

### Communication model

| Need | Channel | Cadence |
|---|---|---|
| Defect report | Defect tracker (issue/bug) | As discovered |
| Test plan for a feature | Feature description / PR description | Before development |
| Regression results | PR comment or release notes | Per gate run |
| Release go/no-go | Brief sync or async message | Per release |
| Metrics review | Monthly quality review | Monthly |

### Review & handoff protocol

1. **Developer → Reviewer:** Developer runs the Stage 2 gate, attaches results, and lists what was verified and what was not.
2. **Reviewer → Developer:** Reviewer runs an independent check of at least lint + typecheck + one relevant test, and either approves or requests changes with specific feedback.
3. **Developer → QA (for Tier 3+):** After merge, QA runs Stage 3 regression and records results.
4. **QA → Release:** QA confirms Stage 4 checklist and gives go/no-go.

### Shared artifacts

| Artifact | Location | Purpose |
|---|---|---|
| Test suite | `tests/` | Executable verification |
| This document | `QA_WORKFLOW.md` | Process reference |
| Release checklist | §4 of this document | Release gate |
| Metrics log | Per-release notes (or future dashboard) | Trend tracking |
| Defect tracker | Issues (once git exists) | Defect lifecycle |

---

## 11. Role responsibilities (RACI)

| Activity | Developer | Reviewer | QA / Lead | Product Owner |
|---|---|---|---|---|
| Test planning (Stage 0) | C | I | R | A |
| Test authoring (Stage 1) | R | C | I | I |
| Pre-merge gate (Stage 2) | R | A | I | I |
| Code review | I | R | A | I |
| Regression testing (Stage 3) | C | I | R/A | I |
| Release validation (Stage 4) | C | C | R/A | I |
| Post-release monitoring (Stage 5) | I | I | R/A | I |
| Defect triage | C | I | R/A | C |
| Defect fixing | R | C | I | I |
| Defect verification | I | C | R/A | I |
| Metrics tracking | I | I | R/A | C |

**RACI key:** R = Responsible (does the work), A = Accountable (signs off), C = Consulted, I = Informed.

> In a small team, one person may hold multiple roles. The workflow is designed so that the **same person can be developer and QA** — the gate is the gate regardless of who runs it. What matters is that the check runs and the result is recorded.

---

## 12. Getting started — first steps

If adopting this workflow incrementally:

1. **Add unified test scripts** to `package.json` (§7) — gives a single `npm test` command.
2. **Adopt the developer self-review checklist** (§4) — immediately improves pre-merge quality.
3. **Start tracking defects** with severity levels and the lifecycle (§5) — even in a simple list.
4. **Add regression selection rules** to the team's mental model (§6) — run the right tests for the right changes.
5. **Capture metrics** on the next release (§8) — establishes a baseline.
6. **Set up CI** when a git repository exists — automate the Stage 2 gate.
7. **Add E2E tests** for auth, money, and workshop kiosk — the highest-value browser tests for this project.

---

*This workflow is a living document. Update it when the project's testing infrastructure changes (CI setup, new test framework, git repository creation) or when metrics reveal a pattern that warrants a process change.*
