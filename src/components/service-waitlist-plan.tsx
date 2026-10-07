"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarCheck, MapPin } from "lucide-react";
import { fmtKm, areaName } from "@/lib/service-geo";
import { SERVICE_TYPE_LABEL } from "@/lib/service";
import { messageDate, messageTime, daysWaiting, LONG_WAIT_DAYS } from "@/lib/service-waitlist";
import type { TripPlanData } from "@/server/service-waitlist-data";
import { confirmEntryForTrip, createTrip } from "@/server/service-waitlist";
import MessageActions from "@/components/service-message-actions";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { Chip, DateField, EmptyState, ErrorLine, Field, GhostButton, PrimaryButton, SectionCard, Select, TextInput, UnitInput } from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const TEXT = { color: "var(--color-svc-text)" } as const;

const REASON: Record<string, { label: string; tone: "success" | "azure" | "slate" | "warn" }> = {
  at_destination: { label: "In the destination", tone: "success" },
  near_destination: { label: "Near the destination", tone: "success" },
  on_the_way: { label: "On the way", tone: "azure" },
  no_location: { label: "No area saved", tone: "warn" },
};

const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Plan a trip: pick the destination and day, tick who to take along (everyone waiting near the way there or near the
 * destination is suggested), then message each one and, when they say yes, "Confirm + time" books them on the trip.
 */
