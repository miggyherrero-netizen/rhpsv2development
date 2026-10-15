import type { Pool } from "pg";

/**
 * Brute-force lock for POST /api/backup. It uses the existing `gos_login_attempts` table (key `backup:<userId>`) but has its
 * own atomic statement: the attempt is counted BEFORE the (slow) password check, in ONE INSERT ... ON CONFLICT DO UPDATE, so
 * parallel guesses cannot slip through. The login code and src/server/gos/login-attempts.ts are untouched.
 *
 * Fails CLOSED: any database error (including a missing table) throws, and the route answers 503 and exports nothing.
 */
export const BACKUP_MAX_ATTEMPTS = 5;
export const BACKUP_LOCK_MINUTES = 15;

export type BackupClaim = { allowed: boolean; retryAfterSec: number };

/** Attempts 1..5 inside the window are allowed; the 6th sets a 15-minute lock; while locked nothing changes. */
export const CLAIM_SQL = `
INSERT INTO gos_login_attempts AS t (email, failed_count, first_failed_at, locked_until)
VALUES ($1, 1, now(), NULL)
ON CONFLICT (email) DO UPDATE SET
  failed_count = CASE
    WHEN t.locked_until > now() THEN t.failed_count
    WHEN t.first_failed_at IS NULL OR t.first_failed_at < now() - make_interval(mins => $3) OR t.locked_until IS NOT NULL THEN 1
    ELSE t.failed_count + 1 END,
  first_failed_at = CASE
    WHEN t.locked_until > now() THEN t.first_failed_at
    WHEN t.first_failed_at IS NULL OR t.first_failed_at < now() - make_interval(mins => $3) OR t.locked_until IS NOT NULL THEN now()
    ELSE t.first_failed_at END,
  locked_until = CASE
    WHEN t.locked_until > now() THEN t.locked_until
    WHEN t.first_failed_at IS NULL OR t.first_failed_at < now() - make_interval(mins => $3) OR t.locked_until IS NOT NULL THEN NULL
    WHEN t.failed_count + 1 > $2 THEN now() + make_interval(mins => $3)
    ELSE NULL END
RETURNING (locked_until IS NOT NULL AND locked_until > now()) AS locked,
          GREATEST(1, CEIL(EXTRACT(EPOCH FROM (locked_until - now()))))::int AS retry_after`;

export async function claimBackupAttempt(db: Pick<Pool, "query">, userId: string): Promise<BackupClaim> {
  const res = await db.query<{ locked: boolean; retry_after: number | null }>(CLAIM_SQL, [`backup:${userId}`, BACKUP_MAX_ATTEMPTS, BACKUP_LOCK_MINUTES]);
  const row = res.rows[0];
  if (!row) throw new Error("backup lock: no row returned");
  return { allowed: !row.locked, retryAfterSec: row.locked ? Math.min(BACKUP_LOCK_MINUTES * 60, Math.max(1, row.retry_after ?? 1)) : 0 };
}

/** After a correct password: forget the failures. */
export async function resetBackupAttempts(db: Pick<Pool, "query">, userId: string): Promise<void> {
  await db.query("DELETE FROM gos_login_attempts WHERE email = $1", [`backup:${userId}`]);
}
