import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/gos/diagnose";

describe("describeError", () => {
  it("shows a Postgres error code and hint, never the message text", () => {
    expect(describeError({ code: "42P01", message: "relation x does not exist, password=abc" }))
      .toBe("Database code 42P01: a table is missing (run gos-tables.sql)");
    expect(describeError({ code: "42501", message: "secret" })).toMatch(/^Database code 42501: permission denied/);
  });
  it("looks inside a wrapped cause (drizzle)", () => {
    expect(describeError({ message: "Failed query", cause: { code: "42P01" } })).toMatch(/42P01/);
  });
  it("falls back to the error name", () => {
    expect(describeError(new TypeError("boom with secret"))).toBe("TypeError");
    expect(describeError("weird")).toBe("Unknown error");
  });
});
