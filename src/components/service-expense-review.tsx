"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/service";
import { EXPENSE_KINDS, defaultKindForCategory } from "@/lib/service-finance-split";
import type { ExpenseRow } from "@/server/service-data";
import { setExpenseKinds } from "@/server/service";
import { EmptyState, ErrorLine, Money, PrimaryButton, SectionCard, Select } from "@/components/service-ui";

type Pick = { kind: string; pianoId: string };

/** One-time screen: give every older expense a kind. Suggestions come from the category; nothing is saved until you press Save. */
export default function ExpenseReviewClient({
  expenses, pianoOptions,
}: {
  expenses: ExpenseRow[];
  pianoOptions: { id: string; label: string; status: string }[];
}) {
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(
    expenses.map((e) => [e.id, { kind: e.jobId ? "job" : defaultKindForCategory(e.category), pianoId: "" }]),
  ));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const stockWithoutPiano = expenses.filter((e) => picks[e.id]?.kind === "stock" && !picks[e.id]?.pianoId);
  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }));

  const save = () => {
    setError(null);
    start(async () => {
      const res = await setExpenseKinds(expenses.map((e) => ({ id: e.id, kind: picks[e.id]!.kind, pianoId: picks[e.id]!.pianoId || null })));
      if (!res.ok) return setError(res.error);
      setSaved(res.data?.updated ?? expenses.length);
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-5">
      <header>
        <Link href="/service/expenses" className="inline-flex items-center gap-1.5 min-h-11 text-[12px] hover:underline" style={{ color: "var(--color-svc-text-faint)" }}>
          <ArrowLeft size={13} aria-hidden="true" /> Expenses
        </Link>
        <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Review expenses</h1>
        <p className="text-[13px] mt-1 max-w-2xl" style={{ color: "var(--color-svc-text-dim)" }}>
          Tell Finance what each older expense was for. <b className="font-medium">Job cost</b> and <b className="font-medium">Overhead</b> hit profit right away;
          <b className="font-medium"> Piano stock</b> only counts once that piano is sold. The kind is suggested from the category — change any that are wrong, then save.
        </p>
      </header>

      <ErrorLine>{error}</ErrorLine>

      {saved !== null ? (
        <SectionCard>
          <EmptyState
            icon={<CheckCircle2 size={19} strokeWidth={1.7} />} title={`Saved ${saved} expense${saved === 1 ? "" : "s"}`}
            hint="Finance now splits these into Service, Piano sales and Overhead."
            action={<Link href="/service/expenses" className="btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center text-[13px]">Back to expenses</Link>}
          />
        </SectionCard>
      ) : expenses.length === 0 ? (
        <SectionCard><EmptyState icon={<CheckCircle2 size={19} strokeWidth={1.7} />} title="Everything is reviewed" hint="New expenses get a kind when you add them." /></SectionCard>
      ) : (
        <SectionCard
          title={`${expenses.length} to review`}
          action={<PrimaryButton pending={pending} disabled={stockWithoutPiano.length > 0} onClick={save} className="!min-h-11">Save all {expenses.length}</PrimaryButton>}
        >
          {stockWithoutPiano.length > 0 && (
            <p role="alert" className="px-5 pt-3 text-[13px]" style={{ color: "var(--color-svc-warn)" }}>
              {stockWithoutPiano.length} piano-stock expense{stockWithoutPiano.length === 1 ? " needs" : "s need"} a piano before you can save (or change its kind).
            </p>
          )}
          <ul className="svc-divide">
            {expenses.map((e) => {
              const pick = picks[e.id]!;
              return (
                <li key={e.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-x-4 gap-y-2 px-5 py-3 items-center">
                  <div className="min-w-0">
                    <p className="text-[14px] truncate" style={{ color: "var(--color-svc-text)" }}>{e.description}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>
                      {fmtDate(new Date(e.spentAt))} · {EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}{e.jobCode ? ` · ${e.jobCode}` : ""} · <Money cents={e.amountCents} />
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`Kind for ${e.description}`} value={pick.kind} className="!w-auto !min-h-11"
                      onChange={(ev) => set(e.id, { kind: ev.target.value })}
                    >
                      {EXPENSE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </Select>
                    {pick.kind === "stock" && (
                      <Select aria-label={`Piano for ${e.description}`} value={pick.pianoId} className="!w-auto !min-h-11 max-w-56" onChange={(ev) => set(e.id, { pianoId: ev.target.value })}>
                        <option value="">Choose a piano…</option>
                        {pianoOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </Select>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
