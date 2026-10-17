/**
 * AI Operations Assistant — provider call. OFF by default: nothing leaves the app unless the owner sets
 * OPS_AI_ENABLED=true AND ANTHROPIC_API_KEY (see docs/AI_OPERATIONS_ASSISTANT.md). The key is read from the environment
 * only, never logged, never sent to the browser. The model has no tools: it can only return text, which is validated.
 */
import { buildUserMessage, minimizeForAi, restoreNames, SYSTEM_PROMPT, validateAiReport, type AiReport } from "@/lib/ops-ai";
import type { OpsSummary } from "@/lib/ops-summary";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 1200;

export type AiResult =
  | { status: "disabled"; message: string }
  | { status: "ok"; report: AiReport; model: string }
  | { status: "error"; message: string };

export const aiConfigured = () => process.env.OPS_AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;

export async function generateAiReport(summary: OpsSummary, fetchImpl: typeof fetch = fetch): Promise<AiResult> {
  if (!aiConfigured()) return { status: "disabled", message: "AI analysis is switched off. The verified summary below is complete without it." };
  const model = process.env.OPS_AI_MODEL || "claude-haiku-5-5";
  const { payload, aliases } = minimizeForAi(summary);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60_000, Math.max(10, Number(process.env.OPS_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)));
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: "user", content: buildUserMessage(payload) }] }),
    });
    if (!res.ok) {
      console.error("[ops-ai] provider status", res.status); // status only: never the body or the payload
      return { status: "error", message: "The AI service did not answer. The verified summary is still correct." };
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
    const checked = validateAiReport(text, payload);
    if (!checked.ok) {
      console.error("[ops-ai] reply rejected:", checked.reason);
      return { status: "error", message: "The AI reply did not pass the safety checks, so it was discarded." };
    }
    return { status: "ok", report: restoreNames(checked.report, aliases), model };
  } catch (err) {
    console.error("[ops-ai] failed:", (err as Error).name);
    return { status: "error", message: "The AI service could not be reached. The verified summary is still correct." };
  } finally {
    clearTimeout(timer);
  }
}
