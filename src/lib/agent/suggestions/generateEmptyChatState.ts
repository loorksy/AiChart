import { callLLM, isLLMConfigured } from "@/lib/llm";
import { extractJson } from "@/lib/extractJson";
import type { AppLocale } from "@/lib/i18n";

export interface EmptyChatFacts {
  locale: AppLocale;
  symbol: string;
  interval: string;
  drawingsCount: number;
  hasActiveRecommendation: boolean;
  accountConnected: boolean;
}

/**
 * The start screen is a greeting and the composer — nothing else.
 *
 * It used to offer suggested-prompt chips ("Trend analysis", "Support and
 * resistance levels", "Suggest a trade opportunity"…). They are gone by
 * request: this is a chat with an analyst, and a row of canned questions
 * makes it look like a menu of features instead.
 */
export interface EmptyChatState {
  greeting: string;
}

const SYSTEM_PROMPT = `Compose the empty state for Lonora's trading chat from the supplied facts.
Return natural Arabic when locale=ar and English when locale=en.
Write ONE calm greeting of at most 18 words. Nothing else.
Do not invent prices, recommendations, news, connection state, or analysis results.
Do not offer suggestions, prompts, options, or a list of things the user could ask.
Do not mention tools, skills, MCP, modules, policies, feature flags, traces, schemas, or implementation details.
Respond with JSON only:
{"greeting":"..."}`;

export async function generateEmptyChatState(
  facts: EmptyChatFacts,
): Promise<EmptyChatState | null> {
  if (!isLLMConfigured()) return null;
  try {
    const response = await callLLM({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      maxTokens: 200,
    }, { tier: "quick" });
    const raw = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    const parsed = JSON.parse(extractJson(raw)) as { greeting?: unknown };
    const greeting = typeof parsed.greeting === "string"
      ? parsed.greeting.replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
    if (!greeting) return null;
    return { greeting };
  } catch {
    return null;
  }
}
