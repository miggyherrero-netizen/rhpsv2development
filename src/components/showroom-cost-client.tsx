"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Ban, Coins, HandCoins, Lock, Plus, ReceiptText, Tag } from "lucide-react";
import { peso, toDateInput } from "@/lib/format";
import { Modal, Field } from "@/components/ui";
import { Btn, Day, FormError, Money, SectionCard, StatCard, useAction } from "@/components/accounting-ui";
import { updatePianoCost } from "@/server/admin";
import {
  addPianoCost, cancelPianoSale, completePianoSale, payPianoCost, recordPianoPayment,
  reservePiano, voidPianoCost, voidPianoPayment,
} from "@/server/accounting-billing";
import type { getPianoCost } from "@/server/data";
import type { getPianoSale } from "@/server/accounting-data";

type Piano = NonNullable<Awaited<ReturnType<typeof getPianoCost>>>;
type SaleBundle = NonNullable<Awaited<ReturnType<typeof getPianoSale>>>;

const COST_KINDS = ["acquisition", "prep", "other"] as const;
const COST_KIND_LABEL: Record<string, string> = { acquisition: "Acquisition", prep: "Prep / restoration", other: "Other" };

export default function ShowroomCostClient({ piano, sale }: { piano: Piano; sale: SaleBundle }) {
  const action = useAction();

  // legacy single-figure cost (counts until an acquisition entry is logged)
  const [cost, setCost] = useState(piano.costCents != null ? (piano.costCents / 100).toString() : "");
  const [saved, setSaved] = useState(false);

  const [costModal, setCostModal] = useState(false);
  const [costKind, setCostKind] = useState<string>("prep");
  const [costDesc, setCostDesc] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costVendor, setCostVendor] = useState("");
  const [costWallet, setCostWallet] = useState("");
  const [payCostId, setPayCostId] = useState<string | null>(null);
  const [payCostWallet, setPayCostWallet] = useState(sale.wallets[0]?.id ?? "");

  const [reserveModal, setReserveModal] = useState(false);
  const [resPrice, setResPrice] = useState(piano.priceCents != null ? (piano.priceCents / 100).toString() : "");
  const [resBuyer, setResBuyer] = useState("");
  const [resContact, setResContact] = useState("");

  const [payModal, setPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payWallet, setPayWallet] = useState(sale.wallets[0]?.id ?? "");
  const [payDate, setPayDate] = useState(toDateInput(new Date()));
  const [payRef, setPayRef] = useState("");

  const [completeModal, setCompleteModal] = useState(false);
  const [finalPrice, setFinalPrice] = useState("");

  const [cancelModal, setCancelModal] = useState(false);
  const [refund, setRefund] = useState("0");
  const [cancelReason, setCancelReason] = useState("");

  const [voidTarget, setVoidTarget] = useState<{ type: "payment" | "cost"; id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const entries = sale.costEntries.filter((c) => !c.voidedAt);
  const hasAcquisitionEntry = entries.some((c) => c.kind === "acquisition");
  const legacyCents = hasAcquisitionEntry ? 0 : (piano.costCents ?? 0);
  const carrying = sale.carryingCents + legacyCents;
  const activeSale = sale.sale && sale.sale.status !== "cancelled" ? sale.sale : null;
  const completed = activeSale?.status === "completed";
  const held = activeSale
    ? sale.payments.filter((p) => !p.voidedAt && new Date(p.createdAt) >= new Date(activeSale.reservedAt ?? 0)).reduce((s, p) => s + p.amountCents, 0)
    : 0;
  const price = activeSale?.priceCents ?? 0;
  const vatPreview = completed || activeSale ? Math.round((price * (activeSale?.taxRateBps ?? 1200)) / (10000 + (activeSale?.taxRateBps ?? 1200))) : 0;
  const netPreview = price - vatPreview;

  async function saveLegacyCost() {
    const cents = cost.trim() === "" ? null : Math.round(Number(cost) * 100);
    await updatePianoCost(piano.id, cents);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1050px] mx-auto">
      <Link href="/admin/showroom" className="flex items-center gap-1.5 text-[12px] text-mist hover:text-white transition mb-5">
        <ArrowLeft size={14} /> Back to Showroom
      </Link>

      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-white tracking-tight flex items-center gap-2.5">
          Costs &amp; sale
          {activeSale && (
            <span className={`text-[10.5px] uppercase tracking-[0.14em] rounded-full px-2.5 py-1 border ${completed ? "text-emerald-300 border-emerald-400/25 bg-emerald-400/10" : "text-amber-300 border-amber-400/25 bg-amber-400/10"}`}>
              {completed ? <>Sold <Lock size={10} /></> : "Reserved"}
            </span>
          )}
        </h1>
        <p className="text-[13px] text-mist mt-1">{piano.brand} {piano.model} · private page, never shown on the public site</p>
      </div>
      <div className="mb-4"><FormError error={action.error} /></div>

      {/* Sale status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {activeSale ? (
          <>
            <StatCard label="Selling price (incl. VAT)" value={<Money cents={price} />} sub={`VAT ${peso(vatPreview)} · net ${peso(netPreview)}`} />
            <StatCard label={completed ? "Collected" : "Deposits held"} value={<Money cents={held} />} tone="sky" />
            <StatCard label="Balance" value={<Money cents={Math.max(0, price - held)} />} tone="amber" />
            <StatCard
              label={completed ? "Realized profit (frozen)" : "Projected profit"}
              value={<Money cents={netPreview - (completed ? (activeSale.costSnapshotCents ?? carrying) : carrying)} colored />}
              tone={(completed ? (activeSale.costSnapshotCents ?? carrying) : carrying) <= netPreview ? "emerald" : "rose"}
              sub={`carrying ${peso(completed ? (activeSale.costSnapshotCents ?? carrying) : carrying)}`}
            />
          </>
        ) : (
          <>
            <StatCard label="List price" value={piano.priceCents != null ? <Money cents={piano.priceCents} /> : <span className="text-mist">—</span>} />
            <StatCard label="Carrying cost" value={<Money cents={carrying} />} tone="violet" sub={legacyCents > 0 ? `legacy ${peso(legacyCents)}${sale.carryingCents ? ` + entries ${peso(sale.carryingCents)}` : ""}` : "from cost entries"} />
            <StatCard label="Projected margin" value={piano.priceCents != null ? <Money cents={piano.priceCents - Math.round((piano.priceCents * 1200) / 11200) - carrying} colored /> : <span className="text-mist">—</span>} sub="net of 12% VAT" />
            <div className="card-dark p-4 flex items-center">
              <Btn onClick={() => { setResPrice(piano.priceCents != null ? (piano.priceCents / 100).toString() : ""); setReserveModal(true); }}>
                <Tag size={13} /> Reserve for a buyer
              </Btn>
            </div>
          </>
        )}
      </div>

      <div className="space-y-5">
        {/* Legacy cost figure */}
        {!hasAcquisitionEntry && (
          <SectionCard title="Acquisition cost (single figure)" action={<Coins size={13} className="text-mist/60" />}>
            <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
              The original one-field cost. It still counts toward this piano&apos;s carrying cost until you log a tracked
              acquisition entry below — after that the entries take over.
            </p>
            <div className="flex flex-wrap gap-2.5 items-end">
              <Field label="Cost (₱)">
                <input className="input-dark !w-44 tnum" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={completed} />
              </Field>
              <Btn variant="ghost" disabled={completed} onClick={saveLegacyCost}>{saved ? "Saved" : "Save"}</Btn>
            </div>
          </SectionCard>
        )}

        {/* Cost entries */}
        <SectionCard
          title="Cost entries"
          action={<Btn variant="ghost" disabled={completed} onClick={() => setCostModal(true)}><Plus size={13} /> Add cost</Btn>}
        >
          <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
            Each entry builds the Pianos-on-Hand value. Unpaid entries sit in Accounts Payable until settled.
            {completed && " The snapshot is frozen at completion — later costs can no longer change this sale's margin."}
          </p>
          <div className="divide-y divide-white/[0.05]">
            {sale.costEntries.map((c) => (
              <div key={c.id} className={`flex items-center justify-between gap-3 py-2.5 ${c.voidedAt ? "opacity-40" : ""}`}>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-chrome truncate">
                    {c.description}
                    {c.voidedAt && <span className="text-[10.5px] text-rose-300/80"> · voided</span>}
                  </p>
                  <p className="text-[10.5px] text-mist/70">
                    {COST_KIND_LABEL[c.kind] ?? c.kind}<Day iso={new Date(c.spentAt).toISOString()} />
                    {c.vendor ? ` · ${c.vendor}` : ""} · {c.voidedAt ? "—" : c.paidAccountId ? "paid" : "unpaid (AP)"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tnum text-[13px] text-rose-300"><Money cents={c.amountCents} /></span>
                  {!c.voidedAt && !c.paidAccountId && (
                    <button onClick={() => { setPayCostId(c.id); setPayCostWallet(sale.wallets[0]?.id ?? ""); }} className="text-[11.5px] text-sky-300 hover:text-white transition">Pay</button>
                  )}
                  {!c.voidedAt && (
                    <button onClick={() => { setVoidTarget({ type: "cost", id: c.id, label: `${c.description} (${peso(c.amountCents)})` }); setVoidReason(""); }} className="text-mist hover:text-rose-300 transition" title="Void">
                      <Ban size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sale.costEntries.length === 0 && <p className="text-[12px] text-mist py-2">No cost entries yet.</p>}
          </div>
          {sale.costEntries.length > 0 && (
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/[0.08] text-[13px]">
              <span className="text-white">Carrying cost{legacyCents > 0 ? " (incl. legacy figure)" : ""}</span>
              <span className="tnum text-white">{peso(carrying)}</span>
            </div>
          )}
        </SectionCard>

        {/* Sale flow */}
        {activeSale ? (
          <SectionCard
            title={completed ? "Sale — payment history" : "Sale in progress"}
            action={
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setPayModal(true)}><HandCoins size={13} /> Record payment</Btn>
                {!completed && (
                  <>
                    <Btn onClick={() => { setFinalPrice((price / 100).toString()); setCompleteModal(true); }}>Complete sale</Btn>
                    <Btn variant="danger" onClick={() => { setRefund(String(held / 100)); setCancelReason(""); setCancelModal(true); }}>Cancel</Btn>
                  </>
                )}
              </div>
            }
          >
            <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
              {completed
                ? "Buyer: " + (activeSale.buyerName ?? "—") + " · sold " + (activeSale.soldAt ? new Date(activeSale.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : "—") + ". Payments now reduce the receivable."
                : "Buyer: " + (activeSale.buyerName ?? "—") + ". Payments are deposits held until the sale completes."}
            </p>
            <div className="divide-y divide-white/[0.05]">
              {sale.payments.filter((p) => activeSale && new Date(p.createdAt) >= new Date(activeSale.reservedAt ?? 0)).map((p) => (
                <div key={p.id} className={`flex items-center justify-between gap-3 py-2.5 ${p.voidedAt ? "opacity-40" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-chrome">
                      {p.method}
                      {p.voidedAt && <span className="text-[10.5px] text-rose-300/80"> · voided</span>}
                    </p>
                    <p className="text-[10.5px] text-mist/70"><Day iso={new Date(p.receivedAt).toISOString()} />{p.reference ? ` · ${p.reference}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tnum text-[13px] text-emerald-300"><Money cents={p.amountCents} /></span>
                    {!p.voidedAt && (
                      <button onClick={() => { setVoidTarget({ type: "payment", id: p.id, label: `payment of ${peso(p.amountCents)}` }); setVoidReason(""); }} className="text-mist hover:text-rose-300 transition" title="Void">
                        <Ban size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {sale.payments.length === 0 && <p className="text-[12px] text-mist py-2">No payments yet.</p>}
            </div>
            {!completed && sale.sale?.status === "cancelled" && <p className="text-[12px] text-mist pt-2">This piano&apos;s previous sale was cancelled — its history stays above for reference.</p>}
          </SectionCard>
        ) : (
          sale.sale && (
            <SectionCard title="Previous sale (cancelled)">
              <p className="text-[12px] text-mist">
                Cancelled {sale.sale.updatedAt ? new Date(sale.sale.updatedAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila" }) : ""} — payment history is kept.
                Reserve the piano again to start a new sale on the same record.
              </p>
            </SectionCard>
          )
        )}
      </div>

      {/* Add cost modal */}
      <Modal open={costModal} onClose={() => setCostModal(false)} title="Add cost entry">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select className="input-dark" value={costKind} onChange={(e) => setCostKind(e.target.value)}>
                {COST_KINDS.map((k) => <option key={k} value={k}>{COST_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Description">
            <input className="input-dark" value={costDesc} onChange={(e) => setCostDesc(e.target.value)} placeholder="e.g. Bought from estate sale" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor (optional)">
              <input className="input-dark" value={costVendor} onChange={(e) => setCostVendor(e.target.value)} />
            </Field>
            <Field label="Paid how?">
              <select className="input-dark" value={costWallet} onChange={(e) => setCostWallet(e.target.value)}>
                <option value="">Not paid yet (Accounts Payable)</option>
                {sale.wallets.map((w) => <option key={w.id} value={w.id}>Paid from {w.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setCostModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => addPianoCost({
                  pianoId: piano.id, kind: costKind, description: costDesc, amount: Number(costAmount),
                  vendor: costVendor || null, walletId: costWallet || null,
                }), { notice: "Cost recorded" });
                if (done) { setCostModal(false); setCostDesc(""); setCostAmount(""); setCostVendor(""); }
              }}
            >
              Add cost
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Settle cost */}
      <Modal open={!!payCostId} onClose={() => setPayCostId(null)} title="Settle cost">
        <div className="space-y-4">
          <Field label="Pay from">
            <select className="input-dark" value={payCostWallet} onChange={(e) => setPayCostWallet(e.target.value)}>
              {sale.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPayCostId(null)}>Cancel</Btn>
            <Btn busy={action.busy} onClick={async () => { const done = await action.run(() => payPianoCost(payCostId!, payCostWallet), { notice: "Cost settled" }); if (done) setPayCostId(null); }}>
              Pay now
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Reserve */}
      <Modal open={reserveModal} onClose={() => setReserveModal(false)} title="Reserve for a buyer">
        <div className="space-y-4">
          <Field label="Agreed price (₱, VAT-inclusive)">
            <input className="input-dark tnum" value={resPrice} onChange={(e) => setResPrice(e.target.value)} inputMode="decimal" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buyer name">
              <input className="input-dark" value={resBuyer} onChange={(e) => setResBuyer(e.target.value)} />
            </Field>
            <Field label="Contact (optional)">
              <input className="input-dark" value={resContact} onChange={(e) => setResContact(e.target.value)} />
            </Field>
          </div>
          <p className="text-[11.5px] text-mist leading-relaxed">
            Reserving marks the piano as reserved. No money moves until you record the first payment.
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setReserveModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => reservePiano({ pianoId: piano.id, price: Number(resPrice), buyerName: resBuyer || null, buyerContact: resContact || null }), { notice: "Piano reserved" });
                if (done) setReserveModal(false);
              }}
            >
              Reserve
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Record payment */}
      <Modal open={payModal} onClose={() => setPayModal(false)} title="Record payment">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)">
              <input className="input-dark tnum" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Into wallet">
              <select className="input-dark" value={payWallet} onChange={(e) => setPayWallet(e.target.value)}>
                {sale.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Received">
              <input type="date" className="input-dark tnum" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </Field>
            <Field label="Reference (optional)">
              <input className="input-dark" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPayModal(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => recordPianoPayment({ saleId: activeSale!.id, amount: Number(payAmount), walletId: payWallet, receivedAt: payDate, reference: payRef || null }), { notice: "Payment recorded" });
                if (done) { setPayModal(false); setPayAmount(""); setPayRef(""); }
              }}
            >
              Record payment
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Complete sale */}
      <Modal open={completeModal} onClose={() => setCompleteModal(false)} title="Complete the sale" wide>
        <div className="space-y-4">
          <p className="text-[12.5px] text-mist leading-relaxed">
            Completing recognizes revenue (VAT extracted from the inclusive price), moves deposits and the unpaid balance
            to a receivable, books cost of sales, and <span className="text-chrome">freezes the price and carrying-cost
            snapshot</span> so later edits can never distort this sale&apos;s realized margin. The piano is marked sold.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Final price (₱, VAT-inclusive)">
              <input className="input-dark tnum" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} inputMode="decimal" />
            </Field>
            <div className="card-dark p-3.5 space-y-1">
              <p className="text-[10.5px] text-mist">At this price</p>
              <p className="tnum text-[13px] text-chrome">carrying {peso(carrying)}</p>
              <p className="tnum text-[13px] text-emerald-300">
                profit {peso(Math.round(Number(finalPrice) * 100) - Math.round((Number(finalPrice) * 100 * (activeSale?.taxRateBps ?? 1200)) / (10000 + (activeSale?.taxRateBps ?? 1200))) - carrying)}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setCompleteModal(false)}>Not yet</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => completePianoSale({ saleId: activeSale!.id, finalPrice: Number(finalPrice) }), { notice: "Sale completed" });
                if (done) setCompleteModal(false);
              }}
            >
              Complete sale
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Cancel sale */}
      <Modal open={cancelModal} onClose={() => setCancelModal(false)} title="Cancel the sale">
        <div className="space-y-4">
          <p className="text-[12.5px] text-mist leading-relaxed">
            The piano returns to available. Refund what the buyer gets back — anything not refunded of the {peso(held)}
            {" "}held is released from deposits as income.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Refund (0 – ${peso(held)})`}>
              <input className="input-dark tnum" value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Reason">
              <input className="input-dark" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Buyer backed out" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setCancelModal(false)}>Keep sale</Btn>
            <Btn
              variant="danger"
              busy={action.busy}
              disabled={Number(refund) < 0 || Number(refund) * 100 > held}
              onClick={async () => {
                const done = await action.run(() => cancelPianoSale({ saleId: activeSale!.id, refund: Number(refund), reason: cancelReason || null, walletId: payWallet }), { notice: "Sale cancelled" });
                if (done) setCancelModal(false);
              }}
            >
              Cancel sale
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
            <input className="input-dark" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
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
                  ? await action.run(() => voidPianoPayment(voidTarget.id, voidReason), { notice: "Payment voided" })
                  : await action.run(() => voidPianoCost(voidTarget.id, voidReason), { notice: "Cost voided" });
                if (done) setVoidTarget(null);
              }}
            >
              Void it
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
