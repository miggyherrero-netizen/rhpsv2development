# Home Service Launcher

A dependency-free, localhost-only control center for the Next.js Home Service workspace.

## Run

Run from the project root:

```powershell
node tools/home-service-launcher/server.js
```

Then open <http://127.0.0.1:4310>.

## Boundaries

- The control server binds only to `127.0.0.1:4310`.
- It invokes the installed Next.js CLI through Node with fixed arguments and binds the app to `127.0.0.1:3000`.
- Start, Stop, and Restart use a fixed action allowlist; no command comes from browser input.
- Runtime output is bounded in memory and common secret/token patterns are redacted before display.
- Stop and Restart are allowed only for the child process created by this launcher.
- If another terminal already owns port 3000, the UI reports an external online process and keeps destructive controls disabled.
- `PATCH_NOTES.md` is always available. Git history appears only when the project is actually a Git repository.

Closing the background launcher process also stops a development server that it owns.

## AI work tracker

The same page includes five historical PR records (#33–#37) and provisional Codex reviews. `public/tracker-seed.js` stores the initial snapshot; each review points at the actual merged revision. GitHub attribution identifies Claude Code but does not identify the model version. PR status is a snapshot, not a live feed.

Use **Add work** for new tasks and **Edit / rate** to record your rating (1–5), status and notes. Review scores stay separate from owner ratings. Expand a review to see findings, checks and limitations. Search and status filters help locate earlier work.

Records persist in `localStorage` under `herrero-ai-work-v1`, scoped to the browser and exact address. `localhost:4310` and `127.0.0.1:4310` have different storage. Clearing site data removes edits; private browsing may not retain them. Export a JSON backup regularly and import it to restore or move browsers. Import replaces records after validation and confirmation. No credentials, production database, or GitHub writes are needed for the tracker. This is a manual tracker; it does not automatically collect future PRs or reviews.

## Verification

`test-tracker.cjs` exercises the tracker in an isolated browser context against the running launcher, including persistence, review preservation, import/export, unsafe links, storage failures and narrow layouts. It requires an available Playwright package/browser; production launcher code has no dependencies.

```powershell
node tools/home-service-launcher/test-tracker.cjs
```

If Playwright is bundled outside the checkout, set `PLAYWRIGHT_MODULE` to its absolute package directory. The test does not press Start/Stop/Restart or touch the owner's existing browser storage.
