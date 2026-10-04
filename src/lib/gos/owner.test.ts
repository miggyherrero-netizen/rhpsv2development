import { describe, expect, it } from "vitest";
import { isOwner } from "@/lib/gos/owner";

describe("isOwner", () => {
  it("accepts the owner role", () => expect(isOwner({ role: "owner" })).toBe(true));
  it("rejects other roles", () => expect(isOwner({ role: "staff" })).toBe(false));
  it("rejects no user", () => expect(isOwner(null)).toBe(false));
});
