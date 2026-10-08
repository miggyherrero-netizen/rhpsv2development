import assert from "node:assert/strict";
import { expenseToFormInitial, buildExpensePatch, kindAfterJobLink } from "../src/lib/service-expense-edit";

const row = {
  id: "e1", category: "fuel", description: "Diesel", amountCents: 125050, spentAt: new Date("2026-10-01T02:30:00Z"),
  vendor: null, method: "gcash", reimbursable: true, jobId: null, kind: "job", pianoId: null,
};
const init = expenseToFormInitial(row);
assert.equal(init.id, "e1");
assert.equal(init.amount, 1250.5);
assert.equal(init.vendor, "");
assert.equal(init.spentAt, "2026-10-01T02:30:00.000Z");
assert.equal(init.jobId, null);
assert.equal(expenseToFormInitial({ ...row, kind: null }).kind, undefined);

const base = { category: "fuel", description: "Diesel", amount: 10, spentAt: null, vendor: "", method: "cash", reimbursable: false, jobId: null, kind: "job", pianoId: null };
const noReceipt = buildExpensePatch({ ...base, receiptUrl: null });
assert.ok(!("receiptUrl" in noReceipt), "unchanged receipt must be omitted");
assert.equal(noReceipt.jobId, null, "clearing the job keeps jobId: null in the patch");
assert.equal(buildExpensePatch({ ...base, receiptUrl: "data:image/png;base64,AAA" }).receiptUrl, "data:image/png;base64,AAA");
assert.equal(kindAfterJobLink("", "j1", "overhead"), null, "old overhead fuel row linked to a job -> follows the job (Job cost)");
assert.equal(kindAfterJobLink("", "j1", "job"), null);
assert.equal(kindAfterJobLink("", "j1", "stock"), "stock", "stock is kept");
assert.equal(kindAfterJobLink("j0", "j1", "overhead"), "overhead", "changing an existing job link leaves the kind alone");
assert.equal(kindAfterJobLink("j1", "", "overhead"), "overhead", "unlinking leaves the kind alone");
console.log("  ✓ link to job switches overhead to Job cost, stock kept\n  ✓ prefill maps cents to pesos, null vendor to empty\n  ✓ null kind stays unset\n  ✓ unchanged receipt omitted from patch\n  ✓ clearing job keeps jobId null\n  ✓ new receipt included");
