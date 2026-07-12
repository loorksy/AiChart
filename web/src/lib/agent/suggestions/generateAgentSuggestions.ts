/**
 * Model-generated follow-up suggestions, produced per response from the actual
 * turn state (decision, active recommendation status, drawings, sync/action
 * required, locale). There is NO static fallback: if the LLM is not configured
 * or generation fails, this returns [] and the UI shows no suggestions.
 */
import { callLLM, isLLMConfigured } from "@/lib/llm";
import type { AgentFinalResult } from "../types";
import type { AppLocale } from "@/lib/i18n";
import { sanitizeAgentSuggestions } from "./sanitizeAgentSuggestions";
import type { AgentSuggestion } from "./types";

export interface GenerateAgentSuggestionsInput {
  locale: AppLocale;
  userMessage: string;
  result: AgentFinalResult;
  symbol?: string;
  interval?: string;
  activeRecommendation?: AgentFinalResult["activeRecommendation"];
  maxSuggestions?: number;
}

export interface GenerateAgentSuggestionsDeps {
  /** Injectable model call (tests). Returns raw model text. */
  callModel?: (system: string, user: string) => Promise<string>;
  configured?: boolean;
}

const SYSTEM_PROMPT = `You generate up to 4 short follow-up SUGGESTION chips for a chart-connected trading agent's chat UI.

Rules:
- Output MUST be in the requested locale ("ar" = Arabic, "en" = English). Never mix languages.
- Each suggestion has a short "label" (button text, <= 6 words) and a "prompt" (the exact natural message sent when the user taps it).
- Suggestions MUST match the CURRENT state provided (decision, active recommendation status, drawings, whether action is required / data is out of sync, whether there is no active recommendation).
- Be actionable and specific to THIS turn. Do NOT offer generic menus after every message.
- Do NOT invent prices, levels, candles, news, or account data. Prompts are user intents, not fabricated facts.
- Never suggest executing/closing/modifying a trade without confirmation wording.
- 0 to 4 suggestions. If nothing useful applies, return an empty array.

State-aware examples (do NOT copy verbatim — adapt to the actual state and locale):
- after a buy/sell recommendation: track it, explain why, draw its details, cancel it.
- after a drawing-only command: adjust the drawing, clear agent drawings, analyze based on the drawing.
- when there is no active recommendation: analyze the current chart, ask for a buy/sell/wait opinion.
- when data is out of sync / action required: retry after refreshing the chart, check the data status.

Respond with ONLY a JSON object, no markdown fences:
{"suggestions":[{"label":"<short>","prompt":"<natural user message>"}]}`;

interface RunState {
  locale: AppLocale;
  userMessage: string;
  decision: AgentFinalResult["decision"];
  actionRequired: boolean;
  hasActiveRecommendation: boolean;
  recommendationStatus: string | null;
  recommendationDirection: string | null;
  hasDrawings: boolean;
  requiresConfirmation: boolean;
  symbol: string | null;
  interval: string | null;
}

function buildState(input: GenerateAgentSuggestionsInput): RunState {
  const rec = input.activeRecommendation ?? input.result.activeRecommendation ?? null;
  return {
    locale: input.locale,
    userMessage: input.userMessage.slice(0, 400),
    decision: input.result.decision,
    actionRequired: input.result.decision === "action_required",
    hasActiveRecommendation: Boolean(rec),
    recommendationStatus: rec?.status ?? null,
    recommendationDirection: rec?.direction ?? null,
    hasDrawings: Boolean(input.result.drawings?.length),
    requiresConfirmation: Boolean(input.result.requiresConfirmation),
    symbol: input.symbol ?? null,
    interval: input.interval ?? null,
  };
}

/** Parse a raw model response into sanitized suggestions. */
export function parseAgentSuggestions(
  raw: string,
  maxSuggestions = 4,
): AgentSuggestion[] {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as { suggestions?: unknown };
  return sanitizeAgentSuggestions(parsed?.suggestions, maxSuggestions);
}

export async function generateAgentSuggestions(
  input: GenerateAgentSuggestionsInput,
  deps: GenerateAgentSuggestionsDeps = {},
): Promise<AgentSuggestion[]> {
  const max = input.maxSuggestions ?? 4;
  const configured = deps.configured ?? isLLMConfigured();
  if (!configured) return [];

  const callModel =
    deps.callModel ??
    (async (system: string, userMsg: string) => {
      const res = await callLLM({
        system,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 400,
      });
      return res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    });

  try {
    const raw = await callModel(SYSTEM_PROMPT, JSON.stringify(buildState(input)));
    return parseAgentSuggestions(raw, max);
  } catch {
    // No static fallback — a failed generation shows no suggestions.
    return [];
  }
}

function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
