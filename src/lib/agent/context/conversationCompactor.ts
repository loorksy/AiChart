import { compactHistoricalProse } from "./contextSummary";
import { repairToolPairs } from "./repairToolPairs";
import { scoreContextMessage } from "./relevanceScorer";
import { estimateContextTokens, estimateMessageTokens } from "./tokenBudget";
import type { ContextLocale, ContextWarning, NormalizedContextMessage } from "./types";

export interface CompactConversationInput {
  messages: readonly NormalizedContextMessage[];
  currentUserMessageId: string;
  query: string;
  locale: ContextLocale;
  tokenBudget: number;
  symbol?: string;
  timeframe?: string;
  recommendationId?: string;
  analysisId?: string;
  recentReserve?: number;
}

export interface CompactConversationResult {
  messages: NormalizedContextMessage[];
  estimatedTokens: number;
  removedMessageIds: string[];
  compactedMessageIds: string[];
  warnings: ContextWarning[];
  placeholderToolResultCount: number;
}

export function compactConversation(input: CompactConversationInput): CompactConversationResult {
  const budget = Math.max(0, input.tokenBudget);
  const recentReserve = Math.max(2, input.recentReserve ?? 8);
  const warnings: ContextWarning[] = [];
  const compactedMessageIds: string[] = [];
  const removed = new Set<string>();

  let messages = input.messages
    .filter((message) => {
      if (!message.historicalMarketData) return true;
      removed.add(message.id);
      warnings.push({ code: "historical_market_data_omitted", messageId: message.id });
      return false;
    })
    .map((message) => {
      const compacted = compactHistoricalProse(message, input.locale, message.kind === "tool_result" ? 600 : 1_200);
      if (compacted.content !== message.content) compactedMessageIds.push(message.id);
      return compacted;
    });

  const currentIndex = messages.findIndex((message) => message.id === input.currentUserMessageId);
  const current = currentIndex >= 0 ? messages[currentIndex] : undefined;
  const recentIds = new Set(messages.slice(-recentReserve).map(({ id }) => id));
  const removable = () => messages
    .filter((message) => message.id !== input.currentUserMessageId && !message.important)
    .map((message) => ({
      message,
      score:
        scoreContextMessage({
          message,
          query: input.query,
          symbol: input.symbol,
          timeframe: input.timeframe,
          recommendationId: input.recommendationId,
          analysisId: input.analysisId,
        }) +
        (recentIds.has(message.id) ? 20 : 0) +
        (message.kind === "tool_call" || message.kind === "tool_result" ? 2 : 0),
    }))
    .sort((a, b) => a.score - b.score || a.message.sequence - b.message.sequence);

  while (estimateContextTokens(messages) > budget) {
    const candidate = removable()[0];
    if (!candidate) break;
    const pairId = candidate.message.kind === "tool_call"
      ? candidate.message.toolCall?.id
      : candidate.message.kind === "tool_result"
        ? candidate.message.toolCallId
        : undefined;
    messages = messages.filter((message) => {
      const samePair = pairId && (message.toolCall?.id === pairId || message.toolCallId === pairId);
      const drop = message.id === candidate.message.id || Boolean(samePair);
      if (drop) removed.add(message.id);
      return !drop;
    });
  }

  const repaired = repairToolPairs(messages, input.locale);
  repaired.removedMessageIds.forEach((id) => removed.add(id));
  warnings.push(...repaired.warnings);
  messages = repaired.messages;

  // Pair placeholders have a cost. Remove lowest-value non-current groups again if required.
  let removedAfterRepair = false;
  while (estimateContextTokens(messages) > budget) {
    const candidate = removable()[0];
    if (!candidate) break;
    const pairId = candidate.message.kind === "tool_call"
      ? candidate.message.toolCall?.id
      : candidate.message.kind === "tool_result"
        ? candidate.message.toolCallId
        : undefined;
    messages = messages.filter((message) => {
      const samePair = pairId && (message.toolCall?.id === pairId || message.toolCallId === pairId);
      const drop = message.id === candidate.message.id || Boolean(samePair);
      if (drop) removed.add(message.id);
      return !drop;
    });
    removedAfterRepair = true;
  }
  const finalRepair = removedAfterRepair ? repairToolPairs(messages, input.locale) : repaired;
  if (removedAfterRepair) {
    finalRepair.removedMessageIds.forEach((id) => removed.add(id));
    warnings.push(...finalRepair.warnings);
    messages = finalRepair.messages;
  }
  const estimatedTokens = estimateContextTokens(messages);
  if (estimatedTokens > budget && current && estimateMessageTokens(current) > budget) {
    warnings.push({ code: "budget_too_small", messageId: current.id });
  }
  return {
    messages,
    estimatedTokens,
    removedMessageIds: [...removed],
    compactedMessageIds: [...new Set(compactedMessageIds)],
    warnings,
    placeholderToolResultCount: finalRepair.placeholderCount,
  };
}
