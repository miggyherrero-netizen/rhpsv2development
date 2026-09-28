"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, CircleCheck, RefreshCw } from "lucide-react";
import type { AccountDetailBundle } from "@/server/accounting-data";
import { cancelReconciliation, completeReconciliation, setLineCleared, startReconciliation } from "@/server/accounting";
import { Modal, Field } from "@/components/ui";
import { AccountingHeader, Btn, Day, FormError, KindChip, Money, SectionCard, StatCard, useAction } from "@/components/accounting-ui";
import { KIND_LABEL } from "@/lib/accounting";
import { fmtDate, peso, toDateInput } from "@/lib/format";

export default function AccountingAccountDetail({ data }: { data: AccountDetailBundle }) {
  const action = useAction();
  const [startOpen, setStartOpen] = useState(false);
  const [stmtDate, setStmtDate] = useState(toDateInput(new Date()));
  const [stmtEnding, setStmtEnding] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [note, setNote] = useState("");

  const { account, recon } = data;
  const isWallet = account.isWallet;
  const completed = data.reconciliations.filter((r) => r.status === "completed");

  return (
    <div className="p-4 sm:p-7 max-w-[1100px] mx-auto">
      <Link href="/admin/accounting/accounts" className="inline-flex items-center gap-1.5 text-[12px] text-mist hover:text-white transition mb-3">
        <ArrowLeft size={13} /> All accounts
      </Link>
      <AccountingHeader
        title={account.name}
        sub={`${account.isWallet ? "Wallet" : "Book account"} · balance derived from opening + journal lines`}
        action={
          isWallet && !recon ? (
            <Btn onClick={() => setStartOpen(true)}><RefreshCw size={13} /> Reconcile</Btn>
          ) : undefined
        }
      />
      <div className="mb-4"><FormError error={action.error} /></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Balance" value={<Money cents={data.balanceCents} />} />
        <StatCard label="Opening balance" value={<Money cents={account.openingBalanceCents} />} sub={account.openingAsOf ? `as of ${fmtDate(new Date(account.openingAsOf))}` : undefined} />
        <StatCard label="Reconciliations" value={String(completed.length)} sub={recon ? "one in progress" : undefined} tone={recon ? "amber" : undefined} />
        <StatCard label="Entries" value={String(data.lines.length)} sub="most recent 300 shown" />
      </div>

      {/* Open reconciliation */}
      {recon && (
        <SectionCard
          title={`Reconciliation — statement ending ${fmtDate(new Date(recon.statementDate))}`}
          className="mb-5"
          action={
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => action.run(() => cancelReconciliation(data.openRecon!.id), { notice: "Reconciliation cancelled" })} busy={action.busy}>Cancel</Btn>
              <Btn
                busy={action.busy}
                onClick={() => setCompleteOpen(true)}
                variant={recon.reconciled ? "primary" : "danger"}
              >
                <CircleCheck size={14} /> {recon.reconciled ? "Complete" : "Close with difference…"}
              </Btn>
            </div>
          }
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Statement ending</p>
              <p className="tnum text-[15px] text-white">{peso(recon.statementEndingCents)}</p>
            </div>
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Cleared balance</p>
              <p className="tnum text-[15px] text-white">{peso(recon.clearedBalanceCents)}</p>
            </div>
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Difference</p>
              <p className={`tnum text-[15px] ${recon.differenceCents === 0 ? "text-emerald-300" : "text-amber-300"}`}>{peso(recon.differenceCents)}</p>
            </div>
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Not yet in statement</p>
              <p className="tnum text-[15px] text-chrome">+{peso(recon.unclearedInCents)}</p>
            </div>
            <div className="card-dark p-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-mist mb-1">Outstanding out</p>
              <p className="tnum text-[15px] text-chrome">−{peso(recon.unclearedOutCents)}</p>
            </div>
          </div>
          <p className="text-[11.5px] text-mist mb-4 leading-relaxed">
            Tick every line that appears on the {account.name} statement. When the difference reaches zero the wallet agrees with the real account.
            Uncleared lines stay listed for the next statement.
          </p>
          <div className="max-h-80 overflow-y-auto thin-scroll divide-y divide-white/[0.05]">
            {recon.lines.map((l) => (
              <div key={l.lineId} className={`flex items-center gap-3 py-2.5 ${l.voided ? "opacity-40" : ""}`}>
                <button
                  onClick={() => action.run(() => setLineCleared(l.lineId, !l.clearedAt))}
                  disabled={action.busy}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                    l.clearedAt ? "bg-emerald-400/20 border-emerald-400/40 text-emerald-300" : "border-white/20 text-transparent hover:border-white/40"
                  }`}
                  aria-label={l.clearedAt ? "Mark uncleared" : "Mark cleared"}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-chrome truncate">{l.memo ?? KIND_LABEL[l.kind] ?? l.kind}</p>
                  <p className="text-[10.5px] text-mist/60 flex items-center gap-2">
                    <Day iso={l.occurredAt} /> · {l.code}
                    {l.voided && <span className="text-rose-300/80">voided</span>}
                    {l.clearedAt && <span className="text-emerald-300/70">cleared</span>}
                  </p>
                </div>
                <span className="tnum text-[13px] shrink-0">
                  {l.debitCents > 0 && <span className="text-emerald-300">+{peso(l.debitCents)}</span>}
                  {l.creditCents > 0 && <span className="text-rose-300">−{peso(l.creditCents)}</span>}
                </span>
              </div>
            ))}
            {recon.lines.length === 0 && <p className="text-[12px] text-mist py-4 text-center">No lines up to the statement date.</p>}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Running history */}
        <SectionCard title="Running history">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="text-mist/70">
                  {["Date", "Entry", "What", "In", "Out", "Balance"].map((h) => (
                    <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {data.lines.map((l) => (
                  <tr key={l.lineId} className={l.voided ? "opacity-40" : ""}>
                    <td className="py-2.5 pr-3 text-[11.5px] text-mist tnum whitespace-nowrap"><Day iso={l.occurredAt} /></td>
                    <td className="py-2.5 pr-3 text-[11px] text-mist/70 tnum">{l.code}</td>
                    <td className="py-2.5 pr-3 max-w-[260px]">
                      <div className="flex items-center gap-2"><KindChip kind={l.kind} />{l.voided && <Ban size={11} className="text-rose-300/70" />}</div>
                      <p className="text-[11.5px] text-chrome truncate mt-0.5">{l.memo}</p>
                    </td>
                    <td className="py-2.5 pr-3 tnum text-[12px] text-emerald-300">{l.debitCents > 0 ? peso(l.debitCents) : ""}</td>
                    <td className="py-2.5 pr-3 tnum text-[12px] text-rose-300">{l.creditCents > 0 ? peso(l.creditCents) : ""}</td>
                    <td className="py-2.5 tnum text-[12px] text-chrome">{peso(l.runningBalanceCents)}</td>
                  </tr>
                ))}
                {data.lines.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-[12px] text-mist">No journal lines on this account yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Reconciliation history */}
        <SectionCard title="Reconciliation history">
          {completed.length === 0 ? (
            <p className="text-[12px] text-mist py-2">
              {isWallet ? "Never reconciled. Reconcile against each statement (bank, GCash, or a cash count) so the books stay provable." : "Only wallets are reconciled."}
            </p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {completed.map((r) => (
                <div key={r.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] text-chrome tnum">{fmtDate(new Date(r.statementDate))}</p>
                    <span className={`tnum text-[12.5px] ${(r.differenceCents ?? 0) === 0 ? "text-emerald-300" : "text-amber-300"}`}>
                      diff {peso(r.differenceCents ?? 0)}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-mist/70 mt-1">
                    statement {peso(r.statementEndingCents)} · cleared {peso(r.clearedBalanceCents ?? 0)} · {r.completedBy ?? ""}
                  </p>
                  {r.notes && <p className="text-[10.5px] text-mist/60 mt-1 italic">{r.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Start reconciliation modal */}
      <Modal open={startOpen} onClose={() => setStartOpen(false)} title={`Reconcile ${account.name}`}>
        <div className="space-y-4">
          <Field label="Statement date">
            <input type="date" className="input-dark tnum" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
          </Field>
          <Field label="Statement ending balance (₱)">
            <input className="input-dark tnum" value={stmtEnding} onChange={(e) => setStmtEnding(e.target.value)} placeholder="0.00" inputMode="decimal" />
          </Field>
          <p className="text-[11.5px] text-mist leading-relaxed">
            Enter the ending balance exactly as the statement shows it. You&apos;ll then tick the lines that appear on the statement until the difference is zero.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setStartOpen(false)}>Cancel</Btn>
            <Btn
              busy={action.busy}
              disabled={!stmtEnding.trim()}
              onClick={async () => {
                const done = await action.run(
                  () => startReconciliation({ accountId: account.id, statementDate: stmtDate, statementEnding: Number(stmtEnding) }),
                  { notice: "Reconciliation started" },
                );
                if (done) setStartOpen(false);
              }}
            >
              Start reconciling
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Complete modal */}
      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} title="Complete reconciliation">
        <div className="space-y-4">
          {recon && (
            <div className="card-dark p-4 space-y-2 text-[12.5px]">
              <div className="flex justify-between"><span className="text-mist">Statement ending</span><span className="tnum text-chrome">{peso(recon.statementEndingCents)}</span></div>
              <div className="flex justify-between"><span className="text-mist">Cleared balance</span><span className="tnum text-chrome">{peso(recon.clearedBalanceCents)}</span></div>
              <div className="flex justify-between"><span className="text-mist">Difference</span><span className={`tnum ${recon.differenceCents === 0 ? "text-emerald-300" : "text-amber-300"}`}>{peso(recon.differenceCents)}</span></div>
            </div>
          )}
          <Field label="Note (required when closing with a difference)">
            <textarea className="input-dark" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank fee not yet recorded — will add next month" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setCompleteOpen(false)}>Back</Btn>
            <Btn
              busy={action.busy}
              onClick={async () => {
                const done = await action.run(() => completeReconciliation(data.openRecon!.id, note), { notice: "Reconciliation completed" });
                if (done) { setCompleteOpen(false); setNote(""); }
              }}
            >
              Complete
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
