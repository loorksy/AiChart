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
 */
export function resolveActiveRecommendationContext(input: {
  candidates: readonly SafeRecommendationContext[];
  symbol?: string;
  timeframe?: string;
}): SafeRecommendationContext | undefined {
  const symbol = input.symbol?.toUpperCase().trim();
  const timeframe = input.timeframe?.toLowerCase().trim();
  return input.candidates
    .filter((candidate) => !isTerminalContextRecommendation(candidate))
    .filter((candidate) => !symbol || candidate.symbol.toUpperCase() === symbol)
    .filter((candidate) => !timeframe || candidate.timeframe.toLowerCase() === timeframe)
    .sort((a, b) =>
      SOURCE_RANK[b.source] - SOURCE_RANK[a.source] ||
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      a.id.localeCompare(b.id),
    )[0];
}
