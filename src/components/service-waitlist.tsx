"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ListChecks, MessageSquare, Pencil, Plus, Route as RouteIcon, Zap } from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import { SERVICE_TYPE_LABEL } from "@/lib/service";
import {
  LONG_WAIT_DAYS, WAIT_SOURCE_LABEL, isFollowUpDue, WAIT_STATUSES, WAIT_STATUS_LABEL, WAIT_STATUS_TONE, daysWaiting, groupWaitlist, isUpcoming, type WaitRow,
} from "@/lib/service-waitlist";
import type { WaitlistData, WaitlistItem } from "@/server/service-waitlist-data";
import { addWaitlistEntry, addWaitlistEntryWithNewCustomer, deleteWaitlistEntry, updateWaitlistEntry } from "@/server/service-waitlist";
import { NewContactNotice, addedNotice } from "@/components/service-customer-combobox";
import MessageActions from "@/components/service-message-actions";
import { WaitlistEntryModal, type EntryFormValues } from "@/components/service-waitlist-forms";
import { QuickInquiryModal } from "@/components/service-quick-inquiry";
import { ConvertButton, useConvertToJob } from "@/components/service-waitlist-convert";
import { canConvertEntry } from "@/lib/service-waitlist-convert";
import { Chip, EmptyState, ErrorLine, GhostButton, Select, StatCard, PrimaryButton } from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const TEXT = { color: "var(--color-svc-text)" } as const;
const GHOST = "btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[13px]";

