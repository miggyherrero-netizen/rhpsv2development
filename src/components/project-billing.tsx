"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCircle2, Hammer, Lock, Plus, ReceiptText, Trash2, Wallet } from "lucide-react";
import type { ProjectBillingBundle } from "@/server/accounting-data";
import {
  addProjectCost, addProjectItem, deleteProjectItem, finalizeProjectBilling, payProjectCost,
  recordProjectPayment, setProjectTaxRate, updateProjectItem, voidProjectCost, voidProjectPayment,
} from "@/server/accounting-billing";
import { Modal, Field } from "@/components/ui";
import { Btn, Day, FormError, Money, SectionCard, StatCard, useAction } from "@/components/accounting-ui";
import { peso, toDateInput } from "@/lib/format";

const ITEM_KINDS = ["service", "part", "fee", "discount"] as const;
const ITEM_KIND_LABEL: Record<string, string> = { service: "Service", part: "Part", fee: "Fee", discount: "Discount" };
const COST_CATEGORIES = ["materials", "parts", "subcontractor", "tools", "other"] as const;
const COST_LABEL: Record<string, string> = {
  materials: "Materials", parts: "Parts", subcontractor: "Subcontractor", tools: "Tools", other: "Other",
};
const PAY_KINDS = ["deposit", "progress", "final"] as const;
const PAY_KIND_LABEL: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final" };

