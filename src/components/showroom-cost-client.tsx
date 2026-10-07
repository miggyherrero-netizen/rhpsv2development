"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Coins } from "lucide-react";
import { peso } from "@/lib/format";
import { Field, Spinner } from "@/components/ui";
import { updatePianoCost } from "@/server/admin";
import type { getPianoCost } from "@/server/data";

type Piano = NonNullable<Awaited<ReturnType<typeof getPianoCost>>>;

export default function ShowroomCostClient({ piano }: { piano: Piano }) {
  const [cost, setCost] = useState(piano.costCents != null ? (piano.costCents / 100).toString() : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const costCents = cost.trim() === "" ? null : Math.round(Number(cost) * 100);
  const margin = piano.priceCents != null && costCents != null ? piano.priceCents - costCents : null;
  const marginPct = margin != null && piano.priceCents ? (margin / piano.priceCents) * 100 : null;

  async function save() {
    setBusy(true);
    await updatePianoCost(piano.id, costCents);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="p-4 sm:p-7 max-w-lg mx-auto">
      <Link href="/admin/showroom" className="flex items-center gap-1.5 text-[12px] text-mist hover:text-white transition mb-5">
        <ArrowLeft size={14} /> Back to Showroom Editor
      </Link>

      <div className="card-dark p-6">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.22em] text-mist mb-1">
          <Coins size={12} /> Private · cost &amp; margin
        </p>
        <h1 className="font-serif text-2xl text-white">{piano.brand} {piano.model}</h1>
        <p className="text-mist text-[12px] mt-1">Not shown anywhere on the public site or the main showroom editor list.</p>

        <div className="mt-6 space-y-4">
          <Field label="List price">
            <p className="input-dark opacity-60 tnum">{piano.priceCents != null ? peso(piano.priceCents) : "Not set"}</p>
          </Field>
          <Field label="Acquisition / restoration cost (₱)">
            <input className="input-dark" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
          </Field>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3.5">
              <p className="text-xs uppercase tracking-[0.16em] text-mist">Margin</p>
              <p className={`tnum text-lg font-medium mt-1 ${margin != null && margin < 0 ? "text-rose-300" : "text-white"}`}>
                {margin != null ? peso(margin) : "—"}
              </p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3.5">
              <p className="text-xs uppercase tracking-[0.16em] text-mist">Margin %</p>
              <p className={`tnum text-lg font-medium mt-1 ${marginPct != null && marginPct < 0 ? "text-rose-300" : "text-white"}`}>
                {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>

          <button onClick={save} disabled={busy}
            className="w-full bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Spinner className="text-black" />} {saved ? "Saved" : "Save cost"}
          </button>
        </div>
      </div>
    </div>
  );
}
