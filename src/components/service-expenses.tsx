"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Wallet, Search, Trash2 } from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
} from "@/lib/service";
import type { ExpenseRow } from "@/server/service-data";
import { createExpense, deleteExpense } from "@/server/service";
import {
  Bar, Chip, EmptyState, ErrorLine, Field, FilterPills, GhostButton, Money, PrimaryButton,
  SectionCard, Select, StatCard, SvcModal, TextInput, TONE_BAR,
} from "@/components/service-ui";

const RANGES = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

export default function ExpensesClient({
  expenses,
  categoryTotals,
  monthTotalCents,
  monthCount,
  showFinance,
}: {
  expenses: ExpenseRow[];
  categoryTotals: { category: string; amountCents: number; count: number }[];
  monthTotalCents: number;
  monthCount: number;
  showFinance: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("month");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const cutoff = useMemo(() => {
    const now = new Date();
    if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === "quarter") return new Date(now.getTime() - 90 * 86_400_000);
    return null;
  }, [range]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses
      .filter((e) => (cutoff ? new Date(e.spentAt) >= cutoff : true))
      .filter((e) => (category === "all" ? true : e.category === category))
      .filter((e) => !q || `${e.description} ${e.vendor ?? ""}`.toLowerCase().includes(q));
  }, [expenses, cutoff, category, query]);

  const total = filtered.reduce((s, e) => s + e.amountCents, 0);
  const reimbursable = filtered.filter((e) => e.reimbursable).reduce((s, e) => s + e.amountCents, 0);
  const maxCat = Math.max(1, ...categoryTotals.map((c) => c.amountCents));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1300px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Expenses
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            Fuel, materials, subcontractors — everything that eats into margin
          </p>
        </div>
        <PrimaryButton onClick={() => setOpen(true)}>
          <Plus size={15} /> Add expense
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="This month" value={<Money cents={monthTotalCents} />} icon={<Wallet size={15} />} sub={`${monthCount} entries`} />
        <StatCard label="Shown" value={<Money cents={total} />} tone="azure" sub={`${filtered.length} entries`} />
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
            <FilterPills options={RANGES} value={range} onChange={setRange} />
            <div className="flex-1" />
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="!pl-9 w-52" />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="!w-auto">
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
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Date", "Category", "Description", "Job", "Method", "Amount", ""].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {filtered.map((e) => (
                    <tr key={e.id} className="group hover:bg-white/[0.02] transition">
                      <td className="px-5 py-2.5 text-[12.5px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtDate(new Date(e.spentAt))}
                      </td>
                      <td className="px-5 py-2.5">
                        <Chip tone="slate">{EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}</Chip>
                      </td>
                      <td className="px-5 py-2.5 text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                        {e.description}
                        {e.vendor ? (
                          <span className="text-[11.5px] ml-2" style={{ color: "var(--color-svc-text-faint)" }}>
                            {e.vendor}
                          </span>
                        ) : null}
                        {e.reimbursable ? (
                          <span className="text-[10.5px] ml-2" style={{ color: "var(--color-svc-violet)" }}>reimbursable</span>
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
                      <td className="px-5 py-2.5 whitespace-nowrap"><Money cents={e.amountCents} className="text-[13px]" /></td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => run(() => deleteExpense(e.id))}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
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

        <SectionCard title="By category">
          <div className="px-5 py-4 space-y-4">
            {categoryTotals.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No data yet.</p>
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
            <p className="text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>
              Category totals cover the last 90 days.
            </p>
            {showFinance ? (
              <Link href="/service/finance" className="text-[11.5px] hover:underline" style={{ color: TONE_BAR.azure }}>
                See the full finance report →
              </Link>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <ExpenseModal
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
        onCreate={(input) => run(() => createExpense(input))}
      />
    </div>
  );
}

function ExpenseModal({
  open,
  onClose,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (input: {
    category: string; description: string; amount: number; spentAt: string | null;
    vendor: string; method: string; reimbursable: boolean;
  }) => void;
}) {
  const [category, setCategory] = useState("fuel");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState("");
  const [vendor, setVendor] = useState("");
  const [method, setMethod] = useState("cash");
  const [reimbursable, setReimbursable] = useState(false);

  return (
    <SvcModal open={open} onClose={onClose} title="Add expense">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" hint="Pesos">
            <TextInput type="number" step="50" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
        </div>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Diesel — Buhangin run" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor">
            <TextInput value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label="Date">
            <TextInput type="datetime-local" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid with">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reimbursable">
            <Select value={reimbursable ? "yes" : "no"} onChange={(e) => setReimbursable(e.target.value === "yes")}>
              <option value="no">Business expense</option>
              <option value="yes">Owed to crew</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!description.trim()}
            onClick={() => {
              onCreate({
                category, description: description.trim(), amount: Number(amount) || 0,
                spentAt: spentAt || null, vendor, method, reimbursable,
              });
              onClose();
              setDescription(""); setAmount(""); setVendor("");
            }}
          >
            Add expense
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
