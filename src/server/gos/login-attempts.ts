import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gosLoginAttempts } from "@/db/gos-schema";
import { EMPTY_ATTEMPTS, type AttemptState } from "@/lib/gos/lockout";

export async function getAttemptState(email: string): Promise<AttemptState> {
  const [row] = await db.select().from(gosLoginAttempts).where(eq(gosLoginAttempts.email, email)).limit(1);
  if (!row) return { ...EMPTY_ATTEMPTS };
  return { failedCount: row.failedCount, firstFailedAt: row.firstFailedAt, lockedUntil: row.lockedUntil };
}

export async function saveAttemptState(email: string, state: AttemptState): Promise<void> {
  await db
    .insert(gosLoginAttempts)
    .values({ email, ...state })
    .onConflictDoUpdate({ target: gosLoginAttempts.email, set: { ...state } });
}

export async function clearAttemptState(email: string): Promise<void> {
  await db.delete(gosLoginAttempts).where(eq(gosLoginAttempts.email, email));
}
