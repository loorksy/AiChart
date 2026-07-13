import { compactConversation } from "./conversationCompactor";
import { normalizeContextMessages } from "./normalizeMessages";
import { sanitizeContextText } from "./contextSafety";
import type {
  AgentConversationContext,
  BuildAgentConversationContextInput,
  ContextWarning,
  RawContextMessage,
} from "./types";

function recommendationMessage(input: BuildAgentConversationContextInput): RawContextMessage[] {
  const recommendation = input.activeRecommendation;
  if (!recommendation) return [];
  return [{
    id: `recommendation:${recommendation.id}`,
    role: "assistant",
    kind: "recommendation",
    content: [
      `Active recommendation ${recommendation.id}`,
      `Direction: ${recommendation.direction}`,
      `Status: ${recommendation.status}`,
      recommendation.summary,
    ].filter(Boolean).join("\n"),
    createdAt: recommendation.createdAt,
    symbol: recommendation.symbol,
    timeframe: recommendation.timeframe,
    recommendationId: recommendation.id,
    analysisId: recommendation.analysisId,
    important: true,
    source: "recommendation",
  }];
}

export function buildAgentConversationContext(
  input: BuildAgentConversationContextInput,
): AgentConversationContext {
  const now = input.now ?? Date.now();
  const warnings: ContextWarning[] = [];
  const recalledMemoryIds: string[] = [];
  const memoryMessages: RawContextMessage[] = [];
  for (const memory of input.recalledMemories ?? []) {
    if (memory.expiresAt != null && memory.expiresAt <= now) {
      warnings.push({ code: "expired_memory_excluded", messageId: memory.id });
      continue;
    }
    const sanitized = sanitizeContextText(memory.content, { messageId: memory.id, maxChars: 2_000, untrusted: true });
    warnings.push(...sanitized.warnings);
    if (sanitized.rejected) continue;
    recalledMemoryIds.push(memory.id);
    memoryMessages.push({
      id: `memory:${memory.id}`,
      role: "user",
      kind: "memory",
      content: `[Untrusted recalled context]\n${sanitized.text}`,
      important: true,
      source: "memory",
    });
  }
  const lessonMessages: RawContextMessage[] = (input.tradeLessons ?? []).map((lesson) => ({
    id: `trade-lesson:${lesson.id}`,
    role: "user",
    kind: "trade_lesson",
    content: `[Untrusted historical trade lesson]\n${lesson.content}`,
    createdAt: lesson.createdAt,
    symbol: lesson.symbol,
    timeframe: lesson.timeframe,
    source: "trade_lesson",
  }));
  const currentId = `current:${input.sessionId}`;
  const history = [...(input.persistedMessages ?? [])];
  const last = history.at(-1);
  if (last?.role === "user" && last.content?.trim() === input.userMessage.trim()) history.pop();
  const raw: RawContextMessage[] = [
    ...memoryMessages,
    ...lessonMessages,
    ...history,
    ...recommendationMessage(input),
    {
      id: currentId,
      role: "user",
      kind: "conversation",
      content: input.userMessage,
      createdAt: input.now,
      symbol: input.chartContext?.symbol,
      timeframe: input.chartContext?.interval,
      important: true,
      source: "current_user",
    },
  ];
  const normalized = normalizeContextMessages(raw, { maxChars: 4_000 });
  const messages = normalized.messages.map((message) => message.id === currentId ? { ...message, current: true } : message);
  const compacted = compactConversation({
    messages,
    currentUserMessageId: currentId,
    query: input.userMessage,
    locale: input.locale,
    tokenBudget: input.tokenBudget,
    symbol: input.chartContext?.symbol,
    timeframe: input.chartContext?.interval,
    recommendationId: input.activeRecommendation?.id,
    analysisId: input.activeRecommendation?.analysisId,
  });
  warnings.push(...normalized.warnings, ...compacted.warnings);
  const selectedIds = new Set(compacted.messages.map(({ id }) => id));
  const removedMessageIds = [
    ...new Set([
      ...normalized.messages.filter(({ id }) => !selectedIds.has(id)).map(({ id }) => id),
      ...compacted.removedMessageIds,
    ]),
  ];
  return {
    messages: compacted.messages,
    estimatedTokens: compacted.estimatedTokens,
    selectedMessageIds: compacted.messages.map(({ id }) => id),
    removedMessageIds,
    compactedMessageIds: [...new Set([...normalized.compactedMessageIds, ...compacted.compactedMessageIds])],
    recalledMemoryIds,
    activeRecommendation: input.activeRecommendation ?? undefined,
    warnings,
    diagnostics: input.includeDiagnostics ? {
      inputMessageCount: raw.length,
      selectedHistoryCount: compacted.messages.filter(({ source }) => source === "history").length,
      removedCount: removedMessageIds.length,
      compactedCount: compacted.compactedMessageIds.length,
      placeholderToolResultCount: compacted.placeholderToolResultCount,
    } : undefined,
  };
}
