import { startOfManilaDayUTC } from "@/lib/dates";

/** Pure helpers for the admin dashboard — wording, counters and the "Needs attention" list. No DB. */

/** Dialable `tel:` href from a free-text phone, or null when there is nothing dialable (e.g. "n/a"). */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/(?!^\+)[^\d]/g, "");
  return digits.replace("+", "").length >= 5 ? `tel:${digits}` : null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MISSING = new Set(["", "n/a", "na", "-", "—", "none", "unknown", "null"]);
export const isMissing = (v: string | null | undefined) => MISSING.has((v ?? "").trim().toLowerCase());

/** "Elma piano" when the model is missing, otherwise "Yamaha U1". */
export function pianoLabel(brand: string | null | undefined, model: string | null | undefined): string {
  const b = isMissing(brand) ? "" : brand!.trim();
  const m = isMissing(model) ? "" : model!.trim();
  const label = [b, m].filter(Boolean).join(" ");
  if (!label) return "Piano";
  return m ? label : `${label} piano`;
}

/** Tasks nobody has claimed yet (status "available"). Backlog / claimed / in progress are counted elsewhere. */
export const unclaimedCount = (tasks: { status: string }[]) => tasks.filter((t) => t.status === "available").length;

export type AttentionRow = {
  key: "clients" | "stock" | "overdue" | "parts" | "inquiries";
  count: number;
  title: string;
  /** Short lines naming exactly what needs action (max `limit`). */
  items: { id: string; label: string; detail?: string; href?: string; actionLabel?: string }[];
  more: number;
  href: string;
  actionLabel: string;
};

type Stale = { id: string; clientName: string; pianoBrand: string; pianoModel: string; lastClientUpdateAt: Date | null };
type Stock = { id: string; name: string; qtyOnHand: number; reorderPoint: number };
type TaskLite = { id: string; title: string; pianoName?: string | null; claimedName?: string | null; dueDate?: Date | string | null };

const firstName = (n?: string | null) => (n ? n.split(" ")[0] : null);
const lateLabel = (due: Date | string | null | undefined, nowMs: number) => {
  if (!due) return null;
  // Whole Manila calendar days, not 24h blocks — a task due last night is "1d late" the next morning.
  const days = Math.round((startOfManilaDayUTC(new Date(nowMs)).getTime() - startOfManilaDayUTC(new Date(due)).getTime()) / 86_400_000);
  return days < 1 ? "due today" : `${days}d late`;
};
type Inquiry = { id: string; name: string; phone: string | null; pianoContext: string | null };

export type AttentionInput = {
  staleClients: Stale[];
  lowStock: Stock[];
  overdue: TaskLite[];
  waitingParts: TaskLite[];
  inquiries: Inquiry[];
};

export function buildAttention(d: AttentionInput, nowMs: number, limit = 3): AttentionRow[] {
  const take = <T,>(xs: T[]) => ({ list: xs.slice(0, limit), more: Math.max(0, xs.length - limit) });
  const rows: AttentionRow[] = [];

  if (d.staleClients.length) {
    const { list, more } = take(d.staleClients);
    rows.push({
      key: "clients", count: d.staleClients.length, title: "Clients awaiting an update", more,
      // One client -> open the update form for exactly that project; several -> the curator.
      href: d.staleClients.length === 1 ? `/admin/curator?new=1&project=${d.staleClients[0].id}` : "/admin/curator", actionLabel: "Post update",
      items: list.map((p) => {
        const days = p.lastClientUpdateAt ? Math.floor((nowMs - new Date(p.lastClientUpdateAt).getTime()) / 86_400_000) : null;
        return {
          id: p.id, label: p.clientName,
          detail: `${days === null ? "No updates yet" : `${days}d since last update`} · ${pianoLabel(p.pianoBrand, p.pianoModel)}`,
          href: `/admin/curator?new=1&project=${p.id}`, actionLabel: "Post update",
        };
      }),
    });
  }
  if (d.lowStock.length) {
    const { list, more } = take(d.lowStock);
    rows.push({
      key: "stock", count: d.lowStock.length, title: "Low stock", more,
      href: "/admin/inventory?low=1", actionLabel: "View stock",
      items: list.map((i) => ({ id: i.id, label: i.name, detail: `${i.qtyOnHand} left · reorder at ${i.reorderPoint}` })),
    });
  }
  if (d.overdue.length) {
    const { list, more } = take(d.overdue);
    rows.push({
      key: "overdue", count: d.overdue.length, title: "Overdue tasks", more,
      href: "/admin/tasks?status=overdue", actionLabel: "View tasks",
      items: list.map((t) => ({ id: t.id, label: t.title, detail: [lateLabel(t.dueDate, nowMs), t.pianoName].filter(Boolean).join(" · ") || undefined, href: `/admin/tasks?sel=${t.id}`, actionLabel: "Open" })),
    });
  }
  if (d.waitingParts.length) {
    const { list, more } = take(d.waitingParts);
    rows.push({
      key: "parts", count: d.waitingParts.length, title: "Waiting on parts", more,
      href: "/admin/tasks?status=parts", actionLabel: "View tasks",
      items: list.map((t) => ({ id: t.id, label: t.title, detail: [t.pianoName ?? "Shop", firstName(t.claimedName)].filter(Boolean).join(" · "), href: `/admin/tasks?sel=${t.id}`, actionLabel: "Open" })),
    });
  }
  if (d.inquiries.length) {
    const { list, more } = take(d.inquiries);
    rows.push({
      key: "inquiries", count: d.inquiries.length, title: d.inquiries.length === 1 ? "New website inquiry" : "New website inquiries", more,
      href: "#inquiries", actionLabel: "Review",
      items: list.map((q) => ({
        id: q.id, label: q.name, detail: q.pianoContext ?? undefined,
        href: telHref(q.phone) ?? "#inquiries", actionLabel: telHref(q.phone) ? "Call" : "Open",
      })),
    });
  }
  return rows;
}

/** Task / project / inventory filters carried in the URL by dashboard links. */
export type TaskUrlFilter = "available" | "overdue" | "parts" | null;
export function matchesTaskFilter(
  t: { status: string; dueDate: Date | string | null; waitingParts: boolean },
  f: Exclude<TaskUrlFilter, null>,
  nowMs: number,
): boolean {
  if (f === "available") return t.status === "available";
  if (t.status === "done") return false;
  if (f === "parts") return t.waitingParts;
  return !!t.dueDate && new Date(t.dueDate).getTime() < nowMs;
}
export const parseTaskFilter = (v: string | null | undefined): TaskUrlFilter =>
  v === "available" || v === "overdue" || v === "parts" ? v : null;
