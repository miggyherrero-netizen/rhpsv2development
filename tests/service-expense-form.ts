import assert from "node:assert/strict";
import { amountState, canSaveExpense, categoryLabel, defaultDescription, shouldOpenMore } from "../src/lib/service-expense-form";

assert.equal(categoryLabel("fuel"), "Fuel");
assert.equal(categoryLabel("nope"), "Other");
assert.equal(defaultDescription("fuel", ""), "Fuel");
assert.equal(defaultDescription("fuel", "   "), "Fuel", "whitespace counts as blank");
assert.equal(defaultDescription("fuel", " Diesel, Buhangin "), "Diesel, Buhangin");

assert.equal(amountState(""), "empty");
assert.equal(amountState("  "), "empty");
assert.equal(amountState("abc"), "invalid");
assert.equal(amountState("0"), "zero");
assert.equal(amountState("0.00"), "zero");
assert.equal(amountState("1,250"), "ok");
assert.equal(amountState("₱ 99.5"), "ok");

const base = { amount: "100", description: "", category: "fuel" };
assert.equal(canSaveExpense(base), true, "blank purpose is fine on create (category label)");
assert.equal(canSaveExpense({ ...base, amount: "" }), false);
assert.equal(canSaveExpense({ ...base, amount: "0" }), false);
assert.equal(canSaveExpense({ ...base, amount: "12x" }), false);
assert.equal(canSaveExpense({ ...base, blocked: true }), false);
assert.equal(canSaveExpense({ ...base, mode: "edit" }), false, "edit still needs a purpose");
assert.equal(canSaveExpense({ ...base, mode: "edit", description: "Diesel" }), true);
assert.equal(canSaveExpense({ ...base, mode: "edit", description: "Diesel", amount: "0" }), true, "edit keeps allowing an old PHP 0 row");
assert.equal(canSaveExpense({ ...base, mode: "edit", description: "Diesel", amount: "x" }), false);

const quiet = { vendor: "", receipt: null, method: "cash", reimbursable: false, dateChanged: false };
assert.equal(shouldOpenMore(quiet), false);
assert.equal(shouldOpenMore({ ...quiet, vendor: " " }), false);
assert.equal(shouldOpenMore({ ...quiet, vendor: "Shell" }), true);
assert.equal(shouldOpenMore({ ...quiet, receipt: "data:image/png;base64,AA" }), true);
assert.equal(shouldOpenMore({ ...quiet, method: "gcash" }), true);
assert.equal(shouldOpenMore({ ...quiet, reimbursable: true }), true);
assert.equal(shouldOpenMore({ ...quiet, dateChanged: true }), true);
console.log("  ✓ default purpose = category label\n  ✓ amount must be above 0 on create\n  ✓ edit keeps old rules\n  ✓ More details stays open with typed input");

/* ---- review additions: ceiling, edge cases, payload, server rule, messages ---- */
import {
  GENERIC_SAVE_ERROR, MAX_EXPENSE_CENTS, amountHint, buildExpensePayload, effectiveExpenseKind, parseExpenseAmount, saveBlockReason,
  stockNeedsPiano, thrownSubmitMessage, validateExpenseAmountCents,
} from "../src/lib/service-expense-form";

assert.equal(parseExpenseAmount(".5"), 0.5);
assert.equal(parseExpenseAmount("5."), 5);
assert.equal(parseExpenseAmount("1250."), 1250, "trailing dot while typing is not invalid");
assert.equal(parseExpenseAmount("-5"), null);
assert.equal(parseExpenseAmount("1e3"), null);
assert.equal(parseExpenseAmount("."), null);
assert.equal(parseExpenseAmount("1.2.3"), null);
assert.equal(amountState("1250."), "ok");
assert.equal(amountState(".5"), "ok");
assert.equal(amountState("-5"), "invalid");
assert.equal(amountState("1e3"), "invalid");
assert.equal(amountState("0.004"), "zero", "rounds to 0 centavos");
assert.equal(amountState("0.005"), "ok");
assert.equal(amountState("20,000,000"), "ok");
assert.equal(amountState("20000000.01"), "toolarge");
assert.equal(amountState("99999999999999999999"), "toolarge");
assert.deepEqual(amountHint("30000000"), { text: "Amount is too large", tone: "danger" });
assert.deepEqual(amountHint(""), { text: "Enter an amount above ₱0", tone: "muted" });
assert.deepEqual(amountHint("0"), { text: "Enter an amount above ₱0", tone: "danger" });
assert.equal(amountHint("0", "edit").text, "");
assert.equal(canSaveExpense({ ...base, amount: "30000000" }), false);
assert.equal(canSaveExpense({ ...base, amount: "30000000", mode: "edit", description: "x" }), false);

