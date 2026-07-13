import { sanitizeContextText } from "./contextSafety";
import type { ContextWarning, NormalizedContextMessage, RawContextMessage } from "./types";

export interface NormalizeMessagesResult {
  messages: NormalizedContextMessage[];
  warnings: ContextWarning[];
  compactedMessageIds: string[];
}

export function normalizeContextMessages(
  input: readonly RawContextMessage[],
  options: { maxChars?: number } = {},
): NormalizeMessagesResult {
  const warnings: ContextWarning[] = [];
  const compactedMessageIds: string[] = [];
  const messages = input.map((message, sequence) => {
    const id = message.id?.trim() || `context-${sequence}`;
    const sanitized = sanitizeContextText(message.content ?? "", {
      maxChars: options.maxChars,
      messageId: id,
      untrusted: message.source !== "current_user",
    });
    warnings.push(...sanitized.warnings);
    const sanitizedArguments = message.toolCall?.arguments == null
      ? undefined
      : sanitizeContextText(message.toolCall.arguments, {
          maxChars: 2_000,
          messageId: `${id}:tool-arguments`,
          untrusted: true,
        });
    if (sanitizedArguments) warnings.push(...sanitizedArguments.warnings);
    if (sanitized.truncated) compactedMessageIds.push(id);
    if (sanitizedArguments?.truncated) compactedMessageIds.push(id);
    const createdAt = Number.isFinite(message.createdAt) ? Number(message.createdAt) : undefined;
    return {
      id,
      role: message.role,
      kind: message.kind ?? "conversation",
      content: sanitized.text,
      sequence,
      createdAt,
      toolCall: message.toolCall
        ? {
            ...message.toolCall,
            arguments: sanitizedArguments?.rejected
              ? "[REDACTED unsafe tool arguments]"
              : sanitizedArguments?.text,
          }
        : undefined,
      toolCallId: message.toolCallId,
      symbol: message.symbol?.toUpperCase().trim() || undefined,
      timeframe: message.timeframe?.toLowerCase().trim() || undefined,
      recommendationId: message.recommendationId,
      analysisId: message.analysisId,
      important: message.important,
      historicalMarketData: message.historicalMarketData,
      safety: [...new Set([
        ...sanitized.classifications,
        ...(sanitizedArguments?.classifications ?? []),
      ])],
      source: message.source ?? "history",
    } satisfies NormalizedContextMessage;
  });
  // Input sequence is authoritative. Timestamps are metadata and may collide or be absent.
  return { messages, warnings, compactedMessageIds };
}
