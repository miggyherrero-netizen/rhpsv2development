"use client";

import { useState } from "react";
import type { GosAd } from "@/db/gos-schema";
import {
  centavosToPesos, fuelPerKmCentavos, pesosToCentavos, TEMPLATE_KEYS, unknownPlaceholders, type GosSettings,
} from "@/lib/gos/settings";
import { addAd, saveGosSettings, setAdRetired } from "@/server/gos/settings";

type Status = Record<string, "saved" | "error" | undefined>;

/* Field components live at top level (not inside SettingsClient) so React keeps their state and focus between saves. */
function Note({ value }: { value: "saved" | "error" | undefined }) {
  if (value === "saved") return <span role="status" className="text-sm text-[var(--gos-ok)]">Saved ✓</span>;
  if (value === "error") return <span role="alert" className="text-sm text-[var(--gos-danger)]">✕ Not saved — try again</span>;
  return null;
}

function MoneyField(props: {
  label: string; value: number | null; allowBlank: boolean; status: "saved" | "error" | undefined;
  onSave: (centavos: number | null) => void; onInvalid: () => void;
}) {
  const [text, setText] = useState(centavosToPesos(props.value));
  return (
    <label className="block">
      <span className="font-bold">{props.label}</span>
      <input className="gos-input mt-1" inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const c = pesosToCentavos(text);
          if (c === null) { if (props.allowBlank) props.onSave(null); else props.onInvalid(); return; }
          if (Number.isNaN(c) || c <= 0) { props.onInvalid(); return; }
          props.onSave(c);
        }} />
      <Note value={props.status} />
    </label>
  );
}

function NumberField(props: {
  label: string; value: number; status: "saved" | "error" | undefined;
  onSave: (n: number) => void; onInvalid: () => void;
}) {
  const [text, setText] = useState(String(props.value));
  return (
    <label className="block">
      <span className="font-bold">{props.label}</span>
      <input className="gos-input mt-1" inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (!Number.isFinite(n) || n <= 0) { props.onInvalid(); return; }
          props.onSave(n);
        }} />
      <Note value={props.status} />
    </label>
  );
}

const TEMPLATE_LABELS: Record<(typeof TEMPLATE_KEYS)[number], string> = {
  newInquiry: "New inquiry", general: "General (fallback)", noQuoteFollowUp: "Follow-up: no quote yet",
  quoteFollowUp: "Follow-up: quote sent", confirmation: "Visit confirmation", onMyWay: "On my way",
  thankYou: "Thank you", paymentReminder: "Payment reminder", tuningInvite: "Tuning invite",
};

