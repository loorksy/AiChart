import type { ContextSelectionOptions, ContextSelectionResult, NormalizedContextMessage } from "./types";
import { estimateMessageTokens } from "./tokenBudget";
import { scoreContextMessage } from "./relevanceScorer";

export function selectRelevantTurns(
  history: readonly NormalizedContextMessage[],
  query: string,
  options: ContextSelectionOptions,
): ContextSelectionResult {
  if (!history.length || options.maxTokens <= 0) {
    return { turns: [], estimatedTokens: 0, omittedTurnCount: history.length };
  }
  const recentCount = Math.max(0, options.recentTurnCount ?? 8);
  const relevantCount = Math.max(0, options.relevantTurnCount ?? 8);
  const recentStart = Math.max(0, history.length - recentCount);
  const candidates = new Set<number>();
  for (let index = recentStart; index < history.length; index += 1) candidates.add(index);

  history
    .slice(0, recentStart)
    .map((message, index) => ({
      index,
      score: scoreContextMessage({ message, query, ...options }),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, relevantCount)
    .forEach(({ index }) => candidates.add(index));

  // Highest priority is newest recent context, then relevance. Output is restored to input order.
  const priority = [...candidates].sort((a, b) => {
    const aRecent = a >= recentStart ? 1 : 0;
    const bRecent = b >= recentStart ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    const scoreA = scoreContextMessage({ message: history[a]!, query, ...options });
    const scoreB = scoreContextMessage({ message: history[b]!, query, ...options });
    return scoreB - scoreA || b - a;
  });
  const selected = new Set<number>();
  let estimatedTokens = 0;
  for (const index of priority) {
    const cost = estimateMessageTokens(history[index]!);
    if (estimatedTokens + cost > options.maxTokens) continue;
    selected.add(index);
    estimatedTokens += cost;
  }
  const turns = [...selected].sort((a, b) => a - b).map((index) => history[index]!);
  return { turns, estimatedTokens, omittedTurnCount: history.length - turns.length };
}
