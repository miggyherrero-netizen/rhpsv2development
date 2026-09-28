"use client";

import { useState } from "react";
import { AlertTriangle, Check, Lock, LockOpen, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import type { SettingsBundle, AccountRow } from "@/server/accounting-data";
import {
  createExpenseCategory, lockPeriod, renameAccount, resolveException, syncNow, unlockPeriod,
  updateBooksStartDate, updateMethodMap, updatePayrollAccount, updateWallet,
} from "@/server/accounting";
import { Modal, Field } from "@/components/ui";
import { AccountingHeader, Btn, Day, FormError, Money, SectionCard, useAction } from "@/components/accounting-ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/service";
import { WALLET_KINDS, WALLET_KIND_LABEL } from "@/lib/accounting";
import { peso, toDateInput } from "@/lib/format";

function monthOptions(): { label: string; year: number; month: number }[] {
  const out: { label: string; year: number; month: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
    });
  }
  return out;
}

export default function AccountingSettings({ data }: { data: SettingsBundle }) {
  const action = useAction();
  const [booksStart, setBooksStart] = useState(toDateInput(new Date(data.settings.booksStartDate)));
  const [mapDraft, setMapDraft] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    for (const m of Object.keys(PAYMENT_METHOD_LABEL)) base[m] = data.settings.methodMap[m] ?? "";
    return base;
  });
  const [payrollDraft, setPayrollDraft] = useState(data.settings.payrollAccountId ?? "");
  const [lockMonth, setLockMonth] = useState("");
  const [lockNote, setLockNote] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editWallet, setEditWallet] = useState<AccountRow | null>(null);
  const [walletName, setWalletName] = useState("");
  const [walletKind, setWalletKind] = useState("bank");
  const [walletOpening, setWalletOpening] = useState("");

  const loanAccounts = data.allAccounts.filter((a) => a.type === "liability" && !a.isWallet);
  const months = monthOptions();

  return (
    <div className="p-4 sm:p-7 max-w-[1100px] mx-auto">
      <AccountingHeader
        title="Accounting settings"
        sub="Books start, payment-method mapping, wallets, period locks, and bridge exceptions."
        action={
          <Btn variant="ghost" busy={action.busy} onClick={() => action.run(() => syncNow(), { notice: "Books synced" })}>
            <RefreshCw size={13} /> Sync now
          </Btn>
        }
      />
      <div className="mb-4"><FormError error={action.error} /></div>
      {action.notice && <p className="mb-4 text-[12px] text-emerald-300">{action.notice}</p>}

      <div className="space-y-5">
        {/* Books start */}
        <SectionCard title="Books start date">
          <p className="text-[12px] text-mist mb-3 leading-relaxed">
            Events before this date are not posted (collections on pre-books invoices post against Opening Equity instead of revenue).
            Moving it earlier picks up more history on the next sync; moving it later only affects future events.
          </p>
          <div className="flex flex-wrap gap-2.5 items-end">
            <Field label="Books start">
              <input type="date" className="input-dark !w-44 tnum" value={booksStart} onChange={(e) => setBooksStart(e.target.value)} />
            </Field>
            <Btn busy={action.busy} onClick={() => action.run(() => updateBooksStartDate(booksStart), { notice: "Books start saved" })}>Save</Btn>
          </div>
        </SectionCard>

        {/* Method map */}
        <SectionCard title="Payment method → wallet">
          <p className="text-[12px] text-mist mb-3 leading-relaxed">
            Service payments and field expenses land in these wallets based on how they were paid. Unmapped methods fall into “Unmapped Clearing” and raise an exception.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {Object.keys(PAYMENT_METHOD_LABEL).map((method) => (
              <Field key={method} label={PAYMENT_METHOD_LABEL[method]}>
                <select
                  className="input-dark"
                  value={mapDraft[method] ?? ""}
                  onChange={(e) => setMapDraft({ ...mapDraft, [method]: e.target.value })}
                >
                  <option value="">— unmapped —</option>
                  {data.wallets.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5 items-end">
            <Field label="Payroll payouts wallet">
              <select className="input-dark !w-48" value={payrollDraft} onChange={(e) => setPayrollDraft(e.target.value)}>
                {data.wallets.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Btn
              busy={action.busy}
              onClick={() => action.run(async () => {
                const patch: Record<string, string> = {};
                for (const [k, v] of Object.entries(mapDraft)) if (v) patch[k] = v;
                const mapRes = await updateMethodMap(patch);
                if (!mapRes.ok) return mapRes;
                return payrollDraft ? updatePayrollAccount(payrollDraft) : mapRes;
              }, { notice: "Mapping saved" })}
            >
              Save mapping
            </Btn>
          </div>
        </SectionCard>

        {/* Wallets */}
        <SectionCard title="Wallets" action={<span className="text-[11px] text-mist/60">rename · kind · opening · active</span>}>
          <div className="divide-y divide-white/[0.05]">
            {data.wallets.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[13px] text-chrome">{w.name} {!w.active && <span className="text-[10.5px] text-mist/60">· inactive</span>}</p>
                  <p className="text-[10.5px] text-mist/70">{WALLET_KIND_LABEL[w.walletKind ?? "other"]} · balance {peso(w.balanceCents)} · opening {peso(w.openingBalanceCents)}</p>
                </div>
                <Btn variant="ghost" onClick={() => { setEditWallet(w); setWalletName(w.name); setWalletKind(w.walletKind ?? "bank"); setWalletOpening(String(w.openingBalanceCents / 100)); }}>
                  Edit
                </Btn>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Expense categories */}
        <SectionCard title="Expense categories">
          <div className="flex flex-wrap gap-2 mb-4">
            {data.expenseAccounts.map((c) => (
              <span key={c.id} className="card-dark px-3 py-1.5 text-[12px] text-chrome">{c.name}{!c.active ? " (inactive)" : ""}</span>
            ))}
          </div>
          <div className="flex gap-2.5 items-end">
            <Field label="New category">
              <input className="input-dark !w-56" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Insurance" />
            </Field>
            <Btn
              variant="ghost"
              busy={action.busy}
              disabled={!newCategory.trim()}
              onClick={async () => {
                const done = await action.run(() => createExpenseCategory(newCategory), { notice: "Category added" });
                if (done) setNewCategory("");
              }}
            >
              <Plus size={13} /> Add
            </Btn>
          </div>
        </SectionCard>

        {/* Period locks */}
        <SectionCard title="Period locks">
          <p className="text-[12px] text-mist mb-3 leading-relaxed">
            A locked month rejects any accounting write dated inside it — the bridge files an exception instead of posting. Unlocking is explicit and audited.
          </p>
          {data.locks.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {data.locks.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-2 card-dark px-3 py-1.5 text-[12px] text-amber-300 border-amber-400/20">
                  <Lock size={11} />
                  {new Date(Date.UTC(l.year, l.month - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                  <button onClick={() => action.run(() => unlockPeriod(l.id), { notice: "Period unlocked" })} className="text-mist hover:text-white transition" title="Unlock">
                    <LockOpen size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2.5 items-end">
            <Field label="Month">
              <select className="input-dark !w-48" value={lockMonth} onChange={(e) => setLockMonth(e.target.value)}>
                <option value="">Pick a month…</option>
                {months.map((m) => <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Note">
              <input className="input-dark !w-56" value={lockNote} onChange={(e) => setLockNote(e.target.value)} placeholder="optional" />
            </Field>
            <Btn
              variant="ghost"
              busy={action.busy}
              disabled={!lockMonth}
              onClick={() => {
                const [y, m] = lockMonth.split("-").map(Number);
                return action.run(() => lockPeriod(y!, m!, lockNote), { notice: "Period locked" });
              }}
            >
              <Lock size={13} /> Lock
            </Btn>
          </div>
        </SectionCard>

        {/* Exceptions */}
        <SectionCard title="Bridge exceptions" action={<ShieldAlert size={13} className="text-mist/60" />}>
          {data.exceptions.length === 0 ? (
            <p className="text-[12px] text-mist py-2">Nothing needs attention. The bridge posts Service invoices, payments, expenses, and payroll automatically.</p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data.exceptions.map((x) => (
                <div key={x.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {x.status === "open" ? <AlertTriangle size={13} className="text-amber-300 shrink-0" /> : <Check size={13} className="text-emerald-300 shrink-0" />}
                      <p className="text-[12.5px] text-chrome">{x.reason}</p>
                    </div>
                    <p className="text-[10.5px] text-mist/60 mt-1">
                      {x.sourceType ?? "manual"}<Day iso={x.createdAt.toISOString()} />{x.details ? ` · ${x.details}` : ""}
                    </p>
                  </div>
                  {x.status === "open" && (
                    <Btn variant="ghost" onClick={() => action.run(() => resolveException(x.id), { notice: "Exception resolved" })}>Resolve</Btn>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Loan accounts list (reference) */}
        {loanAccounts.length > 0 && (
          <SectionCard title="Loan accounts">
            <div className="divide-y divide-white/[0.05]">
              {loanAccounts.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-2.5">
                  <p className="text-[13px] text-chrome">{l.name}</p>
                  <span className="tnum text-[13px]"><Money cents={l.balanceCents} /></span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-mist/60 mt-3">Create loan accounts from Transactions → Loan received.</p>
          </SectionCard>
        )}
      </div>

      {/* Wallet edit modal */}
      <Modal open={!!editWallet} onClose={() => setEditWallet(null)} title={`Edit ${editWallet?.name ?? ""}`}>
        <div className="space-y-4">
          <Field label="Name">
            <input className="input-dark" value={walletName} onChange={(e) => setWalletName(e.target.value)} />
          </Field>
          <Field label="Kind">
            <select className="input-dark" value={walletKind} onChange={(e) => setWalletKind(e.target.value)}>
              {WALLET_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          {editWallet && !editWallet.hasLines ? (
            <Field label="Opening balance (₱) — editable until the wallet has entries">
              <input className="input-dark tnum" value={walletOpening} onChange={(e) => setWalletOpening(e.target.value)} inputMode="decimal" />
            </Field>
          ) : (
            <p className="text-[11.5px] text-mist">
              Opening balance is locked once a wallet has journal lines — adjust through a journal entry instead.
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <Btn
              variant="danger"
              onClick={() => action.run(() => updateWallet({ id: editWallet!.id, active: !editWallet!.active }), { notice: editWallet!.active ? "Wallet deactivated" : "Wallet reactivated" })}
            >
              {editWallet?.active ? "Deactivate" : "Reactivate"}
            </Btn>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setEditWallet(null)}>Cancel</Btn>
              <Btn
                busy={action.busy}
                onClick={() => action.run(async () => {
                  const renamed = await renameAccount(editWallet!.id, walletName);
                  if (!renamed.ok) return renamed;
                  return updateWallet({
                    id: editWallet!.id,
                    walletKind,
                    ...(editWallet && !editWallet.hasLines ? { openingBalance: Number(walletOpening) || 0 } : {}),
                  });
                }, { notice: "Wallet saved" }).then((r) => { if (r) setEditWallet(null); return r; })}
              >
                Save
              </Btn>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
