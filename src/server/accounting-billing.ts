"use server";

/**
 * Project (restoration) billing + piano sale writes. Each action authenticates with
 * `requireUser()`, validates, writes the operational row AND posts its journal entry
 * together (nested transaction), and audits. Journal-linked records are voided, never
 * hard-deleted — a void reverses the journal entry and keeps the row for history.
 *
 * Payment forms in this area pick the **wallet** directly (they live in the back office,
 * unlike Service payments which flow through the method map); the wallet's name is stored
 * in the `method` column for display.
 */

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accAccounts, accJournal, pianos, pianoCostEntries, pianoPayments, pianoSales,
  projectCosts, projectItems, projectPayments, projects,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  completionLegs, expenseAccountKey, netFromInclusiveCents, twoLeg, vatExclusiveCents,
  vatInclusiveCents,
} from "@/lib/accounting";
import { hashSource, postJournalEntry, voidJournalEntry } from "@/server/accounting-post";
import { intOr, moneyToCents, oneOf, optionalDate, str } from "@/lib/service";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

function touch() {
  revalidatePath("/admin", "layout");
}

async function systemAccountId(key: string): Promise<string | null> {
  const [a] = await db.select({ id: accAccounts.id }).from(accAccounts).where(eq(accAccounts.systemKey, key)).limit(1);
  return a?.id ?? null;
}

async function walletById(id: string): Promise<{ id: string; name: string } | null> {
  const [a] = await db
    .select({ id: accAccounts.id, name: accAccounts.name })
    .from(accAccounts)
    .where(and(eq(accAccounts.id, id), eq(accAccounts.isWallet, true), eq(accAccounts.active, true)))
    .limit(1);
  return a ?? null;
}

/** Latest active (non-correction, non-voided) entry posted from a source row. */
async function entryBySource(sourceType: string, sourceId: string) {
  const [entry] = await db
    .select({ id: accJournal.id })
    .from(accJournal)
    .where(
      and(
        eq(accJournal.sourceType, sourceType),
        eq(accJournal.sourceId, sourceId),
        isNull(accJournal.reversalOfId),
        isNull(accJournal.voidedAt),
      ),
    )
    .orderBy(desc(accJournal.entryNumber))
    .limit(1);
  return entry ?? null;
}

async function recalcProjectQuote(projectId: string): Promise<number> {
  const rows = await db.select({ qty: projectItems.qty, price: projectItems.unitPriceCents }).from(projectItems).where(eq(projectItems.projectId, projectId));
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0);
  await db.update(projects).set({ quotedCents: total, updatedAt: new Date() }).where(eq(projects.id, projectId));
  return total;
}

/* ============================================================
 * Projects — quote items
 * ============================================================ */

export async function addProjectItem(input: {
  projectId?: string; kind?: string; description?: string; qty?: number; unitPrice?: number;
}): Promise<Result> {
  await requireUser();
  if (!input.projectId) return fail("Missing project.");
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) return fail("Project not found.");
  if (project.billingFinalizedAt) return fail("Billing is finalized — add further charges as a new billed item via the journal or unlock with the owner.");
  const description = str(input.description, 300);
  if (!description) return fail("Describe the line.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${projectItems.position}), 0)::int` })
    .from(projectItems)
    .where(eq(projectItems.projectId, input.projectId));
  await db.insert(projectItems).values({
    projectId: input.projectId,
    kind: oneOf(input.kind, ["service", "part", "fee", "discount"] as const, "service"),
    description,
    qty: Math.max(1, intOr(input.qty, 1)),
    unitPriceCents: moneyToCents(input.unitPrice),
    position: (max ?? 0) + 1,
  });
  await recalcProjectQuote(input.projectId);
  touch();
  return ok();
}

