/** "Download a backup" button: pure helpers + static guard on the route. No database, no server. Run: npx tsx tests/backup-route.ts */
import { readFileSync } from "node:fs";
import {
  buildAuditLine, createWindowLimiter, downloadHeaders, fileNameFromDisposition, formatBytes, isSameOrigin, mapExportError, streamBuffer,
} from "../src/lib/backup-download";
import { backupFileName } from "../src/lib/db-backup";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

console.log("file name + headers");
const name = backupFileName(new Date("2026-10-15T08:09:10Z"));
check("file name pattern", name, "herrero-backup-20261015-080910.json.gz");
const hd = downloadHeaders(name, 1234);
check("download headers", [hd["Content-Type"], hd["Cache-Control"], hd["X-Content-Type-Options"], hd["Content-Disposition"], hd["Content-Length"]], ["application/gzip", "no-store", "nosniff", `attachment; filename="${name}"`, "1234"]);
check("file name read back from Content-Disposition", [fileNameFromDisposition(hd["Content-Disposition"]!, "x"), fileNameFromDisposition(null, "fallback.gz"), fileNameFromDisposition('attachment; filename="../../etc"', "safe.gz")], [name, "fallback.gz", "safe.gz"]);
check("size labels", [formatBytes(12), formatBytes(2048), formatBytes(5 * 1024 * 1024)], ["12 B", "2.0 KB", "5.0 MB"]);

console.log("\nstreaming");
async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  return chunks;
}
const big = Buffer.from(Array.from({ length: 250_000 }, (_, i) => i % 251));
const streamingDone = (async () => {
const chunks = await readAll(streamBuffer(big, 64 * 1024));
check("250 KB becomes 4 chunks of at most 64 KB", [chunks.length, Math.max(...chunks.map((c) => c.length)) <= 65536], [4, true]);
check("chunks re-assemble to the same bytes", Buffer.concat(chunks).equals(big), true);
check("empty buffer gives an empty, closed stream", (await readAll(streamBuffer(Buffer.alloc(0)))).length, 0);
})();

console.log("\nsame-origin (CSRF) check");
const ok = { origin: "https://app.example.com", secFetchSite: "same-origin", host: "app.example.com", contentType: "application/json" };
check("same origin accepted", isSameOrigin(ok), true);
check("no Origin header refused", isSameOrigin({ ...ok, origin: null }), false);
check("other site refused", isSameOrigin({ ...ok, origin: "https://evil.example.net" }), false);
check("sec-fetch-site cross-site / same-site / none refused", ["cross-site", "same-site", "none"].map((s) => isSameOrigin({ ...ok, secFetchSite: s })), [false, false, false]);
check("missing sec-fetch-site is fine when Origin matches (older browsers)", isSameOrigin({ ...ok, secFetchSite: null }), true);
check("lookalike host refused", isSameOrigin({ ...ok, origin: "https://app.example.com.evil.net" }), false);
check("form content type refused", isSameOrigin({ ...ok, contentType: "application/x-www-form-urlencoded" }), false);
check("X-Forwarded-Host: comma-separated list uses the first value only", [isSameOrigin({ ...ok, host: "internal:3000", forwardedHost: "app.example.com, proxy.internal" }), isSameOrigin({ ...ok, host: "internal:3000", forwardedHost: "proxy.internal, app.example.com" })], [true, false]);
check("X-Forwarded-Host accepted when it matches", isSameOrigin({ ...ok, host: "internal:3000", forwardedHost: "app.example.com" }), true);
check("garbage origin refused", isSameOrigin({ ...ok, origin: "not a url" }), false);
check("port must match", isSameOrigin({ ...ok, origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }) && !isSameOrigin({ ...ok, origin: "http://127.0.0.1:3100", host: "127.0.0.1:3101" }), true);

console.log("\nrate limit");
const lim = createWindowLimiter(3, 600_000);
const t0 = 1_000_000;
check("3 allowed then blocked with Retry-After", [lim.hit("u", t0).ok, lim.hit("u", t0 + 1000).ok, lim.hit("u", t0 + 2000).ok, lim.hit("u", t0 + 3000)], [true, true, true, { ok: false, retryAfterSec: 597 }]);
check("other users are not affected", lim.hit("v", t0 + 3000).ok, true);
check("allowed again after the window", lim.hit("u", t0 + 600_001).ok, true);

