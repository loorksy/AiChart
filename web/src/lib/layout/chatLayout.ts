/**
 * Pure layout helpers for the workspace shell: the desktop chat-panel width and
 * the wide-desktop pane layout, both clamped/validated and persisted. Kept free
 * of React so they are unit-testable without a DOM runner.
 */
export const MIN_CHAT_WIDTH = 320;
export const MAX_CHAT_WIDTH = 560;
export const DEFAULT_CHAT_WIDTH = 400;

export const CHAT_WIDTH_STORAGE_KEY = "lonora_chat_width";

/**
 * What the wide-desktop workspace shows. The conversation is the surface the
 * operator works in; the chart is summoned next to it when a plan needs looking
 * at, which is why `chatOnly` is where a new session starts.
 */
export type DesktopLayout = "chatOnly" | "chartOnly" | "split";

export const DEFAULT_DESKTOP_LAYOUT: DesktopLayout = "chatOnly";

export const DESKTOP_LAYOUT_STORAGE_KEY = "aichart_workspace_layout";

function isDesktopLayout(value: unknown): value is DesktopLayout {
  return value === "chatOnly" || value === "chartOnly" || value === "split";
}

/** Load the persisted desktop layout, defaulting when absent/invalid. */
export function loadDesktopLayout(): DesktopLayout {
  if (typeof window === "undefined") return DEFAULT_DESKTOP_LAYOUT;
  const raw = window.localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
  return isDesktopLayout(raw) ? raw : DEFAULT_DESKTOP_LAYOUT;
}

/** Persist the desktop layout. */
export function saveDesktopLayout(layout: DesktopLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DESKTOP_LAYOUT_STORAGE_KEY, layout);
}

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
