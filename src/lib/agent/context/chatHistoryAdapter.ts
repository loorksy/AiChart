import type { AgentFinalResult } from "../types";
import type { AgentChatMessageRecord } from "../chatHistory/types";
import type { RawContextMessage } from "./types";

export interface AuthorizedChatHistoryInput {
  authenticatedUserId: number;
  ownerUserId: number;
  authorizedChatId: string;
  messages: readonly AgentChatMessageRecord[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeAssistantContext(message: AgentChatMessageRecord): string {
  const result = record(message.result) as Partial<AgentFinalResult> | undefined;
  if (!result) return message.content;
  const recommendation = record(result.recommendation);
  const lines = [message.content || result.summary]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  // Only market verdicts are worth restating; "informational" and
  // "action_required" are envelope plumbing, and a model reading
  // "Decision: informational" in its own history parrots it into replies —
  // a real transcript, not a hypothesis.
  if (
    result.decision === "buy" ||
    result.decision === "sell" ||
    result.decision === "wait"
  ) {
    lines.push(`Decision: ${result.decision}`);
  }
  if (typeof result.activeRecommendation?.status === "string") {
    lines.push(`Recommendation status: ${result.activeRecommendation.status}`);
  }
  const entry = finite(recommendation?.entry);
  const stop = finite(recommendation?.stop_loss);
  const targets = Array.isArray(recommendation?.targets)
    ? recommendation.targets.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).slice(0, 5)
    : [];
  if (entry != null) lines.push(`Entry: ${entry}`);
  if (stop != null) lines.push(`Stop loss: ${stop}`);
  if (targets.length) lines.push(`Targets: ${targets.join(", ")}`);
  if (Array.isArray(result.publicReasoningSummary)) {
    const publicReasons = result.publicReasoningSummary
      .filter((value): value is string => typeof value === "string")
      .slice(0, 5)
      .join("; ");
    if (publicReasons) lines.push(`Public reasoning: ${publicReasons}`);
  }
  return [...new Set(lines)].join("\n");
}

/**
 * Session-scope variant: the caller already read messages scoped BY USER
 * (getRecentMessagesForUser), so ownership is the read's guarantee and no
 * single-chat filter applies — this is what lets a conversation started on
 * one channel continue on another.
 */
export function adaptOwnedSessionHistory(
  messages: readonly AgentChatMessageRecord[],
): RawContextMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    kind: "conversation" as const,
    content: message.role === "assistant" ? safeAssistantContext(message) : message.content,
    createdAt: message.createdAt,
    symbol: message.symbol,
    timeframe: message.interval,
    recommendationId: message.recommendationId,
    analysisId: message.analysisId,
    source: "history" as const,
  }));
}

/** Converts an already-authorized chat into a DB-independent context contract. */
export function adaptAuthorizedChatHistory(input: AuthorizedChatHistoryInput): RawContextMessage[] {
  if (input.authenticatedUserId !== input.ownerUserId) {
    throw new Error("Context history tenant mismatch");
  }
  return input.messages
    .filter((message) => message.chatId === input.authorizedChatId)
    .map((message) => ({
      id: message.id,
      role: message.role,
      kind: "conversation",
      content: message.role === "assistant" ? safeAssistantContext(message) : message.content,
      createdAt: message.createdAt,
      symbol: message.symbol,
      timeframe: message.interval,
      recommendationId: message.recommendationId,
      analysisId: message.analysisId,
      source: "history",
    }));
}