const ago = (d: Date | null, now: Date): string => {
  if (!d) return "never";
  const n = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`;
};

export default function WaitlistClient({
  data, customers, templates, routes, technicians,
}: {
  data: WaitlistData;
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  templates: { key: string; name: string; body: string }[];
  routes: { id: string; name: string; cityCodes: string[] }[];
}) {
  const [now] = useState(() => new Date());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [area, setArea] = useState("all");
  const [status, setStatus] = useState("active");
  const [route, setRoute] = useState("all");
  const [dueNowOnly, setDueNowOnly] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "new" | "edit"; entry?: WaitlistItem; preset?: { code: string; label: string } } | null>(null);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const convert = useConvertToJob({ technicians });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null); setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong."); else after?.();
    });
  };

  const { items, metrics } = data;
  const routeCodes = useMemo(() => new Set(routes.find((r) => r.id === route)?.cityCodes ?? []), [routes, route]);

  const areas = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.cityCode && i.cityName) m.set(i.cityCode, i.cityName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(() => items.filter((i) => {
    if (status === "active" ? i.status === "done" : status !== "all" && i.status !== status) return false;
    if (area !== "all" && (area === "unsorted" ? i.cityCode : i.cityCode !== area)) return false;
    if (route !== "all" && !(i.cityCode && routeCodes.has(i.cityCode))) return false;
    if (dueNowOnly && !isFollowUpDue(i, now)) return false;
    if (!showUpcoming && isUpcoming(i.requestedAt, now)) return false;
    return true;
  }), [items, status, area, route, routeCodes, dueNowOnly, showUpcoming, now]);
  const upcomingHidden = items.filter((i) => isUpcoming(i.requestedAt, now) && i.status !== "done").length;

  const rows: (WaitRow & { item: WaitlistItem })[] = useMemo(() => filtered.map((i) => ({
    id: i.id, cityCode: i.cityCode, cityName: i.cityName, provinceCode: i.provinceCode, provinceName: i.provinceName,
    regionCode: i.regionCode, regionShort: i.regionShort, requestedAt: i.requestedAt, estValueCents: i.estValueCents, item: i,
  })), [filtered]);
  const groups = useMemo(() => groupWaitlist(rows, now), [rows, now]);
  const topCityOf = (cities: { key: string; count: number }[]) => cities.find((c) => c.key !== "unsorted")?.key ?? null;

  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const tpl = (i: WaitlistItem) => templates.find((t) => t.key === (i.source === "recall" && i.status === "waiting" ? "recall" : "follow_up"))?.body ?? "";

  const submit = (v: EntryFormValues) => {
    const m = modal;
    if (!m) return;
    if (m.mode === "new") {
      run(() => addWaitlistEntry({
        customerId: v.customerId, pianoId: v.pianoId, serviceType: v.serviceType, source: v.source, requestedAt: v.requestedAt, nextFollowUpAt: v.nextFollowUpAt,
        estValue: v.estValue, notes: v.notes, ...(v.useCustomerAddress ? {} : { cityCode: v.cityCode, barangayCode: v.barangayCode }),
      }), () => setModal(null));
    } else if (m.entry) {
      run(() => updateWaitlistEntry(m.entry!.id, {
        pianoId: v.pianoId, serviceType: v.serviceType, status: v.status, cityCode: v.cityCode, barangayCode: v.barangayCode,
        requestedAt: v.requestedAt, nextFollowUpAt: v.nextFollowUpAt, estValue: v.estValue, notes: v.notes,
      }), () => setModal(null));
    }
  };

  const Header = ({ gKey, name, count, oldestDays, value, depth, planCity, expanded }: { gKey: string; name: string; count: number; oldestDays: number; value: number; depth: number; planCity: string | null; expanded: boolean }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5" style={{ background: depth === 0 ? "rgba(255,255,255,0.02)" : undefined, borderTop: "1px solid var(--color-svc-border)", paddingLeft: `${1 + depth * 0.6}rem` }}>
      <button type="button" onClick={() => toggle(gKey)} aria-expanded={expanded} className="flex items-center gap-2 min-h-11 text-left flex-1 min-w-[9rem]" style={TEXT}>
        {expanded ? <ChevronDown size={15} aria-hidden="true" className="shrink-0" style={FAINT} /> : <ChevronRight size={15} aria-hidden="true" className="shrink-0" style={FAINT} />}
        <span className={`${depth === 0 ? "text-[14px] font-medium" : "text-[14px]"} min-w-0`}>{name}</span>
        <span className="shrink-0"><Chip tone="slate">{count}</Chip></span>
      </button>
      <span className="text-[12px] order-last basis-full sm:order-none sm:basis-auto pb-1.5 sm:pb-0 pl-7 sm:pl-0" style={DIM}>
        oldest {oldestDays}d{value > 0 ? <> · <span className="svc-num">{peso(value)}</span></> : null}
      </span>
      {planCity && (
        <Link href={`/service/waitlist/plan?city=${planCity}`} className={`${GHOST} shrink-0`}><RouteIcon size={13} aria-hidden="true" /> Plan trip</Link>
      )}
    </div>
  );

  const Row = ({ i }: { i: WaitlistItem }) => {
    const dw = daysWaiting(i.requestedAt, now);
    const due = isFollowUpDue(i, now);
    return (
      <li style={{ borderTop: "1px solid var(--color-svc-border)" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 sm:px-5 py-3 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_88px_110px_120px_auto]">
          <div className="min-w-0 basis-full min-[1100px]:basis-auto">
            <Link href={`/service/customers/${i.customerId}`} className="text-[14px] font-medium hover:underline" style={TEXT}>{i.customerName}</Link>
            <p className="text-[12px] truncate" style={DIM}>
              {i.pianoLabel ?? "No piano chosen"} · {SERVICE_TYPE_LABEL[i.serviceType] ?? i.serviceType}
              {i.areaLabel && i.areaLabel !== i.cityName ? ` · ${i.areaLabel}` : ""}
            </p>
          </div>
          <p className="text-[12px]" style={DIM}>{WAIT_SOURCE_LABEL[i.source] ?? i.source}{i.estValueCents ? ` · ${peso(i.estValueCents)}` : ""}</p>
          <p className="text-[13px] svc-num" style={{ color: dw > LONG_WAIT_DAYS ? "var(--color-svc-danger)" : "var(--color-svc-text-dim)" }}>
            <span className="min-[1100px]:hidden" style={FAINT}>Waiting </span>{isUpcoming(i.requestedAt, now) ? `due ${fmtDate(i.requestedAt)}` : `${dw}d`}
          </p>
          <p className="text-[12px]" style={DIM}><span className="min-[1100px]:hidden" style={FAINT}>Contacted </span>{ago(i.lastContactedAt, now)}</p>
          <p className="text-[12px]" style={DIM}>
            <span className="min-[1100px]:hidden" style={FAINT}>Follow up </span>{due ? "due · " : ""}{fmtDate(i.nextFollowUpAt)}
          </p>
          <div className="flex flex-wrap items-center gap-2 basis-full min-[1100px]:basis-auto min-[1100px]:justify-end">
            <Chip tone={WAIT_STATUS_TONE[i.status] ?? "slate"}>{WAIT_STATUS_LABEL[i.status] ?? i.status}</Chip>
            <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id} className={GHOST} aria-label={`Message ${i.customerName}`}>
              <MessageSquare size={13} aria-hidden="true" /> Message
            </button>
            {canConvertEntry(i) && <ConvertButton customerName={i.customerName} loading={convert.loadingId === i.id} onClick={() => { void convert.start(i.id); }} />}
            <button type="button" onClick={() => setModal({ mode: "edit", entry: i })} className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]" style={FAINT} aria-label={`Edit ${i.customerName}'s entry`}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {open === i.id && (
          <div className="px-4 sm:px-5 pb-4">
            <MessageActions
              entryId={i.id} customerName={i.customerName} phone={i.customerPhone} messenger={i.messenger} template={tpl(i)}
              vars={{ area: i.areaLabel, piano: i.pianoLabel ?? "piano" }} onMessaged={() => setOpen(null)}
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 app-page app-page-mid [--page-w:1200px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={FAINT}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={TEXT}>Waitlist by area</h1>
          <p className="text-[13px] mt-1" style={DIM}>Who is waiting, where — so one trip covers everyone nearby</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => setModal({ mode: "new" })} className="!min-h-11 !px-4 !text-[14px]"><Plus size={15} aria-hidden="true" /> Add to waitlist</GhostButton>
          <PrimaryButton onClick={() => setInquiryOpen(true)} className="!min-h-11"><Zap size={15} aria-hidden="true" /> Quick inquiry</PrimaryButton>
        </div>
      </header>

      <ErrorLine>{error}</ErrorLine>
      <NewContactNotice text={notice} />
      {convert.notice}

      <section aria-label="Waitlist numbers" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Waiting" value={metrics.waiting} sub={`${groups.length ? `${groups.reduce((n, g) => n + g.provinces.reduce((m, p) => m + p.cities.length, 0), 0)} areas` : "no areas yet"}`} icon={<ListChecks size={15} />} />
        <StatCard label="Avg days waiting" value={metrics.avgDaysWaiting === null ? "—" : metrics.avgDaysWaiting} sub="waiting + messaged" tone={metrics.avgDaysWaiting !== null && metrics.avgDaysWaiting > LONG_WAIT_DAYS ? "danger" : undefined} />
        <StatCard label="Messaged → confirmed" value={metrics.messagedToConfirmed.ratePct === null ? "—" : `${metrics.messagedToConfirmed.ratePct}%`} sub={`${metrics.messagedToConfirmed.confirmed} of ${metrics.messagedToConfirmed.messaged} · last 30 days`} tone="success" />
        <StatCard label="Jobs per trip" value={metrics.jobsPerTrip === null ? "—" : metrics.jobsPerTrip} sub="trips with bookings" tone="azure" />
      </section>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
        <label className="block"><span className="block text-[12px] uppercase tracking-[0.1em] mb-1" style={DIM}>Area</span>
          <Select aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)} className="!w-auto !min-h-11">
            <option value="all">All areas</option><option value="unsorted">Unsorted</option>
            {areas.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </Select></label>
        <label className="block"><span className="block text-[12px] uppercase tracking-[0.1em] mb-1" style={DIM}>Status</span>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto !min-h-11">
            <option value="active">Active</option><option value="all">Everything</option>
            {WAIT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select></label>
        {routes.length > 0 && (
          <label className="block"><span className="block text-[12px] uppercase tracking-[0.1em] mb-1" style={DIM}>Route</span>
            <Select aria-label="Filter by saved route" value={route} onChange={(e) => setRoute(e.target.value)} className="!w-auto !min-h-11">
              <option value="all">Any</option>
              {routes.map((r) => <option key={r.id} value={r.id}>On route: {r.name}</option>)}
            </Select></label>
        )}
        <button type="button" aria-pressed={dueNowOnly} onClick={() => setDueNowOnly((v) => !v)} className={GHOST} style={dueNowOnly ? { borderColor: "var(--color-svc-accent)", color: "var(--color-svc-accent)" } : undefined}>
          Due now
        </button>
        {upcomingHidden > 0 && (
          <button type="button" aria-pressed={showUpcoming} onClick={() => setShowUpcoming((v) => !v)} className={GHOST}>
            {showUpcoming ? "Hide" : "Show"} {upcomingHidden} upcoming recall{upcomingHidden === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card-svc">
          <EmptyState
            icon={<ListChecks size={19} strokeWidth={1.7} />}
            title={items.length === 0 ? "Nobody is waiting yet" : "Nothing matches these filters"}
            hint={items.length === 0 ? "Website inquiries and completed tunings land here by themselves. You can also add a client by hand." : "Clear a filter to see more."}
            action={items.length === 0 ? <PrimaryButton onClick={() => setInquiryOpen(true)}><Zap size={15} aria-hidden="true" /> Quick inquiry</PrimaryButton> : undefined}
          />
        </div>
      ) : (
        <div className="card-svc overflow-hidden">
          {groups.map((r) => {
            const rOpen = !collapsed.has(`r-${r.key}`);
            const rPlan = r.key === "unsorted" ? null : topCityOf(r.provinces.flatMap((p) => p.cities));
            return (
              <div key={r.key}>
                {r.key !== "unsorted" && <Header gKey={`r-${r.key}`} name={r.name} count={r.count} oldestDays={r.oldestDays} value={r.estValueCents} depth={0} planCity={rPlan} expanded={rOpen} />}
                {(rOpen || r.key === "unsorted") && r.provinces.map((p) => {
                  const pOpen = !collapsed.has(`p-${p.key}`);
                  return (
                    <div key={p.key}>
                      {r.key !== "unsorted" && <Header gKey={`p-${p.key}`} name={p.name} count={p.count} oldestDays={p.oldestDays} value={p.estValueCents} depth={1} planCity={topCityOf(p.cities)} expanded={pOpen} />}
                      {pOpen && p.cities.map((c) => {
                        const cOpen = !collapsed.has(`c-${c.key}`);
                        return (
                          <div key={c.key}>
                            <Header gKey={`c-${c.key}`} name={c.name} count={c.count} oldestDays={c.oldestDays} value={c.estValueCents} depth={r.key === "unsorted" ? 0 : 2} planCity={c.key === "unsorted" ? null : c.key} expanded={cOpen} />
                            {cOpen && (
                              <ul>
                                {(c.entries as (WaitRow & { item: WaitlistItem })[]).map((e) => <Row key={e.id} i={e.item} />)}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <QuickInquiryModal open={inquiryOpen} onClose={() => setInquiryOpen(false)} onConvert={(id) => { void convert.start(id); }} />
      {convert.modal}
      <WaitlistEntryModal
        open={!!modal} onClose={() => { setModal(null); setError(null); }} mode={modal?.mode ?? "new"} pending={pending} error={error}
        customers={customers} entry={modal?.entry} presetCity={modal?.preset} onSubmit={submit}
        onSubmitNewCustomer={async (customer, v) => {
          setError(null); setNotice(null);
          const res = await addWaitlistEntryWithNewCustomer(customer, {
            serviceType: v.serviceType, source: v.source, requestedAt: v.requestedAt, nextFollowUpAt: v.nextFollowUpAt,
            estValue: v.estValue, notes: v.notes, ...(v.useCustomerAddress ? {} : { cityCode: v.cityCode, barangayCode: v.barangayCode }),
          });
          if (!res.ok) return { ok: false, error: res.error, duplicateOf: res.duplicateOf };
          setNotice(addedNotice(res.data.customerName));
          return { ok: true };
        }}
        onDelete={modal?.mode === "edit" && modal.entry ? () => run(() => deleteWaitlistEntry(modal.entry!.id), () => setModal(null)) : undefined}
      />
    </div>
  );
}
