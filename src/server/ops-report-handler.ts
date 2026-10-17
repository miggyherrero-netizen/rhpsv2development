/**
 * POST /api/ops-assistant/report — the request logic, with its dependencies injected so the auth, CSRF, rate-limit and quota
 * boundaries can be tested without a database or network (tests/ops-handler.ts). The route file only wires the real ones.
 * Order matters: session → owner → same-origin → rate limit → quota reservation → (only then) load data → AI.
 */
import { isSameOrigin, type WindowLimiter } from "@/lib/backup-download";
import type { OpsSummary } from "@/lib/ops-summary";
import type { AiResult } from "@/server/ops-ai";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => json({ error }, status, extra);

export const LOADER_BUDGET_MS = 15_000;

const manilaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Daily AI cap on the Manila calendar day. `reserve()` is synchronous, so concurrent requests can never overspend it. */
export function createDailyQuota(max: number, now: () => Date = () => new Date()) {
  let day = "";
  let used = 0;
  const roll = () => { const today = manilaDay(now()); if (today !== day) { day = today; used = 0; } };
  return {
    /** A reservation remembers its Manila day: it can only be refunded into that same day's bucket, and only once. */
    reserve(): { day: string; refunded: boolean } | null { roll(); if (used >= max) return null; used += 1; return { day, refunded: false }; },
    refund(h: { day: string; refunded: boolean } | null): void {
      if (!h || h.refunded) return;
      h.refunded = true;
      roll();
      if (h.day === day) used = Math.max(0, used - 1);
    },
    used(): number { roll(); return used; },
  };
}
export type DailyQuota = ReturnType<typeof createDailyQuota>;

export type OpsReportDeps = {
  getUser: () => Promise<{ id: string; role?: string | null } | null>;
  loadSummary: (userId: string) => Promise<OpsSummary>;
  generate: (summary: OpsSummary) => Promise<AiResult>;
  aiEnabled: () => boolean;
  limiter: WindowLimiter;
  quota: DailyQuota;
  loaderBudgetMs?: number;
};

/** Stop WAITING after `ms`. (It cannot cancel a running database query; that residual risk is documented.) */
export const withBudget = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("budget")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export async function handleOpsReport(request: Request, deps: OpsReportDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return fail(401, "Please log in again.");
  if (user.role !== "owner") return fail(403, "Only the owner can use the assistant.");
  const h = request.headers;
  if (!isSameOrigin({ origin: h.get("origin"), secFetchSite: h.get("sec-fetch-site"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), contentType: h.get("content-type") })) {
    return fail(403, "This request did not come from the app.");
  }
  const rate = deps.limiter.hit(user.id);
  if (!rate.ok) return fail(429, `Too many requests. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).`, { "Retry-After": String(rate.retryAfterSec) });

  // Reserve the daily slot BEFORE any await so parallel requests cannot all pass the check.
  const reserved = deps.aiEnabled() ? deps.quota.reserve() : null;
  try {
    const summary = await withBudget(deps.loadSummary(user.id), deps.loaderBudgetMs ?? LOADER_BUDGET_MS);
    if (!deps.aiEnabled()) {
      return json({ summary, ai: { status: "disabled", message: "AI analysis is switched off. The verified summary is complete without it." } });
    }
    if (!reserved) return json({ summary, ai: { status: "error", message: "The daily AI limit was reached. The verified summary is still correct." } });
    const ai = await deps.generate(summary);
    if (ai.status === "disabled") deps.quota.refund(reserved);
    return json({ summary, ai });
  } catch (err) {
    deps.quota.refund(reserved);
    console.error("[ops-assistant] request failed:", (err as Error).message === "budget" ? "loader budget" : (err as Error).name);
    return fail(500, "The summary could not be loaded. Nothing was changed.");
  }
}
