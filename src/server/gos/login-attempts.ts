import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gosLoginAttempts } from "@/db/gos-schema";
import { EMPTY_ATTEMPTS, type AttemptState } from "@/lib/gos/lockout";

/**
 * The lockout must never stop the owner from signing in. If the table is missing (migration not
 * applied yet) or the database hiccups, we log the problem and let the normal password check decide.
 * The email is deliberately not logged.
 */
function warn(what: string, err: unknown) {
  console.error(`[gos] login attempts ${what} failed; lockout skipped:`, err instanceof Error ? err.message : err);
}

export async function getAttemptState(email: string): Promise<AttemptState> {
  try {
    const [row] = await db.select().from(gosLoginAttempts).where(eq(gosLoginAttempts.email, email)).limit(1);
    if (!row) return { ...EMPTY_ATTEMPTS };
    return { failedCount: row.failedCount, firstFailedAt: row.firstFailedAt, lockedUntil: row.lockedUntil };
  } catch (err) {
    warn("read", err);
    return { ...EMPTY_ATTEMPTS };
  }
}

export async function saveAttemptState(email: string, state: AttemptState): Promise<void> {
  try {
    await db
      .insert(gosLoginAttempts)
      .values({ email, ...state })
      .onConflictDoUpdate({ target: gosLoginAttempts.email, set: { ...state } });
  } catch (err) {
    warn("save", err);
  }
}

export async function clearAttemptState(email: string): Promise<void> {
  try {
    await db.delete(gosLoginAttempts).where(eq(gosLoginAttempts.email, email));
  } catch (err) {
    warn("clear", err);
  }
}
