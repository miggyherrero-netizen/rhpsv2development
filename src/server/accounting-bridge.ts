/**
 * Posting bridge — feeds existing operational money (service invoices, service payments,
 * service expenses, payroll payouts) into the accounting journal WITHOUT touching the
 * working Service/Admin modules.
 *
 * How it works:
 *  - idempotent: for each source row it computes the entry that *should* exist
 *  - unposted → post it; posted-but-changed (source hash differs) → void the old entry
 *    (reversal posted, history kept) + post the new state; no longer postable → void.
 *  - the bridge never rewrites history and never writes to operational tables
 *  - anything it cannot post (locked period, etc.) becomes an `acc_exceptions` row
 *  - throttled per process (15s) because it runs on accounting page loads
 *
 * Aggregation rule (see accounting-post.ts): voided entries stay in aggregates — every
 * void carries a reversal entry, so pairs net to zero and cleared-statement history
 * stays intact.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accExceptions, accJournal, payments, serviceExpenses, serviceInvoices, servicePayments,
  timeEntries, workers,
} from "@/db/schema";
import {
  billingLegs, expenseAccountKey, twoLeg,
  type JournalLegDraft,
} from "@/lib/accounting";
import { getAccountingContext, hashSource, postJournalEntry, voidJournalEntry, type AccContext } from "@/server/accounting-post";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/service";

export type BridgeResult = { posted: number; voided: number; exceptions: number; skipped: boolean };

const BRIDGE_THROTTLE_MS = 15_000;
let lastRun = 0;

type PostPlan = {
  occurredAt: Date;
  kind: string;
  stream: string;
  memo: string;
  legs: JournalLegDraft[];
  sourceHash: string;
};

type PostedEntryRef = { id: string; sourceHash: string | null; voidedAt: Date | null };

/** Latest original (non-correction) entry per source id. Voided ones mean "no current post". */
async function postedMap(sourceType: string): Promise<Map<string, PostedEntryRef>> {
  const rows = await db
    .select({ id: accJournal.id, sourceId: accJournal.sourceId, sourceHash: accJournal.sourceHash, voidedAt: accJournal.voidedAt })
    .from(accJournal)
    .where(and(eq(accJournal.sourceType, sourceType), isNull(accJournal.reversalOfId)))
    .orderBy(accJournal.entryNumber);
  const map = new Map<string, PostedEntryRef>();
  for (const r of rows) {
    if (r.sourceId) map.set(r.sourceId, { id: r.id, sourceHash: r.sourceHash, voidedAt: r.voidedAt });
  }
  return map;
}

async function raiseException(sourceType: string, sourceId: string | null, reason: string, details?: string): Promise<void> {
  const existing = await db
    .select({ id: accExceptions.id })
    .from(accExceptions)
    .where(
      and(
        eq(accExceptions.status, "open"),
        eq(accExceptions.sourceType, sourceType),
        eq(accExceptions.reason, reason),
        sourceId ? eq(accExceptions.sourceId, sourceId) : isNull(accExceptions.sourceId),
      ),
    )
    .limit(1);
  if (existing.length) return;
  await db.insert(accExceptions).values({ sourceType, sourceId, reason, details: details ?? null });
}

/** Apply the computed plans for one source type. Returns counts; failures become exceptions. */
async function applyPlans(
  sourceType: string,
  plans: Map<string, PostPlan | null>,
  actor: string,
): Promise<{ posted: number; voided: number; exceptions: number }> {
  const posted = await postedMap(sourceType);
  const ids = new Set<string>([...plans.keys(), ...posted.keys()]);
  let nPosted = 0;
  let nVoided = 0;
  let nExceptions = 0;

  for (const id of ids) {
    const plan = plans.get(id) ?? null;
    const current = posted.get(id);
    try {
      if (plan && (!current || current.voidedAt)) {
        await postJournalEntry({
          occurredAt: plan.occurredAt,
          kind: plan.kind,
          stream: plan.stream,
          memo: plan.memo,
          sourceType,
          sourceId: id,
          sourceHash: plan.sourceHash,
          postedBy: actor,
          legs: plan.legs,
        });
        nPosted++;
      } else if (plan && current && !current.voidedAt && current.sourceHash !== plan.sourceHash) {
        await voidJournalEntry(current.id, "Source record changed — reposted", actor);
        await postJournalEntry({
          occurredAt: plan.occurredAt,
          kind: plan.kind,
          stream: plan.stream,
          memo: plan.memo,
          sourceType,
          sourceId: id,
          sourceHash: plan.sourceHash,
          postedBy: actor,
          legs: plan.legs,
        });
        nVoided++;
        nPosted++;
      } else if (!plan && current && !current.voidedAt) {
        await voidJournalEntry(current.id, "No longer postable (voided, deleted, or pre-books)", actor);
        nVoided++;
      }
    } catch (err) {
      nExceptions++;
      await raiseException(
        sourceType,
        id,
        err instanceof Error ? err.message : "Unknown bridge error",
        `plan: ${plan ? plan.memo : "(none)"}`,
      );
    }
  }
  return { posted: nPosted, voided: nVoided, exceptions: nExceptions };
}

