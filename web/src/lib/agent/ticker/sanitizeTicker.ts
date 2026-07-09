/**
 * Ticker text sanitization. Ticker lines are public UI text: they must never
 * carry chain-of-thought phrasing and must stay short enough for a one-line
 * animated ticker. Trailing dots are stripped (the UI animates its own dots).
 */
import { sanitizeActivityMessage } from "../activity";

const MAX_TICKER_CHARS = 70;

export function sanitizeTickerText(text: string): string {
  const clean = sanitizeActivityMessage(String(text ?? ""));
  return clean.replace(/[.،…\s]+$/g, "").slice(0, MAX_TICKER_CHARS).trim();
}