export default function SettingsClient({ initial, initialAds }: { initial: GosSettings; initialAds: GosAd[] }) {
  const [s, setS] = useState(initial);
  const [ads, setAds] = useState(initialAds);
  const [status, setStatus] = useState<Status>({});
  const [newAd, setNewAd] = useState("");
  const [adError, setAdError] = useState("");

  const mark = (field: string, v: "saved" | "error") => setStatus((st) => ({ ...st, [field]: v }));

  async function save(field: string, next: GosSettings) {
    const res = await saveGosSettings(next);
    if (res.ok) {
      setS(res.value);
      mark(field, "saved");
    } else {
      mark(field, "error");
    }
  }

  /** Props for a field: current status + save/invalid handlers bound to its key. */
  const bind = (field: string) => ({
    status: status[field],
    onInvalid: () => mark(field, "error"),
  });

  return (
    <div className="mt-2 space-y-6">
      <h1>Settings</h1>

      <fieldset className="gos-card space-y-4">
        <legend className="px-1 text-lg font-bold">Prices</legend>
        <MoneyField {...bind("tuning")} label="Tuning, pesos" value={s.prices.tuningCentavos} allowBlank={false}
          onSave={(c) => void save("tuning", { ...s, prices: { ...s.prices, tuningCentavos: c as number } })} />
        <MoneyField {...bind("cleaning")} label="Cleaning, pesos (blank = not set)" value={s.prices.cleaningCentavos} allowBlank
          onSave={(c) => void save("cleaning", { ...s, prices: { ...s.prices, cleaningCentavos: c } })} />
        <MoneyField {...bind("repair")} label="Repair labor, pesos (blank = not set)" value={s.prices.repairLaborCentavos} allowBlank
          onSave={(c) => void save("repair", { ...s, prices: { ...s.prices, repairLaborCentavos: c } })} />
        <p className="text-sm text-[var(--gos-ink-dim)]">New quotes only. Old quotes keep their price.</p>
      </fieldset>

      <fieldset className="gos-card space-y-4">
        <legend className="px-1 text-lg font-bold">Travel</legend>
        <MoneyField {...bind("diesel")} label="Diesel price, pesos per liter" value={s.travel.dieselPerLiterCentavos} allowBlank={false}
          onSave={(c) => void save("diesel", { ...s, travel: { ...s.travel, dieselPerLiterCentavos: c as number } })} />
        <NumberField {...bind("kmpl")} label="Kilometers per liter" value={s.travel.kmPerLiter}
          onSave={(n) => void save("kmpl", { ...s, travel: { ...s.travel, kmPerLiter: n } })} />
        <p aria-live="polite">Fuel: ₱{centavosToPesos(fuelPerKmCentavos(s))}/km</p>
        <MoneyField {...bind("vehicle")} label="Vehicle cost, pesos per km (blank = not set)" value={s.travel.vehicleCostPerKmCentavos} allowBlank
          onSave={(c) => void save("vehicle", { ...s, travel: { ...s.travel, vehicleCostPerKmCentavos: c } })} />
        <MoneyField {...bind("meals")} label="Meals default, pesos" value={s.travel.mealsDefaultCentavos} allowBlank={false}
          onSave={(c) => void save("meals", { ...s, travel: { ...s.travel, mealsDefaultCentavos: c as number } })} />
        <label className="gos-tap flex items-center gap-3">
          <input type="checkbox" checked={s.travel.roundTripDefault}
            onChange={(e) => void save("roundtrip", { ...s, travel: { ...s.travel, roundTripDefault: e.target.checked } })} />
          Round trip by default <Note value={status.roundtrip} />
        </label>
        <label className="gos-tap flex items-center gap-3">
          <input type="checkbox" checked={s.travel.roundUpTo10}
            onChange={(e) => void save("round10", { ...s, travel: { ...s.travel, roundUpTo10: e.target.checked } })} />
          Round travel up to ₱10 <Note value={status.round10} />
        </label>
        <p className="text-sm text-[var(--gos-ink-dim)]">New quotes only. Old quotes keep their price.</p>
      </fieldset>

      <fieldset className="gos-card space-y-4">
        <legend className="px-1 text-lg font-bold">Reminders</legend>
        <NumberField {...bind("noreply")} label="No reply after, minutes" value={s.reminders.noReplyMinutes}
          onSave={(n) => void save("noreply", { ...s, reminders: { ...s.reminders, noReplyMinutes: Math.round(n) } })} />
        <NumberField {...bind("noquote")} label="No quote after reply, days" value={s.reminders.noQuoteDays}
          onSave={(n) => void save("noquote", { ...s, reminders: { ...s.reminders, noQuoteDays: Math.round(n) } })} />
        <NumberField {...bind("quotefu")} label="Quote follow-up after, days" value={s.reminders.quoteFollowUpDays}
          onSave={(n) => void save("quotefu", { ...s, reminders: { ...s.reminders, quoteFollowUpDays: Math.round(n) } })} />
        <NumberField {...bind("unpaid")} label="Unpaid reminder after, days" value={s.reminders.unpaidDays}
          onSave={(n) => void save("unpaid", { ...s, reminders: { ...s.reminders, unpaidDays: Math.round(n) } })} />
        <NumberField {...bind("tuningdays")} label="Tuning reminder, days before due" value={s.reminders.tuningLeadDays}
          onSave={(n) => void save("tuningdays", { ...s, reminders: { ...s.reminders, tuningLeadDays: Math.round(n) } })} />
      </fieldset>

      <fieldset className="gos-card space-y-4">
        <legend className="px-1 text-lg font-bold">Reply texts</legend>
        {TEMPLATE_KEYS.map((key) => {
          const unknown = unknownPlaceholders(s.templates[key]);
          return (
            <label key={key} className="block">
              <span className="font-bold">{TEMPLATE_LABELS[key]}</span>
              <textarea className="gos-input mt-1 min-h-24" maxLength={1000} defaultValue={s.templates[key]}
                onBlur={(e) => void save(`tpl-${key}`, { ...s, templates: { ...s.templates, [key]: e.target.value } })} />
              {unknown.length > 0 && (
                <span role="alert" className="block text-sm text-[var(--gos-danger)]">✕ Unknown: {unknown.join(", ")}</span>
              )}
              <Note value={status[`tpl-${key}`]} />
            </label>
          );
        })}
        <p className="text-sm text-[var(--gos-ink-dim)]">Allowed: {"{name} {area} {total} {date} {time} {balance} {piano} {minutes}"}</p>
      </fieldset>

      <fieldset className="gos-card space-y-3">
        <legend className="px-1 text-lg font-bold">Ad names</legend>
        <ul className="space-y-2">
          {ads.map((ad) => (
            <li key={ad.id} className="flex items-center justify-between gap-3">
              <span>{ad.name}{ad.retired ? " (retired)" : ""}</span>
              <button type="button" className="gos-btn-ghost"
                onClick={async () => {
                  const res = await setAdRetired(ad.id, !ad.retired);
                  if (res.ok) { setAds(ads.map((a) => (a.id === ad.id ? { ...a, retired: !a.retired } : a))); setAdError(""); }
                  else setAdError(res.error);
                }}>
                {ad.retired ? "Bring back" : "Retire"}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input className="gos-input" aria-label="New ad name" maxLength={60} value={newAd} onChange={(e) => setNewAd(e.target.value)} />
          <button type="button" className="gos-btn-black shrink-0 whitespace-nowrap"
            onClick={async () => {
              const res = await addAd(newAd);
              if (res.ok) { setAds([...ads, res.value]); setNewAd(""); setAdError(""); }
              else setAdError(res.error);
            }}>+ Add</button>
        </div>
        {adError && <p role="alert" className="text-sm text-[var(--gos-danger)]">✕ {adError}</p>}
      </fieldset>

      <fieldset className="gos-card space-y-2">
        <legend className="px-1 text-lg font-bold">Lost reasons</legend>
        <textarea className="gos-input min-h-24" aria-label="Lost reasons, one per line" defaultValue={s.lostReasons.join("\n")}
          onBlur={(e) => {
            const list = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
            void save("lost", { ...s, lostReasons: list });
          }} />
        <Note value={status.lost} />
      </fieldset>

      <fieldset className="gos-card space-y-2">
        <legend className="px-1 text-lg font-bold">Ads connection</legend>
        <p>Not connected</p>
      </fieldset>
    </div>
  );
}
