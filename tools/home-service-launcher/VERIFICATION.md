# AI work tracker verification — October 16, 2026

Base: `8c8dc76c74ff7c348e778cdffe26b9691846a19f` from `main`. Implementation branch: `codex/ai-work-tracker`.

This PR includes the existing local launcher baseline because `tools/home-service-launcher` was absent from GitHub. Its server, app script and original stylesheet were copied unchanged from the owner's running local dashboard. The tracker adds static assets and markup; no launcher restart, app-server restart, database access, migration, merge or production deployment was performed.

## Actual command results

Windows checkout paths contain `&`. Initial npm scripts using the default cmd shell failed to resolve `.bin` commands. With process-local `npm_config_script_shell=powershell.exe`:

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Exit 0 (`tsc --noEmit`) |
| `npm run lint` | Exit 0 (`eslint .`), including completed tracker and browser test files |
| `npm run test:domain` | Exit 0: `Total: 1314 passed, 0 failed, 38 suites` |
| `npm run build` | Exit 1: Turbopack rejected the reused node_modules junction because it points outside its filesystem root |
| `npm run build -- --webpack` | Exit 0: compiled successfully, TypeScript passed, 5/5 static pages generated, route list printed |
| `node --check tools/home-service-launcher/public/tracker.js` | Exit 0 |
| `node --check tools/home-service-launcher/public/tracker-seed.js` | Exit 0 |
| `git diff --check` | Exit 0 |
| `node tools/home-service-launcher/test-tracker.cjs` | Exit 0; browser checks listed below |

Build used only a dummy connection URL pointing at `127.0.0.1:1` and `DATABASE_SSL=false` in the fresh clone, which has no copied environment files. No database operations were run. Build success does not verify database-backed routes.

Browser test used the existing server at `http://127.0.0.1:4310` and bundled Playwright in an isolated browser context. It passed seed loading (5 entries), owner rating and notes persistence after reload, preservation of imported review evidence, escaped HTML in notes, unsafe URL rejection, task creation, search, status filtering, exported JSON, rejection of invalid imports without data loss, backup restoration, multi-tab conflict handling, 390px horizontal overflow check, expandable evidence, storage-quota failure handling, entry deletion, corrupt-storage preservation, and absence of JavaScript page errors. The mobile screenshot was visually inspected. No launcher process-control buttons were exercised.

## Historical review limits

Reviews concern merged revisions of PRs #33–#37, not every commit ever written by Claude. Agent attribution comes from PR/commit metadata; model versions are unknown. Pure tests ran on the latest merged `main` rather than five isolated historical heads. Only `Vercel Preview Comments` check-runs were observed at those PR heads; they are not treated as code test results. Database integration, real backup exports/imports, authenticated historical UI workflows and hosting limits were not independently reproduced. Each tracker record discloses these limits alongside findings and source links.

Tracker data is browser-local and GitHub metadata is a manual snapshot. Export/import is the backup mechanism for owner edits. No automatic future PR import, review scheduling or live GitHub synchronization is implemented.