type InvoiceLikeRow = {
  id: string; invoiceNumber: number; issueDate: Date; sentAt: Date | null; voidedAt: Date | null;
  totalCents: number; taxCents: number;
};

/** When an invoice becomes a real claim: sent, or first payment — whichever came first. */
function invoiceBillingDate(inv: InvoiceLikeRow, firstPayment: Date | null): Date | null {
  const candidates = [inv.sentAt, firstPayment].filter((d): d is Date => !!d);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

async function syncServiceInvoices(ctx: AccContext, actor: string) {
  const booksStart = ctx.settings.booksStartDate;
  const invoices = await db
    .select({
      id: serviceInvoices.id, invoiceNumber: serviceInvoices.invoiceNumber,
      issueDate: serviceInvoices.issueDate, sentAt: serviceInvoices.sentAt,
      voidedAt: serviceInvoices.voidedAt, totalCents: serviceInvoices.totalCents,
      taxCents: serviceInvoices.taxCents, customerId: serviceInvoices.customerId,
    })
    .from(serviceInvoices);
  const firstPays = await db
    .select({ invoiceId: servicePayments.invoiceId, first: sql<string>`min(${servicePayments.receivedAt})` })
    .from(servicePayments)
    .groupBy(servicePayments.invoiceId);
  const firstPayMap = new Map(firstPays.map((r) => [r.invoiceId, new Date(r.first!)]));

  const ar = ctx.byKey.get("ar");
  const revenue = ctx.byKey.get("service_revenue");
  const vat = ctx.byKey.get("vat_payable");
  if (!ar || !revenue || !vat) {
    return { posted: 0, voided: 0, exceptions: 0, billingDates: new Map<string, { date: Date | null; voided: boolean }>() };
  }

  const plans = new Map<string, PostPlan | null>();
  const billingDates = new Map<string, { date: Date | null; voided: boolean }>();
  for (const inv of invoices) {
    const firstPay = firstPayMap.get(inv.id) ?? null;
    const billingDate = invoiceBillingDate(inv, firstPay);
    billingDates.set(inv.id, { date: billingDate, voided: !!inv.voidedAt });
    const postable = billingDate && !inv.voidedAt && billingDate.getTime() >= booksStart.getTime();
    if (!postable) {
      plans.set(inv.id, null);
      continue;
    }
    const net = inv.totalCents - inv.taxCents;
    plans.set(inv.id, {
      occurredAt: billingDate,
      kind: "service_billing",
      stream: "service",
      memo: `Service invoice #${inv.invoiceNumber}`,
      legs: billingLegs({ arId: ar.id, revenueId: revenue.id, vatId: vat.id, totalCents: inv.totalCents, revenueCents: net, taxCents: inv.taxCents }),
      sourceHash: hashSource({ billed: true, at: billingDate.toISOString(), total: inv.totalCents, tax: inv.taxCents }),
    });
  }
  const res = await applyPlans("service_invoice", plans, actor);
  return { ...res, billingDates };
}

async function syncServicePayments(ctx: AccContext, actor: string, billingDates: Map<string, { date: Date | null; voided: boolean }>) {
  const booksStart = ctx.settings.booksStartDate;
  const rows = await db
    .select({
      id: servicePayments.id, invoiceId: servicePayments.invoiceId, amountCents: servicePayments.amountCents,
      method: servicePayments.method, receivedAt: servicePayments.receivedAt,
    })
    .from(servicePayments);
  const invoices = await db
    .select({ id: serviceInvoices.id, invoiceNumber: serviceInvoices.invoiceNumber })
    .from(serviceInvoices);
  const invNo = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));
  const unmapped = ctx.byKey.get("unmapped");
  const opening = ctx.byKey.get("opening_equity");
  const ar = ctx.byKey.get("ar");
  if (!ar || !opening || !unmapped) return { posted: 0, voided: 0, exceptions: 0 };

  const plans = new Map<string, PostPlan | null>();
  for (const p of rows) {
    const billing = billingDates.get(p.invoiceId);
    // Voided invoice or pre-books billing → collection is money in against Opening Equity.
    const prebooks = !billing || billing.voided || !billing.date || billing.date.getTime() < booksStart.getTime();
    if (p.receivedAt.getTime() < booksStart.getTime()) {
      plans.set(p.id, null); // cash received before the books started is not posted
      continue;
    }
    const walletId = ctx.settings.methodMap[p.method];
    const wallet = walletId ? ctx.byId.get(walletId) : undefined;
    if (!wallet) {
      await raiseException("service_payment", p.id, `Unmapped payment method: ${p.method}`, "Map it in Accounting settings");
    }
    const walletAcc = wallet ?? unmapped;
    plans.set(p.id, {
      occurredAt: p.receivedAt,
      kind: prebooks ? "prebooks_collection" : "service_collection",
      stream: "service",
      memo: `Payment on service invoice #${invNo.get(p.invoiceId) ?? "?"} — ${p.method}`,
      legs: twoLeg(walletAcc.id, prebooks ? opening.id : ar.id, p.amountCents),
      sourceHash: hashSource({ amount: p.amountCents, method: p.method, at: p.receivedAt.toISOString(), prebooks, wallet: walletAcc.id }),
    });
  }
  return applyPlans("service_payment", plans, actor);
}

