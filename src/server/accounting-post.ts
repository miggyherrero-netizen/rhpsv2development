/**
 * Accounting posting core — shared by the bridge and every accounting action.
 * NOT a "use server" file (it is a library): it never runs without an authenticated
 * caller above it in the stack.
 *
 * Invariants enforced here:
 *  - every journal entry is balanced (Σ debits = Σ credits) before insert
 *  - every write inside a locked period is rejected (bridge callers catch → exception)
 *  - entries are append-only; corrections/voids post reversal entries
 *  - every write leaves an audit_log row
 */

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accAccounts, accJournal, accJournalLines, accPeriodLocks, accSettings, auditLog,
  type AccAccount, type AccSettings,
} from "@/db/schema";
import {
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_WALLETS, SYSTEM_ACCOUNTS,
  defaultBooksStart, isBalanced, jeCode, monthKeyManila, reversedLegs,
  type JournalLegDraft,
} from "@/lib/accounting";
import { PAYMENT_METHODS } from "@/lib/service";

/* ============================================================
 * Errors
 * ============================================================ */

export class PeriodLockedError extends Error {
  constructor(period: string) {
    super(`Period ${period} is locked. Unlock it in Accounting settings first.`);
    this.name = "PeriodLockedError";
  }
}

/* ============================================================
 * Hashing (source change detection)
 * ============================================================ */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Stable hash of a source row's posting-relevant state (sorted keys, sha256, 16 hex chars). */
export function hashSource(state: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(state)).digest("hex").slice(0, 16);
}

/* ============================================================
 * Period locks
 * ============================================================ */

export async function assertPeriodOpen(occurredAt: Date): Promise<void> {
  const key = monthKeyManila(occurredAt);
  const [year, month] = key.split("-").map(Number);
  const [lock] = await db
    .select({ id: accPeriodLocks.id })
    .from(accPeriodLocks)
    .where(and(eq(accPeriodLocks.year, year!), eq(accPeriodLocks.month, month!)))
    .limit(1);
  if (lock) throw new PeriodLockedError(key);
}

/* ============================================================
 * Audit
 * ============================================================ */

export async function audit(input: {
  tableName: string; rowId: string; action: string;
  before?: unknown; after?: unknown; actor?: string | null; note?: string | null;
}): Promise<void> {
  await db.insert(auditLog).values({
    tableName: input.tableName,
    rowId: input.rowId,
    action: input.action,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    actor: input.actor ?? null,
    note: input.note ?? null,
  });
}

/* ============================================================
 * Posting
 * ============================================================ */

export type PostEntryInput = {
  occurredAt: Date;
  kind: string;
  stream: string;
  memo?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceHash?: string | null;
  postedBy?: string | null;
  reversalOfId?: string | null;
  legs: JournalLegDraft[];
};

export type PostedEntry = { id: string; entryNumber: number; code: string };

/** Insert one balanced journal entry (+ its lines, + audit) inside a transaction. */
export async function postJournalEntry(input: PostEntryInput): Promise<PostedEntry> {
  if (!input.legs.length) throw new Error("Journal entry has no lines.");
  if (!isBalanced(input.legs)) throw new Error("Unbalanced journal entry rejected.");
  await assertPeriodOpen(input.occurredAt);
  const occurredAt = new Date(input.occurredAt);
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(accJournal)
      .values({
        occurredAt,
        kind: input.kind,
        stream: input.stream,
        memo: input.memo ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        sourceHash: input.sourceHash ?? null,
        postedBy: input.postedBy ?? null,
        reversalOfId: input.reversalOfId ?? null,
      })
      .returning({ id: accJournal.id, entryNumber: accJournal.entryNumber });
    await tx.insert(accJournalLines).values(
      input.legs.map((l) => ({
        journalId: entry!.id,
        accountId: l.accountId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        lineMemo: l.lineMemo ?? null,
      })),
    );
    await tx.insert(auditLog).values({
      tableName: "acc_journal",
      rowId: entry!.id,
      action: "post",
      after: {
        code: jeCode(entry!.entryNumber, occurredAt),
        kind: input.kind,
        occurredAt: occurredAt.toISOString(),
        memo: input.memo ?? null,
        legs: input.legs,
      } as never,
      actor: input.postedBy ?? null,
      note: input.sourceType ? `posted from ${input.sourceType}` : null,
    });
    return { id: entry!.id, entryNumber: entry!.entryNumber, code: jeCode(entry!.entryNumber, occurredAt) };
  });
}

/**
 * Void an entry the append-only way: mark the original voided (excluded from aggregates)
 * and post a reversal entry dated now, so history is never rewritten. The reversal is
 * dated today, not the original date — voiding an old entry must still be possible after
 * its month has been closed.
 */
