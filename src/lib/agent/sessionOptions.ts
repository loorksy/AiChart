/**
 * Per-session option memory. When the agent presents a numbered list of choices
 * ("1. تحليل الشارت …") the next message might just be "1" / "١". This module
 * remembers the last options shown for a session so that reply resolves to the
 * real prompt for option 1 — instead of being misread as a new general question.
 *
 * In-memory is sufficient: options are ephemeral UX state, not durable data.
 */

import type { AgentOption } from "./types";

export type { AgentOption } from "./types";

interface StoredOptions {
  options: AgentOption[];
  updatedAt: number;
}

const OPTIONS_TTL_MS = 30 * 60 * 1000; // 30m idle expiry
const optionStore = new Map<string, StoredOptions>();

/** Default capability options offered after a greeting / general reply. */
export const DEFAULT_AGENT_OPTIONS: AgentOption[] = [
  {
    id: "analyze_chart",
    label: "تحليل الشارت الحالي",
    prompt: "حلّل الشارت الحالي وارسم السيناريو الأفضل واشرح القرار.",
  },
  {
    id: "support_resistance",
    label: "تحديد الدعم والمقاومة",
    prompt:
      "حدّد أهم مناطق الدعم والمقاومة، ولا ترسم إلا المستويات القوية الموثوقة.",
  },
  {
    id: "buy_sell_wait",
    label: "رأي شراء/بيع/انتظار",
    prompt:
      "أعطني رأي شراء أو بيع أو انتظار بناءً على الشارت الحالي والمخاطر.",
  },
  {
    id: "news_risk",
    label: "خطر الأخبار",
    prompt: "تحقق من خطر الأخبار على هذه الأداة الآن.",
  },
];

export function rememberOptions(sessionId: string, options: AgentOption[]): void {
  if (!sessionId || !options.length) return;
  optionStore.set(sessionId, { options, updatedAt: Date.now() });
}

export function clearOptions(sessionId: string): void {
  optionStore.delete(sessionId);
}

function getOptions(sessionId: string): AgentOption[] | null {
  const stored = optionStore.get(sessionId);
  if (!stored) return null;
  if (Date.now() - stored.updatedAt > OPTIONS_TTL_MS) {
    optionStore.delete(sessionId);
    return null;
  }
  return stored.options;
}

/**
 * If `message` is a bare option index ("1", "٢", "3.") and the session has
 * remembered options, return that option's prompt. Otherwise null (not an
 * option reply — treat the message normally).
 */
export function resolveOptionReply(
  sessionId: string,
  message: string,
): string | null {
  const normalized = normalizeNumber(String(message ?? "").trim());
  if (!normalized) return null;

  const index = Number(normalized) - 1;
  if (!Number.isInteger(index) || index < 0) return null;

  const options = getOptions(sessionId);
  const option = options?.[index];
  return option?.prompt ?? null;
}

/** Convert Arabic-Indic digits to ASCII and accept only a pure integer. */
export function normalizeNumber(value: string): string | null {
  const arabic: Record<string, string> = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  // Allow a single trailing "." or ")" e.g. "1." / "2)".
  const trimmed = value.replace(/[.)\s]+$/, "");
  const converted = trimmed
    .split("")
    .map((c) => arabic[c] ?? c)
    .join("");
  return /^\d+$/.test(converted) ? converted : null;
}
