import type { NormalizedContextMessage } from "./types";

const CHARS_PER_TOKEN = 4;
export function estimateTextTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN)) : 0;
}
export function estimateTurnTokens(content: string): number {
  return estimateTextTokens(content) + 6;
}
export function estimateMessageTokens(message: Pick<NormalizedContextMessage, "content" | "toolCall">): number {
  return estimateTurnTokens(message.content) + estimateTextTokens(message.toolCall?.arguments ?? "");
}
export function estimateContextTokens(messages: readonly NormalizedContextMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}
