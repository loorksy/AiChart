/**
 * Pure message-list transitions for the Smart Chart Agent chat. Extracted from
 * the React hook so the pending-bubble / ticker / final-replacement behavior is
 * unit-testable without a DOM runner.
 */
import type { AgentChatMessage } from "@/hooks/useSmartChartAgent";
import type { AgentTickerItem } from "@/lib/agent/ticker/types";

/** Append the user's message plus a temporary pending assistant bubble. */
export function appendUserAndPending(
  messages: AgentChatMessage[],
  user: { id: string; content: string },
  pendingId: string,
): AgentChatMessage[] {
  return [
    ...messages,
    { id: user.id, role: "user", content: user.content },
    { id: pendingId, role: "assistant", content: "", pending: true, ticker: null },
  ];
}

/** Update the pending bubble's live ticker line (UI-only, never persisted). */
export function applyTicker(
  messages: AgentChatMessage[],
  pendingId: string,
  item: AgentTickerItem,
): AgentChatMessage[] {
  return messages.map((m) =>
    m.id === pendingId && m.pending ? { ...m, ticker: item } : m,
  );
}

/**
 * Replace the pending bubble in place with the final assistant message. Keeps
 * the same id (no duplicate assistant message) and drops the ticker text.
 * If the pending bubble is gone (e.g. chat switched), the final is appended.
 */
export function applyFinal(
  messages: AgentChatMessage[],
  pendingId: string,
  final: Omit<AgentChatMessage, "id" | "role" | "pending" | "ticker">,
): AgentChatMessage[] {
  const finalMessage: AgentChatMessage = {
    id: pendingId,
    role: "assistant",
    pending: false,
    ticker: null,
    ...final,
  };
  const exists = messages.some((m) => m.id === pendingId);
  if (!exists) return [...messages, finalMessage];
  return messages.map((m) => (m.id === pendingId ? finalMessage : m));
}

/** Remove a stuck pending bubble (error / cancel / dropped stream). */
export function dropPending(
  messages: AgentChatMessage[],
  pendingId: string,
): AgentChatMessage[] {
  return messages.filter((m) => !(m.id === pendingId && m.pending));
}
