/**
 * Quant Agent Chat intent router. Pure keyword heuristics — no LLM call —
 * mirroring the STYLE of `@/lib/agent/intentRouter` (Lonora's own router,
 * itself keyword-based). Entirely separate code: this file never imports
 * Lonora's router and Lonora's router never imports this one.
 *
 * Three intents only for v1:
 * - "generate_strategy": the user wants a NEW strategy specification drafted.
 * - "explain_recommendation": the user wants an EXISTING recommendation
 *   explained (an explain-word co-occurring with a symbol mention or an
 *   explicit reference to "this"/"the last" recommendation).
 * - "chat": everything else — the default, general conversation branch.
 */

export type QuantAgentChatIntent = "chat" | "explain_recommendation" | "generate_strategy";

const STRATEGY_ACTION_WORDS_EN = ["create", "build", "generate", "design", "write"];
const STRATEGY_ACTION_WORDS_AR = ["اصنع", "أنشئ", "انشئ", "صمم", "اعمل", "أعمل"];
const STRATEGY_WORD_AR = ["استراتيجية", "استراتيجيه", "إستراتيجية"];

const EXPLAIN_WORDS_EN = ["explain", "why", "rationale", "reasoning"];
const EXPLAIN_WORDS_AR = ["فسر", "فسّر", "لماذا", "اشرح", "ليه", "سبب"];

const RECOMMENDATION_REFERENCE_PHRASES = [
  "this recommendation",
  "the recommendation",
  "that recommendation",
  "هذه التوصية",
  "هذه التوصيه",
  "التوصية دي",
  "آخر توصية",
  "اخر توصية",
  "آخر توصيه",
  "اخر توصيه",
];

/**
 * Best-effort symbol hint: a 3-6 letter base immediately followed by a
 * quote-currency-style suffix (USD, JPY, EUR, ...), or a slash pair like
 * "XAU/USD". Good enough to co-occur-gate "explain" — not a market data
 * source and never used to fetch prices.
 */
const SYMBOL_HINT_REGEX = /\b([A-Za-z]{3,6})\/?(USD|JPY|GBP|EUR|CAD|CHF|AUD|NZD|USDT|USDC)\b/i;

export function extractQuantAgentSymbolHint(message: string): string | null {
  const match = message.match(SYMBOL_HINT_REGEX);
  if (!match) return null;
  return `${match[1]}${match[2]}`.toUpperCase();
}

function hasGenerateStrategyIntent(message: string, lower: string): boolean {
  const mentionsStrategyEn = lower.includes("strategy");
  const mentionsStrategyAr = STRATEGY_WORD_AR.some((w) => message.includes(w));
  if (!mentionsStrategyEn && !mentionsStrategyAr) return false;

  const hasEnAction = STRATEGY_ACTION_WORDS_EN.some((w) => lower.includes(w));
  const hasArAction = STRATEGY_ACTION_WORDS_AR.some((w) => message.includes(w));
  // Arabic also allows the bare noun-phrase "new strategy" ("استراتيجية
  // جديدة") without a separate action verb — matches the plan's example
  // phrases verbatim.
  const hasArNewPhrase = mentionsStrategyAr && (message.includes("جديدة") || message.includes("جديد"));

  return hasEnAction || hasArAction || hasArNewPhrase;
}

function hasExplainRecommendationIntent(message: string, lower: string): boolean {
  const hasExplainWord =
    EXPLAIN_WORDS_EN.some((w) => lower.includes(w)) || EXPLAIN_WORDS_AR.some((w) => message.includes(w));
  if (!hasExplainWord) return false;

  const hasSymbol = Boolean(extractQuantAgentSymbolHint(message));
  const hasReference = RECOMMENDATION_REFERENCE_PHRASES.some((p) => lower.includes(p.toLowerCase()));
  return hasSymbol || hasReference;
}

/** Route one user message to a Quant Agent Chat intent. Stateless, pure. */
export function routeQuantAgentChatIntent(message: string): QuantAgentChatIntent {
  const trimmed = message.trim();
  if (!trimmed) return "chat";
  const lower = trimmed.toLowerCase();

  // generate_strategy is checked first: "explain why this new strategy makes
  // sense" should still route to strategy generation, not an explain lookup.
  if (hasGenerateStrategyIntent(trimmed, lower)) return "generate_strategy";
  if (hasExplainRecommendationIntent(trimmed, lower)) return "explain_recommendation";
  return "chat";
}
