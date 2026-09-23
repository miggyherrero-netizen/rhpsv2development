import { createHash } from "node:crypto";

/** Private document links use a 32-byte base64url bearer token (43 characters). */
export const validDocumentToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);
export const documentTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A stable payment identifier, not a tax-authority receipt serial number. */
export function paymentReceiptCode(paymentId: string, receivedAt: Date): string {
  return `PAY-${receivedAt.getUTCFullYear()}-${paymentId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function paymentSettlement(
  totalCents: number,
  payments: { id: string; amountCents: number; receivedAt: Date }[],
  paymentId: string,
) {
  const ordered = [...payments].sort((a, b) =>
    a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((p) => p.id === paymentId);
  if (index < 0) return null;
  const previousCents = ordered.slice(0, index).reduce((sum, p) => sum + p.amountCents, 0);
  return {
    previousCents,
    paymentCents: ordered[index].amountCents,
    balanceCents: Math.max(0, totalCents - previousCents - ordered[index].amountCents),
  };
}

export const documentMoney = (cents: number): string =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
