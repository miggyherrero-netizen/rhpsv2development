"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { loadBarangays, searchCities, type PlaceHit } from "@/server/service-waitlist";
import { Select, TextInput } from "@/components/service-ui";

export type PlaceValue = { cityCode: string | null; barangayCode: string | null };

/**
 * City / municipality typeahead over the Mindanao PSGC list. Choosing one fills in the province and region
 * (shown as the label); inside Davao City a barangay can be chosen too. Value is the PSGC codes.
 */
export function CityPicker({
  value, onChange, selectedLabel, label = "City / municipality", barangay = true, autoFocus,
}: {
  value: PlaceValue;
  onChange: (v: PlaceValue, hit?: PlaceHit) => void;
  /** Shown while a city is already chosen (e.g. when editing); after a pick the hit's own label is used. */
  selectedLabel?: string;
  label?: string;
  barangay?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<PlaceHit | null>(null);
  const [brgys, setBrgys] = useState<{ code: string; name: string }[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const res = await searchCities(q);
      if (mine === seq.current && res.ok) setHits(res.data ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const needsBarangays = barangay && value.cityCode === "112402000";
  useEffect(() => {
    if (!needsBarangays || !value.cityCode) return;
    let cancelled = false;
    loadBarangays(value.cityCode).then((r) => { if (!cancelled && r.ok) setBrgys(r.data ?? []); });
    return () => { cancelled = true; };
  }, [needsBarangays, value.cityCode]);

  const choose = (h: PlaceHit) => {
    setPicked(h); setQuery(""); setHits([]); setOpen(false); setActive(-1);
    onChange({ cityCode: h.code, barangayCode: null }, h);
  };
  const shownLabel = picked && picked.code === value.cityCode ? picked.label : selectedLabel;
  const list = query.trim() ? hits : [];

  if (value.cityCode) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--color-svc-text-dim)" }}>{label}</p>
        <div className="flex items-center justify-between gap-2 rounded-xl px-3.5 min-h-11" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)" }}>
          <span className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>{shownLabel ?? value.cityCode}</span>
          <button
            type="button" aria-label="Change city" className="inline-flex items-center justify-center min-w-11 min-h-11 -mr-2 rounded-lg hover:bg-white/[0.06]"
            style={{ color: "var(--color-svc-text-faint)" }} onClick={() => { setPicked(null); onChange({ cityCode: null, barangayCode: null }); }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        {needsBarangays && (
          <Select aria-label="Barangay" value={value.barangayCode ?? ""} onChange={(e) => onChange({ cityCode: value.cityCode, barangayCode: e.target.value || null })}>
            <option value="">Barangay (optional)…</option>
            {brgys.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </Select>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={`${id}-in`} className="block text-[11px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>{label}</label>
      <TextInput
        id={`${id}-in`} role="combobox" aria-expanded={open && list.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined} autoComplete="off" autoFocus={autoFocus}
        placeholder="Type a city or town — e.g. Digos, Gensan, Tagum" value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(list.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); choose(list[active]!); }
          else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
        }}
      />
      {open && list.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching places" className="absolute z-30 left-0 right-0 mt-1 rounded-lg overflow-auto max-h-64 py-1 shadow-xl" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border-strong)" }}>
          {list.map((h, i) => (
            <li
              key={h.code} id={`${id}-o${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(h); }}
              className="px-3 py-2 min-h-11 flex flex-col justify-center cursor-pointer text-[13px]"
              style={{ background: i === active ? "var(--color-svc-accent-soft)" : undefined, color: "var(--color-svc-text)" }}
            >
              <span>{h.name}</span>
              <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-dim)" }}>{h.provinceName ? `${h.provinceName} · ` : ""}Region {h.regionShort}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
