import type { NormalizedContextMessage } from "./types";

export function contextTerms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
}

export function scoreContextMessage(input: {
  message: NormalizedContextMessage;
  query: string;
  symbol?: string;
  timeframe?: string;
  recommendationId?: string;
  analysisId?: string;
}): number {
  const { message } = input;
  let score = message.important ? 100 : 0;
  const queryTerms = contextTerms(input.query);
  const haystack = contextTerms(
    [message.content, message.symbol, message.timeframe, message.recommendationId, message.analysisId]
      .filter(Boolean)
      .join(" "),
  );
  for (const term of queryTerms) if (haystack.has(term)) score += 3;
  if (input.symbol && message.symbol === input.symbol.toUpperCase()) score += 8;
  if (input.timeframe && message.timeframe === input.timeframe.toLowerCase()) score += 5;
  if (input.recommendationId && message.recommendationId === input.recommendationId) score += 12;
  if (input.analysisId && message.analysisId === input.analysisId) score += 12;
  if (message.kind === "recommendation") score += 4;
  if (message.kind === "memory" && /(?:preference|أفضل|افضل|تفضيل|risk|مخاطر)/iu.test(message.content)) score += 6;
  if (message.historicalMarketData) score -= 20;
  return score;
}