export async function voidJournalEntry(
  id: string,
  reason: string,
  postedBy?: string | null,
): Promise<PostedEntry | null> {
  const [entry] = await db.select().from(accJournal).where(eq(accJournal.id, id)).limit(1);
  if (!entry || entry.voidedAt) return null;
  if (entry.reversalOfId) throw new Error("Corrections cannot be voided directly — void the original entry instead.");

  const lines = await db.select().from(accJournalLines).where(eq(accJournalLines.journalId, id));
  const legs: JournalLegDraft[] = reversedLegs(
    lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      lineMemo: l.lineMemo,
    })),
  );
  if (!legs.length) throw new Error("Entry has no lines to reverse.");

  const now = new Date();
  const reversal = await postJournalEntry({
    occurredAt: now,
    kind: "correction",
    stream: entry.stream,
    memo: `Reversal of ${jeCode(entry.entryNumber, entry.occurredAt)} — ${reason}`,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceHash: entry.sourceHash,
    postedBy: postedBy ?? null,
    reversalOfId: entry.id,
    legs,
  });
  await db
    .update(accJournal)
    .set({ voidedAt: now, voidReason: reason })
    .where(eq(accJournal.id, id));
  await audit({
    tableName: "acc_journal",
    rowId: id,
    action: "void",
    before: { code: jeCode(entry.entryNumber, entry.occurredAt), kind: entry.kind },
    actor: postedBy ?? null,
    note: reason,
  });
  return reversal;
}

/* ============================================================
 * Core initialization + context
 * ============================================================ */

export type AccContext = {
  settings: AccSettings;
  accounts: AccAccount[];
  byKey: Map<string, AccAccount>;
  byId: Map<string, AccAccount>;
  wallets: AccAccount[];
};

const defaultMethodMap = (byKey: Map<string, AccAccount>): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const m of PAYMENT_METHODS) {
    const walletKey =
      m.key === "cash" ? "wallet_cash"
      : m.key === "gcash" ? "wallet_gcash"
      : m.key === "maya" ? "wallet_maya"
      : m.key === "bank_transfer" ? "wallet_bank"
      : null;
    const account = walletKey ? byKey.get(walletKey) : undefined;
    if (account) map[m.key] = account.id;
  }
  return map;
};

/**
 * Idempotent: creates the system accounts, default wallets, expense categories and the
 * settings row (with a sensible method→wallet map) the first time Accounting is used.
 * Safe to call on every load — after the first run it is one indexed SELECT.
 */
export async function ensureAccountingCore(ownerId: string): Promise<void> {
  const [existing] = await db.select({ id: accSettings.id }).from(accSettings).where(eq(accSettings.ownerId, ownerId)).limit(1);
  if (existing) return;

  const specs = [...SYSTEM_ACCOUNTS, ...DEFAULT_WALLETS];
  await db
    .insert(accAccounts)
    .values(
      specs.map((spec, i) => ({
        name: spec.name,
        type: spec.type,
        isWallet: spec.isWallet ?? false,
        walletKind: spec.walletKind ?? null,
        systemKey: spec.systemKey,
        position: i,
        notes: spec.note ?? null,
      })),
    )
    .onConflictDoNothing({ target: accAccounts.systemKey });
  await db
    .insert(accAccounts)
    .values(
      DEFAULT_EXPENSE_CATEGORIES.map((cat, i) => ({
        name: cat.name,
        type: "expense",
        systemKey: cat.systemKey,
        position: 100 + i,
      })),
    )
    .onConflictDoNothing({ target: accAccounts.systemKey });

  const accounts = await db.select().from(accAccounts);
  const byKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  const cash = byKey.get("wallet_cash");
  await db
    .insert(accSettings)
    .values({
      ownerId,
      booksStartDate: defaultBooksStart(),
      methodMap: defaultMethodMap(byKey),
      payrollAccountId: cash?.id ?? null,
    })
    .onConflictDoNothing({ target: accSettings.ownerId });
  await audit({ tableName: "acc_settings", rowId: ownerId, action: "create", note: "Accounting initialized" });
}

/** Settings + accounts, after ensuring the core exists. The one-stop context getter. */
export async function getAccountingContext(ownerId: string): Promise<AccContext> {
  await ensureAccountingCore(ownerId);
  const [settings] = await db.select().from(accSettings).where(eq(accSettings.ownerId, ownerId)).limit(1);
  const accounts = await db.select().from(accAccounts);
  const byKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    settings: settings!,
    accounts,
    byKey,
    byId,
    wallets: accounts.filter((a) => a.isWallet),
  };
}
