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

/** Telegram's hard cap on a photo caption — the lead card must fit or split. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Escape model-authored text for a `parse_mode: "HTML"` message. The card
 * MARKUP stays literal — this is for the values interpolated into it.
 */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const QUOTE_OPEN = "<blockquote expandable>";
const QUOTE_CLOSE = "</blockquote>";

/** How many `<blockquote` opens in `chunk` have no matching close. */
function openQuotes(chunk: string): number {
  const opens = chunk.match(/<blockquote\b/g)?.length ?? 0;
  const closes = chunk.match(/<\/blockquote>/g)?.length ?? 0;
  return Math.max(0, opens - closes);
}

/**
 * Split a message into Telegram-sized chunks on block boundaries.
 *
 * Splits prefer a blank line (a card boundary in the rendered output), then
 * a newline, and only then a hard cut. Inline tag pairs never span a split
 * because they open and close on one line — but an expandable blockquote (a
 * folded card section) spans MANY lines, so a cut landing inside one is
 * repaired: the chunk closes its quote and the next chunk reopens it. An
 * unbalanced tag 400s BOTH sends, which is how a long answer used to become
 * the generic failure message.
 */
export function splitTelegramMessage(
  text: string,
  limit = TELEGRAM_TEXT_LIMIT,
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  // The repair below adds at most one open+close pair per chunk; carve the
  // window smaller by that much so a repaired chunk still fits the limit.
  const margin = QUOTE_OPEN.length + QUOTE_CLOSE.length;
  while (rest.length > limit) {
    const window = rest.slice(0, Math.max(1, limit - margin));
    // Prefer the last blank line; fall back to the last newline; then hard cut.
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit / 2) cut = window.lastIndexOf("\n");
    if (cut < limit / 2) cut = window.length;
    let chunk = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).trimStart();
    if (openQuotes(chunk) > 0) {
      chunk += QUOTE_CLOSE;
      rest = `${QUOTE_OPEN}${rest}`;
    }
    chunks.push(chunk);
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}
