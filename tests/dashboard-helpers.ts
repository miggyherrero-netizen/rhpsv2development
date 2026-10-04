/** Admin dashboard wording + "Needs attention" logic. No DB. Run: npx tsx tests/dashboard-helpers.ts */
import { plural, pianoLabel, unclaimedCount, buildAttention, parseTaskFilter, matchesTaskFilter, telHref } from "../src/lib/dashboard";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const empty = { staleClients: [], lowStock: [], overdue: [], waitingParts: [], inquiries: [] };

console.log("wording");
check("1 project", plural(1, "project"), "1 project");
check("2 projects", plural(2, "project"), "2 projects");
check("0 projects", plural(0, "project"), "0 projects");
check("inquiry irregular plural", plural(2, "inquiry", "inquiries"), "2 inquiries");
check("missing model hides N/A", pianoLabel("Elma", "N/A"), "Elma piano");
check("missing model (empty)", pianoLabel("Elma", ""), "Elma piano");
check("full name kept", pianoLabel("Yamaha", "U1"), "Yamaha U1");
check("both missing", pianoLabel("", null), "Piano");

console.log("task counters");
const tasks = [{ status: "available" }, { status: "available" }, { status: "backlog" }, { status: "in_progress" }, { status: "claimed" }, { status: "done" }];
check("unclaimed = available only", unclaimedCount(tasks), 2);
check("task filter whitelist", [parseTaskFilter("overdue"), parseTaskFilter("x"), parseTaskFilter(null)], ["overdue", null, null]);

const t0 = (o: object) => ({ status: "available", dueDate: null as Date | null, waitingParts: false, ...o });
const later = new Date(Date.UTC(2026, 9, 1));
check("filter available", matchesTaskFilter(t0({}), "available", Date.UTC(2026, 9, 10)), true);
check("claimed is not unclaimed", matchesTaskFilter(t0({ status: "claimed" }), "available", 0), false);
check("overdue = past due and not done", [matchesTaskFilter(t0({ dueDate: later }), "overdue", Date.UTC(2026, 9, 10)), matchesTaskFilter(t0({ dueDate: later, status: "done" }), "overdue", Date.UTC(2026, 9, 10))], [true, false]);
check("no due date is never overdue", matchesTaskFilter(t0({}), "overdue", Date.UTC(2026, 9, 10)), false);
check("parts filter ignores done", [matchesTaskFilter(t0({ waitingParts: true }), "parts", 0), matchesTaskFilter(t0({ waitingParts: true, status: "done" }), "parts", 0)], [true, false]);

console.log("tel links");
check("spaces/dashes stripped", telHref("0917 123-4567"), "tel:09171234567");
check("leading + kept", telHref("+63 917 123 4567"), "tel:+639171234567");
check("stray + dropped", telHref("+63 +917"), "tel:+63917");
check("n/a is not dialable", telHref("n/a"), null);
check("injection attempt only keeps digits", telHref("javascript:alert(1)"), null);
check("empty/null", [telHref(""), telHref(null)], [null, null]);

console.log("lateness (Manila calendar days)");
const lateOf = (due: Date, at: number) => buildAttention({ ...empty, overdue: [{ id: "x", title: "T", dueDate: due }] }, at)[0].items[0].detail;
// 2026-10-10 01:00 Manila = 2026-10-09 17:00 UTC; due 2026-10-09 23:00 Manila = 15:00 UTC
check("due last night, seen next morning -> 1d late", lateOf(new Date(Date.UTC(2026, 9, 9, 15)), Date.UTC(2026, 9, 9, 17)), "1d late");
check("due earlier today (Manila) -> due today", lateOf(new Date(Date.UTC(2026, 9, 9, 17)), Date.UTC(2026, 9, 9, 20)), "due today");

console.log("needs attention");
const now = Date.UTC(2026, 9, 10);
check("all zero -> no rows (UI shows 'All clear')", buildAttention(empty, now), []);
const rows = buildAttention({
  ...empty,
  staleClients: [{ id: "p1", clientName: "Atty. Nikki A.", pianoBrand: "Elma", pianoModel: "N/A", lastClientUpdateAt: new Date(now - 12 * 86_400_000) }],
  lowStock: [{ id: "i1", name: "Piano wire", qtyOnHand: 1, reorderPoint: 5 }, { id: "i2", name: "Felt", qtyOnHand: 0, reorderPoint: 2 }],
  inquiries: [{ id: "q1", name: "Ana", phone: "0917 123 4567", pianoContext: "Yamaha U1" }, { id: "q2", name: "Ben", phone: null, pianoContext: null }],
}, now);
check("only non-zero rows, fixed order", rows.map((r) => r.key), ["clients", "stock", "inquiries"]);
check("stale client detail", rows[0].items[0].detail, "12d since last update · Elma piano");
check("stale client links to that project", rows[0].items[0].href, "/admin/curator?new=1&project=p1");
check("single stale client -> row opens that project's form", rows[0].href, "/admin/curator?new=1&project=p1");
check("both low-stock items listed", rows[1].items.map((i) => i.label), ["Piano wire", "Felt"]);
check("low stock links to filtered inventory", rows[1].href, "/admin/inventory?low=1");
check("inquiry with phone -> tel:", rows[2].items[0].href, "tel:09171234567");
check("undialable phone -> scroll to card", buildAttention({ ...empty, inquiries: [{ id: "z", name: "Z", phone: "n/a", pianoContext: null }] }, now)[0].items[0].href, "#inquiries");
check("inquiry without phone -> scroll to card", rows[2].items[1].href, "#inquiries");
const many = buildAttention({ ...empty, overdue: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: `T${i}` })) }, now);
const od = buildAttention({ ...empty, overdue: [{ id: "t1", title: "Re-felt", pianoName: "Elma piano", dueDate: new Date(now - 3 * 86_400_000) }], waitingParts: [{ id: "t2", title: "Wire", claimedName: "Marco Reyes" }] }, now);
check("overdue detail shows lateness + piano", od[0].items[0].detail, "3d late · Elma piano");
check("parts detail shows who has it", od[1].items[0].detail, "Shop · Marco");
check("overflow counted, not dropped", [many[0].items.length, many[0].more, many[0].count], [3, 2, 5]);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall dashboard helper checks passed");
