import { describe, expect, it } from "vitest";
import { gosEnvProblems, DEV_AUTH_SECRET } from "@/lib/gos/env";
import { afterFailure, afterSuccess, isLocked, LOCK_MESSAGE, EMPTY_ATTEMPTS } from "@/lib/gos/lockout";
import { isOwner } from "@/lib/gos/owner";
import { gosSettingsSchema, defaultGosSettings, unknownPlaceholders, fuelPerKmCentavos, pesosToCentavos } from "@/lib/gos/settings";

describe("contracts", () => {
  it("env checker exists and is silent outside production", () => {
    expect(gosEnvProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(typeof DEV_AUTH_SECRET).toBe("string");
  });
  it("lockout functions exist", () => {
    expect(isLocked(EMPTY_ATTEMPTS, new Date())).toBe(false);
    expect(afterSuccess()).toEqual(EMPTY_ATTEMPTS);
    expect(typeof afterFailure).toBe("function");
    expect(LOCK_MESSAGE).toBe("Too many tries. Try again in 15 minutes.");
  });
  it("owner check exists", () => {
    expect(isOwner({ role: "owner" })).toBe(true);
  });
  it("default settings pass their own schema", () => {
    expect(gosSettingsSchema.parse(defaultGosSettings())).toEqual(defaultGosSettings());
    expect(typeof unknownPlaceholders).toBe("function");
    expect(typeof fuelPerKmCentavos).toBe("function");
    expect(typeof pesosToCentavos).toBe("function");
  });
});
