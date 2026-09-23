import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { serviceDocumentShares, type ServiceDocumentShare } from "@/db/schema";
import { documentTokenHash, validDocumentToken } from "@/lib/service-documents";

export async function getActiveDocumentShares(
  ownerId: string, invoiceId: string, paymentId: string | null,
): Promise<ServiceDocumentShare[]> {
  return db.select().from(serviceDocumentShares).where(and(
    eq(serviceDocumentShares.ownerId, ownerId),
    eq(serviceDocumentShares.invoiceId, invoiceId),
    paymentId ? eq(serviceDocumentShares.paymentId, paymentId) : isNull(serviceDocumentShares.paymentId),
    isNull(serviceDocumentShares.revokedAt),
    gt(serviceDocumentShares.expiresAt, new Date()),
  )).orderBy(desc(serviceDocumentShares.createdAt));
}

/** Public access is by possession of a valid, unexpired, unrevoked random token only. */
export async function getSharedDocument(token: string): Promise<ServiceDocumentShare | null> {
  if (!validDocumentToken(token)) return null;
  const [share] = await db.select().from(serviceDocumentShares).where(and(
    eq(serviceDocumentShares.tokenHash, documentTokenHash(token)),
    isNull(serviceDocumentShares.revokedAt),
    gt(serviceDocumentShares.expiresAt, new Date()),
  )).limit(1);
  return share ?? null;
}
