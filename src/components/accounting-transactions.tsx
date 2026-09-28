"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Plus, Search } from "lucide-react";
import type { JournalFeedItem } from "@/server/accounting-data";
import type { AccountRow } from "@/server/accounting-data";
import {
  createLoanAccount, recordBusinessExpense, recordBusinessIncome, recordLoanPayment,
  recordLoanReceived, recordPayablePayment, recordTaxPayment, recordTransfer, voidEntry,
} from "@/server/accounting";
import { Modal, Field } from "@/components/ui";
import { AccountingHeader, Btn, Day, FormError, KindChip, Money, SectionCard, StreamChip, useAction } from "@/components/accounting-ui";
import { JOURNAL_KINDS, KIND_LABEL, STREAMS, STREAM_LABEL } from "@/lib/accounting";
import { peso, toDateInput } from "@/lib/format";

type Filter = { accountId?: string; kind?: string; stream?: string; monthKey?: string; q?: string };

const RECORD_KINDS = ["business_expense", "business_income", "transfer", "loan_received", "loan_payment", "tax_payment", "ap_payment"] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

export default function AccountingTransactions({
  items, wallets, expenseAccounts, loanAccounts, months, filter,
}: {
  items: JournalFeedItem[];
  wallets: { id: string; name: string }[];
  expenseAccounts: AccountRow[];
  loanAccounts: AccountRow[];
  months: string[];
  filter: Filter;
}) {
  const router = useRouter();
  const action = useAction();
  const [modal, setModal] = useState<RecordKind | null>(null);
  const [voidTarget, setVoidTarget] = useState<JournalFeedItem | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // shared form state
  const today = toDateInput(new Date());
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState(expenseAccounts[0]?.id ?? "");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [walletId2, setWalletId2] = useState(wallets[1]?.id ?? wallets[0]?.id ?? "");
  const [unpaid, setUnpaid] = useState(false);
  const [loanId, setLoanId] = useState(loanAccounts[0]?.id ?? "");
  const [newLoan, setNewLoan] = useState("");
  const [interest, setInterest] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  function close() {
    setModal(null);
    setAmount(""); setDescription(""); setVendor(""); setInterest(""); setNewLoan(""); setNote(""); setUnpaid(false);
  }

  async function submit() {
    if (!modal) return;
    const amt = Number(amount);
    let res: boolean = false;
    switch (modal) {
      case "business_expense":
        res = await action.run(() => recordBusinessExpense({
          amount: amt, categoryId: category, walletId: unpaid ? "unpaid" : walletId,
          date, vendor, description, note,
        }));
        break;
      case "business_income":
        res = await action.run(() => recordBusinessIncome({ amount: amt, walletId, date, description }));
        break;
      case "transfer":
        res = await action.run(() => recordTransfer({ amount: amt, fromWalletId: walletId, toWalletId: walletId2, date, note }));
        break;
      case "loan_received": {
        let loanAcc = loanId;
        if (newLoan.trim()) {
          const created = await createLoanAccount(newLoan);
          if (!created.ok) { action.setError(created.error); return; }
          loanAcc = created.data!.id;
        }
        if (!loanAcc) { action.setError("Pick or create a loan account."); return; }
        res = await action.run(() => recordLoanReceived({ amount: amt, loanAccountId: loanAcc, walletId, date, note }));
        break;
      }
      case "loan_payment":
        res = await action.run(() => recordLoanPayment({ amount: amt, interest: Number(interest) || 0, loanAccountId: loanId, walletId, date }));
        break;
      case "tax_payment":
        res = await action.run(() => recordTaxPayment({ amount: amt, walletId, date, reference }));
        break;
      case "ap_payment":
        res = await action.run(() => recordPayablePayment({ amount: amt, walletId, date, note }));
        break;
    }
    if (res) close();
  }

  function setFilter(patch: Partial<Filter>) {
    const next = { ...filter, ...patch };
    const params = new URLSearchParams();
    if (next.accountId) params.set("account", next.accountId);
    if (next.kind) params.set("kind", next.kind);
    if (next.stream) params.set("stream", next.stream);
    if (next.monthKey) params.set("month", next.monthKey);
    if (next.q) params.set("q", next.q);
    router.push(`/admin/accounting/transactions${params.size ? `?${params.toString()}` : ""}`);
  }

  const [q, setQ] = useState(filter.q ?? "");

  return (
    <div className="p-4 sm:p-7 max-w-[1300px] mx-auto">
      <AccountingHeader
        title="Transactions"
        sub="Every money movement in one journal — recorded where the work happens, classified here."
        action={
          <div className="flex flex-wrap gap-2 justify-end">
            {RECORD_KINDS.map((k) => (
              <Btn key={k} variant="ghost" onClick={() => setModal(k)}><Plus size={12} /> {KIND_LABEL[k]}</Btn>
            ))}
          </div>
        }
      />
      <div className="mb-4"><FormError error={action.error} /></div>

      {/* Filters */}
      <div className="card-dark p-3 mb-5 flex flex-wrap gap-2 items-center">
        <select className="input-dark !w-auto text-[12px]" value={filter.accountId ?? ""} onChange={(e) => setFilter({ accountId: e.target.value || undefined })}>
          <option value="">All accounts</option>
          {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="input-dark !w-auto text-[12px]" value={filter.kind ?? ""} onChange={(e) => setFilter({ kind: e.target.value || undefined })}>
          <option value="">All kinds</option>
          {JOURNAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <select className="input-dark !w-auto text-[12px]" value={filter.stream ?? ""} onChange={(e) => setFilter({ stream: e.target.value || undefined })}>
          <option value="">All streams</option>
          {STREAMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="input-dark !w-auto text-[12px]" value={filter.monthKey ?? ""} onChange={(e) => setFilter({ monthKey: e.target.value || undefined })}>
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <form className="flex gap-2 ml-auto" onSubmit={(e) => { e.preventDefault(); setFilter({ q: q || undefined }); }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mist/60" />
            <input className="input-dark !w-44 !pl-7 text-[12px]" placeholder="Search memo…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Btn variant="ghost" type="submit">Search</Btn>
        </form>
      </div>

      <SectionCard title={`Journal — ${items.length} entr${items.length === 1 ? "y" : "ies"}`}>
        <div className="divide-y divide-white/[0.05]">
          {items.map((e) => (
            <div key={e.id} className={`py-3 ${e.voided ? "opacity-45" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <KindChip kind={e.kind} />
                    <StreamChip stream={e.stream} />
                    {e.voided && <span className="text-[10.5px] text-rose-300">voided — {e.voidReason}</span>}
                    {e.isCorrection && <span className="text-[10.5px] text-mist/60">correction</span>}
                    <span className="text-[10.5px] text-mist/50 tnum">{e.code}</span>
                  </div>
                  <p className="text-[13px] text-chrome mt-1.5">{e.memo}</p>
                  <p className="text-[11px] text-mist/60 mt-0.5"><Day iso={e.occurredAt} /></p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                    {e.legs.map((l, i) => (
                      <span key={i} className="text-[11px] text-mist/75 tnum">
                        {l.accountName}: {l.debitCents > 0 ? <span className="text-emerald-300/90">+{peso(l.debitCents)}</span> : <span className="text-rose-300/90">−{peso(l.creditCents)}</span>}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="text-right">
                    {e.walletInCents > 0 && <p className="tnum text-emerald-300 text-[14px]">+{peso(e.walletInCents)}</p>}
                    {e.walletOutCents > 0 && <p className="tnum text-rose-300 text-[14px]">−{peso(e.walletOutCents)}</p>}
                    {e.walletInCents === 0 && e.walletOutCents === 0 && <p className="tnum text-mist/50 text-[13px]">no wallet effect</p>}
                  </div>
                  {!e.voided && !e.isCorrection && (
                    <button onClick={() => setVoidTarget(e)} className="text-[11px] text-mist hover:text-rose-300 transition inline-flex items-center gap-1">
                      <Ban size={11} /> Void
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="text-[12px] text-mist py-6 text-center">No entries match.</p>}
        </div>
      </SectionCard>

      {/* Record modal */}
      <Modal open={!!modal} onClose={close} title={modal ? KIND_LABEL[modal] : ""}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
            </Field>
            <Field label="Date">
              <input type="date" className="input-dark tnum" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          {modal === "business_expense" && (
            <>
              <Field label="Category">
                <select className="input-dark" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {expenseAccounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Description">
                <input className="input-dark" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Electricity — September" />
              </Field>
              <Field label="Vendor">
                <input className="input-dark" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="optional" />
              </Field>
              <Field label="Paid from">
                <div className="flex gap-2 items-center">
                  <select className="input-dark" value={unpaid ? "unpaid" : walletId} onChange={(e) => { if (e.target.value === "unpaid") setUnpaid(true); else { setUnpaid(false); setWalletId(e.target.value); } }}>
                    {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    <option value="unpaid">Not paid yet (payable)</option>
                  </select>
                </div>
              </Field>
            </>
          )}

          {modal === "business_income" && (
            <>
              <Field label="Description">
                <input className="input-dark" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Rent from studio tenant" />
              </Field>
              <Field label="Into wallet">
                <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {modal === "transfer" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From wallet">
                  <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                    {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
                <Field label="Into wallet">
                  <select className="input-dark" value={walletId2} onChange={(e) => setWalletId2(e.target.value)}>
                    {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Note">
                <input className="input-dark" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cash deposit to bank" />
              </Field>
            </>
          )}

          {(modal === "loan_received" || modal === "loan_payment") && (
            <>
              <Field label="Loan account">
                <select className="input-dark" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                  {loanAccounts.length === 0 && <option value="">No loan accounts yet</option>}
                  {loanAccounts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              {modal === "loan_received" && (
                <Field label="…or create a new loan account">
                  <input className="input-dark" value={newLoan} onChange={(e) => setNewLoan(e.target.value)} placeholder='e.g. Loan — BPI (leave empty to use the one above)' />
                </Field>
              )}
              {modal === "loan_payment" && (
                <Field label="Interest & fees portion (₱)">
                  <input className="input-dark tnum" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0 — the rest goes to principal" inputMode="decimal" />
                </Field>
              )}
              <Field label={modal === "loan_received" ? "Into wallet" : "Paid from wallet"}>
                <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {modal === "tax_payment" && (
            <>
              <Field label="Reference">
                <input className="input-dark" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. BIR 2551M Q3" />
              </Field>
              <Field label="Paid from wallet">
                <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {modal === "ap_payment" && (
            <>
              <Field label="What was this for?">
                <input className="input-dark" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid the wood supplier balance" />
              </Field>
              <Field label="Paid from wallet">
                <select className="input-dark" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={close}>Cancel</Btn>
            <Btn busy={action.busy} disabled={!amount.trim()} onClick={submit}>Record {modal ? KIND_LABEL[modal].toLowerCase() : ""}</Btn>
          </div>
        </div>
      </Modal>

      {/* Void modal */}
      <Modal open={!!voidTarget} onClose={() => { setVoidTarget(null); setVoidReason(""); }} title="Void entry">
        <div className="space-y-4">
          <p className="text-[12.5px] text-chrome/85 leading-relaxed">
            Voiding keeps history intact: the entry is marked voided and a reversing entry is posted today.
            {voidTarget?.walletInCents ? ` This removes ${peso(voidTarget.walletInCents)} of recorded money in.` : ""}
            {voidTarget?.walletOutCents ? ` This removes ${peso(voidTarget.walletOutCents)} of recorded money out.` : ""}
          </p>
          <Field label="Reason (kept in the audit trail)">
            <textarea className="input-dark" rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. recorded against the wrong wallet" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => { setVoidTarget(null); setVoidReason(""); }}>Cancel</Btn>
            <Btn
              variant="danger"
              busy={action.busy}
              disabled={voidReason.trim().length < 3}
              onClick={async () => {
                const done = await action.run(() => voidEntry(voidTarget!.id, voidReason), { notice: "Entry voided" });
                if (done) { setVoidTarget(null); setVoidReason(""); }
              }}
            >
              Void entry
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
