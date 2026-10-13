/** Customer name matching for the type-to-search field. No database. Run: npx tsx tests/service-customer-match.ts */
import { CUSTOMER_NAME_MAX, canCreateNew, choiceState, editDistance, filterCustomers, findDuplicate, matchRanges, normalizeName } from "../src/lib/service-customer-match";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const list = [
  { id: "1", name: "Ana Reyes" },
  { id: "2", name: "Maria Santos" },
  { id: "3", name: "Mariano Dela Cruz" },
  { id: "4", name: "José Peña" },
  { id: "5", name: "Santos Hardware" },
  { id: "6", name: "Rosa Maria" },
  { id: "7", name: "Maria Santos-Lopez" },
  { id: "8", name: "Patrick O'Brien" },
];
const ids = (q: string, limit = 8) => filterCustomers(list, q, limit).map((c) => c.id);

console.log("normalizeName");
check("trim + collapse + lowercase", normalizeName("  MARIA   Santos "), "maria santos");
check("diacritics stripped", normalizeName("José  Peña"), "jose pena");
check("punctuation: hyphen and dot become spaces", normalizeName("Santos-Lopez, Jr."), "santos lopez jr");
check("apostrophes vanish (O'Brien = OBrien)", normalizeName("O’Brien"), normalizeName("obrien"));
check("empty / null / undefined", [normalizeName(""), normalizeName(null), normalizeName(undefined)], ["", "", ""]);
check("digits are kept", normalizeName("Unit 5B"), "unit 5b");

console.log("\nfilterCustomers");
check("empty query -> nothing", ids(""), []);
check("whitespace-only query -> nothing", ids("   "), []);
check("exact first, then prefix, then word-start, stable inside a group", ids("maria"), ["2", "3", "7", "6"]);
check("full exact name outranks longer prefix names", ids("maria santos"), ["2", "7"]);
check("accent-insensitive both ways", [ids("jose pena"), ids("josé peña"), ids("JOSE")], [["4"], ["4"], ["4"]]);
check("multi-token in any order", ids("santos maria"), ["2", "7"]);
check("a word-start beats a mid-word hit", ids("santos"), ["5", "2", "7"]);
check("substring inside a word still finds it", ids("rian"), ["3"]);
check("limit is honoured", ids("a", 2).length, 2);
check("limit 0 -> nothing", ids("maria", 0), []);
check("no match -> nothing", ids("zzz"), []);
check("matches names only (id is ignored)", ids("1"), []);
check("does not mutate the input order", list.map((c) => c.id).join(""), "12345678");
check("apostrophe typed or not", [ids("o'brien"), ids("obrien")], [["8"], ["8"]]);

console.log("\nmatchRanges (highlight)");
check("prefix", matchRanges("Maria Santos", "mar"), [[0, 3]]);
check("two words", matchRanges("Maria Santos", "san mar"), [[0, 3], [6, 9]]);
check("accent in the name, plain typed", matchRanges("José Peña", "pena"), [[5, 9]]);
check("word start preferred over earlier mid-word hit", matchRanges("Mariano Ana", "an"), [[8, 10]]);
check("no match -> none", matchRanges("Maria", "xyz"), []);

console.log("\nfindDuplicate");
const kind = (n: string) => { const r = findDuplicate(n, list); return r.kind === "none" ? "none" : `${r.kind}:${r.customer.id}`; };
check("exact", kind("Maria Santos"), "exact:2");
check("exact ignoring case and spaces", kind("  maria   SANTOS "), "exact:2");
check("exact ignoring accents", kind("jose pena"), "exact:4");
check("exact ignoring punctuation", kind("Maria Santos Lopez"), "exact:7");
check("reordered words -> near", kind("Santos Maria"), "near:2");
check("one-letter typo in a long word -> near", kind("Maria Santoz"), "near:2");
check("swapped letters in a long word -> near", kind("Maria Satnos"), "near:2");
check("different first name one letter away must NOT warn (Mario vs Maria)", kind("Mario Santos"), "none");
check("a short surname typo must NOT warn", kind("Ana Reyez"), "none");
check("an extra middle name must NOT warn", kind("Maria L Santos"), "none");
check("a different person must NOT warn", kind("Pedro Santos"), "none");
check("two words differing must NOT warn", kind("Mario Santoz"), "none");
check("a partial name must NOT warn", kind("Maria"), "none");
check("exact wins over an earlier near match", findDuplicate("Maria Santos", [{ id: "a", name: "Santos Maria" }, { id: "b", name: "Maria Santos" }]).kind, "exact");
check("empty -> none", kind("   "), "none");
check("one-word names compare too", findDuplicate("Santoz", [{ id: "x", name: "Santos" }]).kind, "near");
check("empty list -> none", findDuplicate("Maria", []).kind, "none");

console.log("\neditDistance");
check("same", editDistance("abc", "abc"), 0);
check("one substitution", editDistance("santos", "santoz"), 1);
check("one swap counts once", editDistance("santos", "satnos"), 1);
check("insert", editDistance("santos", "santoss"), 1);
check("empty side", editDistance("", "abc"), 3);

console.log("\ncanCreateNew");
check("a normal name", canCreateNew("Maria Santos"), true);
check("empty / spaces", [canCreateNew(""), canCreateNew("   "), canCreateNew(null), canCreateNew(undefined)], [false, false, false, false]);
check("only punctuation", canCreateNew("--- ..."), false);
check("only digits", canCreateNew("12345"), false);
check("digits with a letter are fine (Unit 5B Hall)", canCreateNew("Unit 5B Hall"), true);
check("accented letters count", canCreateNew("Ñ"), true);
check("at the length cap", canCreateNew("a".repeat(CUSTOMER_NAME_MAX)), true);
check("over the length cap", canCreateNew("a".repeat(CUSTOMER_NAME_MAX + 1)), false);
check("spaces collapse before the cap", canCreateNew(`a${" ".repeat(400)}b`), true);

console.log("\nnon-string input and the per-list cache");
check("canCreateNew ignores non-strings", [123, {}, [], true, NaN].map((v) => canCreateNew(v)), [false, false, false, false, false]);
check("normalizeName tolerates null-ish", normalizeName(undefined as never), "");
const cached = [{ id: "1", name: "Maria Santos" }];
check("same array twice gives the same answers", [findDuplicate("maria santos", cached).kind, findDuplicate("maria santos", cached).kind, filterCustomers(cached, "mar").length], ["exact", "exact", 1]);

console.log("\nchoiceState");
check("none -> empty", choiceState({ kind: "none" }, list), "empty");
check("existing -> ready", choiceState({ kind: "existing", id: "2" }, list), "ready");
check("new, blank -> empty", choiceState({ kind: "new", name: "  " }, list), "empty");
check("new, no letters -> invalid", choiceState({ kind: "new", name: "123" }, list), "invalid");
check("new, unknown name -> ready", choiceState({ kind: "new", name: "Lourdes Tan" }, list), "ready");
check("new, exact duplicate -> needs a decision", choiceState({ kind: "new", name: "maria santos" }, list), "needs-decision");
check("new, near duplicate -> needs a decision", choiceState({ kind: "new", name: "Santos Maria" }, list), "needs-decision");
check("duplicate allowed by the owner -> ready", choiceState({ kind: "new", name: "Maria Santos", allowDuplicate: true }, list), "ready");

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll customer-match checks passed.");
