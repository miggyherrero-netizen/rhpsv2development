/**
 * Finance history — pure helpers (no database). `diffFields` finds what changed between two versions of a
 * money record; `describeChange` turns it into the one plain-English line shown in the History views.
 * Money is always whole centavos; dates are stored as ISO strings so they survive jsonb.
 */

export type FinanceEntityType = "invoice" | "invoice_item" | "payment" | "expense";
export type FinanceAction = "create" | "update" | "delete" | "status";
export type FieldChange = { from: unknown; to: unknown };
export type FinanceChanges = Record<string, FieldChange>;

/** Normalises a value so equal things compare equal: Date -> ISO, ""/undefined -> null. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (v === undefined || v === "") return null;
  return v;
}

/** Returns only the listed fields whose value differs, as { field: { from, to } }. */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: readonly (keyof T & string)[],
): FinanceChanges {
  const out: FinanceChanges = {};
  for (const f of fields) {
    const from = norm(before?.[f]);
    const to = norm(after?.[f]);
    if (from !== to) out[f] = { from, to };
  }
  return out;
}

/**
 * Drops date fields whose Manila calendar day did not change (a form that re-sends the same day with a
 * different time of day is not a real edit).
 */
export function dropSameDay(changes: FinanceChanges, keys: readonly string[]): FinanceChanges {
  const out: FinanceChanges = { ...changes };
  for (const k of keys) {
    const c = out[k];
    if (c && typeof c.from === "string" && typeof c.to === "string" && manilaDay(c.from) === manilaDay(c.to)) delete out[k];
  }
  return out;
}

const ENTITY_WORD: Record<FinanceEntityType, string> = {
  invoice: "Invoice", invoice_item: "Invoice line", payment: "Payment", expense: "Expense",
};

const FIELD_LABEL: Record<string, string> = {
  discountCents: "discount", taxRateBps: "tax rate", dueDate: "due date", issueDate: "issue date",
  customerId: "customer", notes: "notes", terms: "terms", status: "status",
  description: "description", qty: "quantity", unitPriceCents: "unit price", taxable: "taxable",
  amountCents: "amount", method: "method", receivedAt: "date received", reference: "reference",
  category: "category", kind: "type", vendor: "vendor", spentAt: "date spent", jobId: "job",
  pianoId: "piano", reimbursable: "reimbursable", note: "note", receiptReplaced: "receipt photo",
  totalCents: "invoice total", subtotalCents: "subtotal", taxCents: "tax", amountPaidCents: "paid so far",
  itemCount: "line items", paymentCount: "payments", details: "details",
};

export const fieldLabel = (f: string): string => FIELD_LABEL[f] ?? f;

/** "P1,234.50" — centavos to pesos with two decimals (history wants exact cents, unlike the dashboards). */
export function pesoExact(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}P${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
/** Calendar date in Manila (UTC+8) for an ISO instant, e.g. "2026-10-07". */
function manilaDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** Human text for one stored value of `field`. */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (field === "taxRateBps" && typeof value === "number") return `${+(value / 100).toFixed(2)}%`;
  if (field.endsWith("Cents") && typeof value === "number") return pesoExact(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && ISO_RE.test(value)) return manilaDay(value);
  return String(value);
}

/** One plain-English line. `label` names the record, e.g. "INV-2026-0018" or "\"Tuning\"". */
export function describeChange(
  entityType: FinanceEntityType,
  action: FinanceAction,
  label: string,
  changes?: FinanceChanges | null,
): string {
  const subject = `${ENTITY_WORD[entityType]} ${label}`;
  if (action === "create") return `${subject} ${entityType === "payment" ? "recorded" : "created"}`;
  if (action === "delete") return `${subject} deleted`;
  const keys = Object.keys(changes ?? {});
  if (!keys.length) return `${subject} saved with no changes`;
  const part = (k: string) => {
    const c = changes![k]!;
    if (k === "receiptReplaced") return "receipt photo replaced";
    return `${fieldLabel(k)} changed from ${formatValue(k, c.from)} to ${formatValue(k, c.to)}`;
  };
  const shown = keys.slice(0, 3).map(part);
  const rest = keys.length - shown.length;
  const [first, ...others] = shown;
  return `${subject} ${[first, ...others].join("; ")}${rest > 0 ? `; and ${rest} more` : ""}`;
}