export default function ProjectBilling({ data }: { data: ProjectBillingBundle }) {
  const action = useAction();
  const finalized = !!data.billingFinalizedAt;

  const [itemModal, setItemModal] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [itemKind, setItemKind] = useState<string>("service");
  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemPrice, setItemPrice] = useState("");

  const [payModal, setPayModal] = useState(false);
  const [payKind, setPayKind] = useState<string>("deposit");
  const [payAmount, setPayAmount] = useState("");
  const [payWallet, setPayWallet] = useState(data.wallets[0]?.id ?? "");
  const [payDate, setPayDate] = useState(toDateInput(new Date()));
  const [payRef, setPayRef] = useState("");

  const [costModal, setCostModal] = useState(false);
  const [costCategory, setCostCategory] = useState<string>("materials");
  const [costDesc, setCostDesc] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costVendor, setCostVendor] = useState("");
  const [costWallet, setCostWallet] = useState(""); // "" = unpaid
  const [payCostId, setPayCostId] = useState<string | null>(null);
  const [payCostWallet, setPayCostWallet] = useState(data.wallets[0]?.id ?? "");

  const [finalModal, setFinalModal] = useState(false);
  const [finalAmount, setFinalAmount] = useState(String(data.quotedCents / 100));

  const [voidTarget, setVoidTarget] = useState<{ type: "payment" | "cost"; id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const costsTotal = data.costs.filter((c) => !c.voidedAt).reduce((s, c) => s + c.amountCents, 0);
  const revenue = finalized ? (data.billedCents ?? data.quotedCents) : 0;
  const profit = revenue - data.laborTotalCents - costsTotal;

  function openItem(edit?: (typeof data.items)[number]) {
    setEditItemId(edit?.id ?? null);
    setItemKind(edit?.kind ?? "service");
    setItemDesc(edit?.description ?? "");
    setItemQty(String(edit?.qty ?? 1));
    setItemPrice(edit ? String(edit.unitPriceCents / 100) : "");
    setItemModal(true);
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-2 text-[12px] text-mist mb-4">
        <Link href="/admin/projects" className="inline-flex items-center gap-1.5 hover:text-white transition">
          <ArrowLeft size={13} /> Projects board
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight flex items-center gap-2.5">
            Billing &amp; costs
            {finalized && <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.14em] text-emerald-300 border border-emerald-400/25 bg-emerald-400/10 rounded-full px-2.5 py-1">Finalized <Lock size={10} /></span>}
          </h1>
          <p className="text-[13px] text-mist mt-1">
            {data.pianoLabel} — {data.clientName}
          </p>
        </div>
        <Btn variant="ghost" onClick={() => { setFinalAmount(String((data.billedCents ?? data.quotedCents) / 100)); setFinalModal(true); }} disabled={finalized}>
          <CheckCircle2 size={13} /> Finalize billing
        </Btn>
      </div>
      <div className="mb-4"><FormError error={action.error} /></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Contract (incl. VAT)" value={<Money cents={data.contractCents} />} sub={finalized ? `billed ${peso(data.billedCents ?? 0)} + ${data.taxRateBps / 100}% VAT` : `quote ${peso(data.quotedCents)} + VAT`} />
        <StatCard label="Collected" value={<Money cents={data.paidCents} />} tone="sky" sub={finalized ? "payments reduce receivable" : "held as deposits until finalized"} />
        <StatCard label="Balance due" value={<Money cents={data.balanceCents} />} tone={data.balanceCents > 0 ? "amber" : "emerald"} />
        <StatCard
          label={finalized ? "Profit (after labor + costs)" : "Costs so far"}
          value={finalized ? <Money cents={profit} colored /> : <Money cents={data.laborTotalCents + costsTotal} />}
          tone={finalized ? (profit >= 0 ? "emerald" : "rose") : "violet"}
          sub={finalized ? `margin ${revenue > 0 ? Math.round((profit / revenue) * 100) : 0}%` : `labor ${peso(data.laborTotalCents)} · costs ${peso(costsTotal)}`}
        />
      </div>

      {!finalized && (
        <div className="mb-6">
          <SectionCard title="Quote" action={<Btn variant="ghost" onClick={() => openItem()}><Plus size={13} /> Add line</Btn>}>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-mist/70">
                    {["Kind", "Description", "Qty", "Unit", "Total", ""].map((h) => (
                      <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {data.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-4 text-[12px] text-mist">{ITEM_KIND_LABEL[i.kind] ?? i.kind}</td>
                      <td className="py-2 pr-4 text-[12.5px] text-chrome max-w-[280px] truncate">{i.description}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-chrome">{i.kind === "discount" ? `−${i.qty}` : i.qty}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-mist">{peso(i.unitPriceCents)}</td>
                      <td className="py-2 pr-4 tnum text-[12.5px] text-chrome"><Money cents={i.kind === "discount" ? -i.totalCents : i.totalCents} /></td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button onClick={() => openItem(i)} className="text-[11.5px] text-mist hover:text-white transition mr-3">Edit</button>
                        <button
                          onClick={() => action.run(() => deleteProjectItem(i.id), { notice: "Line removed" })}
                          className="text-mist hover:text-rose-300 transition"
                          title="Remove line"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-[12px] text-mist">No quote lines yet — add the work and parts you agreed on.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-mist">VAT</span>
                <select
                  className="input-dark !w-32"
                  value={data.taxRateBps}
                  disabled={finalized}
                  onChange={(e) => action.run(() => setProjectTaxRate(data.projectId, Number(e.target.value)), { notice: "Tax rate saved" })}
                >
                  <option value={0}>Non-VAT</option>
                  <option value={1200}>12%</option>
                </select>
              </div>
              <p className="text-[13px] text-chrome">
                Quote <span className="tnum">{peso(data.quotedCents)}</span>
                <span className="text-mist"> · with VAT </span>
                <span className="tnum text-white">{peso(data.contractCents)}</span>
              </p>
            </div>
          </SectionCard>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <SectionCard
          title="Payments"
          action={<Btn variant="ghost" onClick={() => setPayModal(true)}><Wallet size={13} /> Record payment</Btn>}
        >
          <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
            {finalized
              ? "Payments now reduce the receivable."
              : "Payments are held as customer deposits until billing is finalized — they are not revenue yet."}
          </p>
          <div className="divide-y divide-white/[0.05]">
            {data.payments.map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-3 py-2.5 ${p.voidedAt ? "opacity-40" : ""}`}>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-chrome">
                    {PAY_KIND_LABEL[p.kind] ?? p.kind} · {p.method}
                    {p.voidedAt && <span className="text-[10.5px] text-rose-300/80"> · voided</span>}
                  </p>
                  <p className="text-[10.5px] text-mist/70"><Day iso={p.receivedAt} />{p.reference ? ` · ${p.reference}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tnum text-[13px] text-emerald-300"><Money cents={p.amountCents} /></span>
                  {!p.voidedAt && (
                    <button
                      onClick={() => { setVoidTarget({ type: "payment", id: p.id, label: `${PAY_KIND_LABEL[p.kind] ?? p.kind} payment of ${peso(p.amountCents)}` }); setVoidReason(""); }}
                      className="text-mist hover:text-rose-300 transition"
                      title="Void payment"
                    >
                      <Ban size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {data.payments.length === 0 && <p className="text-[12px] text-mist py-2">No payments recorded yet.</p>}
          </div>
        </SectionCard>

        <SectionCard
          title="Costs"
          action={<Btn variant="ghost" onClick={() => setCostModal(true)}><ReceiptText size={13} /> Add cost</Btn>}
        >
          <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
            Unpaid costs sit in Accounts Payable until you settle them. Labor below is derived from workshop clock-ins — never entered here.
          </p>
          <div className="divide-y divide-white/[0.05]">
            {data.costs.map((c) => (
              <div key={c.id} className={`flex items-center justify-between gap-3 py-2.5 ${c.voidedAt ? "opacity-40" : ""}`}>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-chrome truncate">
                    {c.description}
                    {c.voidedAt && <span className="text-[10.5px] text-rose-300/80"> · voided</span>}
                  </p>
                  <p className="text-[10.5px] text-mist/70">
                    {COST_LABEL[c.category] ?? c.category}<Day iso={c.spentAt} />
                    {c.vendor ? ` · ${c.vendor}` : ""} · {c.voidedAt ? "—" : c.paid ? "paid" : "unpaid (AP)"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tnum text-[13px] text-rose-300"><Money cents={c.amountCents} /></span>
                  {!c.voidedAt && !c.paid && (
                    <button
                      onClick={() => { setPayCostId(c.id); setPayCostWallet(data.wallets[0]?.id ?? ""); }}
                      className="text-[11.5px] text-sky-300 hover:text-white transition"
                      title="Settle from a wallet"
                    >
                      Pay
                    </button>
                  )}
                  {!c.voidedAt && (
                    <button
                      onClick={() => { setVoidTarget({ type: "cost", id: c.id, label: `${c.description} (${peso(c.amountCents)})` }); setVoidReason(""); }}
                      className="text-mist hover:text-rose-300 transition"
                      title="Void cost"
                    >
                      <Ban size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {data.costs.length === 0 && <p className="text-[12px] text-mist py-2">No project costs recorded yet.</p>}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Labor (derived from workshop time)" action={<Hammer size={13} className="text-mist/60" />}>
        {data.laborByWorker.length === 0 ? (
          <p className="text-[12px] text-mist py-2">No clocked workshop time on this project&apos;s tasks yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {data.laborByWorker.map((w) => (
              <div key={w.worker} className="flex items-center justify-between py-2 text-[12.5px]">
                <span className="text-chrome">{w.worker}</span>
                <span className="tnum text-mist">{peso(w.cents)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3 text-[13px] border-t border-white/[0.08] mt-1">
              <span className="text-white">Total labor</span>
              <span className="tnum text-white">{peso(data.laborTotalCents)}</span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Add/edit quote line */}
      <Modal open={itemModal} onClose={() => setItemModal(false)} title={editItemId ? "Edit quote line" : "Add quote line"}>
        <div className="space-y-4">
          <Field label="Kind">
            <select className="input-dark" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
              {ITEM_KINDS.map((k) => <option key={k} value={k}>{ITEM_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <input className="input-dark" value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder="e.g. Full regulation" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Qty">
              <input className="input-dark tnum" value={itemQty} onChange={(e) => setItemQty(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={itemKind === "discount" ? "Unit (₱, positive)" : "Unit price (₱)"}>
              <input className="input-dark tnum" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setItemModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = editItemId
                  ? await action.run(() => updateProjectItem(editItemId, { kind: itemKind, description: itemDesc, qty: Number(itemQty), unitPrice: Number(itemPrice) }), { notice: "Line saved" })
                  : await action.run(() => addProjectItem({ projectId: data.projectId, kind: itemKind, description: itemDesc, qty: Number(itemQty), unitPrice: Number(itemPrice) }), { notice: "Line added" });
                if (done) setItemModal(false);
              }}
            >
              {editItemId ? "Save line" : "Add line"}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Record payment */}
      <Modal open={payModal} onClose={() => setPayModal(false)} title="Record payment">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select className="input-dark" value={payKind} onChange={(e) => setPayKind(e.target.value)}>
                {PAY_KINDS.map((k) => <option key={k} value={k}>{PAY_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Into wallet">
              <select className="input-dark" value={payWallet} onChange={(e) => setPayWallet(e.target.value)}>
                {data.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Received">
              <input type="date" className="input-dark tnum" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reference (optional)">
            <input className="input-dark" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="cheque no., transfer ref…" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setPayModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => recordProjectPayment({
                  projectId: data.projectId, amount: Number(payAmount), kind: payKind,
                  walletId: payWallet, receivedAt: payDate, reference: payRef || null,
                }), { notice: "Payment recorded" });
                if (done) { setPayModal(false); setPayAmount(""); setPayRef(""); }
              }}
            >
              Record payment
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Add cost */}
      <Modal open={costModal} onClose={() => setCostModal(false)} title="Add project cost">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className="input-dark" value={costCategory} onChange={(e) => setCostCategory(e.target.value)}>
                {COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Description">
            <input className="input-dark" value={costDesc} onChange={(e) => setCostDesc(e.target.value)} placeholder="e.g. Renner hammers set" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor (optional)">
              <input className="input-dark" value={costVendor} onChange={(e) => setCostVendor(e.target.value)} />
            </Field>
            <Field label="Paid how?">
              <select className="input-dark" value={costWallet} onChange={(e) => setCostWallet(e.target.value)}>
                <option value="">Not paid yet (Accounts Payable)</option>
                {data.wallets.map((w) => <option key={w.id} value={w.id}>Paid from {w.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setCostModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => addProjectCost({
                  projectId: data.projectId, category: costCategory, description: costDesc,
                  amount: Number(costAmount), vendor: costVendor || null, walletId: costWallet || null,
                }), { notice: "Cost recorded" });
                if (done) { setCostModal(false); setCostDesc(""); setCostAmount(""); setCostVendor(""); }
              }}
            >
              Add cost
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Settle unpaid cost */}
      <Modal open={!!payCostId} onClose={() => setPayCostId(null)} title="Settle cost">
        <div className="space-y-4">
          <p className="text-[12.5px] text-mist leading-relaxed">Pay this cost now — it moves from Accounts Payable to the wallet you pick.</p>
          <Field label="Pay from">
            <select className="input-dark" value={payCostWallet} onChange={(e) => setPayCostWallet(e.target.value)}>
              {data.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPayCostId(null)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => payProjectCost(payCostId!, payCostWallet), { notice: "Cost settled" });
                if (done) setPayCostId(null);
              }}
            >
              Pay now
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Void payment / cost */}
      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="Void entry">
        <div className="space-y-4">
          <p className="text-[12.5px] text-mist leading-relaxed">
            Void <span className="text-chrome">{voidTarget?.label}</span>? The journal entry is reversed — nothing is deleted.
          </p>
          <Field label="Reason">
            <input className="input-dark" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="why is this being voided?" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setVoidTarget(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              busy={action.busy}
              disabled={!voidReason.trim()}
              onClick={async () => {
                if (!voidTarget) return;
                const done = voidTarget.type === "payment"
                  ? await action.run(() => voidProjectPayment(voidTarget.id, voidReason), { notice: "Payment voided" })
                  : await action.run(() => voidProjectCost(voidTarget.id, voidReason), { notice: "Cost voided" });
                if (done) setVoidTarget(null);
              }}
            >
              Void it
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Finalize billing */}
      <Modal open={finalModal} onClose={() => setFinalModal(false)} title="Finalize billing" wide>
        <div className="space-y-4">
          <p className="text-[12.5px] text-mist leading-relaxed">
            Finalizing recognizes revenue: deposits move out of Customer Deposits Held, the unpaid balance becomes a
            receivable, and VAT becomes payable. Quote lines lock afterwards — further charges belong in a new billed item.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Final amount before VAT (₱)">
              <input className="input-dark tnum" value={finalAmount} onChange={(e) => setFinalAmount(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="VAT rate">
              <select className="input-dark" value={data.taxRateBps} disabled>
                <option value={0}>Non-VAT</option>
                <option value={1200}>12%</option>
              </select>
            </Field>
          </div>
          <p className="text-[12px] text-chrome tnum">
            Total contract: {peso(Math.round(Number(finalAmount) * 100) + Math.round((Number(finalAmount) * 100 * data.taxRateBps) / 10000))}
            {" "}· collected so far: {peso(data.paidCents)}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setFinalModal(false)}>Not yet</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => finalizeProjectBilling({ projectId: data.projectId, finalAmount: Number(finalAmount) }), { notice: "Billing finalized" });
                if (done) setFinalModal(false);
              }}
            >
              Finalize billing
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
