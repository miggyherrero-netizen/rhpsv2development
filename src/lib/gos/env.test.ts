import { describe, expect, it } from "vitest";
import { assertGosEnv, DEV_AUTH_SECRET, gosEnvProblems } from "@/lib/gos/env";

describe("gosEnvProblems", () => {
  it("allows anything outside production", () => {
    expect(gosEnvProblems({ NODE_ENV: "development" })).toEqual([]);
  });
  it("flags missing AUTH_SECRET in production", () => {
    expect(gosEnvProblems({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }))
      .toEqual(["AUTH_SECRET is missing or uses the dev value"]);
  });
  it("flags the dev fallback AUTH_SECRET in production", () => {
    expect(gosEnvProblems({ NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_SECRET: DEV_AUTH_SECRET }))
      .toEqual(["AUTH_SECRET is missing or uses the dev value"]);
  });
  it("flags missing DATABASE_URL in production", () => {
    expect(gosEnvProblems({ NODE_ENV: "production", AUTH_SECRET: "a-long-real-secret" }))
      .toEqual(["DATABASE_URL is missing"]);
  });
  it("passes a correct production setup", () => {
    expect(gosEnvProblems({ NODE_ENV: "production", AUTH_SECRET: "a-long-real-secret", DATABASE_URL: "postgres://x" })).toEqual([]);
  });
  it("assertGosEnv throws with all problems", () => {
    expect(() => assertGosEnv({ NODE_ENV: "production" }))
      .toThrow("Growth OS cannot start: AUTH_SECRET is missing or uses the dev value; DATABASE_URL is missing");
  });
});