export default function PlanTripClient({
  plan, destLabel, destCode, radiusKm, technicians, templates,
}: {
  plan: TripPlanData | null;
  destLabel: string | null;
  destCode: string | null;
  radiusKm: number;
  technicians: { id: string; name: string }[];
  templates: { key: string; name: string; body: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dest, setDest] = useState<PlaceValue>({ cityCode: destCode, barangayCode: null });
  const [km, setKm] = useState(String(radiusKm));
  const [date, setDate] = useState(todayManila());
  const [selected, setSelected] = useState<Set<string>>(() => new Set(plan?.candidates.filter((c) => c.reason !== "no_location").map((c) => c.item.id) ?? []));
  const [times, setTimes] = useState<Record<string, string>>({});
  const [booked, setBooked] = useState<Record<string, { jobId: string; item: TripPlanData["candidates"][number]["item"]; time: string }>>({});
  const [tripId, setTripId] = useState<string | null>(null);
  const [techId, setTechId] = useState(technicians.length === 1 ? technicians[0]!.id : "");

  const dayDate = useMemo(() => new Date(`${date}T09:00:00+08:00`), [date]);
  const areaText = plan?.dest ? areaName({ code: plan.dest.code, name: plan.dest.name }, null) : "";
  // Once booked, a client leaves the waitlist candidates (status "scheduled") — they stay on screen from here.
  const chosen = plan?.candidates.filter((c) => selected.has(c.item.id) && !booked[c.item.id]) ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tripName = `${plan?.dest?.name ?? "Trip"} — ${messageDate(dayDate)}`;
  const defaultTime = (i: number) => {
    const mins = 9 * 60 + i * 90;
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  };
  const tpl = templates.find((t) => t.key === "area_trip")?.body ?? "";

  const confirm = (item: TripPlanData["candidates"][number]["item"], index: number) => {
    const entryId = item.id;
    setError(null);
    start(async () => {
      let id = tripId;
      if (!id) {
        const t = await createTrip({ name: tripName, cityCode: plan?.dest?.code ?? null, tripDate: `${date}T09:00` });
        if (!t.ok || !t.data) return setError(t.ok ? "Couldn't create the trip." : t.error);
        id = t.data.id; setTripId(id);
      }
      const time = times[entryId] ?? defaultTime(index);
      const r = await confirmEntryForTrip({ entryId, tripId: id, start: `${date}T${time}`, technicianId: techId || null });
      if (!r.ok) return setError(r.error);
      setBooked((b) => ({ ...b, [entryId]: { jobId: r.data!.jobId, item, time } }));
    });
  };

  const goPlan = () => {
    if (!dest.cityCode) return;
    router.push(`/service/waitlist/plan?city=${dest.cityCode}&km=${Number(km) || radiusKm}`);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1000px] mx-auto space-y-5">
      <header>
        <Link href="/service/waitlist" className="inline-flex items-center gap-1.5 min-h-11 text-[12px] hover:underline" style={FAINT}><ArrowLeft size={13} aria-hidden="true" /> Waitlist</Link>
        <h1 className="font-serif text-3xl mt-1" style={TEXT}>Plan a trip</h1>
        <p className="text-[13px] mt-1" style={DIM}>Pick where you are going, tick who comes along, message them, then book.</p>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <SectionCard title="1 · Where and when">
        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-[1fr_180px_150px_auto] gap-3 items-end">
          <CityPicker label="Destination" barangay={false} value={dest} selectedLabel={destLabel ?? undefined} onChange={(v) => setDest(v)} />
          <Field label="Trip day"><DateField kind="date" value={date} onChange={setDate} /></Field>
          <Field label="Look within"><UnitInput type="number" inputMode="numeric" min={5} max={300} suffix="km" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
          <PrimaryButton onClick={goPlan} disabled={!dest.cityCode} className="!min-h-11">Find clients</PrimaryButton>
        </div>
        {plan?.home && plan.dest && (
          <p className="px-5 pb-4 -mt-1 text-[12px]" style={DIM}>
            From <b className="font-medium">{plan.home.name}</b> to <b className="font-medium">{plan.dest.name}</b> — clients within {plan.radiusKm} km of the straight line, or within {plan.radiusKm} km of {plan.dest.name}.
          </p>
        )}
        {plan && !plan.home && <p role="alert" className="px-5 pb-4 text-[13px]" style={{ color: "var(--color-svc-warn)" }}>Set a home base with a known location in Settings → Trips &amp; areas to get route-based suggestions.</p>}
      </SectionCard>

      {!plan ? (
        <div className="card-svc"><EmptyState icon={<MapPin size={19} strokeWidth={1.7} />} title="Choose a destination" hint="Type a city or town above — Digos, General Santos, Tagum…" /></div>
      ) : plan.candidates.length === 0 ? (
        <div className="card-svc"><EmptyState icon={<MapPin size={19} strokeWidth={1.7} />} title={`Nobody waiting near ${plan.dest?.name ?? "there"}`} hint={`Try a wider “Look within” than ${plan.radiusKm} km, or add clients to the waitlist.`} /></div>
      ) : (
        <>
          <SectionCard title={`2 · Who to take · ${chosen.length} of ${plan.candidates.length} ticked`}>
            <ul className="svc-divide" aria-label="Waiting clients near this trip">
              {plan.candidates.map((c) => {
                const r = REASON[c.reason]!;
                const dw = daysWaiting(c.item.requestedAt, new Date());
                return (
                  <li key={c.item.id}>
                    <label className="flex items-start gap-3 px-5 py-3 min-h-11 cursor-pointer">
                      <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={selected.has(c.item.id)} onChange={() => toggle(c.item.id)} aria-label={`Take ${c.item.customerName}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium" style={TEXT}>{c.item.customerName}</span>
                        <span className="block text-[12px]" style={DIM}>
                          {c.item.pianoLabel ?? "No piano chosen"} · {SERVICE_TYPE_LABEL[c.item.serviceType] ?? c.item.serviceType} · {c.item.cityName ?? "Unsorted"}
                          {" · "}<span style={{ color: dw > LONG_WAIT_DAYS ? "var(--color-svc-danger)" : undefined }}>{dw}d waiting</span>
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <Chip tone={r.tone}>{r.label}</Chip>
                        {c.routeKm !== null && <span className="block text-[12px] mt-1 svc-num" style={DIM}>{c.reason === "on_the_way" ? `${fmtKm(c.routeKm)} from route` : `${fmtKm(c.destKm ?? 0)} from ${plan.dest?.name}`}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          {Object.keys(booked).length > 0 && (
            <SectionCard title={`Booked on this trip · ${Object.keys(booked).length}`}>
              <ul className="svc-divide">
                {Object.values(booked).map((b) => (
                  <li key={b.item.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <p className="text-[14px]" style={TEXT}>{b.item.customerName} <span className="text-[12px]" style={DIM}>· {b.item.pianoLabel} · {b.time}</span></p>
                    <Link href={`/service/jobs/${b.jobId}`} className="btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[13px]"><CalendarCheck size={14} aria-hidden="true" /> Open visit</Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {chosen.length > 0 && (
            <SectionCard
              title={`3 · Message & book · ${tripName}`}
              action={technicians.length > 1 ? (
                <Select aria-label="Technician for these visits" value={techId} onChange={(e) => setTechId(e.target.value)} className="!w-auto !min-h-11">
                  <option value="">Unassigned</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              ) : undefined}
            >
              <ul className="svc-divide">
                {chosen.map((c, idx) => {
                  const it = c.item;
                  return (
                    <li key={it.id} className="px-5 py-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[14px] font-medium" style={TEXT}>{it.customerName} <span className="text-[12px] font-normal" style={DIM}>· {it.pianoLabel ?? "no piano chosen"}</span></p>
                      </div>
                      <MessageActions
                        entryId={it.id} customerName={it.customerName} phone={it.customerPhone} messenger={it.messenger} template={tpl}
                        vars={{ area: areaText, date: messageDate(dayDate), time: messageTime(new Date(`${date}T${times[it.id] ?? defaultTime(idx)}:00+08:00`)), piano: it.pianoLabel ?? "piano", location: it.areaLabel }}
                      />
                      {(
                        <div className="flex flex-wrap items-end gap-3 pt-1">
                          <label className="block"><span className="block text-[12px] uppercase tracking-[0.1em] mb-1" style={DIM}>Visit time</span>
                            <TextInput type="time" aria-label={`Visit time for ${it.customerName}`} value={times[it.id] ?? defaultTime(idx)} onChange={(e) => setTimes((t) => ({ ...t, [it.id]: e.target.value }))} className="!w-36 !min-h-11" /></label>
                          <PrimaryButton pending={pending} onClick={() => confirm(it, idx)} className="!min-h-11"><CalendarCheck size={14} aria-hidden="true" /> Confirm + time</PrimaryButton>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {tripId && (
                <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
                  <p className="text-[13px]" style={DIM}>{Object.keys(booked).length} booked on this trip.</p>
                  <GhostButton className="!min-h-11" onClick={() => router.push("/service/waitlist")}>Back to waitlist</GhostButton>
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
