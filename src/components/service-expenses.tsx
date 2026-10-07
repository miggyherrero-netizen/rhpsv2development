"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Wallet, Search, Trash2, Paperclip } from "lucide-react";
import { RANGES, type RangeKey } from "@/lib/service-reports";
import { ExpenseFormModal } from "@/components/service-forms";
import { EXPENSE_KIND_LABEL } from "@/lib/service-finance-split";
import { fmtDate, peso } from "@/lib/format";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
} from "@/lib/service";
import type { ExpenseRow } from "@/server/service-data";
import { createExpense, deleteExpense, getExpenseReceipt } from "@/server/service";
import {
  Bar, Chip, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton,
  RangePicker, SectionCard, Select, StatCard, SvcModal, TextInput, TONE_BAR,
} from "@/components/service-ui";

export default function ExpensesClient({
  expenses,
  rangeKey,
  rangeLabel,
  showFinance,
  jobOptions,
  pianoOptions,
  unreviewed,
}: {
  jobOptions: { id: string; label: string }[];
  pianoOptions: { id: string; label: string; status: string }[];
  /** Expenses (any date) that still have no kind saved — drives the one-time review banner. */
  unreviewed: number;
  /** Already limited to the selected range by the server. */
  expenses: ExpenseRow[];
  rangeKey: RangeKey;
  rangeLabel: string;
  showFinance: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [receiptView, setReceiptView] = useState<{ url: string | null; title: string; error?: string } | null>(null);
  const openReceipt = async (id: string, title: string) => {
    setReceiptView({ url: null, title });
    const res = await getExpenseReceipt(id);
    setReceiptView({ url: res.ok ? res.data?.url ?? null : null, title, error: res.ok ? undefined : res.error });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  // The category breakdown follows the range only (not the search / category box), so it always
  // adds up to the range total shown above.
  const categoryTotals = useMemo(() => {
    const m = new Map<string, { amountCents: number; count: number }>();
    for (const e of expenses) {
      const c = m.get(e.category) ?? { amountCents: 0, count: 0 };
      c.amountCents += e.amountCents; c.count += 1; m.set(e.category, c);
    }
    return [...m.entries()].map(([category, v]) => ({ category, ...v })).sort((x, y) => y.amountCents - x.amountCents);
  }, [expenses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses
      .filter((e) => (category === "all" ? true : e.category === category))
      .filter((e) => !q || `${e.description} ${e.vendor ?? ""}`.toLowerCase().includes(q));
  }, [expenses, category, query]);

  const rangeTotal = expenses.reduce((s, e) => s + e.amountCents, 0);
  const total = filtered.reduce((s, e) => s + e.amountCents, 0);
  const narrowed = filtered.length !== expenses.length;
  const reimbursable = expenses.filter((e) => e.reimbursable).reduce((s, e) => s + e.amountCents, 0);
  const maxCat = Math.max(1, ...categoryTotals.map((c) => c.amountCents));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1300px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Expenses
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            Fuel, materials, subcontractors — everything that eats into margin
          </p>
        </div>
        <PrimaryButton onClick={() => setOpen(true)}>
          <Plus size={15} /> Add expense
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      {unreviewed > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: "var(--color-svc-warn-soft)", border: "1px solid var(--color-svc-border)" }}>
          <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>
            <b className="font-medium">{unreviewed} expense{unreviewed === 1 ? "" : "s"}</b> {unreviewed === 1 ? "has" : "have"} no kind yet. Until you review them, Finance sorts them by category.
          </p>
          <Link href="/service/expenses/review" className="btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center text-[13px]">Review expenses</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker options={RANGES} value={rangeKey} />
        <p className="text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
          Showing <b className="font-medium">{rangeLabel.toLowerCase()}</b>
          {narrowed ? <> · <span className="svc-num">{filtered.length} of {expenses.length}</span> entries match your search</> : null}
        </p>
      </div>

      {expenses.length >= 1000 && (
        <p className="text-[13px]" style={{ color: "var(--color-svc-warn)" }}>
          Showing the latest 1,000 entries — pick a shorter range for exact totals.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <StatCard
            label={`Total · ${rangeLabel.toLowerCase()}`}
            value={<Money cents={narrowed ? total : rangeTotal} />}
            icon={<Wallet size={15} />}
            tone="azure"
            sub={narrowed ? `${filtered.length} matching entries` : `${expenses.length} entries`}
          />
        </div>
        <StatCard label="Reimbursable" value={<Money cents={reimbursable} />} tone="violet" sub="owed back to crew" />
        <StatCard
          label="Top category"
          value={categoryTotals[0] ? (EXPENSE_CATEGORY_LABEL[categoryTotals[0].category] ?? categoryTotals[0].category) : "—"}
          sub={categoryTotals[0] ? peso(categoryTotals[0].amountCents) : "no data"}
          tone="warn"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        <SectionCard>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-svc-border)" }}>
            <div className="flex-1" />
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search expenses" className="!pl-9 w-52" />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" className="!w-auto">
              <option value="all">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Wallet size={19} strokeWidth={1.7} />}
              title="No expenses recorded"
              hint="Log fuel and materials against jobs to see true job margins."
            />
          ) : (
            <div className="svc-table-wrap thin-scroll">
              <table className="svc-table w-full text-left">
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Date", "Category", "Kind", "Description", "Job", "Method", "Amount", ""].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-[12px] uppercase tracking-[0.08em] font-normal">{h || <span className="sr-only">Actions</span>}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {filtered.map((e) => (
                    <tr key={e.id} className="group hover:bg-white/[0.02] transition">
                      <td className="px-5 py-2.5 text-[13px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtDate(new Date(e.spentAt))}
                      </td>
                      <td className="px-5 py-2.5">
                        <Chip tone="slate">{EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}</Chip>
                      </td>
                      <td className="px-5 py-2.5">
                        {e.kind ? (
                          <Chip tone={e.kind === "stock" ? "violet" : e.kind === "overhead" ? "slate" : "azure"}>{EXPENSE_KIND_LABEL[e.kind] ?? e.kind}</Chip>
                        ) : (
                          <Chip tone="warn">Not reviewed</Chip>
                        )}
                        {e.pianoLabel ? <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>{e.pianoLabel}</p> : null}
                      </td>
                      <td className="px-5 py-2.5 text-[14px]" style={{ color: "var(--color-svc-text)" }}>
                        {e.description}
                        {e.vendor ? (
                          <span className="text-[12px] ml-2" style={{ color: "var(--color-svc-text-faint)" }}>
                            {e.vendor}
                          </span>
                        ) : null}
                        {e.reimbursable ? (
                          <span className="text-[12px] ml-2" style={{ color: "var(--color-svc-violet)" }}>reimbursable</span>
                        ) : null}
                        {e.hasReceipt ? (
                          <button
                            type="button" onClick={() => openReceipt(e.id, e.description)}
                            className="ml-2 inline-flex items-center gap-1 text-[12px] hover:underline min-h-11 align-middle"
                            style={{ color: "var(--color-svc-accent)" }} aria-label={`View receipt for ${e.description}`}
                          >
                            <Paperclip size={12} /> Receipt
                          </button>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5 text-[12px] whitespace-nowrap">
                        {e.jobCode ? (
                          <span className="font-mono" style={{ color: "var(--color-svc-text-faint)" }}>{e.jobCode}</span>
                        ) : (
                          <span style={{ color: "var(--color-svc-text-faint)" }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-[12px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {PAYMENT_METHOD_LABEL[e.method] ?? e.method}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap"><Money cents={e.amountCents} className="text-[14px]" /></td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => run(() => deleteExpense(e.id))}
                          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
                          style={{ color: "var(--color-svc-text-faint)" }}
                          aria-label="Delete expense"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title={`By category · ${rangeLabel.toLowerCase()}`}>
          <div className="px-5 py-4 space-y-4">
            {categoryTotals.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No expenses in this range.</p>
            ) : (
              categoryTotals.map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <span style={{ color: "var(--color-svc-text-dim)" }}>
                      {EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <span className="tnum" style={{ color: "var(--color-svc-text)" }}>{peso(c.amountCents)}</span>
                  </div>
                  <Bar pct={(c.amountCents / maxCat) * 100} color="var(--color-svc-violet)" />
                </div>
              ))
            )}
            <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
              Category totals cover the last 90 days.
            </p>
            {showFinance ? (
              <Link href="/service/finance" className="inline-flex items-center min-h-11 text-[12px] hover:underline" style={{ color: TONE_BAR.azure }}>
                See the full finance report →
              </Link>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <SvcModal open={!!receiptView} onClose={() => setReceiptView(null)} title="Receipt" subtitle={receiptView?.title} wide>
        {receiptView && !receiptView.url && (
          <p className="text-[14px]" style={{ color: "var(--color-svc-text-dim)" }}>{receiptView.error ?? "Loading receipt…"}</p>
        )}
        {receiptView?.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiptView.url} alt={`Receipt for ${receiptView.title}`} className="w-full max-h-[70vh] object-contain rounded-lg bg-black/30" />
        )}
      </SvcModal>

      <ExpenseFormModal
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
        jobOptions={jobOptions}
        pianoOptions={pianoOptions}
        onSubmit={(values) => run(() => createExpense(values))}
      />
    </div>
  );
}
