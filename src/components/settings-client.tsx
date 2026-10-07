"use client";

import { useState } from "react";
import { Save, Globe, Hammer, Link2, Palette } from "lucide-react";
import { saveStaleDays } from "@/server/admin";
import { Spinner } from "@/components/ui";

export default function SettingsClient({ staleDays }: { staleDays: number }) {
  const [days, setDays] = useState(String(staleDays));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-4 max-w-xl">
      <section className="card-dark p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-mist mb-1.5">Client updates</p>
        <p className="text-[12.5px] text-chrome/80 leading-relaxed mb-4">
          Flag a project on the dashboard when its client hasn&apos;t received a journal update in this many days.
        </p>
        <div className="flex gap-2.5">
          <input type="number" min={1} max={60} aria-label="Days without a client update" value={days} onChange={(e) => setDays(e.target.value)} className="input-dark w-24" />
          <button
            onClick={async () => { setBusy(true); await saveStaleDays(Number(days) || 10); setBusy(false); setSaved(true); setTimeout(() => setSaved(false), 1600); }}
            className="flex items-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl px-4 hover:brightness-110 transition">
            {busy ? <Spinner className="text-black" /> : <Save size={14} />} {saved ? "Saved" : "Save"}
          </button>
        </div>
      </section>

      <section className="card-dark p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-mist mb-3">Quick surfaces</p>
        <ul className="space-y-2.5 text-[12.5px]">
          <li><a href="/admin/website" className="flex items-center gap-2.5 text-chrome hover:text-white transition"><Palette size={14} className="text-mist" /> Public website editor</a></li>
          <li><a href="/" target="_blank" className="flex items-center gap-2.5 text-chrome hover:text-white transition"><Globe size={14} className="text-mist" /> Public website & showroom</a></li>
          <li><a href="/workshop" target="_blank" className="flex items-center gap-2.5 text-chrome hover:text-white transition"><Hammer size={14} className="text-mist" /> Workshop kiosk (PIN demo: 2468, 1357, 7777)</a></li>
          <li><a href="/admin/monitor" className="flex items-center gap-2.5 text-chrome hover:text-white transition"><Link2 size={14} className="text-mist" /> Live labor monitor</a></li>
        </ul>
      </section>

      <section className="card-dark p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-mist mb-3">Workspace access</p>
        <p className="text-[12.5px] text-chrome/80 leading-relaxed">
          Signed in as the owner account. Your personal workspace lives at <a href="/owner/today" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">/owner/today</a> —
          a separate calendar, planner, and inbox that stays yours even when the shop is busy.
        </p>
      </section>
    </div>
  );
}
