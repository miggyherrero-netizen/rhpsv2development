/** Owner-only report endpoint: auth, CSRF, rate limit, daily quota, failure handling. Fake dependencies, no DB, no network. Run: npx tsx tests/ops-handler.ts */
import { createWindowLimiter } from "../src/lib/backup-download";
import { buildOpsSummary } from "../src/lib/ops-summary";
import { createDailyQuota, handleOpsReport, type OpsReportDeps } from "../src/server/ops-report-handler";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const summary = buildOpsSummary({
  now: new Date("2026-10-07T06:00:00Z"), jobsToday: [], unfinishedJobs: [], next7Count: 0, reminders: [], recalls: [], unpaid: [],
  draftInvoices: { count: 0, totalCents: 0 }, outstandingCents: 0, overdueCents: 0, tasks: [], projects: [],
});
const okReq = (over: Record<string, string> = {}) => new Request("http://localhost:3000/api/ops-assistant/report", {
  method: "POST", body: "{}",
  headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json", "sec-fetch-site": "same-origin", ...over },
});

type Spy = { loads: number; generates: number };
function deps(over: Partial<OpsReportDeps> = {}, spy: Spy = { loads: 0, generates: 0 }, max = 20): { d: OpsReportDeps; spy: Spy } {
  const d: OpsReportDeps = {
    getUser: async () => ({ id: "owner-1", role: "owner" }),
    loadSummary: async () => { spy.loads++; return summary; },
    generate: async () => { spy.generates++; return { status: "ok", report: { overview: "x", topThree: [], recommendedActions: [], missingInfo: [] }, model: "m" }; },
    aiEnabled: () => true,
    limiter: createWindowLimiter(6, 600_000),
    quota: createDailyQuota(max),
    ...over,
  };
  return { d, spy };
}
const status = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, unknown> });

(async () => {
  console.log("authentication and authorization (nothing is loaded or sent before these pass)");
  { const { d, spy } = deps({ getUser: async () => null }); const r = await status(await handleOpsReport(okReq(), d));
    check("logged out → 401, no data loaded, no AI call", [r.status, spy.loads, spy.generates], [401, 0, 0]); }
  { const { d, spy } = deps({ getUser: async () => ({ id: "u2", role: "staff" }) }); const r = await status(await handleOpsReport(okReq(), d));
    check("non-owner → 403, no data loaded, no AI call", [r.status, spy.loads, spy.generates], [403, 0, 0]); }
  { const { d, spy } = deps({ getUser: async () => ({ id: "u3", role: null }) }); const r = await status(await handleOpsReport(okReq(), d));
    check("user with no role → 403", [r.status, spy.loads], [403, 0]); }

  console.log("\nsame-origin (CSRF)");
  for (const [name, headers] of [
    ["foreign Origin", { origin: "https://evil.example" }],
    ["missing Origin", { origin: "" }],
    ["cross-site Fetch Metadata", { "sec-fetch-site": "cross-site" }],
    ["form content type", { "content-type": "application/x-www-form-urlencoded" }],
  ] as [string, Record<string, string>][]) {
    const { d, spy } = deps(); const req = okReq(headers); if (!headers.origin && "origin" in headers) req.headers.delete("origin");
    const r = await status(await handleOpsReport(req, d));
    check(`${name} → 403, no data loaded`, [r.status, spy.loads, spy.generates], [403, 0, 0]);
  }

  console.log("\nrate limit");
  { const { d, spy } = deps({ limiter: createWindowLimiter(2, 600_000) }); const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await handleOpsReport(okReq(), d)).status);
    check("third request in the window → 429 and does not load data", [codes, spy.loads], [[200, 200, 429], 2]); }

  console.log("\ndaily quota");
  { const { d, spy } = deps({}, { loads: 0, generates: 0 }, 1);
    d.limiter = createWindowLimiter(50, 600_000);
    const res = await Promise.all(Array.from({ length: 6 }, () => handleOpsReport(okReq(), d).then(status)));
    check("six simultaneous requests with a limit of 1 reach the provider once", spy.generates, 1);
    check("the others still get the verified summary with a clear message", res.filter((r) => (r.body.ai as { status: string }).status === "error").length, 5); }
  { const { d, spy } = deps({ aiEnabled: () => false }); const r = await status(await handleOpsReport(okReq(), d));
    check("AI off: summary returned, provider never called, quota untouched", [r.status, (r.body.ai as { status: string }).status, spy.generates, d.quota.used()], [200, "disabled", 0, 0]); }
  { const { d } = deps({ generate: async () => ({ status: "disabled", message: "x" }) }); await handleOpsReport(okReq(), d);
    check("a disabled provider result refunds the reserved slot", d.quota.used(), 0); }
  { let t = new Date("2026-10-07T15:59:59.999Z"); const q = createDailyQuota(1, () => t);
    const h1 = q.reserve();
    check("first use ok", h1 !== null, true);
    check("same Manila day: exhausted", q.reserve(), null);
    t = new Date("2026-10-07T16:00:00.000Z");
    const h2 = q.reserve();
    check("Manila midnight (16:00Z) resets the quota (UTC midnight would not)", h2 !== null, true);
    q.refund(h1); // a late refund from the OLD day must not free a slot in the new day
    check("a refund from the previous day does not free a new-day slot", q.reserve(), null);
    q.refund(h2); q.refund(h2);
    check("a refund is applied once, to its own day", q.used(), 0);
    t = new Date("2026-10-08T00:00:00.000Z");
    check("UTC midnight alone does not reset the Manila-day count", [q.reserve() !== null, q.reserve()], [true, null]); }

  console.log("\nfailures stay soft");
  { const { d } = deps({ generate: async () => ({ status: "error", message: "The AI service could not be reached." }) });
    const r = await status(await handleOpsReport(okReq(), d));
    check("provider failure → 200 with the verified summary and an error note", [r.status, !!r.body.summary, (r.body.ai as { status: string }).status], [200, true, "error"]); }
  { const { d, spy } = deps({ loadSummary: async () => { throw new Error("db down"); } });
    const r = await status(await handleOpsReport(okReq(), d));
    check("data failure → 500 with a plain message, slot refunded, no AI call", [r.status, spy.generates, d.quota.used()], [500, 0, 0]); }
  { const { d, spy } = deps({ loaderBudgetMs: 30, loadSummary: () => new Promise(() => {}) });
    const r = await status(await handleOpsReport(okReq(), d));
    check("a hung data read hits the time budget → 500, no AI call", [r.status, spy.generates], [500, 0]); }
  { const { d } = deps(); const r = await status(await handleOpsReport(okReq(), d));
    check("responses are never cached", [r.status], [200]);
    const res = await handleOpsReport(okReq(), d); check("Cache-Control: no-store", res.headers.get("cache-control"), "no-store"); }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nall ops-handler checks passed");
})();
