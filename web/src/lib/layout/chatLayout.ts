/**
 * Pure layout helpers for the workspace shell: the desktop chat-panel width
 * (clamped + persisted) and the mobile Chart/Chat tab state. Kept free of React
 * so they are unit-testable without a DOM runner.
 */
export type MobilePane = "chart" | "chat";

export const DEFAULT_MOBILE_PANE: MobilePane = "chart";

export const MIN_CHAT_WIDTH = 320;
export const MAX_CHAT_WIDTH = 560;
export const DEFAULT_CHAT_WIDTH = 400;

export const CHAT_WIDTH_STORAGE_KEY = "lonora_chat_width";

/** Clamp a desktop chat width to the allowed range; ignores non-finite input. */
export function clampChatWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_CHAT_WIDTH;
  return Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, Math.round(px)));
}

/** Load the persisted chat width (clamped), defaulting when absent/invalid. */
export function loadChatWidth(): number {
  if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;
  const raw = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clampChatWidth(parsed) : DEFAULT_CHAT_WIDTH;
}

/** Persist the chat width (clamped). */
export function saveChatWidth(px: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(clampChatWidth(px)));
}
