/** Query key for the active chat on `/chat`. */
export const CHAT_QUERY_KEY = "chat";

/** Last-active chat persisted in the browser (fallback when URL has no chat). */
export const LS_ACTIVE_CHAT = "lonora_active_chat";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accepts UUID ids and legacy `chat-<timestamp>-<random>` ids from chatStore. */
export function isValidChatId(id: string | null | undefined): id is string {
  if (!id || typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  return UUID_RE.test(trimmed) || trimmed.startsWith("chat-");
}

/** Canonical in-app URL for an open chat (supports browser history). */
export function chatConsoleHref(chatId: string): string {
  return `/chat?${CHAT_QUERY_KEY}=${encodeURIComponent(chatId)}`;
}

/** Bare workspace — no chat selected. */
export const WORKSPACE_HOME_HREF = "/chat";

export function parseChatIdFromSearchParams(
  params: Pick<URLSearchParams, "get">,
): string | null {
  const raw = params.get(CHAT_QUERY_KEY);
  if (!raw) return null;
  const id = raw.trim();
  return isValidChatId(id) ? id : null;
}
