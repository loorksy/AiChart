/**
 * Telegram HTML hygiene: escaping and message splitting.
 *
 * Two production failure modes live here, both silent until a user hits them:
 *
 * 1. Every outbound send sets `parse_mode: "HTML"`, and the agent card path
 *    interpolated MODEL-AUTHORED text straight into that HTML. The first
 *    summary containing a bare `<` (a price comparison, a typo) makes the
 *    Bot API answer 400 "can't parse entities", the send throws, and the
 *    operator gets the generic "analysis could not be completed" — for an analysis that
 *    succeeded.
 * 2. Telegram caps message text at 4096 characters and nothing in the repo
 *    split anything. A long answer 400'd the same way, and the fallback send
 *    inside `finalize` failed identically, landing in the outer catch.
 */

/** Telegram's hard cap on message text length. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Escape model-authored text for a `parse_mode: "HTML"` message. The card
 * MARKUP stays literal — this is for the values interpolated into it.
 */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Split a message into Telegram-sized chunks on block boundaries.
 *
 * Splits prefer a blank line (a card boundary in the rendered output), then
 * a newline, and only then a hard cut — a tag pair never spans a split
 * because every card's markup opens and closes on the same line.
 */
export function splitTelegramMessage(
  text: string,
  limit = TELEGRAM_TEXT_LIMIT,
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // Prefer the last blank line; fall back to the last newline; then hard cut.
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit / 2) cut = window.lastIndexOf("\n");
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}
