/**
 * Stick-to-bottom rules for the in-app conversation.
 *
 * The thread grows downward (user turn, then the agent's thinking and answer).
 * If the operator is already at the bottom — or just sent a message — the
 * scroller must follow. If they have scrolled up to read earlier turns, it
 * must not yank them back.
 */

export const CHAT_STICK_THRESHOLD_PX = 96;

export type ScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

/** True when the scroller is close enough to the end to keep following. */
export function isPinnedToBottom(
  el: ScrollMetrics,
  threshold = CHAT_STICK_THRESHOLD_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** Jump the scroller to the latest turn. Instant — streaming must not lag. */
export function scrollChatToBottom(el: { scrollTop: number; scrollHeight: number }): void {
  el.scrollTop = el.scrollHeight;
}

/**
 * A send always re-pins. Being at the bottom re-pins. Reading history unpins
 * until the operator returns to the end or sends again.
 */
export function nextChatPinState(input: { sent: boolean; atBottom: boolean }): boolean {
  return input.sent || input.atBottom;
}
