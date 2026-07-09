"use client";

import type { AgentTickerItem } from "@/lib/agent/ticker/types";

/**
 * Live one-line thinking ticker with animated dots. Shows the CURRENT
 * model-generated line only — no box, no title, no history. Renders nothing
 * when there is no dynamically generated item (never static fallback text).
 */
export function AgentThinkingTicker({
  item,
}: {
  item?: AgentTickerItem | null;
}) {
  if (!item || !item.text.trim()) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      dir="rtl"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      <span>{stripTrailingDots(item.text)}</span>
      <span className="inline-flex w-5 overflow-hidden">
        <span className="animate-thinking-dots">...</span>
      </span>
    </div>
  );
}

function stripTrailingDots(text: string): string {
  return text.replace(/[.،…\s]+$/g, "");
}
