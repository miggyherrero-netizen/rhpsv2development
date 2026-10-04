const HINTS: Record<string, string> = {
  "42P01": "a table is missing (run gos-tables.sql)",
  "42501": "permission denied (check RLS / database user)",
  "28P01": "wrong database password",
  "3D000": "database not found",
  "ECONNREFUSED": "cannot reach the database",
  "ENOTFOUND": "database host not found",
};

/** Short, safe text for the screen: a code or error name, never the message (it may hold secrets). */
export function describeError(err: unknown): string {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code) {
      return `Database code ${code}${HINTS[code] ? `: ${HINTS[code]}` : ""}`;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  if (err instanceof Error && err.name) return err.name;
  return "Unknown error";
}
