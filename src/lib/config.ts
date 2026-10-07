export const PROJECT_STAGES = [
  { key: "intake", label: "Intake" },
  { key: "disassembly", label: "Disassembly" },
  { key: "restoration", label: "Restoration" },
  { key: "finishing", label: "Finishing" },
  { key: "quality", label: "Quality Control" },
  { key: "delivery", label: "Delivery" },
] as const;

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STAGES.map((s) => [s.key, s.label]),
);

export const TASK_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "available", label: "Available" },
  { key: "claimed", label: "Claimed" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
] as const;

export const TASK_LABEL: Record<string, string> = Object.fromEntries(
  TASK_COLUMNS.map((s) => [s.key, s.label]),
);

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  low: { label: "Low", dot: "bg-slate-400", text: "text-slate-400" },
  normal: { label: "Normal", dot: "bg-sky-400", text: "text-sky-300" },
  high: { label: "High", dot: "bg-amber-400", text: "text-amber-300" },
  urgent: { label: "Urgent", dot: "bg-rose-500", text: "text-rose-400" },
};

export const PRIORITY_STYLE_LIGHT: Record<string, { label: string; dot: string; text: string }> = {
  low: { label: "Low", dot: "bg-slate-400", text: "text-slate-500" },
  normal: { label: "Normal", dot: "bg-sky-500", text: "text-sky-700" },
  high: { label: "High", dot: "bg-amber-500", text: "text-amber-700" },
  urgent: { label: "Urgent", dot: "bg-rose-500", text: "text-rose-600" },
};

export const PIANO_STATUS: Record<string, { label: string; cls: string }> = {
  available: { label: "Available", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  reserved: { label: "Reserved", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  sold: { label: "Sold", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const OWNER_EVENT_KINDS = [
  { key: "event", label: "Appointment" },
  { key: "focus", label: "Focus Block" },
  { key: "reminder", label: "Reminder" },
] as const;

export const REMINDER_OPTIONS = [
  { value: 0, label: "At start" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

/** My Desk category palette — every hue reads on the dark navy surfaces and tints calendar blocks. */
export const CATEGORY_COLORS = [
  "#94a3b8", "#7cb0ff", "#2dd4bf", "#34d399", "#22d3ee",
  "#a78bfa", "#f0abfc", "#fb7185", "#fbbf24", "#60a5fa",
];

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