export async function updateProjectItem(id: string, patch: { description?: string; qty?: number; unitPrice?: number; kind?: string }): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(projectItems).where(eq(projectItems.id, id)).limit(1);
  if (!item) return fail("Line not found.");
  const [project] = await db.select().from(projects).where(eq(projects.id, item.projectId)).limit(1);
  if (project?.billingFinalizedAt) return fail("Billing is finalized — quote lines can no longer be changed.");
  await db
    .update(projectItems)
    .set({
      description: patch.description !== undefined ? str(patch.description, 300) ?? item.description : undefined,
      qty: patch.qty !== undefined ? Math.max(1, intOr(patch.qty, 1)) : undefined,
      unitPriceCents: patch.unitPrice !== undefined ? moneyToCents(patch.unitPrice) : undefined,
      kind: patch.kind !== undefined ? oneOf(patch.kind, ["service", "part", "fee", "discount"] as const, "service") : undefined,
      updatedAt: new Date(),
    })
    .where(eq(projectItems.id, id));
  await recalcProjectQuote(item.projectId);
  touch();
  return ok();
}

export async function deleteProjectItem(id: string): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(projectItems).where(eq(projectItems.id, id)).limit(1);
  if (!item) return fail("Line not found.");
  const [project] = await db.select().from(projects).where(eq(projects.id, item.projectId)).limit(1);
  if (project?.billingFinalizedAt) return fail("Billing is finalized — quote lines can no longer be removed.");
  await db.delete(projectItems).where(eq(projectItems.id, id));
  await recalcProjectQuote(item.projectId);
  touch();
  return ok();
}

/* ============================================================
 * Projects — payments
 * ============================================================ */

