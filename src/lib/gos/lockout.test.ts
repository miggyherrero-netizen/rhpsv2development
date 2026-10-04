import { describe, expect, it } from "vitest";
import { afterFailure, afterSuccess, EMPTY_ATTEMPTS, isLocked, type AttemptState } from "@/lib/gos/lockout";

const t0 = new Date("2026-10-05T01:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

function failTimes(times: Date[]): AttemptState {
  return times.reduce((s, t) => afterFailure(s, t), EMPTY_ATTEMPTS);
}

describe("lockout", () => {
  it("4 wrong tries do not lock", () => {
    const s = failTimes([min(0), min(1), min(2), min(3)]);
    expect(isLocked(s, min(4))).toBe(false);
    expect(s.failedCount).toBe(4);
  });
  it("5 wrong tries within 15 min lock for 15 min after the 5th", () => {
    const s = failTimes([min(0), min(1), min(2), min(3), min(4)]);
    expect(isLocked(s, min(5))).toBe(true);
    expect(isLocked(s, min(18))).toBe(true);
    expect(isLocked(s, min(19))).toBe(false);
  });
  it("wrong tries spread over more than 15 min start a new window", () => {
    const s = failTimes([min(0), min(1), min(2), min(3), min(16)]);
    expect(s.failedCount).toBe(1);
    expect(isLocked(s, min(17))).toBe(false);
  });
  it("a wrong try while locked does not extend the lock", () => {
    const locked = failTimes([min(0), min(1), min(2), min(3), min(4)]);
    const again = afterFailure(locked, min(10));
    expect(again.lockedUntil).toEqual(locked.lockedUntil);
  });
  it("success resets everything", () => {
    expect(afterSuccess()).toEqual(EMPTY_ATTEMPTS);
  });
});
