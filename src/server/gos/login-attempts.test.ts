import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => {
  const fail = () => { throw new Error('relation "gos_login_attempts" does not exist'); };
  return { db: { select: fail, insert: fail, delete: fail } };
});

import { clearAttemptState, getAttemptState, saveAttemptState } from "@/server/gos/login-attempts";
import { EMPTY_ATTEMPTS } from "@/lib/gos/lockout";

describe("login attempts never block login when the table is missing", () => {
  it("get returns an empty state", async () => {
    await expect(getAttemptState("a@b.c")).resolves.toEqual(EMPTY_ATTEMPTS);
  });
  it("save and clear do not throw", async () => {
    await expect(saveAttemptState("a@b.c", EMPTY_ATTEMPTS)).resolves.toBeUndefined();
    await expect(clearAttemptState("a@b.c")).resolves.toBeUndefined();
  });
});
