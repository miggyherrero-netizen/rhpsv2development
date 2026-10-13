/**
 * Guard: Maintenance Phase 1 is READ-ONLY. The maintenance files must not write to the database, import any mutation / Server
 * Action module, or reach a mail / SMS provider or the network. A static check on the source (comments stripped).
 * Run: npx tsx tests/service-maintenance-readonly.ts
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`); }
}

const FILES = ["src/lib/maintenance-policy.ts", "src/server/maintenance-data.ts", "src/components/service-maintenance.tsx", "src/app/service/maintenance/page.tsx"];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FORBIDDEN: [string, RegExp][] = [
  ["no insert / update / delete", /\.(insert|update|delete)\s*\(/],
  ["no raw SQL execution", /\.execute\s*\(|\bsql`/],
  ["no transaction", /\.transaction\s*\(/],
  ["not a Server Action module", /["']use server["']/],
  ["no mutation modules imported", /from\s+["']@\/server\/(service|service-invoice-ops|service-invoice-core|service-waitlist|service-waitlist-core|service-recall|service-new-customer|service-new-customer-actions|service-reminders|admin|owner|workshop|auth-actions|public-actions)["']/],
  ["no mail / SMS provider or network", /nodemailer|twilio|sendgrid|resend|mailgun|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendMail|sendSms|child_process/i],
  ["no scheduler / cron", /node-cron|setInterval|setTimeout|cron/i],
];

for (const f of FILES) {
  const src = strip(readFileSync(f, "utf8"));
  for (const [what, re] of FORBIDDEN) {
    const m = src.match(re);
    check(`${f}: ${what}`, !m, m?.[0]);
  }
}

const data = strip(readFileSync("src/server/maintenance-data.ts", "utf8"));
const tables = [...data.matchAll(/\.from\((\w+)\)/g)].map((m) => m[1]).sort();
check("only reads these tables", tables.join() === ["serviceCustomers", "serviceNotificationPreferences", "servicePianos", "serviceWaitlistEntries"].sort().join(), tables);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nMaintenance read-only guard passed.");
