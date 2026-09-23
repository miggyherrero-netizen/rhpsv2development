# Home Service documents

This branch adds a printable invoice and a separate payment acknowledgement for **each** recorded payment. From an invoice, choose **Print / PDF / Share**; from an individual payment, choose **Receipt / PDF / Share**. Printing and saving as PDF use the browser's native print dialog (choose *Save as PDF*). No PDF file is stored on the server.

## Before using live share links

1. First apply the code commit. On a backed-up **local/test** PostgreSQL database, review `src/db/schema.ts` and Drizzle's proposed SQL, then apply the additive schema changes: the earlier Home Service settings columns plus the new `service_document_shares` table. `drizzle.config.ts` falls back to a local URL if `DATABASE_URL` is missing; verify the actual target before any `npx drizzle-kit push`. Do not run a blind push against production. Docker's `init-db.sh` already calls `drizzle-kit push` when the web container starts, so back up and review before redeploying that setup.
2. Configure the real `DATABASE_URL`, deploy the updated app, and verify the public `/share/service/[token]` route is reachable on your HTTPS site. Links created on localhost point to localhost and are not customer-accessible.
3. On a real invoice: verify the A4 print/PDF layout and per-payment receipt, create a link, open it in a private browser, revoke it and verify it returns 404. Links also expire after 14 days; deleting a payment or invoice removes its links. Voided invoices' links return 404.
4. Confirm the registered business details, tax language, and numbering with your accountant before calling any document an official tax document. A receipt here is **payment acknowledgement only**. Receipt codes are derived from payment IDs; the full payment ID appears on the receipt.

Only owners can create/revoke links. The database stores SHA-256 token hashes, not the bearer tokens; the copyable link is shown when created and cannot be recovered later. Anyone possessing an active link can read that document, without logging in. Share it privately. Links show the **current** invoice data, not an immutable copy. The existing Home Service invoice records are shared workspace data rather than owner-scoped; if this becomes multi-tenant, enforce invoice ownership before exposing sharing to other owners.

Verification: `npm run typecheck`, `npm run build` (needs `DATABASE_URL`), `npm run test:service`, `npx tsx tests/service-documents.ts`.
