import type { SafeRecommendationContext } from "./types";

const TERMINAL = new Set([
  "tp1_hit", "tp2_hit", "tp3_hit", "sl_hit", "invalidated", "expired", "cancelled", "closed",
]);
const SOURCE_RANK: Record<SafeRecommendationContext["source"], number> = {
  canonical: 4,
  session: 3,
  chart: 2,
  history: 1,
};

export function isTerminalContextRecommendation(recommendation: SafeRecommendationContext): boolean {
  return TERMINAL.has(recommendation.status);
}

/**
 * Canonical persistence wins, followed by session, chart restore and history.
 * Terminal/history-only records are never promoted to an active recommendation.
 *
 * `recommendationSources` is a generic programming selection list of already
 * persisted recommendation contexts — never Trade Candidate proposals.
 */
export function resolveActiveRecommendationContext(input: {
  recommendationSources: readonly SafeRecommendationContext[];
  /** @deprecated Prefer recommendationSources. */
  candidates?: readonly SafeRecommendationContext[];
  symbol?: string;
  timeframe?: string;
}): SafeRecommendationContext | undefined {
  const sources = input.recommendationSources ?? input.candidates ?? [];
  const symbol = input.symbol?.toUpperCase().trim();
  const timeframe = input.timeframe?.toLowerCase().trim();
  return sources
    .filter((item) => !isTerminalContextRecommendation(item))
    .filter((item) => !symbol || item.symbol.toUpperCase() === symbol)
    .filter((item) => !timeframe || item.timeframe.toLowerCase() === timeframe)
    .sort((a, b) =>
      SOURCE_RANK[b.source] - SOURCE_RANK[a.source] ||
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      a.id.localeCompare(b.id),
    )[0];
}
