"use strict";
// Read-only GitHub snapshot and provisional static reviews; owner ratings live separately in browser storage.
window.AI_WORK_SEED = [
  {
    "id": "github-pr-37",
    "agent": "Claude Code · model not recorded (PR / commit attribution)",
    "title": "PR #37 · Settings: \"Download a backup\" button (POST /api/backup, export only)",
    "status": "Merged",
    "url": "https://github.com/miggyherrero-netizen/rhpsv2development/pull/37",
    "workDate": "2026-10-15",
    "ownerRating": null,
    "ownerNotes": "",
    "review": {
      "scores": {
        "Correctness": 3,
        "Safeguards": 4,
        "Maintainability": 4,
        "Verification": 3
      },
      "summary": "Useful owner-only backup UI with layered checks and clear handling of failures. Follow up on request-size enforcement and lockout wording before treating the safeguards as fully demonstrated.",
      "scope": "Read route, download helpers, lock SQL, UI, export I/O, Next headers, and non-DB tests; inspected merged diff. No live export performed.",
      "strengths": [
        "Owner role, same-origin, password re-entry and attempt checks precede export. A failed durable lock check returns 503.",
        "Backup reuses the read-only export core and strips excluded secrets. Failure releases the pooled connection with an error.",
        "UI clears the password field and exposes pending, error and success states."
      ],
      "findings": [
        "P2 — src/app/api/backup/route.ts: request.text() reads the entire request before checking text.length <= MAX_BODY_BYTES. This is not a streaming byte limit. Enforce a byte cap while reading; check Content-Length as an early rejection, then verify actual bytes.",
        "P2 — src/server/backup-lock.ts allows attempts 1–5 and sets the lock on attempt 6. UI says five wrong passwords lock for 15 minutes, while the per-instance limiter blocks the sixth attempt for its own 10-minute window first. Align the wording, thresholds and tests.",
        "Follow-up — export builds all JSON and gzip in memory before streaming. The DB statement timeout does not bound total export/encoding time; test representative large backups against the hosting limits."
      ],
      "checks": [
        "On merged main 8c8dc76: backup-route non-DB suite passed 36 checks; db-backup suite passed 86 checks as part of npm run test:domain (1,314 total, 0 failures).",
        "GitHub head check observed: Vercel Preview Comments = success. This is not a test-suite result."
      ],
      "limits": [
        "No password flow, concurrent DB lock, actual export download, or database round-trip run in this review.",
        "The PR author's integration/security claims were read, not independently reproduced.",
        "Static review is of the merged revision; pure tests ran on latest main, not an isolated historical PR head."
      ],
      "sources": [
        {
          "label": "Route + body limit",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/src/app/api/backup/route.ts"
        },
        {
          "label": "Atomic lock SQL",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/src/server/backup-lock.ts"
        },
        {
          "label": "Backup UI + lockout text",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/src/components/service-backup-card.tsx"
        },
        {
          "label": "Helpers and streaming",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/src/lib/backup-download.ts"
        },
        {
          "label": "Export I/O",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/src/lib/db-backup-io.ts"
        },
        {
          "label": "Non-DB checks",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8c8dc76c74ff7c348e778cdffe26b9691846a19f/tests/backup-route.ts"
        }
      ],
      "sha": "8c8dc76c74ff7c348e778cdffe26b9691846a19f",
      "reviewedAt": "2026-10-16 (Asia/Manila)"
    }
  },
  {
    "id": "github-pr-36",
    "agent": "Claude Code · model not recorded (PR / commit attribution)",
    "title": "PR #36 · Complete-database export/import (command-line): db:export and db:import",
    "status": "Merged",
    "url": "https://github.com/miggyherrero-netizen/rhpsv2development/pull/36",
    "workDate": "2026-10-15",
    "ownerRating": null,
    "ownerNotes": "",
    "review": {
      "scores": {
        "Correctness": 4,
        "Safeguards": 4,
        "Maintainability": 4,
        "Verification": 3
      },
      "summary": "Strong separation of pure backup rules and database I/O, with explicit exclusions, transactional imports and integrity checks. Confidence is limited by the unexecuted database round-trip and backup size envelope.",
      "scope": "Read export/import CLIs, registry/serialization/validation/host guards/load planning, database I/O and pure tests; inspected merged changes. No database connected.",
      "strengths": [
        "Read-only repeatable-read export; excluded session/token/password/PIN data and allow-listed settings.",
        "Import defaults to dry run, rejects populated targets, takes locks before the transactional emptiness re-check, and verifies table counts and hashes before commit.",
        "Schema registry, quoted identifiers, parameterized batch loads, cycle handling and generated replacement credentials are separated from CLI I/O."
      ],
      "findings": [
        "Follow-up — export has no size cap matching MAX_BACKUP_FILE_BYTES (200 MB compressed) and MAX_BACKUP_JSON_BYTES (512 MB decompressed). A sufficiently large successful export can therefore be refused by the importer. Enforce/document a shared envelope and test the boundary.",
        "Follow-up — checkDatabaseMatchesSchema compares names of tables/columns, not actual database SQL types or nullability. The fingerprint is derived from app code. Test and document how database type drift is rejected during export/import.",
        "Operational limit — export/import hold complete backup data in memory, with JSON, sorting and gzip copies. Establish a supported size and measure peak memory."
      ],
      "checks": [
        "On merged main 8c8dc76: db-backup non-DB suite passed 86 checks, including exclusions, tampering, decompression limits, ordering and host guards.",
        "GitHub head check observed: Vercel Preview Comments = success; no domain CI result inferred."
      ],
      "limits": [
        "No export/import CLI execution or SQL integration test was performed. No live database was accessed.",
        "Round-trip, rollback, locking, generated credentials and sequence behavior still need a throw-away local PostgreSQL verification.",
        "Current main includes PR #37 changes to export I/O; historical tests were not rerun in isolation."
      ],
      "sources": [
        {
          "label": "Pure backup core + size caps",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/src/lib/db-backup.ts"
        },
        {
          "label": "Snapshot / import transaction",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/src/lib/db-backup-io.ts"
        },
        {
          "label": "Export CLI",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/scripts/db-export.ts"
        },
        {
          "label": "Import CLI",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/scripts/db-import.ts"
        },
        {
          "label": "Pure tests",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/tests/db-backup.ts"
        },
        {
          "label": "DB test available, not executed",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/8a52bac3a577f2f2f402eaafa6bc730eeed67fc6/tests/db-backup-db.ts"
        }
      ],
      "sha": "8a52bac3a577f2f2f402eaafa6bc730eeed67fc6",
      "reviewedAt": "2026-10-16 (Asia/Manila)"
    }
  },
  {
    "id": "github-pr-35",
    "agent": "Claude Code · model not recorded (PR / commit attribution)",
    "title": "PR #35 · Docs: make AGENTS.md / CODEX.md work for a cloud (GitHub-only) Codex checkout",
    "status": "Merged",
    "url": "https://github.com/miggyherrero-netizen/rhpsv2development/pull/35",
    "workDate": "2026-10-14",
    "ownerRating": null,
    "ownerNotes": "",
    "review": {
      "scores": {
        "Correctness": 4,
        "Safeguards": 4,
        "Maintainability": 4,
        "Verification": 3
      },
      "summary": "Clearer cloud-checkout instructions and useful owner constraints. The fallback files exist in the clone; some architecture and test-count guidance remains stale.",
      "scope": "Read complete merged AGENTS.md/CODEX.md diff, checked tracked fallback folders, npm scripts and current route structure. Documentation review, not an application feature test.",
      "strengths": [
        "Explains why ignored .agents/.codex adapters disappear and points to tracked .claude sources.",
        "Owner rules cover live DB access, branch/PR review, migrations, money writes and read-only maintenance.",
        "Corrects the previous statement that npm test does not exist and distinguishes DB-dependent tests."
      ],
      "findings": [
        "P3 — CODEX.md route table at this PR revision omits the already-existing /os workspace, so it is not a complete architecture map.",
        "P3 — the approximately 1,190 domain-check count is a snapshot that quickly drifts (current main produces 1,314). Prefer the command as the source of truth or label the count with its revision.",
        "Limit — these instructions alone do not demonstrate automatic skill discovery in a fresh cloud Codex session."
      ],
      "checks": [
        "Verified the .claude skill/agent source paths exist in the clean GitHub clone and package.json defines test/test:domain.",
        "Read the merged documentation diff; no app implementation changes in this PR.",
        "GitHub head check observed: Vercel Preview Comments = success."
      ],
      "limits": [
        "No fresh cloud agent session launched to validate skill loading.",
        "Rating concerns documentation correctness and usability, not application runtime behavior."
      ],
      "sources": [
        {
          "label": "Cloud fallback + owner rules",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/b3cfc6d768143e1e3462b0a59807cfee447d7759/AGENTS.md"
        },
        {
          "label": "Project guide / route table",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/b3cfc6d768143e1e3462b0a59807cfee447d7759/CODEX.md"
        },
        {
          "label": "Actual commands",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/b3cfc6d768143e1e3462b0a59807cfee447d7759/package.json"
        }
      ],
      "sha": "b3cfc6d768143e1e3462b0a59807cfee447d7759",
      "reviewedAt": "2026-10-16 (Asia/Manila)"
    }
  },
  {
    "id": "github-pr-34",
    "agent": "Claude Code · model not recorded (PR / commit attribution)",
    "title": "PR #34 · Service: Maintenance (Phase 1) — read-only preview + consent table (manual SQL 12)",
    "status": "Merged",
    "url": "https://github.com/miggyherrero-netizen/rhpsv2development/pull/34",
    "workDate": "2026-10-14",
    "ownerRating": null,
    "ownerNotes": "",
    "review": {
      "scores": {
        "Correctness": 4,
        "Safeguards": 4,
        "Maintainability": 4,
        "Verification": 3
      },
      "summary": "Well-separated read-only maintenance preview with Manila-day policy and explicit consent gating. Remaining concerns are summary clarity at the row cap and unverified database behavior.",
      "scope": "Read policy, data loader, page/UI, additive migration and pure/static tests; inspected merged schema/nav changes. Database and visual flows not executed for this PR.",
      "strengths": [
        "Page requires a session; data loader reads existing recalls and contact/consent data without sending or scheduling messages.",
        "Pure policy shares Manila day boundaries; no consent blocks electronic channels, opt-out and booked recalls are conservative.",
        "Additive idempotent consent migration and missing-table fallback exist; static guard checks forbidden write/send imports."
      ],
      "findings": [
        "P3 — summary counts are computed from rows after the 200-row cap, so the top statistics are partial when truncated. Label those statistics as 'shown' or aggregate the full eligible result separately.",
        "Follow-up — electronic readiness checks non-empty addresses/phones, not deliverability, and no consent capture exists yet. Keep these as preview eligibility, not a send-ready guarantee.",
        "Follow-up — missing-table fallback and booked/open recall selection need local DB scenarios; the static guard cannot prove transitive code has no effects."
      ],
      "checks": [
        "On current main: service-maintenance pure suite passed 32 checks, including Manila boundaries and eligibility combinations.",
        "On current main: service-maintenance-readonly static guard passed 29 checks.",
        "GitHub head check observed: Vercel Preview Comments = success."
      ],
      "limits": [
        "No service-maintenance-db run, migration execution, authenticated page interaction or screenshot review for the historical PR.",
        "Phase 1 explicitly has no sends, consent-edit screen or queue; rating is for that limited scope."
      ],
      "sources": [
        {
          "label": "Day and consent policy",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/src/lib/maintenance-policy.ts"
        },
        {
          "label": "Data loader / row cap",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/src/server/maintenance-data.ts"
        },
        {
          "label": "Maintenance view",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/src/components/service-maintenance.tsx"
        },
        {
          "label": "Session-guarded page",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/src/app/service/maintenance/page.tsx"
        },
        {
          "label": "Additive migration",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/drizzle/manual/12_maintenance_notifications.sql"
        },
        {
          "label": "Policy tests",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/tests/service-maintenance.ts"
        },
        {
          "label": "Read-only guard",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/4fa0eb603eefaf191561d07bed907f6fd60fa305/tests/service-maintenance-readonly.ts"
        }
      ],
      "sha": "4fa0eb603eefaf191561d07bed907f6fd60fa305",
      "reviewedAt": "2026-10-16 (Asia/Manila)"
    }
  },
  {
    "id": "github-pr-33",
    "agent": "Claude Code · model not recorded (PR / commit attribution)",
    "title": "PR #33 · Add 3 reconciliation/finance skills (gl-recon, break-trace, variance-commentary)",
    "status": "Merged",
    "url": "https://github.com/miggyherrero-netizen/rhpsv2development/pull/33",
    "workDate": "2026-10-14",
    "ownerRating": null,
    "ownerNotes": "",
    "review": {
      "scores": {
        "Correctness": 3,
        "Safeguards": 4,
        "Maintainability": 3,
        "Verification": 2
      },
      "summary": "Useful text-only finance skill imports, but the body instructions remain oriented toward institutional finance connectors rather than the atelier's data and integer-centavo conventions.",
      "scope": "Read all three imported SKILL.md files and CLAUDE.md diff. Review of instruction content only; no financial analysis or ledger operations performed.",
      "strengths": [
        "Each imported skill includes a local Herrero note naming relevant service tables and preserving the invoice operations boundary.",
        "Reconciliation treats extracts as untrusted data, and cause classification is explicitly a hypothesis.",
        "Variance commentary says to flag an unclear driver instead of inventing an explanation."
      ],
      "findings": [
        "P2 — break-trace steps still tell the agent to fetch from internal-gl/subledger MCP, and variance-commentary also names internal-gl after the note says those connectors do not exist. Rewrite the actual steps with local data/file inputs, not only a prefatory warning.",
        "P3 — gl-recon prescribes two-decimal numerics and a default 0.01 tolerance without mapping to integer centavos. Define units and rounding before comparing service_* amounts to bank/GCash exports.",
        "Follow-up — no worked Herrero example demonstrates duplicate payments, timing differences or a zero-prior-period variance. Add representative examples before treating these skills as operationally verified."
      ],
      "checks": [
        "Read all three complete skill bodies and their registration diff; this change adds instructions, not executable app code.",
        "GitHub head check observed: Vercel Preview Comments = success; this does not evaluate skill effectiveness."
      ],
      "limits": [
        "No sample reconciliation, skill invocation, ledger write, or financial dataset processed.",
        "No overall model ranking inferred from these five tasks; agent model/version is not stated in the metadata."
      ],
      "sources": [
        {
          "label": "Reconciliation skill",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/e735ae5db1791f3df7dae8da3063a6eb4e2d69f1/.claude/skills/gl-recon/SKILL.md"
        },
        {
          "label": "Break tracing skill",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/e735ae5db1791f3df7dae8da3063a6eb4e2d69f1/.claude/skills/break-trace/SKILL.md"
        },
        {
          "label": "Variance commentary skill",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/e735ae5db1791f3df7dae8da3063a6eb4e2d69f1/.claude/skills/variance-commentary/SKILL.md"
        },
        {
          "label": "Skill registration",
          "url": "https://github.com/miggyherrero-netizen/rhpsv2development/blob/e735ae5db1791f3df7dae8da3063a6eb4e2d69f1/CLAUDE.md"
        }
      ],
      "sha": "e735ae5db1791f3df7dae8da3063a6eb4e2d69f1",
      "reviewedAt": "2026-10-16 (Asia/Manila)"
    }
  }
];
