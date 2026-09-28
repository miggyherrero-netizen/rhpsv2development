"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Wallet, Landmark } from "lucide-react";
import type { AccountRow } from "@/server/accounting-data";
import { createWallet } from "@/server/accounting";
import { Modal, Field } from "@/components/ui";
import { AccountingHeader, Btn, Chip, FormError, Money, SectionCard, useAction } from "@/components/accounting-ui";
import { ACCOUNT_TYPE_LABEL, WALLET_KINDS, WALLET_KIND_LABEL } from "@/lib/accounting";
import { toDateInput } from "@/lib/format";

const TYPE_TONE: Record<string, string> = {
  asset: "sky", liability: "amber", equity: "violet", revenue: "emerald", expense: "rose",
};

export default function AccountingAccounts({ accounts }: { accounts: AccountRow[] }) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [opening, setOpening] = useState("");
  const [asOf, setAsOf] = useState(toDateInput(new Date()));

  const wallets = accounts.filter((a) => a.isWallet);
  const books = accounts.filter((a) => !a.isWallet);
  const byType = (type: string) => books.filter((a) => a.type === type);

  async function submit() {
    const done = await action.run(() => createWallet({ name, walletKind: kind, openingBalance: Number(opening) || 0, openingAsOf: asOf }), { notice: "Wallet created" });
    if (done) {
      setOpen(false);
      setName("");
      setOpening("");
    }
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1100px] mx-auto">
      <AccountingHeader
        title="Accounts"
        sub="Wallets hold real money; book accounts hold claims and obligations. Balances always derive from the journal."
        action={
          <Btn onClick={() => setOpen(true)}><Plus size={14} /> Add wallet</Btn>
        }
      />
      <div className="mb-4"><FormError error={action.error} /></div>

      <SectionCard title="Wallets" className="mb-5">
        <div className="divide-y divide-white/[0.05]">
          {wallets.map((w) => (
            <Link key={w.id} href={`/admin/accounting/accounts/${w.id}`} className="flex items-center justify-between gap-3 py-3 px-1 hover:bg-white/[0.03] rounded-lg transition">
              <div className="flex items-center gap-3 min-w-0">
                <span className="card-dark p-2 rounded-lg"><Wallet size={15} className="text-mist" /></span>
                <div>
                  <p className="text-[13px] text-chrome">{w.name} {!w.active && <span className="text-[10.5px] text-mist/60">· inactive</span>}</p>
                  <p className="text-[10.5px] text-mist/70">
                    {WALLET_KIND_LABEL[w.walletKind ?? "other"] ?? w.walletKind}
                    {w.openingBalanceCents !== 0 ? ` · opening ${(w.openingBalanceCents / 100).toFixed(2)}` : ""}
                  </p>
                </div>
              </div>
              <span className="tnum text-[14px] text-white">{w.balanceCents >= 0 ? "" : "−"}<Money cents={Math.abs(w.balanceCents)} /></span>
            </Link>
          ))}
        </div>
      </SectionCard>

      {(["asset", "liability", "equity", "revenue", "expense"] as const).map((type) => (
        <SectionCard key={type} title={`${ACCOUNT_TYPE_LABEL[type]} accounts`} className="mb-5">
          <div className="divide-y divide-white/[0.05]">
            {byType(type).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 px-1">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="card-dark p-2 rounded-lg"><Landmark size={14} className="text-mist" /></span>
                  <div>
                    <p className="text-[13px] text-chrome">{a.name}</p>
                    {a.systemKey && <p className="text-[10px] text-mist/50 uppercase tracking-[0.14em]">built-in</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {a.systemKey && <Chip tone={TYPE_TONE[a.type]}>{ACCOUNT_TYPE_LABEL[a.type]}</Chip>}
                  <span className="tnum text-[13.5px] text-chrome">{a.balanceCents >= 0 ? "" : "−"}<Money cents={Math.abs(a.balanceCents)} /></span>
                </div>
              </div>
            ))}
            {byType(type).length === 0 && <p className="text-[12px] text-mist py-2">None.</p>}
          </div>
        </SectionCard>
      ))}

      <Modal open={open} onClose={() => setOpen(false)} title="Add wallet">
        <div className="space-y-4">
          <Field label="Name">
            <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BPI, ShopeePay, Cash drawer" />
          </Field>
          <Field label="Kind">
            <select className="input-dark" value={kind} onChange={(e) => setKind(e.target.value)}>
              {WALLET_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance (₱)">
              <input className="input-dark tnum" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" inputMode="decimal" />
            </Field>
            <Field label="Opening as of">
              <input type="date" className="input-dark tnum" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
          </div>
          <p className="text-[11.5px] text-mist leading-relaxed">
            The opening balance is your baseline before any journal entries. The business already runs, so enter what the account held when the books started.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn busy={action.busy} disabled={!name.trim()} onClick={submit}>Create wallet</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
