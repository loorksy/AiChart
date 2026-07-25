/**
 * Model-generated ticker plan. Every run gets its OWN ticker lines, produced by
 * the LLM from the actual request context (message, symbol, interval, intents,
 * provider availability). There is deliberately NO static fallback array: if
 * generation fails the caller hides the ticker completely — fake scripted
 * progress is worse than no ticker.
 */
import { z } from "zod";
import { callLLM, isLLMConfigured } from "@/lib/llm";
import { newId } from "../activity";
import { sanitizeTickerText } from "./sanitizeTicker";
import type { AgentTickerItem, AgentTickerStage } from "./types";

const STAGES = [
  "thinking",
  "understanding",
  "market_context",
  "candles",
  "structure",
  "liquidity",
  "entries",
  "news",
  "risk",
  "drawing",
  "synthesizing",
  "finalizing",
] as const;

const TickerPlanSchema = z.object({
  items: z
    .array(
      z.object({
        stage: z.enum(STAGES),
        text: z.string().min(2).max(70),
        requiresEvidence: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(10),
});

const TICKER_SYSTEM_PROMPT = `You generate short public UI status ticker lines for a chart-connected trading agent.

Rules:
- Do not reveal chain-of-thought. Do not explain reasoning. Do not include scratchpad.
- Do not invent tool results.
- Do not claim news was checked unless a news provider is configured.
- Do not claim a market direction or a completed finding — before tools finish, use cautious in-progress language (e.g. "أفحص إن كان الهبوط مدعوماً بالسياق", never "تأكدت أن السعر سيهبط").
- Each line must be short (under 70 characters), natural Arabic, present-tense, suitable for a one-line animated UI ticker.
- The lines must feel alive and contextual to THIS request, not scripted.
- Use the user's symbol and timeframe when available.
- If the request is general (no market tools), keep lines about understanding and composing the answer only.
- If no news provider is configured, do NOT produce a news line.

Respond with ONLY a JSON object, no markdown fences, matching:
{"items":[{"stage":"<one of: ${STAGES.join(", ")}>","text":"<short Arabic line>","requiresEvidence":false}]}
2 to 10 items, ordered as the run progresses.`;

export interface GenerateTickerPlanInput {
  userMessage: string;
  symbol?: string;
  interval?: string;
  intent: string[];
  hasChartContext: boolean;
  newsProviderConfigured: boolean;
  canUseMarketTools: boolean;
  canUseNewsTools: boolean;
}

export interface GenerateTickerPlanDeps {
  /** Injectable model call (tests). Returns the raw model text. */
  callModel?: (system: string, user: string) => Promise<string>;
  configured?: boolean;
}

/**
 * Parse + validate a raw model response into sanitized ticker items.
 * Throws when the response does not match the schema — the caller must then
 * hide the ticker (never substitute static text).
 */
export function parseTickerPlan(raw: string): AgentTickerItem[] {
  const jsonText = extractJson(raw);
  const parsed = TickerPlanSchema.parse(JSON.parse(jsonText));
  const items = parsed.items
    .map((item) => ({
      id: newId(),
      stage: item.stage as AgentTickerStage,
      text: sanitizeTickerText(item.text),
      requiresEvidence: item.requiresEvidence,
    }))
    .filter((item) => item.text.length >= 2);
  if (items.length < 2) {
    throw new Error("ticker_plan_too_short_after_sanitize");
  }
  return items;
}

export async function generateTickerPlan(
  input: GenerateTickerPlanInput,
  deps: GenerateTickerPlanDeps = {},
): Promise<AgentTickerItem[]> {
  const configured = deps.configured ?? isLLMConfigured();
  if (!configured) throw new Error("llm_not_configured");

  const user = JSON.stringify({
    userMessage: input.userMessage.slice(0, 500),
    symbol: input.symbol ?? null,
    interval: input.interval ?? null,
    intent: input.intent,
    hasChartContext: input.hasChartContext,
    newsProviderConfigured: input.newsProviderConfigured,
    canUseMarketTools: input.canUseMarketTools,
    canUseNewsTools: input.canUseNewsTools,
  });

  const callModel =
    deps.callModel ??
    (async (system: string, userMsg: string) => {
      const res = await callLLM({
        system,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 400,
      }, { tier: "quick" });
      return res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    });

  const raw = await callModel(TICKER_SYSTEM_PROMPT, user);
  return parseTickerPlan(raw);
}

/** Strip markdown fences / prose around the JSON object, if any. */
function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