console.log("\nerror mapping");
const schema = mapExportError(new Error("The database does not match this version of the app (table \"x\" is missing). Nothing was exported."));
check("schema behind -> 409 + manual SQL hint, no table names", [schema.status, schema.error.includes("drizzle/manual/README.md"), schema.error.includes("table")], [409, true, false]);
check("unknown settings key -> 422 naming the key only", mapExportError(new Error("The settings table has key(s) the backup does not know: mystery. Nothing was exported. If they are...")).error.includes("mystery"), true);
check("unknown settings key containing a dot is not truncated", mapExportError(new Error("The settings table has key(s) the backup does not know: a.b, c. Nothing was exported. If they")).error.includes("a.b, c"), true);
const other = mapExportError(new Error('connect ECONNREFUSED postgres://user:pw@host/db SELECT * FROM users'));
check("anything else -> 500 generic: no SQL, URL or password", [other.status, /postgres|SELECT|pw|ECONN/.test(other.error)], [500, false]);

console.log("\naudit line");
const line = JSON.parse(buildAuditLine({ outcome: "wrong_password", userId: "u-1", ts: new Date("2026-10-15T00:00:00Z"), forwardedFor: "203.0.113.5, 10.0.0.1", userAgent: "x".repeat(200), bytes: undefined }));
check("fields: audit, outcome, userId, ts, ip (first x-forwarded-for), ua (80 chars), bytes", [Object.keys(line), line.ip, line.ua.length], [["audit", "outcome", "userId", "ts", "ip", "ua", "bytes"], "203.0.113.5", 80]);
check("no password / e-mail fields ever", JSON.stringify(Object.keys(line)).match(/pass|mail/i), null);

console.log("\nroute source guard (export only)");
const route = readFileSync("src/app/api/backup/route.ts", "utf8");
const imports = [...route.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
check("route imports only the allowed modules", imports.sort(), ["@/db", "@/lib/auth", "@/lib/backup-download", "@/lib/db-backup", "@/lib/db-backup-io", "@/lib/security", "@/server/backup-lock", "next/server"].sort());
check("no mutation Server Actions, import core, or secret generators", /@\/server\/(admin|owner|service|workshop|public-actions|auth-actions)|importDatabase|makeTemporaryPassword|GENERATED_ON_IMPORT|hashPassword|hashPin|\.insert\(|\.update\(|\.delete\(/.test(route), false);
check("session + owner + origin + password checks come before the export, in that order", ["getUser()", 'user.role !== "owner"', "isSameOrigin(", "limiter.hit(", "claimBackupAttempt(", "verifyPassword(", "exportDatabase("].map((s) => route.indexOf(s)).every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1]!)), true);
check("dynamic, nodejs runtime, maxDuration 60", [/dynamic = "force-dynamic"/.test(route), /runtime = "nodejs"/.test(route), /maxDuration = 60/.test(route)], [true, true, true]);
const lock = readFileSync("src/server/backup-lock.ts", "utf8");
check("lock helper only touches gos_login_attempts, in single atomic statements", [/ON CONFLICT \(email\) DO UPDATE/.test(lock), (lock.match(/gos_login_attempts/g) ?? []).length >= 2, /from "[^"]*(login-attempts|lockout)/.test(lock)], [true, true, false]);
check("route fails closed (503) and destroys the client on error", [/status|fail\(503, "Backup is temporarily unavailable\."/.test(route), /client\.release\(failure\)/.test(route), /timeoutMs: 45_000/.test(route)], [true, true, true]);
const cfg = readFileSync("next.config.ts", "utf8");
check("anti-framing headers only for /service/settings and /api/backup", [/source: "\/service\/settings"/.test(cfg), /source: "\/api\/backup"/.test(cfg), /source: "\/:path\*"/.test(cfg), /frame-ancestors 'none'/.test(cfg)], [true, true, false, true]);
check("no GET handler (POST only)", /export async function GET/.test(route), false);
check("UI sends the password only in the POST body", /body: JSON.stringify\(\{ password \}\)/.test(readFileSync("src/components/service-backup-card.tsx", "utf8")) && !/\/api\/backup\?/.test(readFileSync("src/components/service-backup-card.tsx", "utf8")), true);

streamingDone.then(() => {
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll backup-route checks passed");
});
