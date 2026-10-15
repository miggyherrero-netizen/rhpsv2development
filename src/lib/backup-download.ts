/**
 * Pure helpers for the "Download a backup" button (POST /api/backup). EXPORT ONLY: nothing here writes to the database.
 * The data itself comes from the same core as `npm run db:export` (src/lib/db-backup.ts + db-backup-io.ts).
 */

/** Max JSON body accepted by the route (the body is just {"password": "..."}). */
export const MAX_BODY_BYTES = 2048;
/** Streamed chunk size. */
export const STREAM_CHUNK_BYTES = 64 * 1024;

export type OriginHeaders = {
  origin?: string | null;
  secFetchSite?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  contentType?: string | null;
};

/**
 * Route handlers have no built-in CSRF protection, so a POST must come from this very site: an Origin header whose host
 * equals the Host (or X-Forwarded-Host) header, Sec-Fetch-Site (when the browser sends it) "same-origin", and a JSON
 * content type (which a cross-site form cannot send without a CORS preflight).
 */
export function isSameOrigin(h: OriginHeaders): boolean {
  if (!h.origin) return false;
  if (h.secFetchSite && h.secFetchSite !== "same-origin") return false;
  if (!(h.contentType ?? "").toLowerCase().startsWith("application/json")) return false;
  let originHost: string;
  try { originHost = new URL(h.origin).host.toLowerCase(); } catch { return false; }
  const allowed = [h.host, h.forwardedHost?.split(",")[0]].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase());
  return allowed.includes(originHost);
}

/** A ReadableStream over a Buffer in fixed-size chunks (a streaming response avoids Vercel's 4.5 MB non-streaming limit). */
export function streamBuffer(buf: Uint8Array, chunkBytes = STREAM_CHUNK_BYTES): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buf.length) { controller.close(); return; }
      const end = Math.min(offset + chunkBytes, buf.length);
      controller.enqueue(buf.subarray(offset, end));
      offset = end;
    },
  });
}

export function downloadHeaders(fileName: string, size: number): Record<string, string> {
  return {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Length": String(size),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** File name out of a Content-Disposition header (fallback to the given default). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  const m = /filename="?([A-Za-z0-9._-]+)"?/.exec(header ?? "");
  const name = m?.[1];
  return name && /^[A-Za-z0-9]/.test(name) && !name.includes("..") ? name : fallback;
}

/* ---------------- rate limit (per user, in memory, per server instance) ---------------- */
export const RATE_MAX_ATTEMPTS = 5;
export const RATE_WINDOW_MS = 10 * 60_000;

export type WindowLimiter = { hit(key: string, now?: number): { ok: true } | { ok: false; retryAfterSec: number } };

/** Sliding window: at most `max` hits per `windowMs` for each key. Every attempt that reaches the password check counts. */
export function createWindowLimiter(max = RATE_MAX_ATTEMPTS, windowMs = RATE_WINDOW_MS): WindowLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}

/* ---------------- error mapping (no stack traces, SQL, or connection details ever reach the client) ---------------- */
export type ExportFailure = { status: number; error: string };

export function mapExportError(err: unknown): ExportFailure {
  const msg = err instanceof Error ? err.message : "";
  if (msg.startsWith("The database does not match this version of the app")) {
    return { status: 409, error: "The database is not up to date with this version of the app. Run the manual SQL files first (drizzle/manual/README.md), then try again." };
  }
  const keys = /key\(s\) the backup does not know: (.+?)\. Nothing was exported/.exec(msg);
  if (keys) {
    return { status: 422, error: `The backup stopped because of unknown setting(s): ${keys[1]}. Ask your developer to review them (nothing was downloaded).` };
  }
  return { status: 500, error: "The backup could not be created. Nothing was downloaded. Try again; if it keeps failing, use the command line (docs/BACKUP.md)." };
}

/* ---------------- audit line (one per request outcome; never the password, e-mail or file contents) ---------------- */
export type AuditOutcome = "ok" | "wrong_password" | "locked" | "rate_limited" | "unavailable" | "failed" | "denied";

export function buildAuditLine(a: { outcome: AuditOutcome; userId: string; ts?: Date; forwardedFor?: string | null; userAgent?: string | null; bytes?: number }): string {
  return JSON.stringify({
    audit: "backup_export",
    outcome: a.outcome,
    userId: a.userId,
    ts: (a.ts ?? new Date()).toISOString(),
    ip: a.forwardedFor?.split(",")[0]?.trim() || null,
    ua: (a.userAgent ?? "").slice(0, 80) || null,
    bytes: a.bytes ?? null,
  });
}
