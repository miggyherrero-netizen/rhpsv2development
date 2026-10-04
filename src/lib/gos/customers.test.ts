import { describe, expect, it } from "vitest";
import {
  fillTemplate, isDuplicateName, normalizeName, replyDue, replyState, searchScore, templateKeyFor,
  statusAfterMarkReplied, statusAfterUndoReplied, statusAfterLost, statusAfterReopen, customerStatusLabel,
} from "@/lib/gos/customers";

describe("normalizeName / duplicates (AC-2.4, AC-13.9)", () => {
  it("ignores case and extra spaces", () => {
    expect(normalizeName("  Maria   Santos ")).toBe("maria santos");
    expect(isDuplicateName("Maria  Santos", "maria santos")).toBe(true);
    expect(isDuplicateName("Maria", "Mario")).toBe(false);
  });
});

describe("reply timer (AC-3.4, R4)", () => {
  const added = new Date("2026-10-05T01:12:00Z"); // 9:12 Manila
  it("due 60 min after inquiry", () => {
    expect(replyDue(added, 60)).toEqual(new Date("2026-10-05T02:12:00Z"));
  });
  it("waiting before the hour, overdue after, 1 day after 24h", () => {
    expect(replyState(added, 60, new Date("2026-10-05T02:00:00Z"))).toBe("waiting");
    expect(replyState(added, 60, new Date("2026-10-05T02:12:00Z"))).toBe("overdue");
    expect(replyState(added, 60, new Date("2026-10-06T01:12:00Z"))).toBe("overdue-day");
  });
});

describe("status transitions (R3 subset)", () => {
  it("New -> Replied only", () => {
    expect(statusAfterMarkReplied("New")).toBe("Replied");
    expect(statusAfterMarkReplied("Quoted")).toBeNull();
  });
  it("Replied -> New on undo", () => {
    expect(statusAfterUndoReplied("Replied")).toBe("New");
    expect(statusAfterUndoReplied("New")).toBeNull();
  });
  it("any -> Lost, Lost -> previous (Reopen)", () => {
    expect(statusAfterLost("Booked")).toBe("Lost");
    expect(statusAfterLost("Lost")).toBeNull();
    expect(statusAfterReopen("Lost", "Replied")).toBe("Replied");
    expect(statusAfterReopen("Lost", null)).toBe("New");
    expect(statusAfterReopen("New", "Replied")).toBeNull();
  });
  it("labels carry an icon, never color alone", () => {
    expect(customerStatusLabel("Lost")).toMatch(/Lost/);
    expect(customerStatusLabel("Lost")).not.toBe("Lost");
  });
});

describe("fillTemplate (AC-3.1)", () => {
  it("fills name and area", () => {
    expect(fillTemplate("Hi {name}! Asa dapit sa {area}?", { name: "Maria", area: "Lanang" })).toBe("Hi Maria! Asa dapit sa Lanang?");
  });
  it("drops the line that holds {area} when area is empty", () => {
    expect(fillTemplate("Hi {name}!\nAsa dapit sa {area}?\nSalamat", { name: "Maria", area: "" })).toBe("Hi Maria!\nSalamat");
  });
  it("drops the area sentence when the template is one line", () => {
    expect(fillTemplate("Hi {name}! Tuning starts at ₱3,000. Asa dapit imong piano sa {area}?", { name: "Maria", area: null }))
      .toBe("Hi Maria! Tuning starts at ₱3,000.");
  });
});

describe("templateKeyFor", () => {
  it("New uses newInquiry, others fall back to general", () => {
    expect(templateKeyFor("New")).toBe("newInquiry");
    expect(templateKeyFor("Replied")).toBe("general");
  });
});

describe("searchScore (AC-13.3)", () => {
  it("finds Maria when typing maira", () => {
    expect(searchScore("maira", "Maria")).toBeGreaterThan(0);
  });
  it("prefix match beats typo match", () => {
    expect(searchScore("mar", "Maria")).toBeGreaterThan(searchScore("maira", "Maria"));
  });
  it("no match returns 0", () => {
    expect(searchScore("xyz", "Maria")).toBe(0);
  });
  it("matches inside area or note text", () => {
    expect(searchScore("lanang", "Lanang, Davao")).toBeGreaterThan(0);
  });
});
