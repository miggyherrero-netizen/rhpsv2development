"use client";

import { useState } from "react";
import { HandCoins, PiggyBank, UserRound } from "lucide-react";
import type { OwnerMoneyBundle } from "@/server/accounting-data";
import { recordOwnerContribution, recordOwnerDraw, recordPersonalExpense } from "@/server/accounting";
import { Modal, Field } from "@/components/ui";
import { AccountingHeader, Bar, Btn, Day, FormError, KindChip, Money, SectionCard, StatCard, barTone, useAction } from "@/components/accounting-ui";
import { peso, toDateInput } from "@/lib/format";

const DRAW_CATEGORIES = ["Household", "Savings", "Tuition", "Personal", "Equipment", "Other"];

type ModalKind = "draw" | "contribution" | "personal" | null;

export default function AccountingOwnerMoney({ data }: { data: OwnerMoneyBundle }) {
  const action = useAction();
  const [modal, setModal] = useState<ModalKind>(null);
  const today = toDateInput(new Date());
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState(data.wallets[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState(DRAW_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");

  function close() { setModal(null); setAmount(""); setDescription(""); setNote(""); }

  async function submit() {
    const amt = Number(amount);
    const done =
      modal === "draw"
        ? await action.run(() => recordOwnerDraw({ amount: amt, walletId, date, category, note }), { notice: "Draw recorded" })
        : modal === "contribution"
          ? await action.run(() => recordOwnerContribution({ amount: amt, walletId, date, note }), { notice: "Contribution recorded" })
          : await action.run(() => recordPersonalExpense({ amount: amt, walletId, date, description }), { notice: "Personal expense recorded" });
    if (done) close();
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1100px] mx-auto">
      <AccountingHeader
        title="Owner money"
        sub="Draws, contributions, and personal costs paid from business money — kept structurally separate from business profit."
        action={
          <div className="flex flex-wrap gap-2 justify-end">
            <Btn onClick={() => setModal("draw")}><HandCoins size={13} /> Take a draw</Btn>
            <Btn variant="ghost" onClick={() => setModal("contribution")}><PiggyBank size={13} /> Add capital</Btn>
            <Btn variant="ghost" onClick={() => setModal("personal")}><UserRound size={13} /> Personal expense</Btn>
          </div>
        }
      />
      <div className="mb-4"><FormError error={action.error} /></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Safe to withdraw" value={<Money cents={data.safeToWithdraw.amountCents} />} tone={data.safeToWithdraw.amountCents >= 0 ? "emerald" : "rose"} sub="advisory — draws are never blocked" />
        <StatCard label="Cash on hand" value={<Money cents={data.totalCashCents} />} sub="all active wallets" />
        <StatCard label="Draws to date" value={<Money cents={data.equity.drawsCents} />} tone="amber" />
        <StatCard label="Owner's equity" value={<Money cents={data.equity.totalCents} />} sub="opening + capital + retained − draws − personal" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Before you withdraw">
          <div className="space-y-2.5">
            <div className="flex justify-between text-[12.5px]">
              <span className="text-mist">Retained profit (books to date)</span>
              <span className="tnum text-emerald-300">{peso(data.safeToWithdraw.retainedProfitCents)}</span>
            </div>
            {data.safeToWithdraw.parts.map((p) => (
              <div key={p.label}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-mist">− {p.label}</span>
                  <span className="tnum text-chrome">{peso(p.cents)}</span>
                </div>
                <Bar pct={data.safeToWithdraw.retainedProfitCents > 0 ? (p.cents / data.safeToWithdraw.retainedProfitCents) * 100 : 0} color={barTone("rose")} />
              </div>
            ))}
            <div className="flex justify-between text-[13px] pt-2.5 border-t border-white/[0.07]">
              <span className="text-chrome">Safe to withdraw</span>
              <span className={`tnum ${data.safeToWithdraw.amountCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{peso(data.safeToWithdraw.amountCents)}</span>
            </div>
          </div>
          <p className="text-[11px] text-mist/70 mt-4 leading-relaxed">
            This is guidance, not a rule. Withdrawals are your call — they reduce owner&apos;s equity, never business expenses, so profit stays honest either way.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Capital in</p>
              <p className="tnum text-[14px] text-white">{peso(data.equity.capitalCents)}</p>
            </div>
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Personal from business</p>
              <p className="tnum text-[14px] text-white">{peso(data.equity.personalCents)}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Owner money history">
          <div className="divide-y divide-white/[0.05] max-h-[520px] overflow-y-auto thin-scroll">
            {data.history.map((e) => (
              <div key={e.id} className={`py-3 ${e.voided ? "opacity-45" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <KindChip kind={e.kind} />
                    <p className="text-[12.5px] text-chrome truncate mt-1.5">{e.memo}</p>
                    <p className="text-[10.5px] text-mist/60"><Day iso={e.occurredAt} /> · {e.code}{e.voided ? " · voided" : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {e.walletOutCents > 0 && <p className="tnum text-rose-300 text-[13.5px]">−{peso(e.walletOutCents)}</p>}
                    {e.walletInCents > 0 && <p className="tnum text-emerald-300 text-[13.5px]">+{peso(e.walletInCents)}</p>}
                  </div>
                </div>
              </div>
            ))}
            {data.history.length === 0 && (
              <p className="text-[12px] text-mist py-6 text-center">
                No owner money movements yet. Draws, capital, and personal expenses recorded here never touch the business P&amp;L.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <Modal open={!!modal} onClose={close} title={modal === "draw" ? "Take an owner draw" : modal === "contribution" ? "Add owner capital" : "Personal expense from business money"}>
        <div className="space-y-4">
          {modal === "draw" && (
            <div className="card-dark p-3.5 text-[12px] text-mist leading-relaxed">
              Safe to withdraw right now: <span className="text-emerald-300 tnum">{peso(data.safeToWithdraw.amountCents)}</span>.
              Withdrawing more than that is allowed — it simply reduces equity further.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
            </Field>
            <Field label="Date">
              <input type="date" className="input-dark tnum" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label={modal === "contribution" ? "Into wallet" : "From wallet"}>
            <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {data.wallets.map((w) => <option key={w.id} value={w.id}>{w.name} — {peso(w.balanceCents)}</option>)}
            </select>
          </Field>
          {modal === "draw" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input-dark" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {DRAW_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Note">
                <input className="input-dark" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
              </Field>
            </div>
          )}
          {modal === "personal" && (
            <Field label="What was it?">
              <input className="input-dark" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. family groceries on the shop card" />
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={close}>Cancel</Btn>
            <Btn busy={action.busy} disabled={!amount.trim() || (modal === "personal" && !description.trim())} onClick={submit}>
              {modal === "draw" ? "Record draw" : modal === "contribution" ? "Record contribution" : "Record personal expense"}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
