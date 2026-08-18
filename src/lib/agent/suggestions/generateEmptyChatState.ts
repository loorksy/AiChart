import { callLLM, isLLMConfigured } from "@/lib/llm";
import { extractJson } from "@/lib/extractJson";
import type { AppLocale } from "@/lib/i18n";
import { sanitizeAgentSuggestions } from "./sanitizeAgentSuggestions";
import type { AgentSuggestion } from "./types";

export interface EmptyChatFacts {
  locale: AppLocale;
  symbol: string;
  interval: string;
  drawingsCount: number;
  hasActiveRecommendation: boolean;
  accountConnected: boolean;
}

export interface EmptyChatState {
  greeting: string;
  suggestions: AgentSuggestion[];
}

const SYSTEM_PROMPT = `Compose the empty state for Lonora's trading chat from the supplied facts.
Return natural Arabic when locale=ar and English when locale=en.
Write one calm greeting of at most 18 words and 2 or 3 short suggestion chips.
Suggestions must be useful for the actual symbol/timeframe and state. They are user prompts, not market claims.
Do not invent prices, recommendations, news, connection state, or analysis results.
Do not mention tools, skills, MCP, modules, policies, feature flags, traces, schemas, or implementation details.
Respond with JSON only:
{"greeting":"...","suggestions":[{"label":"...","prompt":"..."}]}`;

export async function generateEmptyChatState(
  facts: EmptyChatFacts,
): Promise<EmptyChatState | null> {
  if (!isLLMConfigured()) return null;
  try {
    const response = await callLLM({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      maxTokens: 350,
    }, { tier: "quick" });
    const raw = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    const parsed = JSON.parse(extractJson(raw)) as { greeting?: unknown; suggestions?: unknown };
    const greeting = typeof parsed.greeting === "string"
      ? parsed.greeting.replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
    if (!greeting) return null;
    return {
      greeting,
      suggestions: sanitizeAgentSuggestions(parsed.suggestions, 3),
    };
  } catch {
    return null;
  }
}
