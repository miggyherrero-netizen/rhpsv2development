"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceDocumentShares, serviceInvoices, servicePayments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { documentTokenHash } from "@/lib/service-documents";
import { newToken } from "@/lib/security";

const SHARE_DAYS = 14;
const uuid = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function createServiceDocumentShare(input: { invoiceId: string; paymentId?: string }) {
  const user = await requireUser();
  if (user.role !== "owner") return { ok: false as const, error: "Only the owner can share documents." };
  if (!uuid(input.invoiceId) || (input.paymentId !== undefined && !uuid(input.paymentId))) {
    return { ok: false as const, error: "Invalid document." };
  }
  const [invoice] = await db.select({ id: serviceInvoices.id, voidedAt: serviceInvoices.voidedAt })
    .from(serviceInvoices).where(eq(serviceInvoices.id, input.invoiceId)).limit(1);
  if (!invoice || invoice.voidedAt) return { ok: false as const, error: "This invoice is unavailable for sharing." };
  if (input.paymentId) {
    const [payment] = await db.select({ id: servicePayments.id }).from(servicePayments)
      .where(and(eq(servicePayments.id, input.paymentId), eq(servicePayments.invoiceId, input.invoiceId))).limit(1);
    if (!payment) return { ok: false as const, error: "Payment not found on this invoice." };
  }
  const token = newToken();
  const [share] = await db.insert(serviceDocumentShares).values({
    ownerId: user.id,
    invoiceId: invoice.id,
    paymentId: input.paymentId ?? null,
    kind: input.paymentId ? "receipt" : "invoice",
    tokenHash: documentTokenHash(token),
    expiresAt: new Date(Date.now() + SHARE_DAYS * 86_400_000),
  }).returning({ id: serviceDocumentShares.id, expiresAt: serviceDocumentShares.expiresAt });
  // Return a relative path: never build a customer link from an untrusted Host header.
  return { ok: true as const, path: `/share/service/${token}`, share: share! };
}

export async function revokeServiceDocumentShare(shareId: string) {
  const user = await requireUser();
  if (user.role !== "owner") return { ok: false as const, error: "Only the owner can revoke links." };
  if (!uuid(shareId)) return { ok: false as const, error: "Invalid link." };
  const [share] = await db.update(serviceDocumentShares).set({ revokedAt: new Date() }).where(and(
    eq(serviceDocumentShares.id, shareId), eq(serviceDocumentShares.ownerId, user.id),
  )).returning({ id: serviceDocumentShares.id });
  return share ? { ok: true as const } : { ok: false as const, error: "Link not found." };
}
