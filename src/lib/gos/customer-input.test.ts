import { describe, expect, it } from "vitest";
import { addCustomerSchema, lostSchema } from "@/lib/gos/customer-input";

const base = { name: "Maria", phone: "", area: "", cameFrom: "Messenger", adChoice: "unknown", adId: null, note: "" };

describe("addCustomerSchema (AC-2.3, 2.11, 2.13)", () => {
  it("accepts a name only", () => expect(addCustomerSchema.safeParse(base).success).toBe(true));
  it("refuses an empty or blank name", () => {
    expect(addCustomerSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(addCustomerSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
  });
  it("limits name to 60 and note to 500", () => {
    expect(addCustomerSchema.safeParse({ ...base, name: "x".repeat(61) }).success).toBe(false);
    expect(addCustomerSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
    expect(addCustomerSchema.safeParse({ ...base, note: "x".repeat(500) }).success).toBe(true);
  });
  it("refuses an unknown came-from value", () => {
    expect(addCustomerSchema.safeParse({ ...base, cameFrom: "Telepathy" }).success).toBe(false);
  });
  it("a named ad needs an adId", () => {
    expect(addCustomerSchema.safeParse({ ...base, adChoice: "ad", adId: null }).success).toBe(false);
  });
  it("phone allows digits, spaces, + - ( )", () => {
    expect(addCustomerSchema.safeParse({ ...base, phone: "+63 917-123 4567" }).success).toBe(true);
    expect(addCustomerSchema.safeParse({ ...base, phone: "call me" }).success).toBe(false);
  });
});

describe("lostSchema", () => {
  it("needs a reason", () => {
    expect(lostSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(lostSchema.safeParse({ reason: "Too expensive" }).success).toBe(true);
  });
});
