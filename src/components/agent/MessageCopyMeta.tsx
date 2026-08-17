"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { formatMessageClock } from "./messageCopy";

/**
 * Clock + copy control under a chat bubble. `type="button"` so a click never
 * submits the composer form. The glyph is 12px; the hit target expands to
 * ≥44px via the ::after inset (same pattern as the recommendation copy).
 */
export function MessageCopyMeta({
  createdAt,
  text,
  align,
}: {
  createdAt?: number;
  text: string;
  align: "start" | "end";
}) {
  const { t, locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const copyable = text.trim().length > 0;
  if (!createdAt && !copyable) return null;

  return (
    <div
      data-testid="message-meta"
      className={cn(
        "mt-1 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {createdAt ? (
        <time
          data-testid="message-time"
          dateTime={new Date(createdAt).toISOString()}
          className="font-mono tabular-nums"
          dir="ltr"
        >
          {formatMessageClock(createdAt, locale)}
        </time>
      ) : null}
      {copyable ? (
        <button
          type="button"
          data-testid="message-copy"
          aria-label={copied ? t("agent.copied") : t("agent.copy")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="relative inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-3.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:after:-inset-2.5"
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}
