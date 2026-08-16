/**
 * OpenClaw-style interactive replies for Telegram.
 *
 * Buttons live on the message the agent just sent — not on a persistent
 * keyboard. Each option is authored for THIS turn (`AgentOption` from the
 * brain or a contextual follow-up). Telegram only gets an opaque token
 * (`o:<8 hex>`, ≤64 bytes); the prompt stays server-side so a tap cannot
 * inject a different command, and a leftover `cmd:approve` from an older
 * surface is never a valid token.
 */
import { randomBytes } from "node:crypto";
import type { AgentOption } from "@/lib/agent/types";
import { contextualOptionsFor } from "@/lib/agent/contextualOptions";
import type { InlineButton } from "@/lib/telegram";

export const OPTION_CALLBACK_PREFIX = "o:";
const TOKEN_HEX_LEN = 8;
const OPTIONS_TTL_MS = 30 * 60 * 1000;
const MAX_OPTIONS = 4;
const BUTTONS_PER_ROW = 2;

type StoredOption = {
  prompt: string;
  label: string;
  chatId: string;
  expiresAt: number;
};

const store = new Map<string, StoredOption>();

function sweep(now = Date.now()): void {
  for (const [token, stored] of store) {
    if (stored.expiresAt <= now) store.delete(token);
  }
}

export function isOptionCallback(data: string): boolean {
  return (
    data.startsWith(OPTION_CALLBACK_PREFIX) &&
    data.length === OPTION_CALLBACK_PREFIX.length + TOKEN_HEX_LEN &&
    /^[a-f0-9]+$/.test(data.slice(OPTION_CALLBACK_PREFIX.length))
  );
}

export function telegramSessionId(chatId: string): string {
  return `tg:${chatId}`;
}

/** Fast-path turns still get agent-authored chips for that context — never a standing keypad. */
export function optionsForTelegramFastPath(
  kind: "greeting" | "menu" | "session" | "chart_photo" | "chart_failed",
): AgentOption[] {
  if (kind === "greeting" || kind === "menu") {
    return contextualOptionsFor({ decision: "informational", locale: "ar" }) ?? [];
  }
  return (
    contextualOptionsFor({
      decision: "informational",
      noActiveRecommendation: true,
      locale: "ar",
    }) ?? []
  );
}

/**
 * Persist this turn's options and return an inline keyboard. Tokens are
 * one-shot and bound to the chat that received them.
 */
export function rememberInlineOptions(
  chatId: string,
  options: AgentOption[],
): InlineButton[][] {
  sweep();
  const buttons: InlineButton[] = [];
  for (const option of options.slice(0, MAX_OPTIONS)) {
    const label = option.label.trim();
    const prompt = option.prompt.trim();
    if (!label || !prompt) continue;
    const token = `${OPTION_CALLBACK_PREFIX}${randomBytes(TOKEN_HEX_LEN / 2).toString("hex")}`;
    store.set(token, {
      prompt,
      label,
      chatId,
      expiresAt: Date.now() + OPTIONS_TTL_MS,
    });
    buttons.push({ text: label.slice(0, 64), callback_data: token });
  }
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push(buttons.slice(i, i + BUTTONS_PER_ROW));
  }
  return rows;
}

export function resolveInlineOption(
  data: string,
  chatId: string,
): { prompt: string; label: string } | null {
  sweep();
  if (!isOptionCallback(data)) return null;
  const stored = store.get(data);
  if (!stored) return null;
  if (stored.chatId !== chatId) return null;
  store.delete(data);
  return { prompt: stored.prompt, label: stored.label };
}

/** OpenClaw-style: keep the reply, mark the tap, drop the buttons. */
export function markChosenReply(
  original: string | undefined,
  label: string,
): string {
  const base = (original ?? "").trim() || "…";
  return `${base}\n\n✓ ${label}`;
}

/** Test seam: the option map is process-global by design. */
export function resetInlineOptions(): void {
  store.clear();
}
