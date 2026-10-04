import type { PublicPiano } from "@/server/data";

/** Prices are stored in centavos. */
const PESO = 100;
export const PRICE_LOW = 60_000 * PESO;
export const PRICE_HIGH = 120_000 * PESO;

export type ShowroomGroup = {
  key: string;
  /** First unit in the group by sort order, preferring an available one — drives the card + dialog. */
  lead: PublicPiano;
  units: PublicPiano[];
  availableCount: number;
  reservedCount: number;
  /** Shown only when every unit agrees; otherwise null (we never guess). */
  year: number | null;
  condition: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Identical = same brand, model, type and price. Year/condition may differ and are then hidden on the card. */
export function groupPianos(pianos: PublicPiano[]): ShowroomGroup[] {
  const map = new Map<string, PublicPiano[]>();
  for (const p of pianos) {
    const key = [norm(p.brand), norm(p.model), norm(p.type), p.priceCents ?? "none"].join("|");
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  const groups: ShowroomGroup[] = [];
  for (const [key, units] of map) {
    const availableCount = units.filter((u) => u.status === "available").length;
    const lead = units.find((u) => u.status === "available") ?? units[0];
    const years = new Set(units.map((u) => u.year ?? null));
    const conditions = new Set(units.map((u) => norm(u.condition)));
    groups.push({
      key,
      lead,
      units,
      availableCount,
      reservedCount: units.filter((u) => u.status === "reserved").length,
      year: years.size === 1 ? [...years][0] : null,
      condition: conditions.size === 1 ? lead.condition : null,
    });
  }
  return groups.sort((a, b) => a.lead.sortOrder - b.lead.sortOrder);
}

/** Homepage picks: available models first, then by the owner's own sort order. */
export function featuredGroups(groups: ShowroomGroup[], count: number): ShowroomGroup[] {
  const live = groups.filter((g) => g.availableCount > 0);
  const rest = groups.filter((g) => g.availableCount === 0);
  return [...live, ...rest].slice(0, count);
}

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "upright", label: "Upright" },
  { id: "grand", label: "Grand" },
  { id: "under60", label: "Under ₱60k" },
  { id: "mid", label: "₱60k–₱120k" },
  { id: "over120", label: "₱120k+" },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];

export function matchesFilter(g: ShowroomGroup, f: FilterId): boolean {
  const type = norm(g.lead.type);
  const price = g.lead.priceCents;
  switch (f) {
    case "all": return true;
    case "upright": return type.includes("upright") || type.includes("console");
    case "grand": return type.includes("grand");
    // "On request" pianos have no price, so they only appear under All / type chips.
    case "under60": return price != null && price < PRICE_LOW;
    case "mid": return price != null && price >= PRICE_LOW && price <= PRICE_HIGH;
    case "over120": return price != null && price > PRICE_HIGH;
  }
}

/** Descriptive alt text built only from stored fields — no invented finish/colour. */
export function pianoAlt(p: Pick<PublicPiano, "brand" | "model" | "year" | "type" | "condition">): string {
  const base = `${p.brand} ${p.model}`;
  const kind = p.type ? `${p.type.toLowerCase()} piano` : "piano";
  const parts = [`${base} ${kind}`];
  if (p.year) parts.push(`${p.year}`);
  if (p.condition) parts.push(`${p.condition.toLowerCase()} condition`);
  return parts.join(", ");
}