async function syncServiceExpenses(ctx: AccContext, actor: string) {
  const booksStart = ctx.settings.booksStartDate;
  const rows = await db
    .select({
      id: serviceExpenses.id, category: serviceExpenses.category, description: serviceExpenses.description,
      amountCents: serviceExpenses.amountCents, spentAt: serviceExpenses.spentAt, method: serviceExpenses.method,
    })
    .from(serviceExpenses);
  const unmapped = ctx.byKey.get("unmapped");
  const fallback = ctx.byKey.get("exp_other");
  if (!unmapped || !fallback) return { posted: 0, voided: 0, exceptions: 0 };

  const plans = new Map<string, PostPlan | null>();
  for (const e of rows) {
    if (e.spentAt.getTime() < booksStart.getTime()) {
      plans.set(e.id, null);
      continue;
    }
    const expense = ctx.byKey.get(expenseAccountKey(e.category)) ?? fallback;
    const walletId = ctx.settings.methodMap[e.method];
    const wallet = walletId ? ctx.byId.get(walletId) : undefined;
    if (!wallet) {
      await raiseException("service_expense", e.id, `Unmapped payment method: ${e.method}`, "Map it in Accounting settings");
    }
    const walletAcc = wallet ?? unmapped;
    plans.set(e.id, {
      occurredAt: e.spentAt,
      kind: "service_expense",
      stream: "service",
      memo: `${EXPENSE_CATEGORY_LABEL[e.category] ?? e.category} — ${e.description}`.slice(0, 200),
      legs: twoLeg(expense.id, walletAcc.id, e.amountCents),
      sourceHash: hashSource({ amount: e.amountCents, category: e.category, at: e.spentAt.toISOString(), method: e.method, wallet: walletAcc.id }),
    });
  }
  return applyPlans("service_expense", plans, actor);
}

async function syncPayroll(ctx: AccContext, actor: string) {
  const booksStart = ctx.settings.booksStartDate;
  const rows = await db
    .select({
      id: payments.id, amountCents: payments.amountCents, paidAt: payments.paidAt,
      workerName: workers.name,
    })
    .from(payments)
    .innerJoin(timeEntries, eq(timeEntries.id, payments.timeEntryId))
    .innerJoin(workers, eq(workers.id, timeEntries.workerId));
  const wages = ctx.byKey.get("wages");
  if (!wages) return { posted: 0, voided: 0, exceptions: 0 };
  const payrollWallet =
    (ctx.settings.payrollAccountId ? ctx.byId.get(ctx.settings.payrollAccountId) : undefined) ??
    ctx.byKey.get("wallet_cash");
  if (!payrollWallet) return { posted: 0, voided: 0, exceptions: 0 };

  const plans = new Map<string, PostPlan | null>();
  for (const p of rows) {
    if (p.paidAt.getTime() < booksStart.getTime()) {
      plans.set(p.id, null);
      continue;
    }
    plans.set(p.id, {
      occurredAt: p.paidAt,
      kind: "payroll_wage",
      stream: "payroll",
      memo: `Payroll — ${p.workerName}`,
      legs: twoLeg(wages.id, payrollWallet.id, p.amountCents),
      sourceHash: hashSource({ amount: p.amountCents, at: p.paidAt.toISOString(), worker: p.workerName, wallet: payrollWallet.id }),
    });
  }
  return applyPlans("payroll_payment", plans, actor);
}

/**
 * Run the full bridge. Cheap when nothing changed (a handful of SELECTs). Throttled per
 * process because it runs on accounting page loads; pass force=true from the Sync action.
 */
export async function runAccountingBridge(ownerId: string, actor = "System", force = false): Promise<BridgeResult> {
  if (!force && Date.now() - lastRun < BRIDGE_THROTTLE_MS) {
    return { posted: 0, voided: 0, exceptions: 0, skipped: true };
  }
  lastRun = Date.now();
  const ctx = await getAccountingContext(ownerId);

  const invoiceRes = await syncServiceInvoices(ctx, actor);
  const payRes = await syncServicePayments(ctx, actor, invoiceRes.billingDates);
  const expRes = await syncServiceExpenses(ctx, actor);
  const payrRes = await syncPayroll(ctx, actor);

  return {
    posted: invoiceRes.posted + payRes.posted + expRes.posted + payrRes.posted,
    voided: invoiceRes.voided + payRes.voided + expRes.voided + payrRes.voided,
    exceptions: invoiceRes.exceptions + payRes.exceptions + expRes.exceptions + payrRes.exceptions,
    skipped: false,
  };
}

