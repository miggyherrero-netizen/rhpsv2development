"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Plus, Minus, PackageX, Trash2, Boxes, Banknote } from "lucide-react";
import type { InventoryItem } from "@/db/schema";
import { peso, timeAgo } from "@/lib/format";
import { Modal, Field, Spinner, EmptyState } from "@/components/ui";
import { createInventoryItem, updateInventoryItem, deleteInventoryItem, adjustInventoryQty, type InventoryInput } from "@/server/admin";

const BLANK: InventoryInput = { name: "", category: "Strings", qtyOnHand: 0, unitCostCents: 0, reorderPoint: 0 };

export default function InventoryClient({ items }: { items: InventoryItem[] }) {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [onlyLow, setOnlyLow] = useState(() => sp.get("low") === "1");
  const [modal, setModal] = useState<null | { id?: string; data: InventoryInput & { price?: string } }>(() => (sp.get("new") === "1" ? { data: BLANK } : null));
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const filtered = items.filter((i) => {
    if (cat !== "all" && i.category !== cat) return false;
    if (onlyLow && i.qtyOnHand > i.reorderPoint) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [i.name, i.sku, i.supplier, i.location].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
  const totalValue = items.reduce((s, i) => s + i.qtyOnHand * i.unitCostCents, 0);
  const lowCount = items.filter((i) => i.qtyOnHand <= i.reorderPoint).length;

  async function save() {
    if (!modal) return;
    setBusy(true);
    const { price, ...data } = modal.data;
    const payload = { ...data, unitCostCents: Math.round(Number(price ?? "0") * 100) || data.unitCostCents };
    if (modal.id) await updateInventoryItem(modal.id, payload);
    else await createInventoryItem(payload);
    setBusy(false);
    setModal(null);
  }

  const inp = "input-dark";

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Inventory</h1>
          <p className="text-mist text-[12.5px] mt-1">Parts, materials, and what they cost the shop.</p>
        </div>
        <button onClick={() => setModal({ data: BLANK })}
          className="flex items-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl px-4 py-2.5 hover:brightness-110 transition">
          <Plus size={15} /> Add Item
        </button>
      </div>

      {/* stats */}
      <div className="grid grid-cols-3 gap-3 mb-5 max-w-xl">
        {[
          { icon: Boxes, label: "SKUs tracked", value: String(items.length) },
          { icon: Banknote, label: "Stock value", value: peso(totalValue) },
          { icon: PackageX, label: "Need reorder", value: String(lowCount), warn: lowCount > 0 },
        ].map((s) => (
          <div key={s.label} className={`card-dark p-3.5 ${s.warn ? "border-amber-400/20" : ""}`}>
            <s.icon size={15} className={s.warn ? "text-amber-300" : "text-mist"} />
            <p className={`tnum text-lg font-medium mt-2 ${s.warn ? "text-amber-300" : "text-white"}`}>{s.value}</p>
            <p className="text-xs uppercase tracking-[0.16em] text-mist mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, SKU, supplier, shelf…" className="input-dark pl-9" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="input-dark w-auto">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={() => setOnlyLow(!onlyLow)}
          className={`text-[12px] rounded-xl px-3.5 py-2.5 border transition ${onlyLow ? "bg-amber-400/15 text-amber-300 border-amber-400/30" : "text-mist border-white/10 hover:text-white"}`}>
          Reorder only
        </button>
      </div>

      {filtered.length === 0 ? <EmptyState title="No items found" body="Add stock or relax the filters." /> : (
        <div className="card-dark overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px] min-w-[920px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-mist border-b border-white/[0.07]">
                {["Item", "Category", "SKU", "Supplier", "On hand", "Unit cost", "Value", "Reorder at", "Location", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const low = i.qtyOnHand <= i.reorderPoint;
                return (
                  <tr key={i.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-white max-w-[260px]">
                      {i.name}
                      {i.notes && <span className="block text-xs text-mist mt-0.5">{i.notes}</span>}
                    </td>
                    <td className="px-4 py-3"><span className="bg-white/[0.07] border border-white/10 rounded-full px-2.5 py-1 text-xs">{i.category}</span></td>
                    <td className="px-4 py-3 text-mist tnum">{i.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-mist">{i.supplier ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => adjustInventoryQty(i.id, -1)} className="p-1 rounded-md bg-white/[0.06] hover:bg-white/[0.14] text-mist transition" aria-label="Remove one"><Minus size={12} /></button>
                        <span className={`tnum w-10 text-center font-medium ${low ? "text-amber-300" : "text-white"}`}>{i.qtyOnHand}</span>
                        <button onClick={() => adjustInventoryQty(i.id, 1)} className="p-1 rounded-md bg-white/[0.06] hover:bg-white/[0.14] text-mist transition" aria-label="Add one"><Plus size={12} /></button>
                      </div>
                      {low && <span className="text-xs uppercase tracking-wide text-amber-300/90">reorder</span>}
                    </td>
                    <td className="px-4 py-3 text-mist tnum">{peso(i.unitCostCents)}</td>
                    <td className="px-4 py-3 text-chrome tnum">{peso(i.qtyOnHand * i.unitCostCents)}</td>
                    <td className="px-4 py-3 text-mist tnum">{i.reorderPoint}</td>
                    <td className="px-4 py-3 text-mist">{i.location ?? "—"}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setModal({ id: i.id, data: { ...i, price: (i.unitCostCents / 100).toString() } as InventoryInput & { price: string } })}
                        className="text-xs text-chrome hover:text-white underline underline-offset-4 decoration-white/20 transition">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Edit inventory item" : "Add inventory item"} wide>
        {modal && (
          <div className="grid sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2"><Field label="Item name"><input className={inp} value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></Field></div>
            <Field label="Category">
              <input className={inp} list="inv-cats" value={modal.data.category} onChange={(e) => setModal({ ...modal, data: { ...modal.data, category: e.target.value } })} />
              <datalist id="inv-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="SKU"><input className={inp} value={modal.data.sku ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, sku: e.target.value } })} /></Field>
            <Field label="Supplier reference"><input className={inp} value={modal.data.supplier ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, supplier: e.target.value } })} /></Field>
            <Field label="Quantity on hand"><input className={inp} type="number" value={modal.data.qtyOnHand ?? 0} onChange={(e) => setModal({ ...modal, data: { ...modal.data, qtyOnHand: Number(e.target.value) } })} /></Field>
            <Field label="Unit cost (₱)"><input className={inp} type="number" step="0.01" value={modal.data.price ?? (modal.data.unitCostCents ?? 0) / 100} onChange={(e) => setModal({ ...modal, data: { ...modal.data, price: e.target.value } })} /></Field>
            <Field label="Reorder point"><input className={inp} type="number" value={modal.data.reorderPoint ?? 0} onChange={(e) => setModal({ ...modal, data: { ...modal.data, reorderPoint: Number(e.target.value) } })} /></Field>
            <Field label="Shelf / bin / location"><input className={inp} placeholder="Aisle B · Bin 12" value={modal.data.location ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, location: e.target.value } })} /></Field>
            <Field label="Notes"><input className={inp} value={modal.data.notes ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field>
            <div className="sm:col-span-2 flex gap-2 mt-1">
              <button onClick={save} disabled={busy || !modal.data.name.trim()}
                className="flex-1 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Spinner className="text-black" />} {modal.id ? "Save changes" : "Add item"}
              </button>
              {modal.id && (
                <button onClick={async () => { if (confirm("Delete this item?")) { setBusy(true); await deleteInventoryItem(modal.id!); setBusy(false); setModal(null); } }}
                  className="px-4 rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 transition"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