export async function recordProjectPayment(input: {
  projectId?: string; amount?: number; kind?: string; walletId?: string;
  reference?: string | null; receivedAt?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.projectId) return fail("Missing project.");
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) return fail("Project not found.");
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await walletById(input.walletId ?? "");
  if (!wallet) return fail("Pick the wallet the payment went into.");
  const date = optionalDate(input.receivedAt) ?? new Date();
  const finalized = !!project.billingFinalizedAt;
  const creditId = finalized
    ? await systemAccountId("ar")
    : await systemAccountId("deposits_held");
  if (!creditId) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  const paymentKind = oneOf(input.kind, ["deposit", "progress", "final"] as const, "deposit");
  const sourceHash = hashSource({ amount: cents, at: date.toISOString(), wallet: wallet.id, kind: paymentKind, credit: finalized ? "ar" : "deposits" });
  try {
    await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(projectPayments)
        .values({
          projectId: project.id, kind: paymentKind, amountCents: cents,
          method: wallet.name, reference: str(input.reference, 120),
          receivedAt: date, note: str(input.note, 500),
        })
        .returning({ id: projectPayments.id });
      await postJournalEntry({
        occurredAt: date,
        kind: "project_payment",
        stream: "workshop",
        memo: `${paymentKind === "deposit" ? "Deposit" : paymentKind === "progress" ? "Progress payment" : "Final payment"} — ${project.clientName}`,
        sourceType: "project_payment",
        sourceId: payment!.id,
        sourceHash,
        postedBy: user.name,
        legs: twoLeg(wallet.id, creditId, cents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the payment.");
  }
  touch();
  return ok();
}

export async function voidProjectPayment(paymentId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  const why = str(reason, 300);
  if (!why) return fail("Give a reason.");
  const [payment] = await db.select().from(projectPayments).where(eq(projectPayments.id, paymentId)).limit(1);
  if (!payment) return fail("Payment not found.");
  if (payment.voidedAt) return fail("Payment is already voided.");
  const entry = await entryBySource("project_payment", paymentId);
  if (!entry) return fail("No journal entry found for this payment.");
  try {
    await voidJournalEntry(entry.id, `Project payment voided — ${why}`, user.name);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not void the payment.");
  }
  await db
    .update(projectPayments)
    .set({ voidedAt: new Date(), voidReason: why })
    .where(eq(projectPayments.id, paymentId));
  touch();
  return ok();
}

/* ============================================================
 * Projects — costs + finalize
 * ============================================================ */

export async function addProjectCost(input: {
  projectId?: string; category?: string; description?: string; amount?: number;
  spentAt?: string | null; vendor?: string | null; walletId?: string | null;
  receiptUrl?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.projectId) return fail("Missing project.");
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) return fail("Project not found.");
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const description = str(input.description, 300);
  if (!description) return fail("Describe the cost.");
  const date = optionalDate(input.spentAt) ?? new Date();
  const category = oneOf(input.category, ["materials", "parts", "subcontractor", "tools", "other"] as const, "materials");
  const expenseId = await systemAccountId(expenseAccountKey(category));
  const apId = await systemAccountId("ap");
  if (!expenseId || !apId) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  const unpaid = input.walletId === "unpaid" || input.walletId === null || input.walletId === undefined;
  const wallet = unpaid ? null : await walletById(input.walletId ?? "");
  if (!unpaid && !wallet) return fail("Pick a wallet, or choose “Not paid yet”.");
  const creditId = wallet ? wallet.id : apId;

  try {
    await db.transaction(async (tx) => {
      const [cost] = await tx
        .insert(projectCosts)
        .values({
          projectId: project.id, category, description, amountCents: cents, spentAt: date,
          vendor: str(input.vendor, 160), paidAccountId: wallet?.id ?? null,
          paidAt: wallet ? date : null, receiptUrl: str(input.receiptUrl, 500), note: str(input.note, 500),
        })
        .returning({ id: projectCosts.id });
      await postJournalEntry({
        occurredAt: date,
        kind: "project_cost",
        stream: "workshop",
        memo: `Project cost — ${description}`,
        sourceType: "project_cost",
        sourceId: cost!.id,
        sourceHash: hashSource({ amount: cents, category, at: date.toISOString(), paid: !!wallet }),
        postedBy: user.name,
        legs: twoLeg(expenseId, creditId, cents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the cost.");
  }
  touch();
  return ok();
}

export async function payProjectCost(costId: string, walletId: string): Promise<Result> {
  const user = await requireUser();
  const [cost] = await db.select().from(projectCosts).where(eq(projectCosts.id, costId)).limit(1);
  if (!cost) return fail("Cost not found.");
  if (cost.voidedAt) return fail("Cost is voided.");
  if (cost.paidAccountId) return fail("Cost is already paid.");
  const wallet = await walletById(walletId);
  if (!wallet) return fail("Pick the wallet paid from.");
  const apId = await systemAccountId("ap");
  if (!apId) return fail("Accounting is not initialized yet.");
  const date = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(projectCosts)
        .set({ paidAccountId: wallet.id, paidAt: date, updatedAt: date })
        .where(eq(projectCosts.id, costId));
      await postJournalEntry({
        occurredAt: date,
        kind: "ap_payment",
        stream: "workshop",
        memo: `Paid project cost — ${cost.description}`,
        sourceType: "project_cost_payment",
        sourceId: costId,
        postedBy: user.name,
        legs: twoLeg(apId, wallet.id, cost.amountCents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the payment.");
  }
  touch();
  return ok();
}

export async function voidProjectCost(costId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  const why = str(reason, 300);
  if (!why) return fail("Give a reason.");
  const [cost] = await db.select().from(projectCosts).where(eq(projectCosts.id, costId)).limit(1);
  if (!cost) return fail("Cost not found.");
  if (cost.voidedAt) return fail("Cost is already voided.");
  const entry = await entryBySource("project_cost", costId);
  if (!entry) return fail("No journal entry found for this cost.");
  try {
    await voidJournalEntry(entry.id, `Project cost voided — ${why}`, user.name);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not void the cost.");
  }
  await db
    .update(projectCosts)
    .set({ voidedAt: new Date(), voidReason: why })
    .where(eq(projectCosts.id, costId));
  touch();
  return ok();
}

export async function setProjectTaxRate(projectId: string, taxRateBps: number): Promise<Result> {
  await requireUser();
  const bps = Math.max(0, intOr(taxRateBps, 0));
  if (bps > 10_000) return fail("Rate looks too high (basis points, 1200 = 12%).");
  await db.update(projects).set({ taxRateBps: bps, updatedAt: new Date() }).where(eq(projects.id, projectId));
  touch();
  return ok();
}

/**
 * Finalize billing: recognize the contract as revenue. Deposits held move to revenue,
 * the unpaid remainder becomes receivable, and VAT becomes payable. The final billed
 * subtotal defaults to the quote but can be adjusted (approved extras / reductions).
 */
export async function finalizeProjectBilling(input: {
  projectId?: string; finalAmount?: number; taxRateBps?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.projectId) return fail("Missing project.");
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) return fail("Project not found.");
  if (project.billingFinalizedAt) return fail("Billing is already finalized for this project.");

  const rate = input.taxRateBps !== undefined ? Math.max(0, intOr(input.taxRateBps, 0)) : project.taxRateBps;
  const base = input.finalAmount !== undefined ? moneyToCents(input.finalAmount) : project.quotedCents;
  if (base < 0) return fail("Final amount cannot be negative.");
  const tax = vatExclusiveCents(base, rate);
  const total = base + tax;

  const payRows = await db
    .select({ paid: sql<number>`coalesce(sum(${projectPayments.amountCents}), 0)::int` })
    .from(projectPayments)
    .where(and(eq(projectPayments.projectId, project.id), isNull(projectPayments.voidedAt)));
  const paid = payRows[0]?.paid ?? 0;

  const [depositsId, arId, revenueId, vatId] = await Promise.all([
    systemAccountId("deposits_held"), systemAccountId("ar"), systemAccountId("project_revenue"), systemAccountId("vat_payable"),
  ]);
  if (!depositsId || !arId || !revenueId || !vatId) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  const date = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ billingFinalizedAt: date, billedCents: base, taxRateBps: rate, updatedAt: date })
        .where(eq(projects.id, project.id));
      await postJournalEntry({
        occurredAt: date,
        kind: "project_billing",
        stream: "workshop",
        memo: `Project billing finalized — ${project.clientName}`,
        sourceType: "project_billing",
        sourceId: project.id,
        sourceHash: hashSource({ base, rate, paid }),
        postedBy: user.name,
        legs: completionLegs({
          depositsId, arId, revenueId, vatId,
          paidCents: paid, totalCents: total, revenueCents: base, taxCents: tax,
        }),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not finalize billing.");
  }
  touch();
  return ok();
}

/* ============================================================
 * Piano sales
 * ============================================================ */

export async function reservePiano(input: {
  pianoId?: string; price?: number; buyerName?: string | null; buyerContact?: string | null; taxRateBps?: number;
}): Promise<Result> {
  await requireUser();
  if (!input.pianoId) return fail("Missing piano.");
  const [piano] = await db.select().from(pianos).where(eq(pianos.id, input.pianoId)).limit(1);
  if (!piano) return fail("Piano not found.");
  const [existing] = await db.select().from(pianoSales).where(eq(pianoSales.pianoId, input.pianoId)).limit(1);
  if (existing && existing.status !== "cancelled") return fail("This piano already has an active sale record.");
  const price = moneyToCents(input.price);
  if (price <= 0) return fail("Enter the agreed selling price (VAT-inclusive).");
  const rate = input.taxRateBps !== undefined ? Math.max(0, intOr(input.taxRateBps, 1200)) : 1200;

  if (existing) {
    // previously cancelled sale — reuse the row so payment history stays attached
    await db
      .update(pianoSales)
      .set({
        status: "reserved", reservedAt: new Date(), soldAt: null, priceCents: price,
        taxRateBps: rate, costSnapshotCents: null,
        buyerName: str(input.buyerName, 160), buyerContact: str(input.buyerContact, 160),
        updatedAt: new Date(),
      })
      .where(eq(pianoSales.id, existing.id));
  } else {
    await db.insert(pianoSales).values({
      pianoId: input.pianoId, status: "reserved", reservedAt: new Date(), priceCents: price,
      taxRateBps: rate, buyerName: str(input.buyerName, 160), buyerContact: str(input.buyerContact, 160),
    });
  }
  await db.update(pianos).set({ status: "reserved" }).where(eq(pianos.id, input.pianoId));
  touch();
  return ok();
}

export async function recordPianoPayment(input: {
  saleId?: string; amount?: number; walletId?: string; reference?: string | null;
  receivedAt?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.saleId) return fail("Missing sale.");
  const [sale] = await db.select().from(pianoSales).where(eq(pianoSales.id, input.saleId)).limit(1);
  if (!sale) return fail("Sale not found.");
  if (sale.status === "cancelled") return fail("Sale is cancelled.");
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await walletById(input.walletId ?? "");
  if (!wallet) return fail("Pick the wallet the payment went into.");
  const date = optionalDate(input.receivedAt) ?? new Date();
  const completed = sale.status === "completed";
  const creditId = completed ? await systemAccountId("ar") : await systemAccountId("deposits_held");
  if (!creditId) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  try {
    await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(pianoPayments)
        .values({
          saleId: sale.id, amountCents: cents, method: wallet.name,
          reference: str(input.reference, 120), receivedAt: date, note: str(input.note, 500),
        })
        .returning({ id: pianoPayments.id });
      await postJournalEntry({
        occurredAt: date,
        kind: "piano_payment",
        stream: "sales",
        memo: `Piano payment — ${sale.buyerName ?? "buyer"}`,
        sourceType: "piano_payment",
        sourceId: payment!.id,
        sourceHash: hashSource({ amount: cents, at: date.toISOString(), wallet: wallet.id, credit: completed ? "ar" : "deposits" }),
        postedBy: user.name,
        legs: twoLeg(wallet.id, creditId, cents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the payment.");
  }
  touch();
  return ok();
}

export async function voidPianoPayment(paymentId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  const why = str(reason, 300);
  if (!why) return fail("Give a reason.");
  const [payment] = await db.select().from(pianoPayments).where(eq(pianoPayments.id, paymentId)).limit(1);
  if (!payment) return fail("Payment not found.");
  if (payment.voidedAt) return fail("Payment is already voided.");
  const entry = await entryBySource("piano_payment", paymentId);
  if (!entry) return fail("No journal entry found for this payment.");
  try {
    await voidJournalEntry(entry.id, `Piano payment voided — ${why}`, user.name);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not void the payment.");
  }
  await db.update(pianoPayments).set({ voidedAt: new Date(), voidReason: why }).where(eq(pianoPayments.id, paymentId));
  touch();
  return ok();
}

export async function addPianoCost(input: {
  pianoId?: string; kind?: string; description?: string; amount?: number;
  spentAt?: string | null; vendor?: string | null; walletId?: string | null;
  receiptUrl?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.pianoId) return fail("Missing piano.");
  const [piano] = await db.select().from(pianos).where(eq(pianos.id, input.pianoId)).limit(1);
  if (!piano) return fail("Piano not found.");
  const [sale] = await db.select().from(pianoSales).where(eq(pianoSales.pianoId, input.pianoId)).limit(1);
  if (sale?.status === "completed") return fail("Sale is completed — the cost snapshot is frozen.");
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const description = str(input.description, 300);
  if (!description) return fail("Describe the cost.");
  const date = optionalDate(input.spentAt) ?? new Date();
  const onHandId = await systemAccountId("pianos_on_hand");
  const apId = await systemAccountId("ap");
  if (!onHandId || !apId) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  const unpaid = input.walletId === "unpaid" || input.walletId === null || input.walletId === undefined;
  const wallet = unpaid ? null : await walletById(input.walletId ?? "");
  if (!unpaid && !wallet) return fail("Pick a wallet, or choose “Not paid yet”.");

  try {
    await db.transaction(async (tx) => {
      const [cost] = await tx
        .insert(pianoCostEntries)
        .values({
          pianoId: input.pianoId!,
          kind: oneOf(input.kind, ["acquisition", "prep", "other"] as const, "acquisition"),
          description, amountCents: cents, spentAt: date,
          vendor: str(input.vendor, 160), paidAccountId: wallet?.id ?? null,
          paidAt: wallet ? date : null, receiptUrl: str(input.receiptUrl, 500), note: str(input.note, 500),
        })
        .returning({ id: pianoCostEntries.id });
      await postJournalEntry({
        occurredAt: date,
        kind: "piano_cost",
        stream: "sales",
        memo: `Piano cost — ${description}`,
        sourceType: "piano_cost",
        sourceId: cost!.id,
        sourceHash: hashSource({ amount: cents, kind: input.kind ?? "acquisition", at: date.toISOString(), paid: !!wallet }),
        postedBy: user.name,
        legs: twoLeg(onHandId, wallet ? wallet.id : apId, cents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the cost.");
  }
  touch();
  return ok();
}

export async function payPianoCost(costId: string, walletId: string): Promise<Result> {
  const user = await requireUser();
  const [cost] = await db.select().from(pianoCostEntries).where(eq(pianoCostEntries.id, costId)).limit(1);
  if (!cost) return fail("Cost not found.");
  if (cost.voidedAt) return fail("Cost is voided.");
  if (cost.paidAccountId) return fail("Cost is already paid.");
  const wallet = await walletById(walletId);
  if (!wallet) return fail("Pick the wallet paid from.");
  const apId = await systemAccountId("ap");
  if (!apId) return fail("Accounting is not initialized yet.");
  const date = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(pianoCostEntries)
        .set({ paidAccountId: wallet.id, paidAt: date, updatedAt: date })
        .where(eq(pianoCostEntries.id, costId));
      await postJournalEntry({
        occurredAt: date,
        kind: "ap_payment",
        stream: "sales",
        memo: `Paid piano cost — ${cost.description}`,
        sourceType: "piano_cost_payment",
        sourceId: costId,
        postedBy: user.name,
        legs: twoLeg(apId, wallet.id, cost.amountCents),
      });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not record the payment.");
  }
  touch();
  return ok();
}

export async function voidPianoCost(costId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  const why = str(reason, 300);
  if (!why) return fail("Give a reason.");
  const [cost] = await db.select().from(pianoCostEntries).where(eq(pianoCostEntries.id, costId)).limit(1);
  if (!cost) return fail("Cost not found.");
  if (cost.voidedAt) return fail("Cost is already voided.");
  const entry = await entryBySource("piano_cost", costId);
  if (!entry) return fail("No journal entry found for this cost.");
  try {
    await voidJournalEntry(entry.id, `Piano cost voided — ${why}`, user.name);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not void the cost.");
  }
  await db.update(pianoCostEntries).set({ voidedAt: new Date(), voidReason: why }).where(eq(pianoCostEntries.id, costId));
  touch();
  return ok();
}

/**
 * Complete a sale: recognize revenue (VAT extracted from the VAT-inclusive price), move
 * deposits + unpaid balance, recognize cost of sales, and FREEZE the price and carrying
 * cost snapshots so later edits never corrupt realized margin. If the piano carries a
 * legacy `cost_cents` and no acquisition-kind cost entry has been recorded yet, that
 * figure is booked through Opening Equity first so the COGS leg balances — prep entries
 * alone never replace the acquisition cost.
 */
export async function completePianoSale(input: {
  saleId?: string; finalPrice?: number; taxRateBps?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.saleId) return fail("Missing sale.");
  const [sale] = await db.select().from(pianoSales).where(eq(pianoSales.id, input.saleId)).limit(1);
  if (!sale) return fail("Sale not found.");
  if (sale.status !== "reserved") return fail("Only a reserved sale can be completed.");

  const [piano] = await db.select().from(pianos).where(eq(pianos.id, sale.pianoId)).limit(1);
  if (!piano) return fail("Piano not found.");
  const price = input.finalPrice !== undefined ? moneyToCents(input.finalPrice) : sale.priceCents;
  if (price <= 0) return fail("Enter the final selling price (VAT-inclusive).");
  const rate = input.taxRateBps !== undefined ? Math.max(0, intOr(input.taxRateBps, 1200)) : sale.taxRateBps;
  const net = netFromInclusiveCents(price, rate);
  const tax = vatInclusiveCents(price, rate);

  const costRows = await db
    .select({
      total: sql<number>`coalesce(sum(${pianoCostEntries.amountCents}), 0)::int`,
      acq: sql<number>`count(*) filter (where ${pianoCostEntries.kind} = 'acquisition')::int`,
    })
    .from(pianoCostEntries)
    .where(and(eq(pianoCostEntries.pianoId, sale.pianoId), isNull(pianoCostEntries.voidedAt)));
  // Prep/other entries add to the piano's cost; only a recorded acquisition entry
  // supersedes the legacy `pianos.cost_cents` figure (dropping it would understate COGS).
  const legacyCents = (costRows[0]?.acq ?? 0) > 0 ? 0 : (piano.costCents ?? 0);
  const carrying = (costRows[0]?.total ?? 0) + legacyCents;

  const payRows = await db
    .select({ paid: sql<number>`coalesce(sum(${pianoPayments.amountCents}), 0)::int` })
    .from(pianoPayments)
    .where(
      and(
        eq(pianoPayments.saleId, sale.id),
        isNull(pianoPayments.voidedAt),
        // Only the CURRENT reservation's deposits — a cancelled-then-re-reserved sale
        // row keeps its old payment history, but those deposits were already settled.
        gte(pianoPayments.createdAt, sale.reservedAt ?? new Date(0)),
      ),
    );
  const paid = payRows[0]?.paid ?? 0;

  const [depositsId, arId, revenueId, vatId, cogsId, onHandId, openingId] = await Promise.all([
    systemAccountId("deposits_held"), systemAccountId("ar"), systemAccountId("piano_revenue"),
    systemAccountId("vat_payable"), systemAccountId("piano_cogs"), systemAccountId("pianos_on_hand"),
    systemAccountId("opening_equity"),
  ]);
  if (!depositsId || !arId || !revenueId || !vatId || !cogsId || !onHandId || !openingId) {
    return fail("Accounting is not initialized yet — open the Accounting page once first.");
  }

  const date = new Date();
  try {
    await db.transaction(async (tx) => {
      // Legacy cost field without a tracked acquisition entry → book it through Opening
      // Equity so the COGS leg balances and margin is never overstated.
      if (legacyCents > 0) {
        await postJournalEntry({
          occurredAt: date,
          kind: "piano_cost",
          stream: "sales",
          memo: `Pre-books carrying cost — ${piano.brand} ${piano.model}`,
          sourceType: "piano_cost_opening",
          sourceId: sale.id,
          postedBy: user.name,
          legs: twoLeg(onHandId, openingId, legacyCents),
        });
      }
      await postJournalEntry({
        occurredAt: date,
        kind: "piano_sale",
        stream: "sales",
        memo: `Piano sold — ${piano.brand} ${piano.model}${sale.buyerName ? ` — ${sale.buyerName}` : ""}`,
        sourceType: "piano_sale",
        sourceId: sale.id,
        sourceHash: hashSource({ price, rate, paid, carrying }),
        postedBy: user.name,
        legs: completionLegs({
          depositsId, arId, revenueId, vatId,
          paidCents: paid, totalCents: price, revenueCents: net, taxCents: tax,
        }),
      });
      if (carrying > 0) {
        await postJournalEntry({
          occurredAt: date,
          kind: "piano_sale",
          stream: "sales",
          memo: `Piano sold — cost of sales`,
          sourceType: "piano_sale_cogs",
          sourceId: sale.id,
          postedBy: user.name,
          legs: twoLeg(cogsId, onHandId, carrying),
        });
      }
      await tx
        .update(pianoSales)
        .set({
          status: "completed", soldAt: date, priceCents: price, taxRateBps: rate,
          costSnapshotCents: carrying, updatedAt: date,
        })
        .where(eq(pianoSales.id, sale.id));
      await tx.update(pianos).set({ status: "sold" }).where(eq(pianos.id, sale.pianoId));
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not complete the sale.");
  }
  touch();
  return ok();
}

/** Cancel a reserved sale. Any refunded deposit leaves the wallet; the piano returns to available. */
export async function cancelPianoSale(input: {
  saleId?: string; refund?: number; reason?: string | null; walletId?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!input.saleId) return fail("Missing sale.");
  const [sale] = await db.select().from(pianoSales).where(eq(pianoSales.id, input.saleId)).limit(1);
  if (!sale) return fail("Sale not found.");
  if (sale.status !== "reserved") return fail("Only a reserved sale can be cancelled.");
  const reason = str(input.reason, 300) ?? "Buyer backed out";

  const payRows = await db
    .select({ paid: sql<number>`coalesce(sum(${pianoPayments.amountCents}), 0)::int` })
    .from(pianoPayments)
    .where(
      and(
        eq(pianoPayments.saleId, sale.id),
        isNull(pianoPayments.voidedAt),
        // Deposits from earlier (cancelled) reservations on the reused row are settled.
        gte(pianoPayments.createdAt, sale.reservedAt ?? new Date(0)),
      ),
    );
  const held = payRows[0]?.paid ?? 0;
  const refund = moneyToCents(input.refund);
  if (refund < 0 || refund > held) return fail(`Refund must be between 0 and the deposits held (${(held / 100).toFixed(2)}).`);

  const depositsId = await systemAccountId("deposits_held");
  const otherIncomeId = await systemAccountId("other_income");
  if (!depositsId || !otherIncomeId) return fail("Accounting is not initialized yet.");
  const forfeit = held - refund;

  try {
    await db.transaction(async (tx) => {
      if (refund > 0) {
        const wallet = await walletById(input.walletId ?? "");
        if (!wallet) throw new Error("Pick the wallet the refund is paid from.");
        await postJournalEntry({
          occurredAt: new Date(),
          kind: "piano_sale",
          stream: "sales",
          memo: `Sale cancelled — deposit refund (${reason})`,
          sourceType: "piano_sale_cancel",
          sourceId: sale.id,
          postedBy: user.name,
          legs: twoLeg(depositsId, wallet.id, refund),
        });
      }
      // A deposit that is neither refunded nor applied to a sale is no longer owed to
      // the buyer — release it from the liability into other income.
      if (forfeit > 0) {
        await postJournalEntry({
          occurredAt: new Date(),
          kind: "piano_sale",
          stream: "sales",
          memo: `Sale cancelled — deposit forfeited (${reason})`,
          sourceType: "piano_sale_cancel",
          sourceId: sale.id,
          postedBy: user.name,
          legs: twoLeg(depositsId, otherIncomeId, forfeit),
        });
      }
      await tx
        .update(pianoSales)
        .set({ status: "cancelled", updatedAt: new Date(), note: `Cancelled — ${reason}` })
        .where(eq(pianoSales.id, sale.id));
      await tx.update(pianos).set({ status: "available" }).where(eq(pianos.id, sale.pianoId));
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not cancel the sale.");
  }
  touch();
  return ok();
}
