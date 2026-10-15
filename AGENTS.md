# Herrero Pianos — Codex instructions

Read `CODEX.md` before working on this project. It contains the architecture,
validation commands, design constraints, and local skill/agent registry.

Work as a practical, collaborative primary coding assistant:

- Inspect the existing implementation before editing. Preserve working behavior and keep changes relevant.
- Use the lightest process appropriate to the task. Research current patterns for major unfamiliar features, and discuss the approach when it would materially help.
- Resolve routine choices from the code and existing requirements; ask only when a consequential decision cannot be inferred.
- Keep communication friendly, clear, and concise. Explain real technical risks without debating small preferences.
- Validate changed behavior with appropriate checks, investigate failures, and review scope and unintended changes before finishing.
- Report what was verified and what remains unverified. Never claim a check or live workflow passed without evidence.
- Use relevant registered skills. Delegate only when requested or otherwise authorized by applicable instructions; registration alone does not require spawning agents.
- Existing user work must be preserved. Do not expose `.env` values or put credentials into documentation.

## Cloud / GitHub-only checkout (read this if you run in the cloud)

`.codex/` and `.agents/` are git-ignored: the Codex skill adapters and agent TOMLs may not exist in your checkout.
If they are missing, read the originals directly: skills in `.claude/skills/<name>/SKILL.md`, agent role guidance in
`.claude/agents/<name>.md` (they are tracked). Ignore Claude-specific tool names and the "orchestrator" wording in `CLAUDE.md`.

## Hard rules for this project (the owner set these)

- Never touch the live database (Supabase "cerise horizon"), run SQL on production, or ask for or print credentials.
  You have no access to it. Test DB code only against a throw-away local Postgres.
- Do not merge or deploy. Work on a branch named `codex/<topic>` from the latest `main`, open a PR with the real output of
  `npm run typecheck`, `npm run lint`, `npm run test:domain` and `npm run build`, then stop. The owner approves merges.
- A new table/column also needs an additive, idempotent SQL file in `drizzle/manual/` (next number after the highest) and
  the PR must say which file the owner pastes first (CLAUDE.md gotcha 6).
- Invoice money writes only through `src/server/service-invoice-ops.ts` + `withInvoiceLock` (gotcha 7). Do not change
  existing money calculations without asking first.
- Waitlist and recall records are never "overdue": no red overdue styling, no day counts. Never show "N/A" for a piano
  (use "Piano (info needed)" and `PianoInfoBadge`). Maintenance (`/service/maintenance`) is read-only: no SMS/email sending.
- Reply to the owner in short Bisaya/English with tables: what is done, what to check, next step.


- Database backup/restore: `npm run db:export` / `npm run db:import -- <file> [--apply]` (command line; import is CLI only) plus the Settings export button, documented in `docs/BACKUP.md`. Never run them against the live database yourself; imports only go into an empty local database. Never put secrets (password/PIN hashes, sessions) into the export; the exclusion lists are in `src/lib/db-backup.ts`. A new table is exported automatically; a new secret-looking column must be excluded there.

- The Settings page has a "Download a backup" button (`POST /api/backup`, export only, owner + password re-entry + rate limit); it exports from whatever database the app is connected to. Details: `docs/BACKUP.md` section 9. There is no import button; keep it that way.
