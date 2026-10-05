"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { saveRoute, deleteRoute, savePlanSettings, saveTemplate } from "@/server/service-waitlist";
import { PLACEHOLDERS, fillTemplate } from "@/lib/service-waitlist";
import { ErrorLine, Field, GhostButton, PrimaryButton, SectionCard, SuccessLine, TextArea, TextInput, UnitInput } from "@/components/service-ui";

export type CityLabels = Record<string, string>;

const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FAINT = { color: "var(--color-svc-text-faint)" } as const;

const SAMPLE = {
  first_name: "Maria", area: "Digos", date: "Saturday, Oct 18", time: "9:00 AM", piano: "Yamaha U1",
  location: "12 Acacia St", price: "₱2,500", tech_name: "Ariel",
};

/** Settings → Trips & areas (home base, search distance, saved routes) and Message templates. These save instantly. */
export default function TripSettings({
  homeBase, radiusKm, routes, templates, cityLabels,
}: {
  homeBase: string;
  radiusKm: number;
  routes: { id: string; name: string; cityCodes: string[] }[];
  templates: { key: string; name: string; body: string }[];
  /** code → "Digos · Davao del Sur · Region XI" for every city used above. */
  cityLabels: CityLabels;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [base, setBase] = useState<PlaceValue>({ cityCode: homeBase, barangayCode: null });
  const [km, setKm] = useState(String(radiusKm));
  const [labels, setLabels] = useState<CityLabels>(cityLabels);
  const flash = (m: string) => { setSaved(m); setTimeout(() => setSaved(null), 2500); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong."); else flash(done);
    });
  };

  // route editor
  const [editing, setEditing] = useState<{ id: string | null; name: string; codes: string[] } | null>(null);
  const [addCity, setAddCity] = useState<PlaceValue>({ cityCode: null, barangayCode: null });

  return (
    <>
      <SectionCard title={<>Trips &amp; areas <span className="font-normal text-[12px]" style={FAINT}>· saves instantly</span></>}>
        <div className="px-5 py-4 space-y-5">
          <ErrorLine>{error}</ErrorLine>
          <SuccessLine>{saved}</SuccessLine>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end">
            <CityPicker label="Home base (where trips start)" barangay={false} value={base} selectedLabel={labels[homeBase]}
              onChange={(v, hit) => { setBase(v); if (hit) setLabels((l) => ({ ...l, [hit.code]: hit.label })); }} />
            <Field label="Search distance" hint="Clients within this of the route or destination">
              <UnitInput type="number" inputMode="numeric" min={5} max={300} suffix="km" value={km} onChange={(e) => setKm(e.target.value)} />
            </Field>
            <PrimaryButton pending={pending} disabled={!base.cityCode} className="!min-h-11"
              onClick={() => run(() => savePlanSettings({ homeBaseCityCode: base.cityCode!, tripRadiusKm: Number(km) }), "Saved ✓")}>Save</PrimaryButton>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[11px] uppercase tracking-[0.1em]" style={DIM}>Saved routes</p>
              {!editing && <GhostButton onClick={() => setEditing({ id: null, name: "", codes: [] })} className="inline-flex items-center gap-1.5 !min-h-11"><Plus size={13} aria-hidden="true" /> New route</GhostButton>}
            </div>
            {routes.length === 0 && !editing && <p className="text-[12.5px]" style={FAINT}>No routes yet. A route is an ordered list of towns — e.g. “South Run: Digos → Sta. Cruz → Gensan” — so the waitlist can show who is on it.</p>}
            <ul className="svc-divide">
              {routes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>{r.name}</p>
                    <p className="text-[12px]" style={DIM}>{r.cityCodes.map((c) => (labels[c] ?? c).split(" · ")[0]).join(" → ")}</p>
                  </div>
                  <div className="flex gap-2">
                    <GhostButton className="!min-h-11" onClick={() => setEditing({ id: r.id, name: r.name, codes: r.cityCodes })}>Edit</GhostButton>
                    <button type="button" aria-label={`Delete route ${r.name}`} onClick={() => run(() => deleteRoute(r.id), "Route deleted")} className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]" style={FAINT}><Trash2 size={14} aria-hidden="true" /></button>
                  </div>
                </li>
              ))}
            </ul>

            {editing && (
              <div className="rounded-xl p-3.5 mt-3 space-y-3" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)" }}>
                <Field label="Route name"><TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. South Run" /></Field>
                <ol className="space-y-1.5" aria-label="Cities on this route, in order">
                  {editing.codes.map((c, i) => (
                    <li key={c} className="flex items-center gap-2">
                      <span className="w-6 text-[12px] text-right" style={FAINT}>{i + 1}.</span>
                      <span className="flex-1 text-[13px]" style={{ color: "var(--color-svc-text)" }}>{labels[c] ?? c}</span>
                      <button type="button" aria-label={`Move ${labels[c] ?? c} up`} disabled={i === 0} className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06] disabled:opacity-30" style={DIM}
                        onClick={() => { const a = [...editing.codes]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; setEditing({ ...editing, codes: a }); }}><ArrowUp size={14} aria-hidden="true" /></button>
                      <button type="button" aria-label={`Move ${labels[c] ?? c} down`} disabled={i === editing.codes.length - 1} className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06] disabled:opacity-30" style={DIM}
                        onClick={() => { const a = [...editing.codes]; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; setEditing({ ...editing, codes: a }); }}><ArrowDown size={14} aria-hidden="true" /></button>
                      <button type="button" aria-label={`Remove ${labels[c] ?? c}`} className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]" style={FAINT}
                        onClick={() => setEditing({ ...editing, codes: editing.codes.filter((x) => x !== c) })}><X size={14} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ol>
                <CityPicker label="Add a city to the route" barangay={false} value={addCity}
                  onChange={(v, hit) => {
                    if (v.cityCode && hit) {
                      setLabels((l) => ({ ...l, [hit.code]: hit.label }));
                      setEditing((e) => (e && !e.codes.includes(hit.code) ? { ...e, codes: [...e.codes, hit.code] } : e));
                      setAddCity({ cityCode: null, barangayCode: null });
                    } else setAddCity(v);
                  }} />
                <div className="flex gap-2">
                  <GhostButton className="!min-h-11" onClick={() => setEditing(null)}>Cancel</GhostButton>
                  <PrimaryButton pending={pending} className="!min-h-11" disabled={!editing.name.trim() || editing.codes.length < 2}
                    onClick={() => { const e = editing; run(async () => { const r = await saveRoute({ id: e.id, name: e.name, cityCodes: e.codes }); if (r.ok) setEditing(null); return r; }, "Route saved ✓"); }}>Save route</PrimaryButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={<>Message templates <span className="font-normal text-[12px]" style={FAINT}>· saves instantly</span></>}>
        <div className="px-5 py-4 space-y-5">
          <p className="text-[12.5px]" style={DIM}>
            Placeholders get filled in for each client: {PLACEHOLDERS.map((p) => <code key={p} className="mx-0.5 px-1 rounded" style={{ background: "var(--color-svc-surface-2)" }}>{`{${p}}`}</code>)}
          </p>
          {templates.map((t) => <TemplateEditor key={t.key} t={t} pending={pending} onSave={(body, name) => run(() => saveTemplate(t.key, { body, name }), `“${name}” saved ✓`)} />)}
        </div>
      </SectionCard>
    </>
  );
}

function TemplateEditor({ t, pending, onSave }: { t: { key: string; name: string; body: string }; pending: boolean; onSave: (body: string, name: string) => void }) {
  const [body, setBody] = useState(t.body);
  const [name, setName] = useState(t.name);
  const preview = fillTemplate(body, SAMPLE).text;
  const dirty = body !== t.body || name !== t.name;
  return (
    <div className="space-y-2">
      <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Message"><TextArea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--color-svc-surface-2)", color: "var(--color-svc-text-dim)" }}><b className="font-medium">Preview:</b> {preview}</p>
      <PrimaryButton pending={pending} disabled={!dirty || !body.trim()} className="!min-h-11" onClick={() => onSave(body, name)}>Save “{t.name}”</PrimaryButton>
    </div>
  );
}
