/**
 * Pure message-list transitions for the Smart Chart Agent chat. Extracted from
 * the React hook so the pending-bubble / live-note / final-replacement behavior
 * is unit-testable without a DOM runner.
 */
import type { AgentChatMessage } from "@/hooks/useSmartChartAgent";

/** Append the user's message plus a temporary pending assistant bubble. */
export function appendUserAndPending(
  messages: AgentChatMessage[],
  user: { id: string; content: string },
  pendingId: string,
): AgentChatMessage[] {
  return [
    ...messages,
    { id: user.id, role: "user", content: user.content },
    { id: pendingId, role: "assistant", content: "", pending: true, liveNote: null },
  ];
}

/**
 * Update the pending bubble's live narration line (UI-only, never persisted).
 *
 * The note is the engine's own latest visible `activity` sentence — authored
 * by the specialist that just did the work, at the moment it happened. Its
 * predecessor was a model-generated "ticker" script played on a timer;
 * narration that does not come from the run does not go in the bubble.
 */
export function applyLiveNote(
  messages: AgentChatMessage[],
  pendingId: string,
  note: string,
): AgentChatMessage[] {
  return messages.map((m) =>
    m.id === pendingId && m.pending ? { ...m, liveNote: note } : m,
  );
}

/**
 * Update the pending bubble's live streamed answer text (replace semantics —
 * the server sends cumulative sanitized text). UI-only; the final event still
 * owns the message content.
 */
export function applyStreamText(
  messages: AgentChatMessage[],
  pendingId: string,
  text: string,
): AgentChatMessage[] {
  return messages.map((m) =>
    m.id === pendingId && m.pending ? { ...m, streamText: text } : m,
  );
}

/**
 * Replace the pending bubble in place with the final assistant message. Keeps
 * the same id (no duplicate assistant message) and drops the live note.
 * If the pending bubble is gone (e.g. chat switched), the final is appended.
 */
export function applyFinal(
  messages: AgentChatMessage[],
  pendingId: string,
  final: Omit<AgentChatMessage, "id" | "role" | "pending" | "liveNote">,
): AgentChatMessage[] {
  const finalMessage: AgentChatMessage = {
    id: pendingId,
    role: "assistant",
    pending: false,
    liveNote: null,
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
