import type { ContextLocale, NormalizedContextMessage } from "./types";

export function compactHistoricalProse(
  message: NormalizedContextMessage,
  locale: ContextLocale,
  maxChars = 900,
): NormalizedContextMessage {
  if (message.current || message.content.length <= maxChars) return message;
  const suffix = locale === "ar" ? "[تم اختصار سياق تاريخي]" : "[historical context compacted]";
  return {
    ...message,
    content: `${message.content.slice(0, Math.max(0, maxChars - suffix.length - 1)).trimEnd()}\n${suffix}`,
    safety: [...new Set([...message.safety.filter((v) => v !== "safe"), "oversized" as const])],
  };
}
