export const LOCK_MAX_FAILS = 5;
export const LOCK_MINUTES = 15;
export const LOCK_MESSAGE = "Too many tries. Try again in 15 minutes.";

export type AttemptState = {
  failedCount: number;
  firstFailedAt: Date | null;
  lockedUntil: Date | null;
};

export const EMPTY_ATTEMPTS: AttemptState = { failedCount: 0, firstFailedAt: null, lockedUntil: null };

const windowMs = LOCK_MINUTES * 60_000;

export function isLocked(state: AttemptState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export function afterFailure(state: AttemptState, now: Date): AttemptState {
  if (isLocked(state, now)) return state;
  const inWindow =
    state.firstFailedAt !== null && now.getTime() - state.firstFailedAt.getTime() <= windowMs;
  const failedCount = inWindow ? state.failedCount + 1 : 1;
  const firstFailedAt = inWindow ? state.firstFailedAt : now;
  const lockedUntil = failedCount >= LOCK_MAX_FAILS ? new Date(now.getTime() + windowMs) : null;
  return { failedCount, firstFailedAt, lockedUntil };
}

export function afterSuccess(): AttemptState {
  return { ...EMPTY_ATTEMPTS };
}
