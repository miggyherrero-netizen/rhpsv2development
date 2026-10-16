# AI Operations Assistant

Owner-only page at **/owner/assistant** ("AI Assistant" in the Owner workspace menu). It has two layers:

| Layer | What it is | Needs AI? |
|---|---|---|
| **Verified facts** | Today's visits, follow-ups, workshop tasks, invoices, maintenance recalls, priorities. Read from the existing app reads. | **No.** Always works. |
| **AI recommendations** | A short report (overview, top 3 priorities, next actions, missing info) written by an AI model from the facts. Shown in a separate box labelled "AI-generated · check before acting". | Yes, optional. **Off by default.** |

It is read-only. It cannot change appointments, invoices, customers or tasks, send any message, or delete anything.

## How the parts connect

```
Owner browser  →  /owner/assistant (page: requireUser + owner role)
                    └─ getOpsSummary()            src/server/ops-summary-data.ts   (reads only)
                         ├─ getDashboardBoard()   existing Today board + finance (stored totals, centavos)
                         ├─ getUntrackedRecalls() existing recalls
                         ├─ getRemindersDue()     existing manual reminders
                         └─ getTaskRows/getProjectRows  existing workshop reads
                    └─ buildOpsSummary()          src/lib/ops-summary.ts           (pure, deterministic)
"Generate report" → POST /api/ops-assistant/report  (session + owner + same-origin + rate limit)
                    └─ minimizeForAi()            src/lib/ops-ai.ts   (aliases, no phones/addresses/notes)
                    └─ AI provider (Anthropic Messages API, no tools)   src/server/ops-ai.ts
                    └─ validateAiReport()         shape, no invented ₱/invoice codes, no "I sent/booked" claims
                    └─ names restored locally, shown to the owner
```

No database table or column was added, so there is **no SQL file to paste**.

## What may leave the app (only when AI is switched on)

**Sent:** today's date; counts; visit times, types and statuses (from fixed lists); task status/priority and whether it is past due;
peso amounts; recall dates. Every record is an opaque code ("Visit 2", "Task 1", "Customer 3", "Staff 1", "Invoice 1", "Recall 1");
the real names, titles and invoice numbers are put back on your server after the reply arrives. At most 25 records per list and
24,000 bytes in total are sent.
**Never sent:** customer or staff names, task/visit titles, notes, reminder text, phone numbers, addresses, e-mail, piano brands/models,
invoice numbers (your invoice prefix is free text), passwords, session data, or anything else in the database. Two independent reviews
found that sending titles, or the invoice code, could leak personal details typed into them, so neither is sent.

**How the reply is checked:** each recommended action must point at a record that exists AND fit that kind of record (payment actions
only for invoices, close-out only for visits still open after their date, tuning plans only for recalls, and so on); its wording is
generated locally from your records. The AI's own sentences (overview, each "why", missing info) must be qualitative: any digit, number
word, money, invoice code, record name, payment/timing status word ("paid", "late", "tomorrow"), link, credential word, "I sent/booked"
claim, invented weekday deadline, or "overdue" recall discards the whole reply. The remaining sentences are still AI wording, so they are
labelled unverified; screening lowers the risk, it does not prove a sentence true.

## Turn it on (Windows, local)

1. Get an API key from your AI provider account. Keep it secret; never paste it into chat, a file in the repo or a commit.
2. Add to your local `.env` file (it is git-ignored):
   ```
   OPS_AI_ENABLED=true
   ANTHROPIC_API_KEY=your-key-here
   ```
   Optional: `OPS_AI_MODEL` (default `claude-haiku-5-5`), `OPS_AI_DAILY_LIMIT` (default 20 reports a day), `OPS_AI_TIMEOUT_MS` (default 20000).
3. Restart the app. The "Generate report" button is enabled.

**Turn it off:** delete `OPS_AI_ENABLED` (or set it to anything but `true`) and restart. The page keeps working with verified facts only.

## Costs

Each report sends a few thousand tokens and returns about 500. Prices change: check your provider's current price list and set a
spending limit in the provider dashboard. The app caps usage with 6 requests per 10 minutes and `OPS_AI_DAILY_LIMIT` per Manila day
(in memory, per server instance, so a restart resets it: the spending limit in your provider account is the hard cap). Verified price figures are not included here on purpose.

## Test it

```
npm run typecheck
npm run lint
npm run test:domain      # includes ops-summary, ops-ai and ops-handler, all with synthetic data (no DB, no network)
npm run build
```
Manual: log in as the owner, open **AI Assistant**, press **Refresh summary**, then **Generate report** (with AI on). A logged-out
request to `/api/ops-assistant/report` returns 401; a non-owner or a request from another site gets 403 (covered by tests/ops-handler.ts).

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Button is disabled | AI is off (no `OPS_AI_ENABLED=true` or no key). Facts still work. |
| "The AI reply did not pass the safety checks" | The reply invented an amount/invoice, claimed an action, or was not the expected JSON. It was discarded. Try again. |
| "The AI service could not be reached" | Network/provider problem or the 20 s timeout. Facts are still correct. |
| "Summary unavailable" | A database read failed. Nothing was changed. Check the app log. |

## Needs the owner's approval

Turning AI on (data sharing), any paid account, deployment, merging the pull request. The assistant itself can never act for you:
booking, messaging customers, invoice or payment changes stay manual in the existing screens.

## AutoGPT decision

**Not integrated.** Direct, server-side use of one AI API call is smaller, cheaper and safer for a daily report.

| | Direct API call (chosen) | AutoGPT platform as a separate service | Plain rules only |
|---|---|---|---|
| Infrastructure | none new | Docker services to host and patch (platform self-host is documented as manual setup; the one-command installer is "not yet available") | none |
| Cost | pay per report | hosting + model keys + upkeep | none |
| Security surface | one outbound call, no tools | long-running agent runtime, triggers, its own credentials | none |
| Fit | one fixed summarize-and-recommend task | built for multi-step autonomous agents (more than needed) | already provided by the verified-facts layer |
| License | n/a | `autogpt_platform/` is Polyform Shield (free for internal business use), `classic/` is MIT | n/a |

I could not find a documented external API/webhook for starting an AutoGPT agent from another app on the project's GitHub page,
so an integration would rest on undocumented behaviour. Revisit if the assistant later needs multi-step autonomous work
(it should still stay read-only until you approve each new permission). Source: github.com/Significant-Gravitas/AutoGPT (README).

## Known limits (from the independent review)

- The page and report read all open workshop tasks/projects, reminders and receivables, then shorten the result. At Herrero's size this is small; if the
  data grows a lot, switch those reads to top-N queries. A 15-second budget stops the page/report from *waiting*; it cannot cancel a database query that is already running.
- The rate limit and daily AI cap are in memory, per server instance: a restart resets them (and two instances double them). Set a spending limit in your AI provider account as the real ceiling.
- The summary loader's read-only guarantee is enforced by tests that read the source of every function it calls. There is no database-level test; add one (a database
  stub that throws on any write) before relying on this in a different deployment.
- The page itself has not been looked at in a browser against real data, and the AI call has never been made with a real key.