// server rule
assert.equal(validateExpenseAmountCents(1).ok, true);
assert.equal(validateExpenseAmountCents(MAX_EXPENSE_CENTS).ok, true);
assert.deepEqual(validateExpenseAmountCents(MAX_EXPENSE_CENTS + 1), { ok: false, error: "Amount is too large." });
assert.deepEqual(validateExpenseAmountCents(0), { ok: false, error: "Enter an amount above ₱0." });
assert.equal(validateExpenseAmountCents(-1).ok, false);
assert.equal(validateExpenseAmountCents(0, { allowZero: true }).ok, true, "update may keep a PHP 0 row");
assert.equal(validateExpenseAmountCents(-1, { allowZero: true }).ok, false);
assert.equal(validateExpenseAmountCents(Number.NaN).ok, false);
assert.equal(validateExpenseAmountCents(Number.POSITIVE_INFINITY).ok, false);

// payload
const form = {
  category: "fuel", description: "", amount: "1,250", spentAt: "2026-10-11T16:42", vendor: "", method: "cash",
  reimbursable: false, jobId: "", receipt: null, kindPicked: null, pianoId: "",
};
assert.deepEqual(buildExpensePayload({ ...form, fixedJobId: "j1" }), {
  category: "fuel", description: "Fuel", amount: 1250, spentAt: "2026-10-11T16:42", vendor: "", method: "cash", reimbursable: false,
  jobId: "j1", receiptUrl: null, kind: "job", pianoId: null,
}, "hidden defaults pass through; blank purpose -> category label; fixed job -> kind job");
assert.equal(buildExpensePayload({ ...form, description: "  Diesel run " }).description, "Diesel run");
assert.equal(buildExpensePayload({ ...form, mode: "edit", description: " x " }).description, "x");
assert.equal(buildExpensePayload({ ...form, spentAt: "" }).spentAt, null);
assert.equal(buildExpensePayload({ ...form, jobId: "j9" }).kind, "job", "linking a job -> job cost");
assert.equal(buildExpensePayload({ ...form, jobId: "j9" }).jobId, "j9");
assert.equal(buildExpensePayload({ ...form, category: "rent" }).kind, "overhead", "category default kind without a job");
assert.equal(buildExpensePayload({ ...form, kindPicked: "stock", pianoId: "p1" }).pianoId, "p1");
assert.equal(buildExpensePayload({ ...form, kindPicked: "job", pianoId: "p1" }).pianoId, null, "only stock carries a piano");
assert.equal(buildExpensePayload({ ...form, receipt: "data:image/png;base64,AA", vendor: "Shell", method: "gcash", reimbursable: true }).receiptUrl, "data:image/png;base64,AA");
assert.equal(effectiveExpenseKind({ kindPicked: "overhead", fixedJobId: "j1", jobId: "", category: "fuel" }), "overhead", "explicit pick wins");
assert.equal(stockNeedsPiano({ kind: "stock", pianosOffered: true, pianoId: "" }), true);
assert.equal(stockNeedsPiano({ kind: "stock", pianosOffered: true, pianoId: "p1" }), false);
assert.equal(stockNeedsPiano({ kind: "stock", pianosOffered: false, pianoId: "" }), false);
assert.equal(stockNeedsPiano({ kind: "stock", fixedJobId: "j1", pianosOffered: true, pianoId: "" }), false);
assert.equal(stockNeedsPiano({ kind: "job", pianosOffered: true, pianoId: "" }), false);

// reasons and messages
assert.equal(saveBlockReason({ mode: "create", description: "", needsPiano: true, reading: false }), "Choose a piano to save.");
assert.equal(saveBlockReason({ mode: "edit", description: " ", needsPiano: false, reading: false }), "Add a description to save.");
assert.equal(saveBlockReason({ mode: "create", description: "", needsPiano: false, reading: false }), "", "blank purpose is fine on create");
assert.equal(saveBlockReason({ mode: "create", description: "", needsPiano: false, reading: true }), "Preparing the photo…");
assert.match(thrownSubmitMessage(new Error("boom")), /^It may have been saved\. Check the list before trying again\. Your entries are kept\.$/);
assert.match(thrownSubmitMessage(new TypeError("Failed to fetch")), /^Connection problem\. It may have been saved/);
assert.match(thrownSubmitMessage(new Error("x"), true), /^Connection problem\./);
assert.ok(!/server/i.test(thrownSubmitMessage(new Error("x"))));
assert.equal(GENERIC_SAVE_ERROR, "Couldn't save. Your entries are kept — try again.");
console.log("  ✓ amount ceiling + edge cases\n  ✓ server amount rule\n  ✓ submit payload\n  ✓ block reasons and failure messages");
