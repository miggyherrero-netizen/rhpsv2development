import { getUser } from "@/lib/auth";
import { createWindowLimiter, type WindowLimiter } from "@/lib/backup-download";
import { getOpsSummary } from "@/server/ops-summary-data";
import { aiConfigured, generateAiReport } from "@/server/ops-ai";
import { createDailyQuota, handleOpsReport, type DailyQuota } from "@/server/ops-report-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 6 requests per 10 minutes per owner plus a daily cap (OPS_AI_DAILY_LIMIT, default 20) on the Manila calendar day.
// In memory, per server instance (a restart or a second instance resets/multiplies them; the provider spending limit is the hard cap).
const g = globalThis as unknown as { __opsAiLimiter?: WindowLimiter; __opsAiQuota?: DailyQuota };
const limiter = (g.__opsAiLimiter ??= createWindowLimiter(6, 10 * 60_000));
const quota = (g.__opsAiQuota ??= createDailyQuota(Math.max(1, Number.parseInt(process.env.OPS_AI_DAILY_LIMIT ?? "20", 10) || 20)));

export async function POST(request: Request) {
  return handleOpsReport(request, { getUser, loadSummary: getOpsSummary, generate: generateAiReport, aiEnabled: aiConfigured, limiter, quota });
}
