# Patch & update log

## October 16, 2026 — AI work tracker

- Added editable AI task records, status filters, search, owner ratings and review notes.
- Imported PRs #33–#37 from miggyherrero-netizen/rhpsv2development with provisional Codex reviews of the actual merged code/instructions.
- Each review records its revision, four score dimensions, findings, source links, observed checks and verification limits.
- Owner ratings remain separate from Codex scores; no overall agent leaderboard is inferred.
- Records save in this browser/origin. Export/import JSON backups preserve notes and evidence; there is no automatic GitHub sync.
- Existing launcher controls and server process remain unchanged.

## October 15, 2026 — Local control center

- Added a one-click local launcher for the Home Service workspace.
- Added safe Start, Stop, and Restart controls for the Next.js development server.
- Added live online status checks for localhost:3000.
- Added a scrolling runtime log for development-server output.
- Added this local patch log with an honest fallback when Git history is unavailable.
- The launcher listens only on 127.0.0.1 and will not stop a server it did not start.

## How updates appear here

Add a dated section to tools/home-service-launcher/PATCH_NOTES.md whenever the local launcher changes. If this project later gains a Git repository, recent commits will also appear below these notes automatically.
