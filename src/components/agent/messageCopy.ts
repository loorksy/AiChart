/**
 * Pure helpers for the chat message meta row (clock + copy). Kept out of the
 * React component so the clock format and the copy payload stay unit-testable
 * without a DOM runner.
 */

export function formatMessageClock(
  ts: number,
  locale: "ar" | "en",
): string {
  if (!Number.isFinite(ts)) return "";
  try {
    const formatted = new Date(ts).toLocaleTimeString(
      locale === "ar" ? "ar" : "en",
      {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    );
    return formatted === "Invalid Date" ? "" : formatted;
  } catch {
    return "";
  }
}

/** Text the copy control should put on the clipboard for this bubble. */
export function messageCopyText(m: {
  content: string;
  pending?: boolean;
  streamText?: string | null;
}): string {
  if (m.pending) return (m.streamText ?? "").trim();
  return m.content.trim();
}
