import { NextResponse } from "next/server";
import { pool } from "@/db";
import { getUser } from "@/lib/auth";
import { verifyPassword } from "@/lib/security";
import { BACKUP_LOCK_MINUTES, BACKUP_MAX_ATTEMPTS, claimBackupAttempt, resetBackupAttempts } from "@/server/backup-lock";
import { backupFileName, encodeBackup } from "@/lib/db-backup";
import { exportDatabase } from "@/lib/db-backup-io";
import {
  MAX_BODY_BYTES, buildAuditLine, createWindowLimiter, downloadHeaders, isSameOrigin, mapExportError, streamBuffer, type AuditOutcome, type WindowLimiter,
} from "@/lib/backup-download";

/**
 * POST /api/backup - download a complete backup of the business data (EXPORT ONLY; import is a command-line tool).
 * Order of checks: session -> owner -> same origin -> rate limit -> current password -> read-only snapshot export.
 * Same export core as `npm run db:export`: no sessions, password/PIN hashes, share-link hashes or secret settings.
 * Exports from whatever database this deployment is connected to.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as typeof globalThis & { __backupLimiter?: WindowLimiter };
const limiter = (g.__backupLimiter ??= createWindowLimiter());

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });

export async function POST(request: Request) {
  const audit = (outcome: AuditOutcome, userId: string, bytes?: number) =>
    console.info(buildAuditLine({ outcome, userId, forwardedFor: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent"), bytes }));

  // (a) session + role
  const user = await getUser();
  if (!user) return fail(401, "Please log in again.");
  if (user.role !== "owner") { audit("denied", user.id); return fail(403, "Only the owner can download a backup."); }

  // (b) same origin (CSRF)
  const h = request.headers;
  if (!isSameOrigin({ origin: h.get("origin"), secFetchSite: h.get("sec-fetch-site"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), contentType: h.get("content-type") })) {
    audit("denied", user.id);
    return fail(403, "This request did not come from the app.");
  }

  // (c) in-memory limiter (extra layer, per server instance) + the atomic durable lock. The attempt is counted BEFORE the
  // slow password check; if the lock table cannot be used we FAIL CLOSED (503, nothing exported).
  const rate = limiter.hit(user.id);
  if (!rate.ok) {
    audit("rate_limited", user.id);
    return fail(429, `Too many tries. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).`, { "Retry-After": String(rate.retryAfterSec) });
  }
  let claim;
  try {
    claim = await claimBackupAttempt(pool, user.id);
  } catch (err) {
    console.error("[backup] lock unavailable:", (err as { code?: string }).code ?? "error");
    audit("unavailable", user.id);
    return fail(503, "Backup is temporarily unavailable.");
  }
  if (!claim.allowed) {
    audit("locked", user.id);
    return fail(429, `Too many wrong passwords. The backup is locked for ${BACKUP_LOCK_MINUTES} minutes.`, { "Retry-After": String(claim.retryAfterSec) });
  }

  // (d) current password (never logged)
  let password = "";
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY_BYTES) {
      const body = JSON.parse(text) as { password?: unknown };
      if (typeof body.password === "string") password = body.password;
    }
  } catch { /* falls through to the wrong-password answer */ }
  if (!password || !verifyPassword(password, user.passwordHash)) {
    audit("wrong_password", user.id);
    return fail(403, `Wrong password. (${BACKUP_MAX_ATTEMPTS} tries in a row lock the backup for ${BACKUP_LOCK_MINUTES} minutes.)`);
  }
  try {
    await resetBackupAttempts(pool, user.id);
  } catch {
    audit("unavailable", user.id);
    return fail(503, "Backup is temporarily unavailable.");
  }

  // (e) read-only snapshot with a client from the app's pool; on ANY error the client is destroyed, not returned to the pool
  let bytes: Buffer;
  const when = new Date();
  const client = await pool.connect().catch(() => null);
  if (!client) { audit("unavailable", user.id); return fail(503, "The database is not reachable right now. Nothing was downloaded."); }
  let failure: Error | undefined;
  try {
    bytes = encodeBackup(await exportDatabase(client, when, { timeoutMs: 45_000 }));
  } catch (err) {
    failure = err instanceof Error ? err : new Error("export failed");
    const f = mapExportError(err);
    console.error("[backup] export failed:", (err as { code?: string }).code ?? f.status);
    audit("failed", user.id);
    return fail(f.status, f.error);
  } finally {
    client.release(failure);
  }

  // (f) streamed attachment
  audit("ok", user.id, bytes.length);
  return new Response(streamBuffer(bytes), { status: 200, headers: downloadHeaders(backupFileName(when), bytes.length) });
}
