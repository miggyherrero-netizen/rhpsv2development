import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { documentMoney, documentTokenHash, paymentReceiptCode, paymentSettlement, validDocumentToken } from "../src/lib/service-documents";

const token = randomBytes(32).toString("base64url");
assert.equal(validDocumentToken(token), true);
assert.equal(validDocumentToken("too-short"), false);
assert.equal(validDocumentToken(token + "/"), false);
assert.notEqual(documentTokenHash(token), token);
assert.equal(documentTokenHash(token), documentTokenHash(token));
assert.notEqual(documentTokenHash(token), documentTokenHash(randomBytes(32).toString("base64url")));

const first = { id: "00000000-0000-4000-8000-000000000001", amountCents: 5_000, receivedAt: new Date("2026-09-24T01:00:00Z") };
const second = { id: "00000000-0000-4000-8000-000000000002", amountCents: 6_200, receivedAt: new Date("2026-09-25T01:00:00Z") };
assert.deepEqual(paymentSettlement(11_200, [second, first], first.id), { previousCents: 0, paymentCents: 5_000, balanceCents: 6_200 });
assert.deepEqual(paymentSettlement(11_200, [second, first], second.id), { previousCents: 5_000, paymentCents: 6_200, balanceCents: 0 });
assert.equal(paymentSettlement(11_200, [first], "missing"), null);
assert.equal(paymentReceiptCode(first.id, first.receivedAt), "PAY-2026-000000000000");
assert.ok(documentMoney(11_200).includes("112.00"));
console.log("Document token and payment settlement checks passed.");
