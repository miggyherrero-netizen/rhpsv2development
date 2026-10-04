import { describe, expect, it } from "vitest";
import {
  defaultGosSettings, fuelPerKmCentavos, gosSettingsSchema, pesosToCentavos, unknownPlaceholders,
} from "@/lib/gos/settings";

describe("settings defaults (Business Facts)", () => {
  const s = defaultGosSettings();
  it("tuning starts at ₱3,000", () => expect(s.prices.tuningCentavos).toBe(300000));
  it("cleaning, repair, vehicle cost and home base start blank", () => {
    expect(s.prices.cleaningCentavos).toBeNull();
    expect(s.prices.repairLaborCentavos).toBeNull();
    expect(s.travel.vehicleCostPerKmCentavos).toBeNull();
    expect(s.travel.homeBase).toBeNull();
  });
  it("diesel ₱110/L at 10 km/L = ₱11/km fuel", () => expect(fuelPerKmCentavos(s)).toBe(1100));
  it("reminder defaults", () => {
    expect(s.reminders).toMatchObject({
      noReplyMinutes: 60, quoteFollowUpDays: 1, noQuoteDays: 1, visitSameDayTime: "07:00",
      dayBeforeTime: "18:00", unpaidDays: 3, unpaidRepeatDays: 7, tuningLeadDays: 14,
    });
  });
});

describe("validation (AC-12.3)", () => {
  it("refuses 0 or negative prices", () => {
    const bad = { ...defaultGosSettings(), prices: { ...defaultGosSettings().prices, tuningCentavos: 0 } };
    expect(gosSettingsSchema.safeParse(bad).success).toBe(false);
  });
  it("allows blank cleaning price", () => {
    expect(gosSettingsSchema.safeParse(defaultGosSettings()).success).toBe(true);
  });
  it("refuses template over 1,000 characters", () => {
    const s = defaultGosSettings();
    const bad = { ...s, templates: { ...s.templates, newInquiry: "x".repeat(1001) } };
    expect(gosSettingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("pesosToCentavos", () => {
  it("parses 3,000 → 300000", () => expect(pesosToCentavos("3,000")).toBe(300000));
  it("parses 110.50 → 11050", () => expect(pesosToCentavos("110.50")).toBe(11050));
  it("returns null for blank", () => expect(pesosToCentavos("  ")).toBeNull());
  it("returns NaN for text", () => expect(pesosToCentavos("abc")).toBeNaN());
});

describe("unknownPlaceholders (AC-12.5)", () => {
  it("accepts all allowed placeholders", () => {
    expect(unknownPlaceholders("{name} {area} {total} {date} {time} {balance} {piano} {minutes}")).toEqual([]);
  });
  it("names unknown ones", () => expect(unknownPlaceholders("Hi {nmae}, {total}")).toEqual(["{nmae}"]));
});
