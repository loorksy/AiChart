"use client";

/**
 * The Quick Tools tile grid — the one rendering of
 * `QUANT_AGENT_QUICK_TOOLS`, used by both surfaces that show it: the chat's
 * welcome state and the composer's "Quick tools" sheet.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/CopilotWorkbench.vue:48-67` (the
 * `.welcome-prompts` grid) and `:432-454` (the `.quick-task-modal-grid`
 * inside the Quick tools modal). Layout/interaction PATTERN only: no markup
 * or CSS is copied, and the tiles are AiChart components on `DESIGN.md`
 * tokens.
 *
 * What changed: upstream renders the same eight buttons twice, once per
 * surface, with two different CSS grids; here one component renders them and
 * each surface passes its own column count. Upstream's per-tile `tone` class
 * (`welcome-task--blue`, `--gold`, …) is dropped because it has no CSS rules
 * defined upstream either — it was inert. Tiles are borderless `bg-muted/50`
 * insets rather than bordered cards, because both surfaces are already inside
 * a card and `DESIGN.md` §4 forbids card-in-card. An `unavailable` tool renders
 * disabled with its reason where the description would be, instead of being
 * hidden — the user should learn the tool exists and why it cannot run.
 */
import { Code, Globe, Image as ImageIcon, LineChart, ClipboardList, Radar } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  QUANT_AGENT_QUICK_TOOLS,
  type QuantAgentQuickTool,
  type QuantAgentQuickToolIcon,
} from "@/lib/agent/quantAgentChat/quickTools";

/** Exhaustive by type: a new icon name in the registry will not compile without one here. */
const TOOL_ICONS: Record<QuantAgentQuickToolIcon, LucideIcon> = {
  "line-chart": LineChart,
  image: ImageIcon,
  code: Code,
  "clipboard-list": ClipboardList,
  globe: Globe,
  radar: Radar,
};

export interface QuantAgentQuickToolsProps {
  onSelect: (tool: QuantAgentQuickTool) => void;
  /** Set while a turn is in flight — a tool must not fire a second one. */
  disabled?: boolean;
  /** Grid classes the surface owns; the tiles themselves are identical. */
  className?: string;
}

export function QuantAgentQuickTools({ onSelect, disabled, className }: QuantAgentQuickToolsProps) {
  const { t } = useLocale();

  return (
    <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", className)}>
      {QUANT_AGENT_QUICK_TOOLS.map((tool) => {
        const Icon = TOOL_ICONS[tool.icon];
        const unavailable = tool.action === "unavailable";
        const note = tool.noteKey ? t(tool.noteKey) : null;
        return (
          <button
            key={tool.key}
            type="button"
            disabled={disabled}
            // An unavailable tool is `aria-disabled`, not `disabled`: it stays
            // focusable so a screen-reader user can reach it and hear WHY it
            // cannot run. Clicking is a no-op — the dispatch resolver returns
            // `unavailable` and the caller does nothing with it.
            aria-disabled={unavailable || undefined}
            onClick={() => onSelect(tool)}
            className={cn(
              "flex min-h-11 items-start gap-2.5 rounded-lg bg-muted/50 p-3 text-start transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Same disabled grammar as `squareui/button` — no hover, dimmed.
              "disabled:pointer-events-none disabled:opacity-60",
              unavailable ? "cursor-not-allowed opacity-70" : "hover:bg-muted",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground">{t(tool.labelKey)}</span>
                {unavailable ? (
                  <span className="ms-auto shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {t("qa.quicktool.unavailable")}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                {unavailable && note ? note : t(tool.descriptionKey)}
              </span>
              {!unavailable && note ? (
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">{note}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
